/* ZERO WIDTH – UI Bridge - SAFE MINIMAL VERSION
   No $ conflicts, get sequencer working first
*/

(function(){
  // Basic DOM elements - using standard querySelector
  const stepsRoot = document.querySelector('#sequencerSteps');
  const stepsDisplay = document.querySelector('#stepsDisplay');
  const playStopBtn = document.querySelector('#playStopBtn');
  const seqLocalBtn = document.querySelector('#seqLocalBtn') || document.querySelector('#sequencerPlayBtn');

  // Engine
  const engine = new ZWEngine();

  console.log('UI Bridge loading...', {stepsRoot, stepsDisplay, playStopBtn, seqLocalBtn});

  // Basic engine callbacks
  engine.setCallbacks({
    onStatus:(s) => {
      console.log('Engine status:', s);
    },
    onBeat:(beat, down) => {
      console.log('Beat:', beat, down);
    },
    onPulse:() => {
      console.log('Pulse');
    },
    onStepPlaying:(idx) => {
      console.log('Step playing:', idx);
    },
    onRender:() => {
      console.log('Render requested');
      if (stepsDisplay) {
        stepsDisplay.textContent = String(engine.stepCount);
      }
      renderStepGrid();
    }
  });

  // Basic step grid render
  function renderStepGrid() {
    console.log('Rendering step grid...');
    if (!stepsRoot) {
      console.error('stepsRoot (#sequencerSteps) not found!');
      return;
    }
    
    stepsRoot.innerHTML = '';
    const steps = engine.steps;
    console.log('Steps to render:', steps.length);

    steps.forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'step-card';
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
    playStopBtn.addEventListener('click', () => {
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
