// The sky dome control: camera state, pointer/keyboard/wheel/pinch input, the accessible name,
// and the choice between the WebGL scene and the still chart when WebGL is unavailable.
import { h } from '../core/dom.js';
import { angleDelta, lerp, tween } from './motion.js';
import { createDomeFallback } from './dome-fallback.js';

const RESET_VIEW = Object.freeze({ elevation: 35, azimuth: 180, zoom: 1 });
const ELEVATION_LIMITS = [5, 85];
const ZOOM_LIMITS = [0.6, 2];
const DEGREES_PER_PIXEL = 0.25;
const KEY_ORBIT_DEGREES = 5;
const KEY_ZOOM = 0.1;
const WHEEL_PIXELS_PER_ZOOM = 1000;
const DOUBLE_TAP_MS = 350;
const TAP_SLOP_PX = 12;

function domeName(view, minute) {
  const azimuth = Math.round(view.azimuth) % 360;
  return `Sky dome: camera elevation ${Math.round(view.elevation)} degrees, azimuth ${azimuth} degrees, zoom ${view.zoom.toFixed(1)}, night minute ${minute}`;
}

function clamp(value, [low, high]) {
  return Math.min(high, Math.max(low, value));
}

function tidy(view) {
  return {
    elevation: Math.round(clamp(view.elevation, ELEVATION_LIMITS) * 1e4) / 1e4,
    azimuth: Math.round((((view.azimuth % 360) + 360) % 360) * 1e4) / 1e4,
    zoom: Math.round(clamp(view.zoom, ZOOM_LIMITS) * 100) / 100,
  };
}

export function createDome() {
  const canvas = h('canvas', { class: 'dome-canvas', role: 'img', tabindex: '0', 'aria-label': domeName(RESET_VIEW, 0) });
  const stage = h('div', { class: 'dome-stage' }, canvas);
  const element = h('div', { class: 'dome-wrap' }, stage);

  let target = { ...RESET_VIEW };
  let shown = { ...RESET_VIEW };
  let minute = 0;
  let scene = null;
  let fallback = null;
  let move = null;
  let latest = { plan: null, mask: null, latitude: null, timeLabel: '' };

  function name() {
    return domeName(fallback ? RESET_VIEW : target, minute);
  }
  function relabel() {
    (fallback ? fallback.canvas : canvas).setAttribute('aria-label', name());
  }

  function orbitTo(patch) {
    target = tidy({ ...target, ...patch });
    relabel();
    if (!scene) return;
    if (move) move.cancel();
    const from = { ...shown };
    const swing = angleDelta(from.azimuth, target.azimuth);
    const to = target;
    move = tween({ duration: 160, kickoff: 0.35, update(progress) {
      shown = { elevation: lerp(from.elevation, to.elevation, progress), azimuth: from.azimuth + swing * progress, zoom: lerp(from.zoom, to.zoom, progress) };
      scene.render(shown);
    } });
  }

  function reset() {
    orbitTo(RESET_VIEW);
  }

  const touches = new Map();
  let pinchSpan = 0;
  let lastTap = { at: -Infinity, x: 0, y: 0 };
  let travelled = 0;

  function span() {
    const [first, second] = [...touches.values()];
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    travelled = 0;
    if (touches.size === 2) pinchSpan = span();
  });
  canvas.addEventListener('pointermove', (event) => {
    const previous = touches.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    touches.set(event.pointerId, next);
    if (touches.size === 2) {
      const now = span();
      if (pinchSpan > 0) orbitTo({ zoom: target.zoom * (now / pinchSpan) });
      pinchSpan = now;
      return;
    }
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    travelled += Math.abs(dx) + Math.abs(dy);
    orbitTo({ azimuth: target.azimuth + dx * DEGREES_PER_PIXEL, elevation: target.elevation - dy * DEGREES_PER_PIXEL });
  });
  function release(event) {
    if (!touches.delete(event.pointerId)) return;
    pinchSpan = 0;
    if (event.type !== 'pointerup' || event.pointerType !== 'touch' || travelled > TAP_SLOP_PX) return;
    const now = performance.now();
    const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 40;
    if (now - lastTap.at < DOUBLE_TAP_MS && near) {
      reset();
      lastTap = { at: -Infinity, x: 0, y: 0 };
    } else lastTap = { at: now, x: event.clientX, y: event.clientY };
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('dblclick', reset);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
    orbitTo({ zoom: target.zoom - pixels / WHEEL_PIXELS_PER_ZOOM });
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const steps = {
      ArrowRight: { azimuth: target.azimuth + KEY_ORBIT_DEGREES },
      ArrowLeft: { azimuth: target.azimuth - KEY_ORBIT_DEGREES },
      ArrowUp: { elevation: target.elevation + KEY_ORBIT_DEGREES },
      ArrowDown: { elevation: target.elevation - KEY_ORBIT_DEGREES },
      '+': { zoom: target.zoom + KEY_ZOOM },
      '=': { zoom: target.zoom + KEY_ZOOM },
      '-': { zoom: target.zoom - KEY_ZOOM },
    };
    if (event.key === '0') { event.preventDefault(); reset(); return; }
    if (!steps[event.key]) return;
    event.preventDefault();
    orbitTo(steps[event.key]);
  });

  function fit() {
    if (scene && canvas.clientWidth) {
      scene.resize(canvas.clientWidth, canvas.clientHeight);
      scene.render(shown);
    }
  }

  function showFallback() {
    fallback = createDomeFallback(name());
    stage.replaceChildren(fallback.canvas);
    element.append(fallback.note);
    relabel();
    if (latest.plan) fallback.show({ plan: latest.plan, mask: latest.mask, minute, timeLabel: latest.timeLabel });
  }

  async function start() {
    try {
      const { createDomeScene } = await import('./dome-scene.js');
      scene = createDomeScene(canvas);
    } catch {
      scene = null;
      showFallback();
      return;
    }
    shown = { ...target };
    new ResizeObserver(fit).observe(canvas);
    if (latest.latitude !== null) scene.setLatitude(latest.latitude);
    if (latest.mask) scene.setHorizon(latest.mask);
    if (latest.plan) scene.setPlan(latest.plan, { staged: false });
    fit();
  }

  return {
    element,
    start,
    setMinute(next) {
      minute = next;
      relabel();
    },
    setHorizon(altitudes) {
      latest.mask = altitudes;
      if (scene) { scene.setHorizon(altitudes); scene.render(shown); }
      if (fallback && latest.plan) fallback.show({ plan: latest.plan, mask: altitudes, minute, timeLabel: latest.timeLabel });
    },
    setLatitude(degrees) {
      latest.latitude = degrees;
      if (scene) scene.setLatitude(degrees);
    },
    // setPlan(plan, {staged, timeLabel}): the scene and the still chart both show the plan at the handle's minute.
    setPlan(plan, { staged, timeLabel }) {
      latest = { ...latest, plan, timeLabel };
      if (scene) scene.setPlan(plan, { staged });
      if (fallback) fallback.show({ plan, mask: latest.mask, minute, timeLabel });
    },
  };
}
