// The flat sky chart with the treeline lens. Redraws on demand only: a plan reply, a pointer move, focus, resize.
import { h } from '../core/dom.js';
import { oneDecimal } from '../core/format.js';
import { angleDelta, lerp, reducedMotion, tween } from './motion.js';
import { LENS_DIAMETER, chartPoint, dimAlpha, drawSky, fitCanvas, layoutOf, skyScene } from './sky-draw.js';

const NO_TARGET_UNDER_LENS = 'No target under the lens';

function readoutText(target) {
  const behind = target.position_status === 'behind-treeline' ? ', behind the treeline' : '';
  return `${target.target_name}: altitude ${oneDecimal(target.altitude_deg)} degrees, Moon ${oneDecimal(target.moon_separation_deg)} degrees away${behind}`;
}

export function createChart() {
  const canvas = h('canvas', { class: 'chart-canvas', role: 'img', 'aria-label': 'Sky chart', tabindex: '0' });
  const readout = h('div', { role: 'status', 'aria-live': 'off', 'aria-label': 'Lens readout', class: 'live lens-readout' }, NO_TARGET_UNDER_LENS);
  const element = h('section', { class: 'card chart-card' }, canvas, readout);

  let plan = null;
  let mask = null;
  let minute = 0;
  let timeLabel = '';
  let lens = null;
  let focusIndex = 0;
  let positions = new Map();
  let slide = null;
  let dim = null;

  function destination(target) {
    return { altitude: target.altitude_deg, azimuth: target.azimuth_deg, alpha: dimAlpha(target.position_status) };
  }

  function lensCentre() {
    if (!lens) return null;
    if (lens.mode !== 'focus') return { x: lens.x, y: lens.y };
    const target = plan.targets.find((entry) => entry.project_id === lens.projectId);
    return chartPoint(layoutOf(Math.round(canvas.clientWidth)), target.altitude_deg, target.azimuth_deg);
  }

  function redraw() {
    if (!plan || !canvas.clientWidth) return;
    const { context, size } = fitCanvas(canvas);
    const centre = lensCentre();
    drawSky(context, skyScene(plan, { size, mask, minute, timeLabel, lens: centre, positions }));
  }

  function nearestInLens(centre) {
    const layout = layoutOf(Math.round(canvas.clientWidth));
    let nearest = null;
    let nearestDistance = LENS_DIAMETER / 2;
    for (const target of plan.targets) {
      const at = chartPoint(layout, target.altitude_deg, target.azimuth_deg);
      const distance = Math.hypot(at.x - centre.x, at.y - centre.y);
      if (distance <= nearestDistance) { nearest = target; nearestDistance = distance; }
    }
    return nearest;
  }

  function updateReadout() {
    if (!lens || !plan) return;
    const target = lens.mode === 'focus'
      ? plan.targets.find((entry) => entry.project_id === lens.projectId)
      : nearestInLens(lensCentre());
    readout.textContent = target ? readoutText(target) : NO_TARGET_UNDER_LENS;
  }

  function focusTarget(projectId) {
    if (!plan) return;
    lens = projectId === null ? null : { mode: 'focus', projectId };
    updateReadout();
    redraw();
  }

  function focusIndexTarget() {
    if (!plan || plan.targets.length === 0) return null;
    focusIndex = Math.min(focusIndex, plan.targets.length - 1);
    return plan.targets[focusIndex].project_id;
  }

  function pointAt(event) {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  canvas.addEventListener('focus', () => focusTarget(focusIndexTarget()));
  canvas.addEventListener('blur', () => { if (lens && lens.mode === 'focus') focusTarget(null); });
  canvas.addEventListener('keydown', (event) => {
    if (!plan || plan.targets.length === 0 || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
    event.preventDefault();
    const count = plan.targets.length;
    focusIndex = (focusIndex + (event.key === 'ArrowRight' ? 1 : count - 1)) % count;
    focusTarget(focusIndexTarget());
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!plan || reducedMotion() || event.pointerType === 'touch') return;
    lens = { mode: 'pointer', ...pointAt(event) };
    updateReadout();
    redraw();
  });
  canvas.addEventListener('pointerleave', () => {
    if (lens && lens.mode === 'pointer') { lens = null; redraw(); }
  });
  canvas.addEventListener('click', (event) => {
    if (!plan) return;
    lens = { mode: 'pinned', ...pointAt(event) };
    updateReadout();
    redraw();
  });
  new ResizeObserver(redraw).observe(canvas);

  return {
    element,
    canvas,
    readout,
    setHorizon(altitudes) {
      mask = altitudes;
      redraw();
    },
    focusTarget,
    // setPlan(plan, {minute, timeLabel, staged}): staged slides the dots (position, then the dim/bright mask clip).
    setPlan(next, { minute: handleMinute, timeLabel: label, staged }) {
      plan = next;
      minute = handleMinute;
      timeLabel = label;
      if (slide) slide.cancel();
      if (dim) dim.cancel();
      const wanted = new Map(plan.targets.map((target) => [target.project_id, destination(target)]));
      const from = new Map();
      for (const [projectId, to] of wanted) from.set(projectId, positions.get(projectId) || to);
      positions = new Map([...from].map(([projectId, shown]) => [projectId, { ...shown }]));
      if (staged) {
        slide = tween({ duration: 160, update(progress) {
          for (const [projectId, to] of wanted) {
            const shown = positions.get(projectId);
            const start = from.get(projectId);
            shown.altitude = lerp(start.altitude, to.altitude, progress);
            shown.azimuth = start.azimuth + angleDelta(start.azimuth, to.azimuth) * progress;
          }
          redraw();
        } });
        dim = tween({ duration: 160, delay: 100, update(progress) {
          for (const [projectId, to] of wanted) positions.get(projectId).alpha = lerp(from.get(projectId).alpha, to.alpha, progress);
          redraw();
        } });
      } else {
        positions = wanted;
      }
      if (document.activeElement === canvas && !lens) focusTarget(focusIndexTarget());
      else if (lens && lens.mode === 'focus' && !wanted.has(lens.projectId)) focusTarget(focusIndexTarget());
      updateReadout();
      redraw();
    },
  };
}
