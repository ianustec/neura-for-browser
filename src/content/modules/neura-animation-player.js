(function (Neura) {
  /**
   * Host runtime for neuraAnimationConfig + neura-mark.svg.
   * Modes: idle | speak | burst | live (external amp from TTS analyser).
   */

  const CONFIG_URL = () =>
    chrome.runtime.getURL('assets/voice/neura-default.neura.json');
  const SVG_URL = () => chrome.runtime.getURL('assets/voice/neura-mark.svg');

  const HISTORY_LEN = 90;
  const ANIM_CONSTANTS = {
    pulse: 0.11,
    perspectivePx: 900,
    strokeBaseWidth: 5,
    historyLen: HISTORY_LEN,
  };

  /** @type {ReturnType<typeof createState>|null} */
  let state = null;
  /** @type {number|null} */
  let rafId = null;
  let lastFrame = 0;
  /** @type {HTMLElement|null} */
  let hostEl = null;
  let externalAmp = 0;
  let externalAmpAt = 0;
  const EXTERNAL_STALE_MS = 120;

  function createState() {
    return {
      mode: 'idle',
      intensity: 0.7,
      speed: 1,
      spinSpeed: 118,
      spinSpeedY: 0,
      spinSpeedX: 0,
      waveAngle: 0,
      waveAngleY: 0,
      waveAngleX: 0,
      maxTilt: 20,
      perspectivePx: ANIM_CONSTANTS.perspectivePx,
      pulse: ANIM_CONSTANTS.pulse,
      strokeBaseWidth: ANIM_CONSTANTS.strokeBaseWidth,
      t: 0,
      speechAmp: 0.3,
      burstUntil: 0,
      ready: false,
      letterEls: [],
      letterGroup: null,
      tracciatoGroup: null,
      tracciatoStroke: null,
      bgEls: [],
      turbulence: null,
      displacement: null,
      cx: 419.79,
      cy: 419.79,
      envHist: new Float32Array(HISTORY_LEN),
      envWrite: 0,
      envFilled: 0,
    };
  }

  function noise(t, seed = 0) {
    return (
      Math.sin(t * 1.7 + seed) * 0.45 +
      Math.sin(t * 3.1 + seed * 1.3) * 0.3 +
      Math.sin(t * 5.7 + seed * 2.1) * 0.16 +
      Math.sin(t * 9.3 + seed * 0.7) * 0.09
    );
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function applyConfig(cfg) {
    if (!state) return;
    if (!cfg || cfg.schema !== 'neuraAnimationConfig') return;
    const pb = cfg.playback || {};
    const rot = cfg.rotation || {};
    const motion = cfg.motion || {};
    if (pb.mode === 'idle' || pb.mode === 'speak' || pb.mode === 'burst') {
      state.mode = pb.mode;
    }
    if (pb.intensity != null) state.intensity = clamp(Number(pb.intensity), 0, 1.5);
    if (pb.speed != null) state.speed = clamp(Number(pb.speed), 0.1, 3);
    if (rot.planeZ_degPerSec != null) state.spinSpeed = Number(rot.planeZ_degPerSec);
    if (rot.verticalY_degPerSec != null) state.spinSpeedY = Number(rot.verticalY_degPerSec);
    if (rot.horizontalX_degPerSec != null) state.spinSpeedX = Number(rot.horizontalX_degPerSec);
    if (rot.maxTiltXY_deg != null) state.maxTilt = clamp(Number(rot.maxTiltXY_deg), 20, 75);
    if (rot.perspectivePx != null) state.perspectivePx = Number(rot.perspectivePx);
    if (motion.pulse != null) state.pulse = Number(motion.pulse);
    if (motion.strokeBaseWidth != null) state.strokeBaseWidth = Number(motion.strokeBaseWidth);
  }

  function injectFilters(svg) {
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.insertBefore(defs, svg.firstChild);
    }

    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'neuraSpeechWarp');
    filter.setAttribute('x', '-12%');
    filter.setAttribute('y', '-12%');
    filter.setAttribute('width', '124%');
    filter.setAttribute('height', '124%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const turb = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence');
    turb.setAttribute('type', 'fractalNoise');
    turb.setAttribute('baseFrequency', '0.012');
    turb.setAttribute('numOctaves', '2');
    turb.setAttribute('seed', '7');
    turb.setAttribute('result', 'noise');

    const disp = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', 'noise');
    disp.setAttribute('scale', '0');
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');

    filter.appendChild(turb);
    filter.appendChild(disp);
    defs.appendChild(filter);

    state.turbulence = turb;
    state.displacement = disp;
  }

  function addTracciatoDepth(tracciato) {
    const paths = [...tracciato.querySelectorAll('path')];
    if (!paths.length) return;

    tracciato.style.transformStyle = 'preserve-3d';
    const depths = [-14, -7, 7, 14];
    for (const z of depths) {
      const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.setAttribute('class', 'tracciato-depth');
      layer.style.transform = `translateZ(${z}px)`;
      layer.style.opacity = '0.4';
      layer.style.pointerEvents = 'none';
      for (const p of paths) {
        layer.appendChild(p.cloneNode(true));
      }
      tracciato.insertBefore(layer, tracciato.firstChild);
    }
  }

  function prepareLayers(svg) {
    const clipGroup = svg.querySelector('g.cls-6');
    const letterClip = svg.querySelector('g.cls-4');

    const letterNodes = [];
    if (letterClip) {
      const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      wrap.setAttribute('id', 'letterN');
      const inner = letterClip.querySelector('g') || letterClip;
      const parent = inner.parentNode;
      parent.insertBefore(wrap, inner);
      wrap.appendChild(inner);
      [...letterClip.children].forEach((ch) => {
        if (ch !== wrap) wrap.appendChild(ch);
      });
      wrap.style.transformBox = 'view-box';
      wrap.style.transformOrigin = `${state.cx}px ${state.cy}px`;
      state.letterGroup = wrap;
      letterNodes.push(wrap);
    } else {
      const fallback = [...svg.querySelectorAll('path.cls-10, path.cls-5, path.cls-9')];
      for (const el of fallback) {
        el.style.transformBox = 'view-box';
        el.style.transformOrigin = `${state.cx}px ${state.cy}px`;
        letterNodes.push(el);
      }
      state.letterGroup = null;
    }
    state.letterEls = letterNodes;

    if (!clipGroup) return;

    const bgCircle = clipGroup.querySelector('circle.cls-3');
    const kids = [...clipGroup.children].filter((el) => el !== bgCircle);

    const bgNodes = [];
    const tracciatoNodes = [];
    let inTracciato = false;
    for (const el of kids) {
      const cls = el.getAttribute('class') || '';
      if (cls.includes('cls-7') || cls.includes('cls-2')) inTracciato = true;
      if (!inTracciato) bgNodes.push(el);
      else tracciatoNodes.push(el);
    }

    for (const el of bgNodes) {
      el.classList.add('bg-glow');
      el.style.transformOrigin = `${state.cx}px ${state.cy}px`;
      el.dataset.phase = String(Math.random() * Math.PI * 2);
    }
    state.bgEls = bgNodes;

    const tracciato = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tracciato.setAttribute('id', 'tracciato');
    tracciato.setAttribute('filter', 'url(#neuraSpeechWarp)');

    const first = tracciatoNodes[0];
    if (first) clipGroup.insertBefore(tracciato, first);
    else if (bgCircle && bgCircle.nextSibling) clipGroup.insertBefore(tracciato, bgCircle.nextSibling);
    else clipGroup.appendChild(tracciato);

    for (const el of tracciatoNodes) {
      tracciato.appendChild(el);
      el.style.transform = '';
    }

    if (tracciato.childNodes.length) {
      addTracciatoDepth(tracciato);
      state.tracciatoGroup = tracciato;
      state.tracciatoStroke = tracciato.querySelector('path.cls-2');
    }
  }

  function pushEnvelope(amp) {
    state.envHist[state.envWrite] = amp;
    state.envWrite = (state.envWrite + 1) % HISTORY_LEN;
    if (state.envFilled < HISTORY_LEN) state.envFilled += 1;
  }

  function sampleEnvelope(delayFrames) {
    if (state.envFilled === 0) return state.speechAmp;
    const d = Math.min(Math.max(0, Math.round(delayFrames)), state.envFilled - 1);
    const idx = (state.envWrite - 1 - d + HISTORY_LEN * 4) % HISTORY_LEN;
    return state.envHist[idx];
  }

  function liveAmpTarget() {
    if (performance.now() - externalAmpAt > EXTERNAL_STALE_MS) return 0;
    return clamp(externalAmp, 0, 1.35);
  }

  function updateSpeechEnvelope(dt) {
    if (state.mode === 'live') {
      const target = liveAmpTarget();
      state.speechAmp += (target - state.speechAmp) * Math.min(1, dt * 18);
      return;
    }

    if (state.mode === 'idle') {
      const breath = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin(state.t * 2.4));
      state.speechAmp += (breath - state.speechAmp) * Math.min(1, dt * 4);
      return;
    }

    if (state.mode === 'burst') {
      const remaining = state.burstUntil - performance.now();
      if (remaining <= 0) {
        state.mode = 'speak';
      } else {
        const peak = Math.sin((1 - remaining / 900) * Math.PI);
        state.speechAmp = 0.7 + peak * 0.55;
        return;
      }
    }

    const t = state.t;
    const syllable =
      0.5 + 0.5 * Math.max(0, Math.sin(t * 5.8) * Math.sin(t * 2.5 + 1.1));
    const pauseGate = noise(t * 0.55, 9) > -0.25 ? 1 : 0.08;
    const micro = 0.55 + 0.45 * noise(t * 10, 2);
    const target = clamp(0.12 + syllable * pauseGate * micro * 1.35, 0.08, 1.35);
    state.speechAmp += (target - state.speechAmp) * Math.min(1, dt * 14);
  }

  function render() {
    if (!state?.ready) return;

    const beat = state.speechAmp;
    const amp = state.intensity * beat;
    const t = state.t;

    pushEnvelope(beat);

    const PULSE = state.pulse;
    const buzz = amp * (0.25 + 0.75 * Math.abs(Math.sin(t * 28)));

    const nScale = 1 + amp * PULSE + buzz * 0.02;
    if (state.letterGroup) {
      state.letterGroup.style.transform = `scale(${nScale.toFixed(4)})`;
    } else {
      for (let i = 0; i < state.letterEls.length; i += 1) {
        state.letterEls[i].style.transform = `scale(${nScale.toFixed(4)})`;
      }
    }

    for (let i = 0; i < state.bgEls.length; i += 1) {
      const el = state.bgEls[i];
      const phase = parseFloat(el.dataset.phase || '0');
      const echo = sampleEnvelope(10 + i * 8);
      const local = state.intensity * (beat * 0.4 + echo * 0.6);
      const s = 1 + local * 0.06 + Math.sin(t * 3 + phase) * local * 0.015;
      el.style.transform = `scale(${s.toFixed(4)})`;
    }

    const angZ = ((state.waveAngle % 360) + 360) % 360;
    const tiltX = Math.sin((state.waveAngleX * Math.PI) / 180) * state.maxTilt;
    const tiltY = Math.sin((state.waveAngleY * Math.PI) / 180) * state.maxTilt;
    const reverb = sampleEnvelope(8) * 0.5 + beat * 0.5;
    const tAmp = state.intensity * reverb;
    const tBuzz = tAmp * (0.25 + 0.75 * Math.abs(Math.sin(t * 26)));
    const tScale = 1 + tAmp * PULSE + tBuzz * 0.02;

    const face =
      Math.abs(Math.cos((tiltX * Math.PI) / 180)) *
      Math.abs(Math.cos((tiltY * Math.PI) / 180));
    const faceBoost = 1 + (1 - clamp(face, 0.35, 1)) * 0.55;

    if (state.tracciatoGroup) {
      state.tracciatoGroup.removeAttribute('transform');
      state.tracciatoGroup.style.transformBox = 'view-box';
      state.tracciatoGroup.style.transformOrigin = `${state.cx}px ${state.cy}px`;
      state.tracciatoGroup.style.transformStyle = 'preserve-3d';
      state.tracciatoGroup.style.transform =
        `perspective(${state.perspectivePx}px) rotateX(${tiltX.toFixed(2)}deg) ` +
        `rotateY(${tiltY.toFixed(2)}deg) rotateZ(${angZ.toFixed(2)}deg) ` +
        `scale(${(tScale * faceBoost).toFixed(4)})`;
    }

    if (state.tracciatoStroke) {
      const baseW = state.strokeBaseWidth;
      state.tracciatoStroke.style.strokeWidth = (
        baseW * (1 + (1 - clamp(face, 0.4, 1)) * 1.4)
      ).toFixed(2);
    }

    if (state.displacement && state.turbulence) {
      state.displacement.setAttribute(
        'scale',
        (5 + state.intensity * reverb * 48).toFixed(2),
      );
      state.turbulence.setAttribute(
        'baseFrequency',
        (0.012 + reverb * state.intensity * 0.008).toFixed(4),
      );
    }
  }

  function frame(now) {
    if (!state) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    state.t += dt * state.speed;
    updateSpeechEnvelope(dt);

    // Idle breathes slower than speak/live so the mark feels calm while waiting.
    const idleSpinScale = state.mode === 'idle' ? 0.55 : 1;
    const drive = state.speechAmp * state.intensity * state.speed * idleSpinScale;
    state.waveAngle += state.spinSpeed * drive * dt;
    state.waveAngleY += state.spinSpeedY * drive * dt;
    state.waveAngleX += state.spinSpeedX * drive * dt;

    render();
    rafId = requestAnimationFrame(frame);
  }

  async function loadSvgIntoHost(host) {
    const res = await fetch(SVG_URL());
    if (!res.ok) throw new Error('Failed to load voice SVG');
    host.innerHTML = await res.text();

    const svg = host.querySelector('svg');
    if (!svg) throw new Error('Voice SVG missing root');

    svg.classList.add('neura-voice-art');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const vb = (svg.getAttribute('viewBox') || '0 0 839.57 839.57')
      .split(/[\s,]+/)
      .map(Number);
    state.cx = vb[0] + vb[2] / 2;
    state.cy = vb[1] + vb[3] / 2;

    injectFilters(svg);
    prepareLayers(svg);
    state.ready = true;
  }

  async function mount(host, opts = {}) {
    await unmount();
    hostEl = host;
    state = createState();
    externalAmp = 0;
    externalAmpAt = 0;

    let cfg = opts.config || null;
    if (!cfg) {
      try {
        const res = await fetch(CONFIG_URL());
        if (res.ok) cfg = await res.json();
      } catch (_) {
        /* use defaults */
      }
    }
    if (cfg) applyConfig(cfg);
    // Idle breath until voice-mode drives live/speak.
    state.mode = opts.mode || 'idle';

    await loadSvgIntoHost(host);
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  async function unmount() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (hostEl) {
      hostEl.innerHTML = '';
      hostEl = null;
    }
    state = null;
    externalAmp = 0;
  }

  function setMode(mode) {
    if (!state) return;
    if (mode === 'idle' || mode === 'speak' || mode === 'burst' || mode === 'live') {
      state.mode = mode;
      if (mode === 'burst') state.burstUntil = performance.now() + 900;
      if (mode !== 'live') {
        externalAmp = 0;
      }
    }
  }

  /**
   * Drive animation from real TTS amplitude (0..1+).
   * Caller must setMode('live') while OpenWebUI audio is playing.
   * @param {number} amp
   */
  function setExternalAmp(amp) {
    externalAmp = clamp(Number(amp) || 0, 0, 1.5);
    externalAmpAt = performance.now();
  }

  Neura.animationPlayer = {
    mount,
    unmount,
    setMode,
    setExternalAmp,
    applyConfig,
    isMounted() {
      return !!state?.ready;
    },
  };
})(window.Neura);
