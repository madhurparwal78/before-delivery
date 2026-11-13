/** Procedural eyepiece views for the landing page: the same field circle the app draws, with three objects in it. */

export const HERO_OBJECTS = ["M13", "Albireo", "M51"] as const;
export type HeroObject = (typeof HERO_OBJECTS)[number];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color},${alpha})`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  ctx.fillStyle = `rgba(${color},${alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

const WHITE = "255,255,255";

function backgroundStars(ctx: CanvasRenderingContext2D, rand: () => number, R: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * R * 0.97;
    const b = rand() ** 3;
    dot(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.4 + b * 1.5, WHITE, 0.25 + b * 0.7);
  }
}

function globular(ctx: CanvasRenderingContext2D, R: number): void {
  const rand = rng(13);
  glow(ctx, 0, 0, R * 0.55, "255,244,230", 0.5);
  glow(ctx, 0, 0, R * 0.22, WHITE, 0.55);
  for (let i = 0; i < 1500; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.abs(gaussian(rand)) * R * 0.2 + rand() * rand() * R * 0.55;
    if (d > R * 0.92) continue;
    const b = rand() ** 2.2;
    dot(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.5 + b * 1.7, WHITE, 0.3 + b * 0.7);
  }
  backgroundStars(ctx, rand, R, 90);
}

function doubleStar(ctx: CanvasRenderingContext2D, R: number): void {
  const rand = rng(7);
  backgroundStars(ctx, rand, R, 110);
  const gap = R * 0.2;
  const angle = -0.55;
  const ax = -Math.cos(angle) * gap;
  const ay = -Math.sin(angle) * gap;
  const bx = Math.cos(angle) * gap;
  const by = Math.sin(angle) * gap;
  glow(ctx, ax, ay, R * 0.5, "255,196,87", 0.5);
  glow(ctx, bx, by, R * 0.34, "127,180,255", 0.5);
  glow(ctx, ax, ay, R * 0.16, "255,226,160", 0.9);
  glow(ctx, bx, by, R * 0.11, "190,220,255", 0.9);
  dot(ctx, ax, ay, R * 0.045, "255,244,214", 1);
  dot(ctx, bx, by, R * 0.034, "232,242,255", 1);
}

function whirlpool(ctx: CanvasRenderingContext2D, R: number): void {
  const rand = rng(51);
  backgroundStars(ctx, rand, R, 100);
  ctx.save();
  ctx.rotate(-0.5);
  ctx.scale(1, 0.82);
  glow(ctx, 0, 0, R * 0.5, "230,236,255", 0.4);
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 700; i++) {
      const t = rand() * 3.2 + 0.25;
      const a = t * 1.9 + arm * Math.PI;
      const d = R * 0.1 * Math.exp(t * 0.52);
      const jitter = gaussian(rand) * R * (0.015 + 0.012 * t);
      const x = Math.cos(a) * d + jitter;
      const y = Math.sin(a) * d + gaussian(rand) * R * 0.02;
      if (Math.hypot(x, y) > R * 0.9) continue;
      dot(ctx, x, y, 0.6 + rand() * 1.1, "225,232,255", 0.14 + rand() * 0.45);
    }
  }
  glow(ctx, 0, 0, R * 0.2, WHITE, 0.85);
  glow(ctx, 0, 0, R * 0.07, WHITE, 1);
  ctx.restore();
  glow(ctx, R * 0.52, -R * 0.38, R * 0.17, "225,232,255", 0.6);
  glow(ctx, R * 0.52, -R * 0.38, R * 0.06, WHITE, 0.9);
}

export function drawEyepieceView(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, which: HeroObject): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cssWidth * dpr);
  const h = Math.round(cssHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(w / cssWidth, 0, 0, h / cssHeight, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const R = Math.min(cssWidth, cssHeight) / 2 - 18;
  if (R < 1) return;
  ctx.save();
  ctx.translate(cssWidth / 2, cssHeight / 2);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#0B060D";
  ctx.fillRect(-R, -R, R * 2, R * 2);
  glow(ctx, 0, 0, R, WHITE, 0.07);
  if (which === "M13") globular(ctx, R);
  else if (which === "Albireo") doubleStar(ctx, R);
  else whirlpool(ctx, R);
  ctx.restore();
  ctx.save();
  ctx.translate(cssWidth / 2, cssHeight / 2);
  ctx.strokeStyle = "rgba(185,169,191,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, R - 0.75, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
