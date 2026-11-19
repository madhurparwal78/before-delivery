const PITCH = 8;
const DOT = "#dce0e2";
const MAX_RATIO = 2;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws a branching tree as a field of small pale dots that fades out toward the edges. Drawn once, no animation. */
export function drawDotField(canvas: HTMLCanvasElement): void {
  const box = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const paint = mask.getContext("2d", { willReadFrequently: true });
  if (paint === null) return;
  const random = seeded(2611);
  paint.strokeStyle = "#000";
  paint.fillStyle = "#000";
  paint.lineCap = "round";
  const crown = Math.max(16, Math.min(width, height) / 14);

  const branch = (x: number, y: number, angle: number, length: number, thickness: number, depth: number): void => {
    const endX = x + Math.cos(angle) * length;
    const endY = y + Math.sin(angle) * length;
    paint.lineWidth = thickness;
    paint.beginPath();
    paint.moveTo(x, y);
    paint.lineTo(endX, endY);
    paint.stroke();
    if (depth === 0) {
      paint.beginPath();
      paint.arc(endX, endY, crown * (1 + random() * 0.8), 0, Math.PI * 2);
      paint.fill();
      return;
    }
    const forks = depth > 2 ? 2 : 2 + (random() > 0.55 ? 1 : 0);
    for (let fork = 0; fork < forks; fork += 1) {
      const spread = (fork - (forks - 1) / 2) * (0.55 + random() * 0.25);
      branch(endX, endY, angle + spread + (random() - 0.5) * 0.2, length * (0.72 + random() * 0.08), Math.max(2, thickness * 0.68), depth - 1);
    }
  };
  branch(width / 2, height + 8, -Math.PI / 2, height * 0.32, Math.max(12, width / 80), 5);

  const pixels = paint.getImageData(0, 0, width, height).data;
  const centreX = width / 2;
  const centreY = height * 0.5;
  for (let y = PITCH / 2; y < height; y += PITCH) {
    for (let x = PITCH / 2; x < width; x += PITCH) {
      const covered = (pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] ?? 0) / 255;
      if (covered < 0.4) continue;
      const away = Math.hypot((x - centreX) / (width * 0.5), (y - centreY) / (height * 0.58));
      const fade = Math.max(0, 1 - away ** 3);
      if (fade <= 0.02) continue;
      context.globalAlpha = 0.5 + 0.5 * fade;
      context.fillStyle = DOT;
      context.beginPath();
      context.arc(x, y, 1.5, 0, Math.PI * 2);
      context.fill();
      if (random() > 0.965) {
        context.globalAlpha = 0.35 + 0.35 * fade;
        context.beginPath();
        context.arc(x + (random() - 0.5) * PITCH, y + (random() - 0.5) * PITCH, 2.4 + random() * 1.4, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  context.globalAlpha = 1;
}
