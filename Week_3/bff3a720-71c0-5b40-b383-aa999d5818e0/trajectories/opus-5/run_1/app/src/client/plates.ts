import { h } from './dom.js';

export type SceneKind = 'road' | 'coast' | 'fields' | 'ferry' | 'interior';

const KINDS: SceneKind[] = ['road', 'coast', 'fields', 'ferry', 'interior'];

const PHRASES: Record<SceneKind, string[]> = {
  road: [
    'the long straight past the quarry',
    'the climb over the ridge',
    'the wet road at first light',
  ],
  coast: ['the coast road above the bay', 'the sea wall on a grey morning'],
  fields: ['the open fields after the turn', 'hedgerows under low cloud'],
  ferry: ['the ferry ramp at slack water', 'the slipway before loading'],
  interior: ['the rear seat with a folded coat', 'the back seat and a packed bag'],
};

const PALETTE = {
  sky: '#cdc5b7',
  skyLow: '#bdb4a4',
  land: '#a39784',
  landDark: '#8d8170',
  water: '#8e9792',
  road: '#6f6962',
  ink: '#211f1c',
  muted: '#6f6258',
  pale: '#ded7cb',
};

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function random(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function band(
  ctx: CanvasRenderingContext2D,
  y: number,
  height: number,
  width: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  ctx.fillRect(0, y, width, height);
}

function drawRoad(
  ctx: CanvasRenderingContext2D,
  w: number,
  hgt: number,
  rnd: () => number,
): void {
  const horizon = hgt * (0.38 + rnd() * 0.12);
  band(ctx, 0, horizon, w, PALETTE.sky);
  band(ctx, horizon, hgt - horizon, w, PALETTE.land);
  const vanish = w * (0.35 + rnd() * 0.3);
  ctx.fillStyle = PALETTE.road;
  ctx.beginPath();
  ctx.moveTo(vanish - w * 0.02, horizon);
  ctx.lineTo(vanish + w * 0.02, horizon);
  ctx.lineTo(w * 0.95, hgt);
  ctx.lineTo(w * 0.05, hgt);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PALETTE.pale;
  ctx.lineWidth = Math.max(1, w * 0.004);
  for (let dash = 1; dash <= 9; dash += 1) {
    const t = dash / 9;
    const y = horizon + (hgt - horizon) * t;
    const centre = vanish + (w * 0.5 - vanish) * t;
    ctx.beginPath();
    ctx.moveTo(centre, y);
    ctx.lineTo(centre, y + (hgt - horizon) * t * 0.08);
    ctx.stroke();
  }
}

function drawCoast(
  ctx: CanvasRenderingContext2D,
  w: number,
  hgt: number,
  rnd: () => number,
): void {
  const horizon = hgt * (0.3 + rnd() * 0.1);
  band(ctx, 0, horizon, w, PALETTE.sky);
  band(ctx, horizon, hgt - horizon, w, PALETTE.water);
  ctx.strokeStyle = PALETTE.pale;
  ctx.lineWidth = Math.max(1, hgt * 0.004);
  for (let i = 0; i < 14; i += 1) {
    const y = horizon + (hgt - horizon) * ((i + 1) / 15);
    const start = w * rnd() * 0.4;
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.lineTo(start + w * (0.2 + rnd() * 0.5), y);
    ctx.stroke();
  }
  ctx.fillStyle = PALETTE.landDark;
  ctx.beginPath();
  ctx.moveTo(0, hgt);
  ctx.lineTo(0, hgt * (0.7 + rnd() * 0.1));
  ctx.lineTo(w * 0.45, hgt);
  ctx.closePath();
  ctx.fill();
}

function drawFields(
  ctx: CanvasRenderingContext2D,
  w: number,
  hgt: number,
  rnd: () => number,
): void {
  const horizon = hgt * (0.32 + rnd() * 0.1);
  band(ctx, 0, horizon, w, PALETTE.sky);
  let y = horizon;
  let index = 0;
  while (y < hgt) {
    const depth = (hgt - horizon) * (0.1 + rnd() * 0.18);
    band(ctx, y, depth, w, index % 2 === 0 ? PALETTE.land : PALETTE.landDark);
    y += depth;
    index += 1;
  }
  ctx.strokeStyle = PALETTE.muted;
  ctx.lineWidth = Math.max(1, w * 0.003);
  for (let i = 0; i < 9; i += 1) {
    const x = w * ((i + rnd()) / 9);
    ctx.beginPath();
    ctx.moveTo(x, horizon);
    ctx.lineTo(x + (w * 0.5 - x) * -0.3, hgt);
    ctx.stroke();
  }
}

function drawFerry(
  ctx: CanvasRenderingContext2D,
  w: number,
  hgt: number,
  rnd: () => number,
): void {
  const horizon = hgt * (0.34 + rnd() * 0.08);
  band(ctx, 0, horizon, w, PALETTE.skyLow);
  band(ctx, horizon, hgt - horizon, w, PALETTE.water);
  ctx.fillStyle = PALETTE.road;
  ctx.beginPath();
  ctx.moveTo(w * 0.3, horizon);
  ctx.lineTo(w * 0.7, horizon);
  ctx.lineTo(w, hgt);
  ctx.lineTo(0, hgt);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.ink;
  for (let i = 0; i < 4; i += 1) {
    const t = (i + 1) / 5;
    const size = w * 0.015 * (1 + t * 2);
    ctx.fillRect(w * (0.08 + t * 0.03), horizon + (hgt - horizon) * t, size, size * 2);
    ctx.fillRect(w * (0.9 - t * 0.03), horizon + (hgt - horizon) * t, size, size * 2);
  }
}

function drawInterior(
  ctx: CanvasRenderingContext2D,
  w: number,
  hgt: number,
  rnd: () => number,
): void {
  band(ctx, 0, hgt, w, PALETTE.landDark);
  ctx.fillStyle = PALETTE.skyLow;
  ctx.fillRect(w * 0.08, hgt * 0.06, w * 0.46, hgt * 0.3);
  ctx.fillStyle = PALETTE.land;
  ctx.fillRect(0, hgt * 0.46, w, hgt * 0.54);
  ctx.fillStyle = PALETTE.road;
  ctx.beginPath();
  ctx.moveTo(w * 0.18, hgt * 0.62);
  ctx.lineTo(w * 0.62, hgt * (0.5 + rnd() * 0.06));
  ctx.lineTo(w * 0.78, hgt * 0.8);
  ctx.lineTo(w * 0.3, hgt * 0.92);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = Math.max(1, w * 0.004);
  ctx.beginPath();
  ctx.moveTo(0, hgt * 0.46);
  ctx.lineTo(w, hgt * 0.46);
  ctx.stroke();
}

function grain(ctx: CanvasRenderingContext2D, w: number, hgt: number, rnd: () => number): void {
  const count = Math.floor(w * hgt * 0.06);
  for (let i = 0; i < count; i += 1) {
    const shade = rnd() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.05)`;
    ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * hgt), 1, 1);
  }
}

const DRAW: Record<
  SceneKind,
  (ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void
> = {
  road: drawRoad,
  coast: drawCoast,
  fields: drawFields,
  ferry: drawFerry,
  interior: drawInterior,
};

export interface PlateOptions {
  /** The same seed always gives the same picture. */
  seed: string;
  /** The caption starts with the leg the drawing shows. */
  leg: string;
  kind?: SceneKind;
  ratio?: number;
  className?: string;
}

const SPANS = ['full', 'three-quarters', 'three-fifths'] as const;
let rhythm = 0;

/** Down a page the plate widths repeat: full, about three quarters, about three fifths. */
export function resetPlateRhythm(): void {
  rhythm = 0;
}

export function plate(options: PlateOptions): HTMLElement {
  const seed = hash(options.seed);
  const rnd = random(seed);
  const kind = options.kind ?? (KINDS[seed % KINDS.length] as SceneKind);
  const phrases = PHRASES[kind];
  const phrase = phrases[seed % phrases.length] as string;
  const ratio = options.ratio ?? 1.6;

  const canvas = h('canvas', { 'aria-hidden': 'true', class: 'plate-canvas' });
  const span = SPANS[rhythm % SPANS.length] as string;
  rhythm += 1;
  const figure = h(
    'figure',
    { class: `plate ${options.className ?? ''}`.trim(), 'data-span': span },
    canvas,
    h('figcaption', { text: `${options.leg}, ${phrase}` }),
  );
  canvas.style.aspectRatio = String(ratio);

  const paint = () => {
    const width = canvas.clientWidth || 320;
    const height = Math.round(width / ratio);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scene = random(seed);
    DRAW[kind](ctx, width, height, scene);
    grain(ctx, width, height, rnd);
  };

  requestAnimationFrame(paint);
  const observer = new ResizeObserver(() => paint());
  observer.observe(canvas);
  return figure;
}
