/* ZERO WIDTH – Engine (swing, linked chains w/ slides, per-step EXCL TRIG, polymeter EXCL STEP)
   Updates for this drop:
   - Local/Global transport friendly (UI handles arming).
   - EXCL TRIG is per-step and suppresses sub-triggers on that step only.
   - EXCL STEP removes the step from traversal (polymeter) and breaks link chains.
   - Trigger "Shape" is a velocity curve within each step's sub-triggers.
   - Rate labels support: "1/2","1/4","1/8","1/16" (back-compat "0.5x","1x","2x").
*/

(function (global) {
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const A_MAX = 0.70;

  function midiToFreq(m){ return 440 * Math.pow(2, (m - 69) / 12); }
  function midiToName(m){ const p=((m%12)+12)%12, o=Math.floor(m/12)-1; return `${NOTE_NAMES[p]}${o}`; }
  function nameToMidi_safe(str, fallback){
    const m = String(str||'').trim().match(/^([A-Ga-g])(#|b)?(-?\d+)$/);
    if (!m) return fallback;
    const base = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }[m[1].toUpperCase()];
    const acc  = m[2]==='#' ? 1 : (m[2]==='b' ? -1 : 0);
    const oct  = parseInt(m[3],10);
    return clamp(base + acc + (oct + 1) * 12, 0, 127);
  }
  function getVelocityValue(v){ return v==='LOW'?40 : v==='HIGH'?127 : 80; }
  function getGateFraction(g){ return g==='SHORT'?0.25 : g==='LONG'?0.9 : 0.5; }

  // sub-trigger velocity shape
  function triggerShapeMul(shape, k, n){
    if (n <= 1) return 1;
    const t = k / (n - 1);
    switch (shape){
      case 'FADE': return 1 - 0.5 * t;
      case 'RISE': return 0.5 + 0.5 * t;
      case 'DIP':  return 1 - 0.5 * Math.sin(Math.PI * t);
      default:     return 1;
    }
  }

  function triggerCount(val){ return val==='1/2'?2 : val==='1/3'?3 : val==='1/4'?4 : val==='1/8'?8 : 1; }

  function makeStep(id, midi=48){
    return {
      id,
      on: true,
      midi,
      gate: 'MEDIUM',
      velocity: 'MEDIUM',
      probability: 99,
      exclTrig: false,
      exclStep: false,
      link: false,
      pitchSlider: 50,
      noteText: midiToName(midi),
    };
  }

  class ZWEngine{
    constructor(){
      // Transport
      this.bpm = 120;
      this.timeSig = '4/4'; this.beatsPerBar = 4;
      this._rateFactor = 1;          // 1 => quarter notes
      this.swing = 0;
      this.playback = 'FORWARDS';
      this.startOffsetFrac = 0;
      this.trigger = 'OFF';
      this.shape = 'STEADY';
      this.transpose = 0;
      this.octave = 0;
      this.firstSelectedIdx = 0;
      this.pendingFirstIdx = null;

      // Sequencer
      this.maxSteps = 32;
      this.steps = Array.from({ length: 8 }, (_, i) => makeStep(i));
      this.trimStash = [];

      // Audio
      this.ctx = null;
      this.master = null;
      this.synthGain = null; this.synthVolume = 1.0;
      this.metGain = null; this.metEnabled = false;
      this.metLevel = 0.6;

      // Synth params
      this.envRoute = 'AMP';
      this.glide = 0.03; // seconds

      // Scheduler (PPQ)
      this.isPlaying = false;
      this.ppq = 96;
      this.lookahead = 0.0125;
      this.scheduleAheadTime = 0.2;
      this.tickInterval = 0;
      this.nextTickTime = 0;
      this.tickCount = 0;
      this.startOffsetTicks = 0;
      this.stepTicks = this.ppq; // 1/4 by default
      this.stepCounter = 0;
      this.stepIndex = 0;
      this.pingPongDir = 1;

      this.cb = { onStatus:()=>{}, onBeat:()=>{}, onPulse:()=>{}, onStepPlaying:()=>{}, onRender:()=>{} };
    }

    setCallbacks(cb){ this.cb = { ...this.cb, ...cb }; }

    // ---------- Audio ----------
    ensureAudio(){
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.synthGain = this.ctx.createGain();
      this.synthGain.gain.value = this.synthVolume;
      this.synthGain.connect(this.master);

      this.metGain = this.ctx.createGain();
      this.metGain.gain.value = this.metEnabled ? this.metLevel : 0;
      this.metGain.connect(this.master);
    }
    _resumeAudio(){
      if (this.ctx && this.ctx.state === 'suspended'){
        try { this.ctx.resume(); } catch {}
      }
    }
    dispose(){
      try { this.stop(); this.ctx?.close(); } catch {}
      this.ctx = null; this.master = null; this.synthGain = null; this.metGain = null;
    }

    // ---------- Transport setters ----------
    setBpm(v){ this.bpm = clamp(parseInt(v,10)||120, 60, 200); this._recalcTiming(); this.cb.onRender(); }
    setTimeSignature(sig){ this.timeSig=sig; const n=parseInt(sig.split('/')[0],10); this.beatsPerBar=clamp(isNaN(n)?4:n,1,16); this.cb.onRender(); }
    setMetronomeEnabled(on){ this.metEnabled=!!on; if(this.metGain) this.metGain.gain.value = on ? this.metLevel : 0; this.cb.onRender(); }
    setMetVolumePercent(p){ const lvl = clamp(parseFloat(p)||0, 0, 150)/100; this.metLevel=lvl; if(this.metGain) this.metGain.gain.value = this.metEnabled?lvl:0; this.cb.onRender(); }

    setSynthVolume(v){ this.synthVolume = clamp(v,0,1); if(this.synthGain) this.synthGain.gain.value = this.synthVolume; this.cb.onRender(); }

    // Accepts "1/2","1/4","1/8","1/16" and old "0.5x","1x","2x"
    setRateFromLabel(lbl){
      const map = {
        '1/2': 0.5, '1/4': 1, '1/8': 2, '1/16': 4,
        '0.5x':0.5, '1x':1, '2x':2
      };
      this._rateFactor = map[lbl] ?? 1;
      this._recalcTiming();
      this.cb.onRender();
    }

    setSwingPercent(p){ this.swing = clamp((parseInt(p,10)||0)/100, 0, 1); this.cb.onRender(); }
    setPlaybackMode(m){ this.playback = m; this.cb.onRender(); }
    setStartOffset(val){ const map={'OFF':0,'1/8':1/8,'1/4':1/4,'3/8':3/8,'1/2':1/2}; this.startOffsetFrac = map[val] ?? 0; this.cb.onRender(); }
    setTrigger(val){ this.trigger = val; this.cb.onRender(); }
    setShape(val){ this.shape = val; this.cb.onRender(); } // sub-trigger curve
    setTranspose(s){ this.transpose = clamp(parseInt(s,10)||0, -24, 24); this.cb.onRender(); }
    setGlideFrom0to100(v){ const t = clamp(parseInt(v,10)||0, 0, 100)/100; this.glide = 0.2 * t; this.cb.onRender(); }
    setOctave(o){ this.octave = clamp(parseInt(o,10)||0, -3, 3); this.cb.onRender(); }
    setEnvRoute(r){ this.envRoute = r; this.cb.onRender(); }

    // ---------- Steps ----------
    get stepCount(){ return this.steps.length; }
    setStepCount(n){
      n = clamp(parseInt(n,10)||8, 1, this.maxSteps);
      const old = this.steps.length;
      if (n === old) return;

      if (n < old){
        const trimmed = this.steps.splice(n);
        this.trimStash = trimmed.concat(this.trimStash).slice(0, this.maxSteps);
      } else {
        while (this.steps.length < n){
          const restored = this.trimStash.shift();
          if (restored){ restored.id = this.steps.length; this.steps.push(restored); }
          else this.steps.push(makeStep(this.steps.length));
        }
      }
      this.firstSelectedIdx = clamp(this.firstSelectedIdx, 0, this.steps.length - 1);
      if (this.pendingFirstIdx != null) this.pendingFirstIdx = clamp(this.pendingFirstIdx, 0, this.steps.length - 1);
      this.cb.onRender();
    }
    selectFirst(i){ i = clamp(i,0,this.steps.length-1); this.pendingFirstIdx=i; this.stepIndex=i; this.cb.onRender(); }
    commitReorder(){
      if (this.pendingFirstIdx == null) return;
      const k = this.pendingFirstIdx;
      const rot = this.steps.slice(k).concat(this.steps.slice(0,k));
      rot.forEach((s,i)=>s.id=i);
      this.steps = rot;
      this.firstSelectedIdx = 0;
      this.pendingFirstIdx = null;
      this.stepIndex = 0;
      this.cb.onRender();
    }

    updateStep(i, patch, opts={}){
      const s = this.steps[i]; if (!s) return;
      Object.assign(s, patch);
      if ('midi' in patch) s.noteText = midiToName(s.midi);
      if (!opts.silent) this.cb.onRender();
    }
    nudgeStepSemitone(i, d, opts={}){
      const s=this.steps[i]; if (!s) return;
      s.midi = clamp(s.midi + d, 0, 127);
      s.noteText = midiToName(s.midi);
      if (!opts.silent) this.cb.onRender();
    }
    setStepNoteFromText(i, txt, opts={}){
      const s=this.steps[i]; if (!s) return;
      const m = nameToMidi_safe(txt, s.midi);
      s.midi = m; s.noteText = midiToName(m);
      if (!opts.silent) this.cb.onRender();
    }

    // ---------- Active-step helpers (polymeter) ----------
    _isActive(idx){ const s=this.steps[idx]; return !!(s && !s.exclStep); }
    _activeIndices(){
      const a=[]; for(let i=0;i<this.steps.length;i++) if(this._isActive(i)) a.push(i);
      return a;
    }
    _nextActiveIndex(idx, dir){
      const N=this.steps.length; if(N===0) return -1;
      let j = idx;
      for (let k=0;k<N;k++){
        j = (j + dir + N) % N;
        if (this._isActive(j)) return j;
      }
      return -1;
    }
    _firstActiveFrom(start, dir=+1){
      const N=this.steps.length; if(N===0) return -1;
      let j = clamp(start,0,N-1);
      if (this._isActive(j)) return j;
      return this._nextActiveIndex(j, dir);
    }
    _prevActive(idx){ return this._nextActiveIndex(idx, -1); }
    _nextActive(idx){ return this._nextActiveIndex(idx, +1); }

    // ---------- Link groups (respect EXCL STEP as breaks) ----------
    _getLinkGroupBoundsAt(idx){
      if (!this._isActive(idx)) return {start:idx, end:idx};
      let start=idx, end=idx;
      while (true){
        const p = this._prevActive(start);
        if (p<0) break;
        if (!this.steps[p].link) break;
        start = p;
      }
      while (true){
        if (!this.steps[end].link) break;
        const n = this._nextActive(end);
        if (n<0) break;
        end = n;
      }
      return {start, end};
    }
    _isChild(i){
      if (!this._isActive(i)) return false;
      const p = this._prevActive(i);
      return (p>=0) && !!this.steps[p].link;
    }
    _isParent(i){
      if (!this._isActive(i)) return false;
      if (!this.steps[i].link) return false;
      const n = this._nextActive(i);
      return (n>=0);
    }

    // ---------- Transport ----------
    play(){
      this.ensureAudio();
      this._resumeAudio();
      if (this.isPlaying) return;

      this._recalcTiming();
      const barTicks = this.beatsPerBar * this.ppq;
      this.startOffsetTicks = Math.round(barTicks * this.startOffsetFrac);
      this.tickCount = 0;
      const offsetSec = this.startOffsetTicks * this.tickInterval;
      this.nextTickTime = this.ctx.currentTime + offsetSec;

      const desired = (this.pendingFirstIdx!=null) ? this.pendingFirstIdx : this.stepIndex;
      this.stepIndex = this._firstActiveFrom(desired, +1);
      if (this.stepIndex < 0) this.stepIndex = 0;
      this.pingPongDir = 1;
      this.stepCounter = 0;

      this.isPlaying = true;
      this.cb.onStatus('PLAYING');
      this.timerId = setInterval(()=>this._scheduler(), this.lookahead * 1000);
    }
    stop(){
      if (!this.isPlaying) return;
      clearInterval(this.timerId); this.timerId = null;
      this.isPlaying = false;
      this.cb.onStatus('STOPPED');
      this.cb.onStepPlaying(-1);
      this.cb.onPulse(false, false);
    }

    _recalcTiming(){
      this.tickInterval = (60 / this.bpm) / this.ppq;
      // map factor: 0.5=>halves, 1=>quarters, 2=>eighths, 4=>sixteenths
      this.stepTicks = Math.round(this.ppq / this._rateFactor);
    }

    // ---------- PPQ Scheduler ----------
    _scheduler(){
      if (!this.isPlaying || !this.ctx) return;

      const barTicks = this.beatsPerBar * this.ppq;

      while (this.nextTickTime < this.ctx.currentTime + this.scheduleAheadTime){
        const gridTick = (this.tickCount + this.startOffsetTicks);
        const t = this.nextTickTime;

        if (gridTick % this.ppq === 0){
          const beatIndex = Math.floor(gridTick / this.ppq);
          const isDownbeat = (beatIndex % this.beatsPerBar) === 0;
          this._scheduleMetronome(t, isDownbeat);
          this.cb.onBeat((beatIndex % this.beatsPerBar) + 1, isDownbeat);
          this.cb.onPulse(true, isDownbeat);
        }

        if (gridTick % this.stepTicks === 0){
          this._scheduleCurrentStep(t, gridTick);
        }

        this.tickCount = (this.tickCount + 1) % barTicks;
        this.nextTickTime += this.tickInterval;
      }
    }

    // ---------- Swing core ----------
    _computeSwing(gridTick){
      const pairTicks = this.stepTicks * 2;
      const pairSec   = pairTicks * this.tickInterval;
      const phase     = (gridTick % pairTicks);
      const isSecond  = phase >= this.stepTicks;

      const s = clamp(this.swing, 0, 1);
      const a = 0.5 + s * (A_MAX - 0.5);

      const onsetShift = isSecond ? (a - 0.5) * pairSec : 0;
      const windowSec  = isSecond ? (1 - a) * pairSec : a * pairSec;

      return { onsetShift, windowSec, a, isSecond };
    }

    _grooveFractions(count, a){
      if (count <= 1) return [0];
      if (count === 3) return [0, 1/3, 2/3];
      const warp = (f)=> (f < 0.5)
        ? (f * (a / 0.5))
        : (a + (f - 0.5) * ((1 - a) / 0.5));
      return Array.from({length: count}, (_,n)=>{
        const f = n / count;
        return warp(f);
      });
    }

    _scheduleCurrentStep(tBase, gridTick){
      let i = this.stepIndex;
      if (!this._isActive(i)){
        i = this._firstActiveFrom(i, +1);
        if (i < 0) return;
        this.stepIndex = i;
      }

      const s = this.steps[i];
      let played = -1;

      const inChain  = this._isChild(i) || this._isParent(i);
      let probOk = true;
      if (inChain){
        const {start} = this._getLinkGroupBoundsAt(i);
        const p = (this.steps[start].probability || 99) / 100;
        probOk = Math.random() <= p;
      } else {
        const p = (s.probability || 99) / 100;
        probOk = Math.random() <= p;
      }

      if (probOk && s.on){
        const { onsetShift, windowSec, a } = this._computeSwing(gridTick);
        let t = tBase + onsetShift;
        if (t < this.ctx.currentTime) t = this.ctx.currentTime + 0.001;

        if (inChain){
          const {start, end} = this._getLinkGroupBoundsAt(i);
          const isGroupStart = (i === start);
          const isGroupEnd   = (i === end);

          if (isGroupStart){
            const windows = [];
            for (let k=start; k<=end; k++){
              const { windowSec: w } = this._computeSwing(gridTick + (k-start)*this.stepTicks);
              windows.push(w);
            }

            const baseVel = getVelocityValue(this.steps[start].velocity);
            const vel     = clamp(Math.round(baseVel), 1, 127);
            const parent  = this.steps[start];
            const baseMidi0 = clamp(parent.midi + this.transpose + this.octave * 12, 0, 127);

            const lastStep      = this.steps[end];
            const lastGateFrac  = getGateFraction(lastStep.gate);
            const totalLen = Math.max(
              0.001,
              windows.slice(0, windows.length-1).reduce((a,b)=>a+b, 0) + lastGateFrac * windows[windows.length-1]
            );

            // pitch slides at each chain boundary
            const pitchEvents = [];
            let acc = 0;
            for (let k=start; k<end; k++){
              acc += windows[k-start];
              const childIdx  = this._nextActive(k);
              if (childIdx<0) break;
              const childStep = this.steps[childIdx];
              const childMidi = clamp(childStep.midi + this.transpose + this.octave * 12, 0, 127);
              const childWin  = windows[(childIdx - start)];
              const glDur     = Math.min(this.glide, Math.max(0.001, (childWin||windows[windows.length-1]) * 0.9));
              pitchEvents.push({ time: t + acc, midi: childMidi, glide: glDur });
            }

            this._triggerVoiceWithPitchAutomation(baseMidi0, vel, t, totalLen, pitchEvents);
            played = start;
          }

          // sub-triggers only from terminal step and only if that terminal step is NOT exclTrig
          if (isGroupEnd && !this.steps[end].exclTrig){
            const term = this.steps[end];
            const trigSetting = this.trigger;
            const retrigs = triggerCount(trigSetting);
            if (retrigs > 1){
              const termMidi = clamp(term.midi + this.transpose + this.octave * 12, 0, 127);
              const baseVel  = getVelocityValue(term.velocity);
              const fracs    = this._grooveFractions(retrigs, a);
              const offsets  = fracs.map(f => f * windowSec);

              for (let n=0;n<retrigs;n++){
                const startOff = offsets[n];
                const nextOff  = (n < retrigs-1) ? offsets[n+1] : windowSec;
                const seg      = Math.max(0.001, nextOff - startOff);
                const when     = t + startOff;
                const len      = getGateFraction(term.gate) * seg;
                const mul      = triggerShapeMul(this.shape, n, retrigs);
                const velN     = clamp(Math.round(baseVel * mul), 1, 127);
                this._triggerVoice(termMidi, velN, when, len);
              }
            }
          }
        } else {
          // standalone step
          const baseMidi = clamp(s.midi + this.transpose + this.octave * 12, 0, 127);
          const baseVel  = getVelocityValue(s.velocity);

          const retrigs = s.exclTrig ? 1 : triggerCount(this.trigger);
          const fracs = this._grooveFractions(retrigs, a);
          const offsetsSec = fracs.map(f => f * windowSec);

          for (let n=0;n<retrigs;n++){
            const startOff = offsetsSec[n];
            const nextOff  = (n < retrigs-1) ? offsetsSec[n+1] : windowSec;
            const seg      = Math.max(0.001, nextOff - startOff);
            const when     = t + startOff;
            const len      = getGateFraction(s.gate) * seg;
            const mul      = triggerShapeMul(this.shape, n, retrigs);
            const velN     = clamp(Math.round(baseVel * mul), 1, 127);
            this._triggerVoice(baseMidi, velN, when, len);
          }
          played = i;
        }
      }

      this.cb.onStepPlaying(played);
      this._advanceIndex();
      this.stepCounter++;
    }

    _advanceIndex(){
      const N = this.steps.length; if (N === 0) return;

      const active = this._activeIndices();
      if (active.length === 0) return;

      switch (this.playback){
        case 'FORWARDS': {
          const nx = this._nextActive(this.stepIndex);
          if (nx >= 0) this.stepIndex = nx;
          break;
        }
        case 'BACKWARDS': {
          const pv = this._prevActive(this.stepIndex);
          if (pv >= 0) this.stepIndex = pv;
          break;
        }
        case 'PINGPONG': {
          let next = (this.pingPongDir > 0) ? this._nextActive(this.stepIndex) : this._prevActive(this.stepIndex);
          if (next < 0){
            this.pingPongDir *= -1;
            next = (this.pingPongDir > 0) ? this._nextActive(this.stepIndex) : this._prevActive(this.stepIndex);
          }
          if (next >= 0) this.stepIndex = next;
          break;
        }
        case 'RANDOM': {
          if (active.length === 1){ this.stepIndex = active[0]; break; }
          const curIdx = active.indexOf(this.stepIndex);
          let pick = curIdx;
          while (pick === curIdx){
            pick = Math.floor(Math.random() * active.length);
          }
          this.stepIndex = active[pick];
          break;
        }
        default: {
          const nx = this._nextActive(this.stepIndex);
          if (nx >= 0) this.stepIndex = nx;
        }
      }
    }

    // ---------- Metronome ----------
    _scheduleMetronome(t, downbeat){
      if (!this.metGain) return;
      const osc=this.ctx.createOscillator();
      const g=this.ctx.createGain();
      osc.frequency.value = downbeat ? 1400 : 950;
      g.gain.value = 0.0001;
      osc.connect(g).connect(this.metGain);
      osc.start(t);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      osc.stop(t + 0.04);
    }

    // ---------- Voices ----------
    _triggerVoice(midi, velocity127, when, dur){
      this._triggerVoiceWithPitchAutomation(midi, velocity127, when, dur, null);
    }

    _triggerVoiceWithPitchAutomation(initialMidi, velocity127, when, dur, pitchEvents){
      const osc=this.ctx.createOscillator();
      const pulse=this.ctx.createOscillator();
      const shaper=this.ctx.createGain();
      const vca=this.ctx.createGain();
      const biq=this.ctx.createBiquadFilter();

      const isPulse = this.wave === 'PULSE';
      osc.type = 'square';

      let lastFreq = midiToFreq(initialMidi);
      osc.frequency.setValueAtTime(lastFreq, when);

      if (isPulse){
        pulse.type='sawtooth';
        pulse.frequency.value = Math.max(0.01, (this.pwm||50)/100) * lastFreq;
        shaper.gain.value = 0.9;
        pulse.connect(shaper.gain);
        osc.connect(shaper);
        pulse.start(when);
      } else {
        osc.connect(shaper);
      }

      biq.type = 'lowpass';
      const cutoffHz = this.cutoffHz || 16020;
      const q = this.resonance || 0;
      biq.frequency.setValueAtTime(cutoffHz, when);
      biq.Q.value = q;

      if (this.envRoute === 'FILTER'){
        const fStart = cutoffHz * 0.6;
        biq.frequency.cancelScheduledValues(when);
        biq.frequency.setValueAtTime(fStart, when);
        biq.frequency.linearRampToValueAtTime(cutoffHz, when + clamp(this.attack||0.01, 0.001, 1));
      }

      shaper.connect(biq).connect(vca).connect(this.synthGain);

      // Amp env
      const peak = clamp(velocity127 / 127, 0.01, 1.0);
      const atk  = clamp(this.attack||0.01, 0.001, 2);
      const dec  = clamp(this.decay||0.1, 0.001, 2);
      const sus  = clamp((this.sustain!=null?this.sustain:0.7), 0, 1);
      const rel  = clamp(this.release||0.1, 0.001, 3);

      vca.gain.setValueAtTime(0.0001, when);
      vca.gain.linearRampToValueAtTime(peak, when + atk);
      vca.gain.linearRampToValueAtTime(peak * sus, when + atk + dec);
      vca.gain.setValueAtTime(peak * sus, when + Math.max(atk + dec, dur));
      vca.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(atk + dec, dur) + rel);

      // Slides across link boundaries
      if (Array.isArray(pitchEvents) && pitchEvents.length){
        pitchEvents.forEach(evt=>{
          const tEvt = Math.max(when, evt.time);
          const fTgt = midiToFreq(evt.midi);
          const gl   = clamp(evt.glide || this.glide || 0.01, 0.0001, 2);
          osc.frequency.setValueAtTime(lastFreq, tEvt);
          osc.frequency.linearRampToValueAtTime(fTgt, tEvt + gl);
          lastFreq = fTgt;
        });
      }

      // LFO
      if (this.lfoShape && this.lfoRate && this.lfoDepth){
        const lfo=this.ctx.createOscillator();
        const lg=this.ctx.createGain();
        lfo.type = this.lfoShape==='SINE' ? 'sine' :
                   this.lfoShape==='SQUARE' ? 'square' :
                   this.lfoShape==='SAW' ? 'sawtooth' : 'triangle';
        const rateHz = this._divToHz(this.lfoRate);
        lfo.frequency.setValueAtTime(rateHz, when);
        lg.gain.value = this.lfoDepth * 50;
        lfo.connect(lg);
        if (this.pitchModSrc === 'LFO') lg.connect(osc.detune); else lg.connect(biq.frequency);
        lfo.start(when); lfo.stop(when + dur + 2);
      }

      const tail = Math.max(0.15, (this.release || 0.2) + 0.05);
      osc.start(when); osc.stop(when + dur + tail);
      if (isPulse) pulse.stop(when + dur + tail);
    }

    _divToHz(div){
      const q = 60 / this.bpm;
      switch(div){
        case '1/1': return 1 / q;
        case '1/2': return 1 / (q * 2);
        case '1/4': return 1 / (q * 4);
        case '1/8': return 1 / (q * 8);
        case '1/16':return 1 / (q * 16);
        default:    return 1 / (q * 4);
      }
    }

    // ---------- Synth Param API ----------
    setSynthParam(name, value){
      switch (name){
        case 'wave': this.wave=value; break;
        case 'pwm': this.pwm=clamp(parseInt(value,10)||50, 0, 100); break;
        case 'attack': this.attack=(parseInt(value,10)||0)/100*0.8 + 0.005; break;
        case 'decay': this.decay=(parseInt(value,10)||0)/100*0.8 + 0.01; break;
        case 'sustain': this.sustain=(parseInt(value,10)||0)/100; break;
        case 'release': this.release=(parseInt(value,10)||0)/100*1.2 + 0.02; break;
        case 'glide': this.setGlideFrom0to100(value); break;
        case 'cutoff': {
          const t=clamp(parseInt(value,10)||0,0,100)/100; const min=50, max=16020;
          this.cutoffHz = min * Math.pow(max/min, t); break;
        }
        case 'resonance': this.resonance=(parseInt(value,10)||0)/10; break;
        case 'lfoShape': this.lfoShape=value; break;
        case 'lfoRate': this.lfoRate=value; break;
        case 'lfoDepth': this.lfoDepth=(parseInt(value,10)||0)/100; break;
        case 'lfoDelay': this.lfoDelay=(parseInt(value,10)||0)/100; break;
        case 'lfoPhase': this.lfoPhase=(parseInt(value,10)||0)/100; break;
        case 'envRoute': this.setEnvRoute(value); break;
        case 'octave': this.setOctave(value); break;
        // bit engine placeholders
        case 'bitModel': this.bitModel=value; break;
        case 'bitResolution': this.bitResolution=parseInt(value,10)||0; break;
        case 'bitLevel': this.bitLevel=parseInt(value,10)||0; break;
        case 'bitPitch': this.bitPitch=parseInt(value,10)||0; break;
        case 'bitVelMod': this.bitVelMod=parseInt(value,10)||0; break;
        case 'bitOnset': this.bitOnset=parseInt(value,10)||0; break;
        case 'pitchModSrc': this.pitchModSrc=value; break;
      }
      this.cb.onRender();
    }

    // ---------- State ----------
    getState(){
      return {
        bpm:this.bpm, timeSig:this.timeSig, rateFactor:this._rateFactor, swing:this.swing, playback:this.playback,
        startOffsetFrac:this.startOffsetFrac, trigger:this.trigger, shape:this.shape, transpose:this.transpose,
        firstSelectedIdx:this.firstSelectedIdx, pendingFirstIdx:this.pendingFirstIdx,
        steps:this.steps, stash:this.trimStash,
        synthVolume:this.synthVolume, metLevel:this.metLevel, metEnabled:this.metEnabled,
        wave:this.wave||'SQUARE', pwm:this.pwm||50, attack:this.attack||0.01, decay:this.decay||0.2,
        sustain:this.sustain!=null?this.sustain:0.7, release:this.release||0.4, glide:this.glide,
        cutoffHz:this.cutoffHz||16020, resonance:this.resonance||0,
        lfoShape:this.lfoShape||'SINE', lfoRate:this.lfoRate||'1/4', lfoDepth:this.lfoDepth||0,
        lfoDelay:this.lfoDelay||0, lfoPhase:this.lfoPhase||0, envRoute:this.envRoute||'AMP', octave:this.octave||0,
        bitModel:this.bitModel||'REDUX', bitResolution:this.bitResolution||75, bitLevel:this.bitLevel||50,
        bitPitch:this.bitPitch||0, bitVelMod:this.bitVelMod||25, bitOnset:this.bitOnset||30,
      };
    }
    setState(st){
      if (!st) return;
      Object.assign(this, {
        bpm:st.bpm ?? this.bpm, timeSig:st.timeSig ?? this.timeSig, swing:st.swing ?? this.swing, playback:st.playback ?? this.playback,
        startOffsetFrac:st.startOffsetFrac ?? this.startOffsetFrac, trigger:st.trigger ?? this.trigger,
        shape:st.shape ?? this.shape, transpose:st.transpose ?? this.transpose,
        firstSelectedIdx:st.firstSelectedIdx ?? this.firstSelectedIdx, pendingFirstIdx:st.pendingFirstIdx ?? null,
        synthVolume:st.synthVolume ?? this.synthVolume, metLevel:st.metLevel ?? this.metLevel, metEnabled:st.metEnabled ?? this.metEnabled,
        wave:st.wave ?? 'SQUARE', pwm:st.pwm ?? 50, attack:st.attack ?? 0.01, decay:st.decay ?? 0.2,
        sustain:st.sustain ?? 0.7, release:st.release ?? 0.4, glide:st.glide ?? 0.03,
        cutoffHz:st.cutoffHz ?? 16020, resonance:st.resonance ?? 0,
        lfoShape:st.lfoShape ?? 'SINE', lfoRate:st.lfoRate ?? '1/4', lfoDepth:st.lfoDepth ?? 0,
        lfoDelay:st.lfoDelay ?? 0, lfoPhase:st.lfoPhase ?? 0, envRoute:st.envRoute ?? 'AMP', octave:st.octave ?? 0,
        bitModel:st.bitModel ?? 'REDUX', bitResolution:st.bitResolution ?? 75, bitLevel:st.bitLevel ?? 50,
        bitPitch:st.bitPitch ?? 0, bitVelMod:st.bitVelMod ?? 25, bitOnset:st.bitOnset ?? 30,
      });
      if (st.rateFactor!=null) this._rateFactor = st.rateFactor;

      if (this.metGain) this.metGain.gain.value = this.metEnabled ? this.metLevel : 0;
      if (this.synthGain) this.synthGain.gain.value = this.synthVolume;

      if (Array.isArray(st.steps)){
        this.steps = st.steps.map((x,i)=>({ ...makeStep(i), ...x, id:i }));
      }
      this.trimStash = Array.isArray(st.stash) ? st.stash : [];
      this._recalcTiming();
      this.cb.onRender();
    }
  }

  global.ZWEngine = ZWEngine;
})(window);
