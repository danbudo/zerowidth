/* ZERO WIDTH – UI Bridge
   CRITICAL FIXES:
   - Transport isolation: Klang stop no longer kills Zero Width
   - Fixed save/load JSON system
   - Made step count clickable/editable
   - Fixed step decrement minimum (stops at 1)
   - Added missing "None" rate option
   - Fixed trigger default to "None"
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

  // Local sequencer transport (ISOLATED - does not affect master)
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

  // ---------- MASTER vs LOCAL Transport Management ----------
  let masterIsPlaying = false; // Track Zero Width master state independently
  let seqArmed = false;
  let desiredStartIdx = null;

  function pulseOnce(){
    if (!pulseIndicator) return;
    pulseIndicator.classList.add('active');
    setTimeout(()=>pulseIndicator.classList.remove('active'), 120);
  }

  // MASTER transport UI (affects Zero Width global)
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

  // LOCAL sequencer UI with AUTOPLAY button
  function setLocalBtnUI(){
    if (!seqLocalBtn) return;
    
    // Update main sequencer button
    if (engine.isPlaying && masterIsPlaying){
      seqLocalBtn.classList.add('active');
      seqLocalBtn.textContent = 'STOP';
      seqLocalBtn.dataset.state = 'playing';
    } else if (seqArmed && masterIsPlaying){
      seqLocalBtn.classList.add('active');
      seqLocalBtn.textContent = 'ARMED';
      seqLocalBtn.dataset.state = 'armed';
    } else if (seqArmed && !masterIsPlaying) {
      seqLocalBtn.classList.add('active');
      seqLocalBtn.textContent = 'ARMED';
      seqLocalBtn.dataset.state = 'armed';
    } else {
      seqLocalBtn.classList.remove('active');
      seqLocalBtn.textContent = 'START';
      seqLocalBtn.dataset.state = 'idle';
    }

    // Update autoplay button
    const autoplayBtn = $('#seqAutoplayBtn');
    if (autoplayBtn) {
      autoplayBtn.classList.toggle('active', seqAutoplay);
      autoplayBtn.textContent = seqAutoplay ? 'AUTO' : 'MANUAL';
    }
  }

  // Add autoplay button functionality
  function setupAutoplayButton() {
    const autoplayBtn = $('#seqAutoplayBtn');
    if (autoplayBtn) {
      autoplayBtn.addEventListener('click', ()=>{
        seqAutoplay = !seqAutoplay;
        setLocalBtnUI();
      });
    }
  }

  // ---------- Trigger options per rate (with NONE option added) ----------
  function currentRateFactor(){
    return engine._rateFactor || 1;
  }
  function allowedTriggersForRateFactor(f){
    // Always include NONE as first option
    const base = ['NONE'];
    if (f === 0.5) return base.concat(['1/2','1/3','1/4','1/8']); // rate 1/2
    if (f === 1)   return base.concat(['1/2','1/3','1/4']);       // rate 1/4
    if (f === 2)   return base.concat(['1/2']);                   // rate 1/8
    if (f === 4)   return base;                                   // rate 1/16 (NONE only)
    return base.concat(['1/2','1/3','1/4']); // default fallback
  }
  function rebuildTriggerOptions(){
    if (!triggerSelect) return;
    const groupEl = triggerSelect.closest('.control-group');
    const f = currentRateFactor();
    const allowed = allowedTriggersForRateFactor(f);

    triggerSelect.innerHTML = '';

    allowed.forEach(val=>{
      const opt=document.createElement('option');
      opt.value=val; opt.textContent=val;
      triggerSelect.appendChild(opt);
    });

    // Set default to NONE if not set, or ensure current value is valid
    if (!allowed.includes(engine.trigger)){
      engine.setTrigger('NONE');
      triggerSelect.value = 'NONE';
    } else {
      triggerSelect.value = engine.trigger;
    }
  }

  // ---------- Engine <-> UI ----------
  engine.setCallbacks({
    onStatus:(s)=>{
      // FIXED: Restore proper master transport UI updates
      sessionStatus.textContent=s;
      setMasterTransportUI(s);
      
      // Only update local sequencer state for arming logic
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
      rebuildTriggerOptions();
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

  // ---------- FIXED Transport Logic ----------
  let masterIsPlaying = false; // Track Zero Width master independently
  let seqArmed = false;
  let seqAutoplay = true; // New: Autoplay toggle
  let desiredStartIdx = null;

  // MASTER transport (Zero Width - controls metronome)
  function toggleMasterTransport(){ 
    masterIsPlaying = !masterIsPlaying;
    
    if (masterIsPlaying) {
      // Start Zero Width master
      engine.play();
      // If autoplay is on and Klang is armed, start Klang too
      if (seqAutoplay || seqArmed) {
        seqArmed = false; // Clear armed state when starting
      }
    } else {
      // Stop Zero Width master
      engine.stop(); 
      seqArmed = false; // Clear armed state when master stops
    }
    
    setMasterTransportUI(masterIsPlaying ? 'PLAYING' : 'STOPPED');
    setLocalBtnUI();
  }

  // LOCAL sequencer (Klang only - does not affect master transport)
  function toggleLocalSequencer() {
    if (engine.isPlaying) {
      // If Klang is playing, stop it but keep master running
      if (masterIsPlaying) {
        // Master is still running, so arm Klang for next cycle
        seqArmed = true;
        // Don't actually stop the engine, just mark as armed
      } else {
        // Master is not running, so we can stop everything
        engine.stop();
        masterIsPlaying = false;
        setMasterTransportUI('STOPPED');
      }
    } else {
      // Klang is not playing
      if (masterIsPlaying) {
        // Master is running, start Klang immediately
        seqArmed = false;
        if (desiredStartIdx !== null) {
          engine.stepIndex = desiredStartIdx;
          desiredStartIdx = null;
        }
      } else {
        // Master is not running, just toggle armed state
        seqArmed = !seqArmed;
        if (seqArmed && desiredStartIdx === null) {
          desiredStartIdx = 0;
        }
        pulseOnce();
      }
    }
    setLocalBtnUI();
  }
  playStopBtn && playStopBtn.addEventListener('click', toggleMasterTransport);

  // Spacebar Play/Stop (ignore when typing)
  document.addEventListener('keydown',(e)=>{
    const ae=document.activeElement;
    const typing = ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.isContentEditable || ae.tagName==='SELECT');
    if(e.code==='Space' && !typing){ e.preventDefault(); toggleMasterTransport(); }
  });

  // ---------- FIXED Local Sequencer Transport ----------
  if (seqLocalBtn){
    seqLocalBtn.addEventListener('click', toggleLocalSequencer);
  }
  
  // Setup autoplay button
  setupAutoplayButton();

  // ---------- BPM, TimeSig, Metronome ----------
  bpmInput && bpmInput.addEventListener('change',()=>engine.setBpm(bpmInput.value));
  timeSignatureSelect && timeSignatureSelect.addEventListener('change',()=>engine.setTimeSignature(timeSignatureSelect.value));
  metronomeBtn && metronomeBtn.addEventListener('click',()=>{ const a=metronomeBtn.classList.toggle('active'); engine.setMetronomeEnabled(a); });

  // ---------- FIXED Save/Load (Browser Storage with Clear Labels) ----------
  const INDEX_KEY = 'zw_sessions_index';

  function generateName(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `Project-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  }
  
  function readIndex(){ 
    try { 
      const data = localStorage.getItem(INDEX_KEY);
      return data ? JSON.parse(data) : []; 
    } catch(e) { 
      console.warn('Failed to read sessions index:', e);
      return []; 
    } 
  }
  
  function writeIndex(arr){ 
    try { 
      localStorage.setItem(INDEX_KEY, JSON.stringify(arr)); 
    } catch(e) {
      console.warn('Failed to write sessions index:', e);
    }
  }
  
  function rebuildSessionDropdown(){
    if (!sessionSelect) {
      console.warn('sessionSelect element not found');
      return;
    }
    const index = readIndex();
    sessionSelect.innerHTML = '';
    
    if (index.length === 0) {
      const opt = document.createElement('option');
      opt.value = generateName();
      opt.textContent = opt.value;
      sessionSelect.appendChild(opt);
      return;
    }
    
    index.slice(0,10).forEach(name=>{
      const opt = document.createElement('option');
      opt.value = name; 
      opt.textContent = name;
      sessionSelect.appendChild(opt);
    });
  }
  
  function saveCurrentAsNew(){
    console.log('Saving to browser storage...');
    const state = engine.getState();
    const name = generateName();
    try {
      localStorage.setItem(name, JSON.stringify(state, null, 2));
      let idx = readIndex().filter(n=>n!==name);
      idx.unshift(name);
      idx = idx.slice(0,10);
      writeIndex(idx);
      rebuildSessionDropdown();
      if (sessionSelect) sessionSelect.value = name;
      console.log('Session saved to browser storage:', name);
      alert(`Session saved to browser storage: ${name}\n\nNote: This saves to your browser only. Use browser export/import for file backup.`);
    } catch(e) {
      console.error('Failed to save session:', e);
      alert('Failed to save session: ' + e.message);
    }
  }
  
  function loadSelected(){
    console.log('Loading from browser storage...');
    if (!sessionSelect) {
      console.warn('sessionSelect not found');
      return;
    }
    const name = sessionSelect.value;
    if (!name) {
      alert('No session selected');
      return;
    }
    
    try {
      const raw = localStorage.getItem(name);
      if (!raw) {
        alert('Session not found in browser storage: ' + name);
        return;
      }
      
      const state = JSON.parse(raw);
      engine.setState(state);
      
      let idx = readIndex().filter(n=>n!==name);
      idx.unshift(name);
      idx = idx.slice(0,10);
      writeIndex(idx);
      rebuildSessionDropdown();
      sessionSelect.value = name;
      console.log('Session loaded from browser storage:', name);
      alert(`Session loaded: ${name}\n\nLoaded from browser storage.`);
    } catch(e) {
      console.error('Failed to load session:', e);
      alert('Failed to load session: ' + e.message);
    }
  }
  
  // Add event listeners with debugging
  if (saveBtn) {
    console.log('Save button found, adding listener');
    saveBtn.addEventListener('click', saveCurrentAsNew);
  } else {
    console.warn('Save button (#saveBtn) not found in DOM');
  }
  
  if (loadBtn) {
    console.log('Load button found, adding listener');
    loadBtn.addEventListener('click', loadSelected);
  } else {
    console.warn('Load button (#loadBtn) not found in DOM');
  }

  // Add keyboard shortcut as fallback
  document.addEventListener('keydown', (e)=>{
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentAsNew();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      loadSelected();
    }
  });

  // ---------- FIXED Sequencer controls ----------
  stepsDown && stepsDown.addEventListener('click',()=>{
    const newCount = Math.max(1, engine.stepCount - 1); // FIXED: Stop at 1
    engine.setStepCount(newCount);
  });
  stepsUp && stepsUp.addEventListener('click',()=>{
    const newCount = Math.min(64, engine.stepCount + 1); // Allow up to 64
    engine.setStepCount(newCount);
  });

  // FIXED: Make step count truly inline-editable (no modal)
  if (stepsDisplay) {
    // Remove any existing click handlers that might trigger modals
    const newStepsDisplay = stepsDisplay.cloneNode(true);
    stepsDisplay.parentNode.replaceChild(newStepsDisplay, stepsDisplay);
    
    // Apply to the new element
    const stepsDisplayFixed = $('#stepsDisplay');
    if (stepsDisplayFixed) {
      stepsDisplayFixed.style.cursor = 'pointer';
      stepsDisplayFixed.style.userSelect = 'all';
      stepsDisplayFixed.contentEditable = true;
      stepsDisplayFixed.spellcheck = false;
      
      stepsDisplayFixed.addEventListener('focus', ()=>{
        // Select all text when focused
        setTimeout(()=>{
          const range = document.createRange();
          range.selectNodeContents(stepsDisplayFixed);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }, 0);
      });
      
      stepsDisplayFixed.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter') {
          e.preventDefault();
          stepsDisplayFixed.blur();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          stepsDisplayFixed.textContent = String(engine.stepCount);
          stepsDisplayFixed.blur();
          return;
        }
        // Allow only numbers and navigation keys
        if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
          e.preventDefault();
        }
      });
      
      stepsDisplayFixed.addEventListener('blur', ()=>{
        const newValue = parseInt(stepsDisplayFixed.textContent, 10);
        if (!isNaN(newValue) && newValue >= 1 && newValue <= 64) {
          engine.setStepCount(newValue);
        } else {
          // Restore original value if invalid
          stepsDisplayFixed.textContent = String(engine.stepCount);
        }
      });
      
      stepsDisplayFixed.addEventListener('input', ()=>{
        // Live validation during typing - limit to 2 digits
        const current = stepsDisplayFixed.textContent.replace(/\D/g, ''); // Remove non-digits
        if (current !== stepsDisplayFixed.textContent) {
          stepsDisplayFixed.textContent = current;
          // Move cursor to end
          const range = document.createRange();
          range.selectNodeContents(stepsDisplayFixed);
          range.collapse(false);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        if (current.length > 2) {
          stepsDisplayFixed.textContent = current.slice(0, 2);
          const range = document.createRange();
          range.selectNodeContents(stepsDisplayFixed);
          range.collapse(false);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });
    }
  }

  // Rate labels with NONE option
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

  // ---------- FIXED Octave controls ----------
  octaveDown && octaveDown.addEventListener('click', ()=>{
    const newOct = Math.max(-2, engine.octave - 1); // FIXED: Allow ±2 octaves
    engine.setOctave(newOct);
  });
  octaveUp && octaveUp.addEventListener('click', ()=>{
    const newOct = Math.min(2, engine.octave + 1); // FIXED: Allow ±2 octaves  
    engine.setOctave(newOct);
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

  // ---------- FIXED Init ----------
  engine.setRateFromLabel('1/4'); // default quarter notes
  engine.setTrigger('NONE'); // FIXED: Default trigger to NONE
  engine.cb.onRender();
  rebuildSessionDropdown(); // Initialize save/load system
  rebuildTriggerOptions(); // ensure correct trigger menu on first paint
})();
