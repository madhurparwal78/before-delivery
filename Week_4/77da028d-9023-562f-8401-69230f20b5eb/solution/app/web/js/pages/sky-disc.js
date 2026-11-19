// The sky disc with no targets: rim ticks, altitude rings and a treeline ring. Used by Unlock and the empty Library.
import { svg } from '../core/dom.js';

const BINS = 72;

function treelinePath(radius, depth) {
  const inner = [];
  for (let bin = 0; bin < BINS; bin += 1) {
    const angle = ((bin + 0.5) * 5 - 90) * (Math.PI / 180);
    const rise = depth * (0.45 + 0.3 * Math.sin(bin * 0.9) + 0.25 * Math.sin(bin * 2.3 + 1));
    inner.push([Math.cos(angle) * (radius - rise), Math.sin(angle) * (radius - rise)]);
  }
  const outer = `M ${radius} 0 A ${radius} ${radius} 0 1 0 ${-radius} 0 A ${radius} ${radius} 0 1 0 ${radius} 0 Z`;
  return `${outer} M ${inner.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;
}

function ticks(radius) {
  let marks = '';
  for (let degrees = 0; degrees < 360; degrees += 30) {
    const angle = (degrees - 90) * (Math.PI / 180);
    const [x1, y1] = [Math.cos(angle) * (radius + 3), Math.sin(angle) * (radius + 3)];
    const [x2, y2] = [Math.cos(angle) * (radius + 9), Math.sin(angle) * (radius + 9)];
    marks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return marks;
}

export function skyDisc({ size = 280 } = {}) {
  const radius = 100;
  return svg(`
    <svg class="sky-disc" viewBox="-120 -120 240 240" width="${size}" height="${size}" role="presentation" aria-hidden="true" focusable="false">
      <circle class="sky-disc-fill" r="${radius}"/>
      <circle class="sky-disc-ring" r="${radius * 2 / 3}"/>
      <circle class="sky-disc-ring" r="${radius / 3}"/>
      <path class="sky-disc-treeline" fill-rule="evenodd" d="${treelinePath(radius, 16)}"/>
      <circle class="sky-disc-rim" r="${radius}"/>
      <g class="sky-disc-ticks">${ticks(radius)}</g>
      <circle class="sky-disc-zenith" r="2"/>
    </svg>`);
}
