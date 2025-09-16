/* ZERO WIDTH – UI Bridge
   Includes:
   - Local sequencer Start/Stop (armed mode)
   - Settings panel toggle
   - MRU Save/Load (10 most recent)
   - Linked steps UI (child shows LINKED/disabled; parent shows +N and gate locked long)
   - Trigger rate rules with hidden/filtered options (no disabled items)
   - Rate labels support 1/2,1/4,1/8,1/16 (back-compat 0.5x/1x/2x)
   
   SINGLE FIX: Klang stop no longer kills Zero Width master transport
*/

(function(){
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));

  // Transport (master)
  const bpmInput=$('#bpmInput');
  const timeSignatureSelect=$('#timeSignatureSelect');
  const pulseIndicator=$('#pulseIndicator');
  const beatCounter=$('#beatCounter');
  const metronomeBtn=$('#metronomeBtn');
  const playStopBtn=$('#playStopBtn');
  const playIcon=playStopBtn?.querySelector('.zw-play-icon');
  const stopIcon=playStopBtn?.querySelector('.zw-stop-icon');
  const transportText=playStopBtn?.querySelector('.zw-transport-text');
  const sessionStatus=$('#sessionStatus');
  const sessionDetails=$('#sessionDetails');
  const saveBtn=$('#saveBtn');
  const loadBtn=$('#loadBtn');
  const sessionSelect=$('#sessionSelect');

  // Local sequencer transport (optional)
  const seqLocalBtn = $('#seqLocalBtn') || $('#sequencerPlayBtn');

  // Volume
  const metVolSlider = $('#metVolSlider');
  const metVolValue  = $('#metVolValue');
  const synthVolSlider = $('#synthVolSlider');
  const synthVolValue  = $('#synthVolValue');

  // Sequencer controls
  const stepsDown=$('#stepsDown');
  const stepsUp=$('#stepsUp');
  const stepsDisplay=$('#stepsDisplay');
  const rateButtons=$$('.rate-btn');
  const swingInput=$('#swingInput');
  const swingValue=$('#swingValue');
  const playbackSelect=$('#playbackSelect');
  const startOffsetSelect=$('#startOffsetSelect');
  const triggerSelect=$('#triggerSelect');
  const shapeSelect=$('#shapeSelect');
  const reorderBtn=$('#reorderBtn');

  // Steps & transpose
  const stepsRoot=$('#sequencerSteps');
  const transposeBtns=$$('.transpose-btn');

  // Synth controls
  const envRouteBtns=$$('.envelope-controls [data-route]');
  const attackSlider=$('#attackSlider'), decaySlider=$('#decaySlider'),
        sustainSlider=$('#sustainSlider'), releaseSlider=$('#releaseSlider'),
        glideSlider=$('#glideSlider');
  const octaveDown=$('#octaveDown'), octaveUp=$('#octaveUp'), octaveDisplay=$('#octaveDisplay');

  const waveSelect=$('#waveSelect'), pwmSlider=$('#pwmSlider');

  const bitModelSelect=$('#bitModelSelect'), resolutionSlider=$('#resolutionSlider'),
        levelSlider=$('#levelSlider'), bitPitchSlider=$('#bitPitchSlider'),
        velModSlider=$('#velModSlider'), onsetSlider=$('#onsetSlider');

  const cutoffSlider=$('#cutoffSlider'), resonanceSlider=$('#resonanceSlider'),
        filterPitchSlider=$('#filterPitchSlider'), filterVelSlider=$('#filterVelSlider'),
        lfoModSlider=$('#lfoModSlider'), envModSlider=$('#envModSlider');

  const lfoShapeSelect=$('#lfoShapeSelect'), lfoRateSelect=$('#lfoRateSelect'),
        lfoSwingSlider=$('#lfoSwingSlider'), lfoDepthSlider=$('#lfoDepthSlider'),
        lfoDelaySlider=$('#lfoDelaySlider'), lfoPhaseSlider=$('#lfoPhaseSlider');

  const settingsToggle=$('#settingsToggle'), settingsPanel=$('#settingsPanel');

  // Engine
  const engine=new ZWEngine();

  // ---------- Local transport arming ----------
  let seqArmed = false;
  let desiredStartIdx = null;

  function pulseOnce(){
    if (!pulseIndicator) return;
    pulseIndicator.classList.add('active');
    setTimeout(()=>pulseIndicator.classList.remove('active'), 120);
  }

  function setMasterTransportUI(state){
    if (!playStopBtn) return;
    if (state==='PLAYING'){
      playStopBtn.classList.add('active');
      if (playIcon) playIcon.style.display='none';
      if (stopIcon) stopIcon.style.display='';
      if (transportText) transportText.textContent='STOP';
    } else {
      playStopBtn.classList.remove('active');
      if (playIcon) playIcon.style.display='';
      if (stopIcon) stopIcon.style.display='none';
      if (transportText) transportText.textContent='PLAY';
    }
  }

  function setLocalBtnUI(){
    if (!seqLocalBtn) return;
    if (engine.isPlaying){
      seqLocalBtn.classList.add('active');
      seqLocalBtn.textContent = 'STOP';
      seqLocalBtn.dataset.state = 'playing';
    } else if (seqArmed){
      seqLocalBtn.classList.add('active');
      seqLocalBtn.textContent = 'ARMED';
      seqLocalBtn.dataset.state = 'armed';
    } else {
      seqLocalBtn.classList.remove('active');
      seqLocalBtn.textContent = 'START';
      seqLocalBtn.dataset.state = 'idle';
    }
  }

  // ---------- Trigger options per rate (no disabled items) ----------
  function currentRateFactor(){
    // engine keeps the factor as a property; default 1 for quarter notes
    return engine._rateFactor || 1;
  }
  function allowedTriggersForRateFactor(f){
    // No OFF here per your spec; hide control if none
    if (f === 0.5) return ['1/2','1/3','1/4','1/8']; // rate 1/2
    if (f === 1)   return ['1/2','1/3','1/4'];       // rate 1/4
    if (f === 2)   return ['1/2'];                   // rate 1/8
    if (f === 4)   return [];                        // rate 1/16
    // default fallback
    return ['1/2','1/3','1/4'];
  }
  function rebuildTriggerOptions(){
    if (!triggerSelect) return;
    const groupEl = triggerSelect.closest('.control-group');
    const f = currentRateFactor();
    const allowed = allowedTriggersForRateFactor(f);

    triggerSelect.innerHTML = '';

    if (allowed.length === 0){
      // Hide the whole Trigger control when none are available
      groupEl?.classList.add('hidden');
      return;
    }
    groupEl?.classList.remove('hidden');

    allowed.forEach(val=>{
      const opt=document.createElement('option');
      opt.value=val; opt.textContent=val;
      triggerSelect.appendChild(opt);
    });

    // Ensure engine.trigger is valid; if not, pick first allowed
    if (!allowed.includes(engine.trigger)){
      engine.setTrigger(allowed[0]);
      triggerSelect.value = allowed[0];
    } else {
      triggerSelect.value = engine.trigger;
    }
  }

  // ---------- Engine <-> UI ----------
  engine.setCallbacks({
    onStatus:(s)=>{
      sessionStatus.textContent=s;
      setMasterTransportUI(s);
      if (s === 'PLAYING'){
        if (seqArmed){
          const idx = (desiredStartIdx!=null) ? desiredStartIdx : 0;
          engine.stepIndex = idx;
          desiredStartIdx = null;
          seqArmed = false;
        }
      }
      setLocalBtnUI();
    },
    onBeat:(beat,down)=>{ beatCounter.textContent=String(beat); pulseIndicator?.classList.toggle('downbeat',!!down); },
    onPulse:()=>{ if(pulseIndicator){ pulseIndicator.classList.add('active'); setTimeout(()=>pulseIndicator.classList.remove('active'),60); } },
    onStepPlaying:(idx)=>{
      const cards=$$('.step-card'); const nums=$$('.step-number');
      cards.forEach((c,i)=>{ c.classList.toggle('is-playing',i===idx); c.classList.toggle('active', i===idx); });
      nums.forEach((n,i)=>n.classList.toggle('current', i===idx));
    },
    onRender:()=>{
      sessionDetails.textContent=`${engine.timeSig} • ${engine.bpm} BPM`;
      stepsDisplay.textContent=String(engine.stepCount);
      swingValue.textContent=String(Math.round(engine.swing*100));
      reorderBtn && (reorderBtn.disabled=(engine.pendingFirstIdx==null));
      renderStepGrid();
      reflectTransposeButtons();
      reflectOctave();
      reflectEnvRoute();
      reflectSlidersVisualFill();
      rebuildTriggerOptions(); // <— enforce trigger menu per rate
      if(metVolSlider){
        const pct=Math.round(engine.metLevel*100);
        metVolSlider.value=String(pct); metVolValue.textContent=`${pct}%`;
        metVolSlider.closest('.slider-container')?.style.setProperty('--slider-fill', `${pct}%`);
      }
      if(synthVolSlider){
        const pct=Math.round(engine.synthVolume*100);
        synthVolSlider.value=String(pct); synthVolValue.textContent=`${pct}%`;
        synthVolSlider.closest('.slider-container')?.style.setProperty('--slider-fill', `${pct}%`);
      }
      setLocalBtnUI();
    }
  });

  // ---------- Helpers ----------
  function reflectTransposeButtons(){ $$('.transpose-btn').forEach(btn=>{ const v=parseInt(btn.dataset.transpose,10)||0; btn.classList.toggle('active',v===engine.transpose); }); }
  function reflectOctave(){ if(!octaveDisplay) return; const sign=engine.octave>=0?'+':''; octaveDisplay.textContent=`${sign}${engine.octave}`; const ov=$('#octaveValue'); if(ov) ov.textContent=`Oct ${sign}${engine.octave}`; }
  function reflectEnvRoute(){ envRouteBtns.forEach(b=>b.classList.toggle('active', b.dataset.route===engine.envRoute)); }
  function reflectSlidersVisualFill(){ $$('input[type="range"]').forEach(r=>{ const p=r.closest('.slider-container'); if(p) p.style.setProperty('--slider-fill', `${r.value}%`); r.style.setProperty('--_p', `${r.value}%`); }); }
  function midiToSliderValue(m){ const min=36,max=84, cl=Math.max(min,Math.min(max,m)); return ((cl-min)/(max-min))*100; }
  function isActiveIndex(i){ const s=engine.steps[i]; return !!(s && !s.exclStep); }
  function prevActive(i){ let k=i; for(let c=0;c<engine.steps.length;c++){ k=(k-1+engine.steps.length)%engine.steps.length; if(isActiveIndex(k)) return k; } return -1; }
  function nextActive(i){ let k=i; for(let c=0;c<engine.steps.length;c++){ k=(k+1)%engine.steps.length; if(isActiveIndex(k)) return k; } return -1; }

  // ---------- Step Grid ----------
  function renderStepGrid(){
    if(!stepsRoot) return;
    stepsRoot.innerHTML='';
    const steps = engine.steps;

    steps.forEach((s,i)=>{
      const card=document.createElement('div');
      card.className='step-card';

      const p = prevActive(i);
      const isChild = (p>=0) && steps[p]?.link === true && isActiveIndex(i);
      if(isChild) card.classList.add('linked-from-prev');

      const num=document.createElement('div');
      num.className='step-number';
      num.textContent=(i+1);
      num.addEventListener('click',()=>{
        engine.selectFirst(i);
        desiredStartIdx = i;
        markFirstSelected(i);
        if (!engine.isPlaying && seqArmed) pulseOnce();
      });
      if(engine.pendingFirstIdx===i) num.classList.add('is-first');
      card.appendChild(num);

      const content=document.createElement('div'); content.className='step-content';

      // ON / LINKED label
      const onBtn=document.createElement('button');
      onBtn.className='zw-button step-on-btn'+(s.on?' active':'');
      if (isChild){
        onBtn.textContent='LINKED';
        onBtn.disabled = true;
      } else {
        onBtn.textContent='ON';
        onBtn.addEventListener('click',()=>engine.updateStep(i,{on:!engine.steps[i].on}));
      }
      content.appendChild(onBtn);

      // Note text
      const note=document.createElement('div');
      note.className='note-display';
      note.setAttribute('tabindex','0');
      note.setAttribute('contenteditable','true');
      note.textContent=s.noteText;

      let pitchSliderEl, pitchValueEl, sliderContainerEl;

      note.addEventListener('keydown',(e)=>{
        if(e.key==='ArrowUp' || e.key==='ArrowDown'){
          e.preventDefault();
          const d=(e.shiftKey?12:1) * (e.key==='ArrowUp'?1:-1);
          engine.nudgeStepSemitone(i,d,{silent:true});
          const st=engine.steps[i], sv=Math.round(midiToSliderValue(st.midi));
          note.textContent=st.noteText;
          if(pitchSliderEl){ pitchSliderEl.value=String(sv); if(sliderContainerEl) sliderContainerEl.style.setProperty('--slider-fill', `${sv}%`); }
          if(pitchValueEl) pitchValueEl.textContent=st.noteText;
        }
      });
      note.addEventListener('input',()=>{
        engine.setStepNoteFromText(i, note.textContent, {silent:true});
        const st=engine.steps[i], sv=Math.round(midiToSliderValue(st.midi));
        if(pitchSliderEl){ pitchSliderEl.value=String(sv); if(sliderContainerEl) sliderContainerEl.style.setProperty('--slider-fill', `${sv}%`); }
        if(pitchValueEl) pitchValueEl.textContent=st.noteText;
      });
      note.addEventListener('blur',()=>engine.setStepNoteFromText(i, note.textContent));
      note.addEventListener('click',()=>{ const r=document.createRange(); r.selectNodeContents(note); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); });
      content.appendChild(note);

      // Pitch slider
      const pitchWrap=document.createElement('div');
      pitchWrap.className='step-param';
      pitchWrap.innerHTML=`
        <div class="step-param-header">
          <span class="step-param-label">PITCH</span>
          <span class="step-param-value">${s.noteText}</span>
        </div>
        <div class="slider-container" style="--slider-fill:${s.pitchSlider}%;"><input type="range" class="zw-slider" min="0" max="100" value="${Math.round(midiToSliderValue(s.midi))}"></div>`;
      const pitchSlider=$('input',pitchWrap);
      const pitchValue=$('.step-param-value',pitchWrap);
      const sliderContainer=$('.slider-container',pitchWrap);
      pitchSliderEl=pitchSlider; pitchValueEl=pitchValue; sliderContainerEl=sliderContainer;

      pitchSlider.addEventListener('input',()=>{
        sliderContainer.classList.add('dragging');
        const min=36,max=84;
        const midi=Math.round(min+(pitchSlider.value/100)*(max-min));
        engine.updateStep(i,{pitchSlider:parseInt(pitchSlider.value,10), midi},{silent:true});
        const nt=engine.steps[i].noteText;
        pitchValue.textContent=nt; note.textContent=nt;
        sliderContainer.style.setProperty('--slider-fill', `${pitchSlider.value}%`);
      });
      pitchSlider.addEventListener('change',()=>{
        sliderContainer.classList.remove('dragging');
        engine.updateStep(i,{ midi: engine.steps[i].midi, pitchSlider:parseInt(pitchSlider.value,10) });
      });
      content.appendChild(pitchWrap);

      // Gate / Vel / Prob
      const isParent = s.link === true && isActiveIndex(i);
      if (isParent){
        content.appendChild(lockedGateRow());
      } else {
        content.appendChild(iconRow('GATE',['SHORT','MEDIUM','LONG'], s.gate, (v)=>engine.updateStep(i,{gate:v})));
      }
      content.appendChild(iconRow('VEL',['LOW','MEDIUM','HIGH'], s.velocity, (v)=>engine.updateStep(i,{velocity:v})));
      content.appendChild(iconRow('PROB',['33','66','99'], String(s.probability), (v)=>engine.updateStep(i,{probability:parseInt(v,10)}), true));

      // EXCL toggles
      content.appendChild(switchRow('EXCL TRIG', s.exclTrig, ()=>engine.updateStep(i,{exclTrig:!engine.steps[i].exclTrig})));
      content.appendChild(switchRow('EXCL STEP', s.exclStep, ()=>engine.updateStep(i,{exclStep:!engine.steps[i].exclStep})));

      // Link button
      const linkBtn=document.createElement('button');
      linkBtn.className='zw-button link-btn'+(s.link?' active':'');
      if (isChild){
        linkBtn.textContent='LINKED';
        linkBtn.disabled = true;
      } else if (isParent){
        let cur=i, nxt=i;
        while (engine.steps[cur].link){
          nxt = nextActive(cur);
          if (nxt<0) break;
          cur = nxt;
        }
        linkBtn.textContent = `+${cur+1}`;
        linkBtn.addEventListener('click',()=>engine.updateStep(i,{link:!engine.steps[i].link}));
      } else {
        linkBtn.textContent='LINK';
        linkBtn.addEventListener('click',()=>engine.updateStep(i,{link:!engine.steps[i].link}));
      }
      content.appendChild(linkBtn);

      card.appendChild(content);
      stepsRoot.appendChild(card);
    });
    markFirstSelected(engine.pendingFirstIdx);
  }

  function iconRow(label, options, current, onChange, numericBars=false){
    const wrap=document.createElement('div'); wrap.className='step-param';
    const header=document.createElement('div'); header.className='step-param-header';
    header.innerHTML=`<span class="step-param-label">${label}</span>`;
    wrap.appendChild(header);
    const row=document.createElement('div'); row.className='icon-buttons';
    options.forEach(opt=>{
      const b=document.createElement('button');
      b.className='icon-btn'+(String(opt)===String(current)?' active':'');
      b.title=opt;
      b.textContent = numericBars ? (opt==='33'?'|':opt==='66'?'||':'|||')
                                  : (opt==='SHORT'?'♩':opt==='MEDIUM'?'𝅗𝅥':'𝅝');
      b.addEventListener('click',()=>onChange(opt));
      row.appendChild(b);
    });
    wrap.appendChild(row);
    return wrap;
  }
  function lockedGateRow(){
    const wrap=document.createElement('div'); wrap.className='step-param';
    const header=document.createElement('div'); header.className='step-param-header';
    header.innerHTML=`<span class="step-param-label">GATE</span>`;
    wrap.appendChild(header);
    const row=document.createElement('div'); row.className='icon-buttons';
    const b=document.createElement('button');
    b.className='icon-btn active';
    b.title='LONG';
    b.textContent='𝅝';
    b.disabled = true;
    row.appendChild(b);
    wrap.appendChild(row);
    return wrap;
  }
  function switchRow(label,isActive,onToggle){
    const wrap=document.createElement('div'); wrap.className='switch-control';
    wrap.innerHTML=`<span class="switch-label">${label}</span>`;
    const btn=document.createElement('button');
    btn.className='zw-button'+(isActive?' active':''); btn.textContent=isActive?'ON':'OFF';
    btn.dataset.action=label.toLowerCase().includes('trig') ? 'excl-trig' : 'excl-step';
    btn.addEventListener('click',()=>{ onToggle(); const a=btn.classList.toggle('active'); btn.textContent=a?'ON':'OFF'; });
    wrap.appendChild(btn);
    return wrap;
  }
  function markFirstSelected(idx){ $$('.step-number').forEach((el,i)=>el.classList.toggle('is-first', i===idx)); }

  // ---------- Master Transport wiring ----------
  function toggleMasterTransport(){ if(engine.isPlaying) engine.stop(); else engine.play(); }
  playStopBtn && playStopBtn.addEventListener('click', toggleMasterTransport);

  // Spacebar Play/Stop (ignore when typing)
  document.addEventListener('keydown',(e)=>{
    const ae=document.activeElement;
    const typing = ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.isContentEditable || ae.tagName==='SELECT');
    if(e.code==='Space' && !typing){ e.preventDefault(); toggleMasterTransport(); }
  });

  // ---------- FIXED: Local Sequencer Transport (TRANSPORT ISOLATION) ----------
  if (seqLocalBtn){
    seqLocalBtn.addEventListener('click', ()=>{
      if (engine.isPlaying){
        // CRITICAL FIX: Do not call engine.stop() here - it kills master transport
        // Instead, just control the arming state
        seqArmed = false;
        desiredStartIdx = null;
      } else {
        seqArmed = !seqArmed;
        if (seqArmed){
          if (desiredStartIdx==null) desiredStartIdx = 0;
          pulseOnce();
        }
      }
      setLocalBtnUI();
    });
  }

  // ---------- BPM, TimeSig, Metronome ----------
  bpmInput && bpmInput.addEventListener('change',()=>engine.setBpm(bpmInput.value));
  timeSignatureSelect && timeSignatureSelect.addEventListener('change',()=>engine.setTimeSignature(timeSignatureSelect.value));
  metronomeBtn && metronomeBtn.addEventListener('click',()=>{ const a=metronomeBtn.classList.toggle('active'); engine.setMetronomeEnabled(a); });

  // ---------- Save / Load (MRU 10) ----------
  const INDEX_KEY = 'zw_sessions_index';

  function generateName(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `session_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zw`;
  }
  function readIndex(){ try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; } catch { return []; } }
  function writeIndex(arr){ try { localStorage.setItem(INDEX_KEY, JSON.stringify(arr)); } catch {} }
  function rebuildSessionDropdown(){
    if (!sessionSelect) return;
    const index = readIndex();
    sessionSelect.innerHTML = '';
    index.slice(0,10).forEach(name=>{
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sessionSelect.appendChild(opt);
    });
    if (sessionSelect.options.length === 0){
      const opt = document.createElement('option');
      opt.value = 'session_001.zw'; opt.textContent = 'session_001.zw';
      sessionSelect.appendChild(opt);
    }
  }
  function saveCurrentAsNew(){
    const state = engine.getState();
    const name = generateName();
    try {
      localStorage.setItem(name, JSON.stringify(state));
      let idx = readIndex().filter(n=>n!==name);
      idx.unshift(name);
      idx = idx.slice(0,10);
      writeIndex(idx);
      rebuildSessionDropdown();
      if (sessionSelect) sessionSelect.value = name;
    } catch {}
  }
  function loadSelected(){
    if (!sessionSelect) return;
    const name = sessionSelect.value;
    try {
      const raw = localStorage.getItem(name);
      if (raw){
        engine.setState(JSON.parse(raw));
        let idx = readIndex().filter(n=>n!==name);
        idx.unshift(name);
        idx = idx.slice(0,10);
        writeIndex(idx);
        rebuildSessionDropdown();
        sessionSelect.value = name;
      }
    } catch {}
  }
  saveBtn && saveBtn.addEventListener('click', saveCurrentAsNew);
  loadBtn && loadBtn.addEventListener('click', loadSelected);
  rebuildSessionDropdown();

  // ---------- Sequencer controls ----------
  stepsDown && stepsDown.addEventListener('click',()=>engine.setStepCount(engine.stepCount-1));
  stepsUp && stepsUp.addEventListener('click',()=>engine.setStepCount(engine.stepCount+1));

  // Rate labels (new + back-compat). Rebuild trigger menu on change.
  rateButtons.forEach(btn=>{
    btn.addEventListener('click',()=>{
      rateButtons.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const label = btn.dataset.rate || btn.textContent.trim();
      engine.setRateFromLabel(label);
      rebuildTriggerOptions();
    });
  });

  swingInput && swingInput.addEventListener('input',()=>{ engine.setSwingPercent(swingInput.value); swingValue && (swingValue.textContent=String(swingInput.value)); });
  playbackSelect && playbackSelect.addEventListener('change',()=>engine.setPlaybackMode(playbackSelect.value));
  startOffsetSelect && startOffsetSelect.addEventListener('change',()=>engine.setStartOffset(startOffsetSelect.value));
  triggerSelect && triggerSelect.addEventListener('change',()=>engine.setTrigger(triggerSelect.value));
  shapeSelect && shapeSelect.addEventListener('change',()=>engine.setShape(shapeSelect.value));
  reorderBtn && reorderBtn.addEventListener('click',()=>engine.commitReorder());

  // ---------- Settings panel toggle ----------
  if (settingsToggle && settingsPanel){
    settingsToggle.addEventListener('click', ()=>{
      const open = settingsPanel.classList.toggle('open');
      const chev = settingsToggle.querySelector('.chevron');
      if (chev) chev.classList.toggle('rotated', open);
    });
  }

  // ---------- Transpose ----------
  transposeBtns.forEach(btn=>{
    btn.addEventListener('click',()=>{ const v=parseInt(btn.dataset.transpose,10)||0; engine.setTranspose(v); reflectTransposeButtons(); });
  });

  // ---------- Synth controls ----------
  envRouteBtns.forEach(b=>{
    b.addEventListener('click',()=>{
      envRouteBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      engine.setSynthParam('envRoute', b.dataset.route);
    });
  });

  function bindRange(el,name,displaySel){
    if(!el) return;
    el.addEventListener('input',()=>{
      engine.setSynthParam(name, el.value);
      const wrap=el.closest('.control-group')||el.closest('.step-param')||el.closest('.slider-container');
      const vEl = displaySel ? $(displaySel) : (wrap && wrap.querySelector('.control-value'));
      if(vEl) vEl.textContent = String(el.value);
      const sc = el.closest('.slider-container');
      if(sc) sc.style.setProperty('--slider-fill', `${el.value}%`);
    });
  }
  bindRange(attackSlider,'attack','#attackValue');
  bindRange(decaySlider,'decay','#decayValue');
  bindRange(sustainSlider,'sustain','#sustainValue');
  bindRange(releaseSlider,'release','#releaseValue');
  bindRange(glideSlider,'glide','#glideValue');

  waveSelect && waveSelect.addEventListener('change',()=>engine.setSynthParam('wave', waveSelect.value));
  bindRange(pwmSlider,'pwm','#pwmValue');

  bitModelSelect && bitModelSelect.addEventListener('change',()=>engine.setSynthParam('bitModel', bitModelSelect.value));
  bindRange(resolutionSlider,'bitResolution','#resolutionValue');
  bindRange(levelSlider,'bitLevel','#levelValue');
  bindRange(bitPitchSlider,'bitPitch','#bitPitchValue');
  bindRange(velModSlider,'bitVelMod','#velModValue');
  bindRange(onsetSlider,'bitOnset','#onsetValue');

  bindRange(cutoffSlider,'cutoff','#cutoffValue');
  bindRange(resonanceSlider,'resonance','#resonanceValue');
  bindRange(filterPitchSlider,'filterPitch','#filterPitchValue');
  bindRange(filterVelSlider,'filterVel','#filterVelValue');
  bindRange(lfoModSlider,'lfoMod','#lfoModValue');
  bindRange(envModSlider,'envMod','#envModValue');

  lfoShapeSelect && lfoShapeSelect.addEventListener('change',()=>engine.setSynthParam('lfoShape', lfoShapeSelect.value));
  lfoRateSelect && lfoRateSelect.addEventListener('change',()=>engine.setSynthParam('lfoRate', lfoRateSelect.value));
  bindRange(lfoSwingSlider,'lfoSwing','#lfoSwingValue');
  bindRange(lfoDepthSlider,'lfoDepth','#lfoDepthValue');
  bindRange(lfoDelaySlider,'lfoDelay','#lfoDelayValue');
  bindRange(lfoPhaseSlider,'lfoPhase','#lfoPhaseValue');

  // ---------- Volume sliders ----------
  if (metVolSlider){
    metVolSlider.addEventListener('input', ()=>{
      engine.setMetVolumePercent(metVolSlider.value);
      metVolValue && (metVolValue.textContent = `${metVolSlider.value}%`);
      metVolSlider.closest('.slider-container')?.style.setProperty('--slider-fill', `${metVolSlider.value}%`);
    });
  }
  if (synthVolSlider){
    synthVolSlider.addEventListener('input', ()=>{
      engine.setSynthVolume(parseInt(synthVolSlider.value,10) / 100);
      synthVolValue && (synthVolValue.textContent = `${synthVolSlider.value}%`);
      synthVolSlider.closest('.slider-container')?.style.setProperty('--slider-fill', `${synthVolSlider.value}%`);
    });
  }

  // ---------- MIDI CC7 => Synth Volume ----------
  if ('requestMIDIAccess' in navigator){
    navigator.requestMIDIAccess({sysex:false}).then(access=>{
      function hookInput(input){
        input.onmidimessage=(msg)=>{
          const [status,d1,d2]=msg.data;
          const cmd=status & 0xF0;
          if (cmd===0xB0 && d1===7){
            const v = d2/127;
            engine.setSynthVolume(v);
          }
        };
      }
      access.inputs.forEach(hookInput);
      access.onstatechange=(e)=>{ if(e.port.type==='input' && e.port.state==='connected') hookInput(e.port); };
    }).catch(()=>{ /* ignore */ });
  }

  // ---------- Init ----------
  engine.setRateFromLabel('1/4'); // default quarter notes
  engine.cb.onRender();
  rebuildTriggerOptions(); // ensure correct trigger menu on first paint
})();
