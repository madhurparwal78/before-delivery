import { useEffect, useRef } from 'react';
import type { View } from '../lib/geometry';

const MIN_SPACING_PX = 8;

/**
 * The hairline grid behind everything: a line every 10 mm at the current zoom, every tenth line darker,
 * drawn with the thinnest line the screen can render (half a pixel on high-density screens, otherwise one).
 */
export function GridCanvas({ view, width, height }: { view: View; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const style = getComputedStyle(document.documentElement);
    const minor = style.getPropertyValue('--rule').trim();
    const major = style.getPropertyValue('--rule-strong').trim();
    let stepMm = 10;
    while (stepMm * view.scale < MIN_SPACING_PX) stepMm *= 10;
    const step = stepMm * view.scale;
    const lineWidth = Math.max(1, Math.round(ratio >= 2 ? ratio / 2 : ratio));
    const snap = (value: number) => Math.round(value * ratio - lineWidth / 2) + lineWidth / 2;
    const draw = (index: number, from: number, to: number, vertical: boolean, position: number) => {
      ctx.strokeStyle = index % 10 === 0 ? major : minor;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(snap(position), from * ratio);
        ctx.lineTo(snap(position), to * ratio);
      } else {
        ctx.moveTo(from * ratio, snap(position));
        ctx.lineTo(to * ratio, snap(position));
      }
      ctx.stroke();
    };
    // Minor lines first so the darker tenth lines are never painted over.
    for (const pass of ['minor', 'major'] as const) {
      for (let i = Math.floor(-view.ox / step); i * step + view.ox < width; i++) {
        if ((i % 10 === 0) === (pass === 'major')) draw(i, 0, height, true, view.ox + i * step);
      }
      for (let i = Math.floor(-(height - view.oy) / step); view.oy - i * step > 0; i++) {
        if ((i % 10 === 0) === (pass === 'major')) draw(i, 0, width, false, view.oy - i * step);
      }
    }
  }, [view, width, height]);

  return <canvas ref={ref} className="grid" aria-hidden="true" style={{ width, height }} />;
}
