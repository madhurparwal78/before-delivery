// The characteristic curve: an SVG plot with a dot that glides to the current reading, and the figures list.
import { h, prefersReducedMotion } from './dom.js';
import { fixed, signed } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 480;
const HEIGHT = 280;
const PAD = { left: 48, right: 16, top: 16, bottom: 40 };
const GLIDE_MS = 250;
const EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';

function svgElement(name, attrs = {}) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

/** Plot the curve (when it has points) with axes, the speed point and a hidden dot. */
export function plotCurve(curve, label = 'Curve position') {
  const svg = svgElement('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': label });
  const points = curve?.points ?? [];
  const xs = points.map((p) => p.log_h);
  const low = points.length ? Math.min(...xs) - 0.1 : -1;
  const high = points.length ? Math.max(...xs) + 0.1 : 1;
  const top = points.length ? Math.max(...points.map((p) => p.net)) + 0.1 : 1;
  const x = (logH) => PAD.left + ((logH - low) / (high - low)) * (WIDTH - PAD.left - PAD.right);
  const y = (net) => HEIGHT - PAD.bottom - (Math.min(net, top) / top) * (HEIGHT - PAD.top - PAD.bottom);
  const stroke = { stroke: 'var(--ink)', 'stroke-width': 2, fill: 'none' };
  svg.append(svgElement('path', { ...stroke, d: `M${PAD.left} ${PAD.top}V${HEIGHT - PAD.bottom}H${WIDTH - PAD.right}` }));
  for (const [text, px, py, anchor] of [['log H', WIDTH - PAD.right, HEIGHT - 10, 'end'], ['net density', PAD.left + 6, PAD.top + 10, 'start']]) {
    const label = svgElement('text', { x: px, y: py, fill: 'var(--muted)', 'font-size': 13, 'text-anchor': anchor });
    label.textContent = text;
    svg.append(label);
  }
  if (points.length) {
    svg.append(svgElement('path', { ...stroke, d: points.map((p, i) => `${i ? 'L' : 'M'}${x(p.log_h).toFixed(1)} ${y(p.net).toFixed(1)}`).join('') }));
    if (curve.speed_point_log_h !== null) {
      svg.append(svgElement('rect', { x: x(curve.speed_point_log_h) - 4, y: y(0.1) - 4, width: 8, height: 8, fill: 'var(--muted)' }));
    }
  }
  const dot = svgElement('rect', { class: 'dot', width: 12, height: 12, fill: 'var(--accent)', visibility: 'hidden', x: -6, y: -6 });
  svg.append(dot);
  let current = null;
  return {
    svg,
    /** Glide the dot to (log H, net); hide it when the reading is off the curve or there is none. */
    moveDot(logH, net) {
      if (!points.length || logH === null || net === null) {
        dot.setAttribute('visibility', 'hidden');
        current = null;
        return;
      }
      const target = `translate(${x(Math.min(high, Math.max(low, logH)))}px, ${y(net)}px)`;
      dot.setAttribute('visibility', 'visible');
      if (current !== null && !prefersReducedMotion()) {
        dot.animate([{ transform: current }, { transform: target }], { duration: GLIDE_MS, easing: EASE });
      }
      dot.style.transform = target;
      current = target;
    },
  };
}

function figure(label, value) {
  return h('span', {}, h('span', { class: 'muted' }, label), ` ${value}`);
}

/** The figures list of a ready curve, with the meter bias line for a normal roll. */
export function curveFigures(curve, { bias = false } = {}) {
  const dash = (value, format) => (value === null ? '—' : format(value));
  return h('p', { class: 'figures' },
    figure('Base + fog', dash(curve.base_fog, fixed)),
    figure('Speed point log H', dash(curve.speed_point_log_h, signed)),
    figure('Contrast index', dash(curve.contrast_index, fixed)),
    figure('Frames used', curve.frames_used),
    figure('Span', `${curve.stops_span.toFixed(1)} stops`),
    bias ? figure('Meter bias', `${dash(curve.meter_bias_stops, (v) => signed(v, 1))} stops`) : null);
}
