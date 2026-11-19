// Without WebGL the dome is a still picture of the flat sky chart at the current minute.
import { h } from '../core/dom.js';
import { drawSky, fitCanvas, skyScene } from './sky-draw.js';

export const DOME_UNAVAILABLE = '3D sky is unavailable on this device. Showing the flat sky chart.';

// createDomeFallback(name) -> {canvas, note, show({plan, mask, minute, timeLabel})}
export function createDomeFallback(name) {
  const canvas = h('canvas', { class: 'dome-canvas dome-canvas--still', role: 'img', tabindex: '0', 'aria-label': name });
  const note = h('p', { class: 'dome-note' }, DOME_UNAVAILABLE);
  let latest = null;

  function redraw() {
    if (!latest || !canvas.clientWidth) return;
    const { context, size } = fitCanvas(canvas);
    drawSky(context, skyScene(latest.plan, { size, mask: latest.mask, minute: latest.minute, timeLabel: latest.timeLabel }));
  }
  new ResizeObserver(redraw).observe(canvas);

  return {
    canvas,
    note,
    show(scene) {
      latest = scene;
      redraw();
    },
  };
}
