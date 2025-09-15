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

  // Full step grid render with all controls
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

      // Check if this is a child step (linked from previous)
      const prevStep = i > 0 ? steps[i - 1] : null;
      const isChild = prevStep && prevStep.link && !s.exclStep;
      if (isChild) card.classList.add('linked-from-prev');

      // Step number
      const num = document.createElement('div');
      num.className = 'step-number';
      num.textContent = (i + 1);
      num.addEventListener('click', () => {
        engine.selectFirst(i);
        // markFirstSelected(i);
      });
      if (engine.pendingFirstIdx === i) num.classList.add('is-first');
      card.appendChild(num);

      // Step content container
      const content = document.createElement('div');
      content.className = 'step-content';

      // ON/LINKED button
      const onBtn = document.createElement('button');
      onBtn.className = 'zw-button step-on-btn' + (s.on ? ' active' : '');
      if (isChild) {
        onBtn.textContent = 'LINKED';
        onBtn.disabled = true;
      } else {
        onBtn.textContent = 'ON';
        onBtn.addEventListener('click', () => engine.updateStep(i, { on: !engine.steps[i].on }));
      }
      content.appendChild(onBtn);

      // Note display (editable)
      const note = document.createElement('div');
      note.className = 'note-display';
      note.setAttribute('tabindex', '0');
      note.setAttribute('contenteditable', 'true');
      note.textContent = s.noteText;

      note.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const d = (e.shiftKey ? 12 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
          engine.nudgeStepSemitone(i, d, { silent: true });
          const st = engine.steps[i];
          note.textContent = st.noteText;
        }
      });
      note.addEventListener('input', () => {
        engine.setStepNoteFromText(i, note.textContent, { silent: true });
      });
      note.addEventListener('blur', () => engine.setStepNoteFromText(i, note.textContent));
      content.appendChild(note);

      // Pitch slider
      const pitchWrap = document.createElement('div');
      pitchWrap.className = 'step-param';
      const midiToSliderValue = (m) => {
        const min = 36, max = 84, cl = Math.max(min, Math.min(max, m));
        return ((cl - min) / (max - min)) * 100;
      };
      pitchWrap.innerHTML = `
        <div class="step-param-header">
          <span class="step-param-label">PITCH</span>
          <span class="step-param-value">${s.noteText}</span>
        </div>
        <div class="slider-container" style="--slider-fill:${Math.round(midiToSliderValue(s.midi))}%;"><input type="range" class="zw-slider" min="0" max="100" value="${Math.round(midiToSliderValue(s.midi))}"></div>`;
      
      const pitchSlider = pitchWrap.querySelector('input');
      const pitchValue = pitchWrap.querySelector('.step-param-value');
      const sliderContainer = pitchWrap.querySelector('.slider-container');

      pitchSlider.addEventListener('input', () => {
        sliderContainer.classList.add('dragging');
        const min = 36, max = 84;
        const midi = Math.round(min + (pitchSlider.value / 100) * (max - min));
        engine.updateStep(i, { midi }, { silent: true });
        const nt = engine.steps[i].noteText;
        pitchValue.textContent = nt;
        note.textContent = nt;
        sliderContainer.style.setProperty('--slider-fill', `${pitchSlider.value}%`);
      });
      pitchSlider.addEventListener('change', () => {
        sliderContainer.classList.remove('dragging');
        engine.updateStep(i, { midi: engine.steps[i].midi });
      });
      content.appendChild(pitchWrap);

      // Gate/Velocity/Probability controls
      content.appendChild(createIconRow('GATE', ['SHORT', 'MEDIUM', 'LONG'], s.gate, (v) => engine.updateStep(i, { gate: v })));
      content.appendChild(createIconRow('VEL', ['LOW', 'MEDIUM', 'HIGH'], s.velocity, (v) => engine.updateStep(i, { velocity: v })));
      content.appendChild(createIconRow('PROB', ['33', '66', '99'], String(s.probability), (v) => engine.updateStep(i, { probability: parseInt(v, 10) }), true));

      // EXCL toggles
      content.appendChild(createSwitchRow('EXCL TRIG', s.exclTrig, () => engine.updateStep(i, { exclTrig: !engine.steps[i].exclTrig })));
      content.appendChild(createSwitchRow('EXCL STEP', s.exclStep, () => engine.updateStep(i, { exclStep: !engine.steps[i].exclStep })));

      // Link button
      const linkBtn = document.createElement('button');
      linkBtn.className = 'zw-button link-btn' + (s.link ? ' active' : '');
      if (isChild) {
        linkBtn.textContent = 'LINKED';
        linkBtn.disabled = true;
      } else {
        linkBtn.textContent = 'LINK';
        linkBtn.addEventListener('click', () => engine.updateStep(i, { link: !engine.steps[i].link }));
      }
      content.appendChild(linkBtn);

      card.appendChild(content);
      stepsRoot.appendChild(card);
    });
    console.log('Step grid rendered with', steps.length, 'cards');
  }

  // Helper functions for step controls
  function createIconRow(label, options, current, onChange, numericBars = false) {
    const wrap = document.createElement('div');
    wrap.className = 'step-param';
    const header = document.createElement('div');
    header.className = 'step-param-header';
    header.innerHTML = `<span class="step-param-label">${label}</span>`;
    wrap.appendChild(header);
    const row = document.createElement('div');
    row.className = 'icon-buttons';
    options.forEach(opt => {
      const b = document.createElement('button');
      b.className = 'icon-btn' + (String(opt) === String(current) ? ' active' : '');
      b.title = opt;
      b.textContent = numericBars ? (opt === '33' ? '|' : opt === '66' ? '||' : '|||')
                                  : (opt === 'SHORT' ? '♩' : opt === 'MEDIUM' ? '𝅗𝅥' : '𝅝');
      b.addEventListener('click', () => onChange(opt));
      row.appendChild(b);
    });
    wrap.appendChild(row);
    return wrap;
  }

  function createSwitchRow(label, isActive, onToggle) {
    const wrap = document.createElement('div');
    wrap.className = 'switch-control';
    wrap.innerHTML = `<span class="switch-label">${label}</span>`;
    const btn = document.createElement('button');
    btn.className = 'zw-button' + (isActive ? ' active' : '');
    btn.textContent = isActive ? 'ON' : 'OFF';
    btn.addEventListener('click', () => {
      onToggle();
      const a = btn.classList.toggle('active');
      btn.textContent = a ? 'ON' : 'OFF';
    });
    wrap.appendChild(btn);
    return wrap;
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
