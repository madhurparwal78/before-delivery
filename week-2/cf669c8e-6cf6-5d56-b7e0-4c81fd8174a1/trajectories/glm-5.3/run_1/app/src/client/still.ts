import type { ScenePart } from './types';

// The still drawing: generated from the same parts table when WebGL is
// missing. Flat, ruled, with dimension lines and a visible fouling edge.

export interface StillState {
  selectedPart: string;
  travelMm: Record<string, number>;
  foulingPart: string | null;
  foulingFeature: string | null;
}

const INK = '#211d17';
const ACCENT = '#c8471b';
const SOFT = '#5c564b';

function partBox(part: ScenePart, travelMm: number): { x: number; y: number; w: number; h: number } {
  // Side view: x forward from the rear axle, z up.
  const [px, , pz] = part.position;
  let x = px, z = pz;
  const travel = travelMm ?? 0;
  if (part.axis === '+x') x += travel;
  if (part.axis === '-x') x -= travel;
  if (part.axis === '+z') z += travel;
  if (part.axis === '-z') z -= travel;
  const w = part.id.includes('wheel') ? 300 : Math.max(120, part.dimension.startsWith('Ø') ? 300 : Number(part.dimension.split(' ')[0]) || 200);
  const h = w * 0.6;
  return { x: x - w / 2, y: z - h / 2, w, h };
}

export function drawStill(canvas: HTMLCanvasElement, parts: ScenePart[], state: StillState): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.clientWidth || 640;
  const height = 440;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#faf6ef';
  ctx.fillRect(0, 0, width, height);

  // World: x from -200..1400 mm, z from -100..900 mm.
  const toX = (mm: number) => 40 + ((mm + 200) / 1600) * (width - 80);
  const toY = (mm: number) => height - 40 - ((mm + 100) / 1000) * (height - 70);

  for (const part of parts) {
    const travel = state.selectedPart === part.id ? state.travelMm[part.id] ?? 0 : state.travelMm[part.id] ?? 0;
    const box = partBox(part, travel);
    const faded = state.selectedPart === 'traction-pack' || state.selectedPart === 'hub-motor'
      ? part.fadedFor.includes(state.selectedPart === 'traction-pack' ? 'pack' : 'hub')
      : false;
    ctx.globalAlpha = faded ? 0.25 : 1;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    const rx = toX(box.x), ry = toY(box.y + box.h), rw = (box.w / 1600) * (width - 80), rh = (box.h / 1000) * (height - 70);
    if (part.id.includes('wheel')) {
      ctx.beginPath();
      ctx.arc(rx + rw / 2, ry + rh / 2, rw / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = 'rgba(33,29,23,0.06)';
      ctx.fillRect(rx, ry, rw, rh);
    }
    // Dimension line with the part's millimetre value.
    ctx.strokeStyle = SOFT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx, ry + rh + 8);
    ctx.lineTo(rx + rw, ry + rh + 8);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '10px IBM Plex Mono, monospace';
    ctx.fillText(part.dimension, rx, ry + rh + 20);
    ctx.globalAlpha = 1;
  }

  // The fouling edge, at least 3 CSS pixels thick, in the flat accent fill.
  if (state.foulingPart) {
    const part = parts.find((p) => p.id === state.foulingPart);
    if (part) {
      const box = partBox(part, state.travelMm[part.id] ?? 0);
      const rx = toX(box.x + box.w / 2), ry = toY(box.y + box.h / 2);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(rx - 14, ry);
      ctx.lineTo(rx + 14, ry);
      ctx.stroke();
    }
  }

  // Title block.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  ctx.fillStyle = INK;
  ctx.font = '16px Big Shoulders Display, sans-serif';
  ctx.fillText('OMMEZWAAI FEELER — FEELER SWEEP STILL', 20, 30);
}
