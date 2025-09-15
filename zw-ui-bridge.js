/* ZERO WIDTH – UI Bridge - MINIMAL WORKING VERSION
   CRITICAL: Get sequencer back first, then add features incrementally
*/

(function(){
  const $=(s,r=document)=>r.querySelector(s);
  const $=(s,r=document)=>Array.from(r.querySelectorAll(s));

  // Basic DOM elements
  const stepsRoot=$('#sequencerSteps');
  const stepsDisplay=$('#stepsDisplay');
  const playStopBtn=$('#playStopBtn');
  const seqLocalBtn = $('#seqLocalBtn') || $('#sequencerPlayBtn');

  // Engine
  const engine=new ZWEngine();

  console.log('UI Bridge loading...', {stepsRoot, stepsDisplay, playStopBtn, seqLocalBtn});

  // Basic engine callbacks
  engine.setCallbacks({
    onStatus:(s)=>{
      console.log('Engine status:', s);
    },
    onBeat:(beat,down)=>{
      console.log('Beat:', beat, down);
    },
    onPulse:()=>{
      console.log('Pulse');
    },
    onStepPlaying:(idx)=>{
      console.log('Step playing:', idx);
    },
    onRender:()=>{
      console.log('Render requested');
      if (stepsDisplay) {
        stepsDisplay.textContent = String(engine.stepCount);
      }
      renderStepGrid();
    }
  });

  // Basic step grid render
  function renderStepGrid(){
    console.log('Rendering step grid...');
    if(!stepsRoot) {
      console.error('stepsRoot (#sequencerSteps) not found!');
      return;
    }
    
    stepsRoot.innerHTML='';
    const steps = engine.steps;
    console.log('Steps to render:', steps.length);

    steps.forEach((s,i)=>{
      const card=document.createElement('div');
      card.className='step-card';
      card.innerHTML = `
        <div class="step-number">${i+1}</div>
        <div class="step-content">
          <button class="zw-button ${s.on ? 'active' : ''}">ON</button>
          <div class="note-display">${s.noteText}</div>
        </div>
      `;
      stepsRoot.appendChild(card);
    });
    console.log('Step grid rendered with', steps.length, 'cards');
  }

  // Basic transport
  if (playStopBtn) {
    playStopBtn.addEventListener('click', ()=>{
      console.log('Transport clicked');
      if (engine.isPlaying) {
        engine.stop();
      } else {
        engine.play();
      }
    });
  }

  // Initialize
  console.log('Initializing engine...');
  engine.cb.onRender();
  console.log('UI Bridge loaded successfully');

})();
