// Artwork frames for entries without an uploaded image, drawn on canvas from the entry id: the id seeds every
// choice, and the discipline picks the motif, so no two entries share a drawing.
const PALETTE = ["#0E0E10", "#F4EDE1", "#C8F031", "#2B1FD0", "#FF4A1F"];

function seeded(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawFrame(canvas: HTMLCanvasElement, id: string, discipline: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const rand = seeded(id);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;
  const ground = pick(["#0E0E10", "#F4EDE1", "#2B1FD0"]);
  const inks = PALETTE.filter((c) => c !== ground);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";

  if (discipline === "sound") {
    const lines = 9 + Math.floor(rand() * 8);
    for (let i = 0; i < lines; i++) {
      ctx.strokeStyle = pick(inks);
      ctx.lineWidth = 2 + rand() * 6;
      ctx.beginPath();
      const y = (h / (lines + 1)) * (i + 1);
      const freq = 1 + rand() * 5;
      const amp = 6 + rand() * 30;
      for (let x = 0; x <= w; x += 4) ctx.lineTo(x, y + Math.sin((x / w) * Math.PI * 2 * freq + i) * amp * Math.sin((x / w) * Math.PI));
      ctx.stroke();
    }
  } else if (discipline === "light") {
    const cx = w * (0.2 + rand() * 0.6);
    const cy = h * (0.1 + rand() * 0.4);
    const beams = 14 + Math.floor(rand() * 18);
    for (let i = 0; i < beams; i++) {
      ctx.strokeStyle = pick(inks);
      ctx.globalAlpha = 0.5 + rand() * 0.5;
      ctx.lineWidth = 1 + rand() * 10;
      const a = Math.PI * (0.15 + rand() * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * h * 1.6, cy + Math.sin(a) * h * 1.6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = pick(inks);
    ctx.beginPath();
    ctx.arc(cx, cy, 10 + rand() * 30, 0, Math.PI * 2);
    ctx.fill();
  } else if (discipline === "code") {
    const cell = 14 + Math.floor(rand() * 18);
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        if (rand() < 0.45) continue;
        ctx.fillStyle = pick(inks);
        const s = cell * (0.3 + rand() * 0.6);
        ctx.fillRect(x + (cell - s) / 2, y + (cell - s) / 2, rand() < 0.3 ? cell * 2.2 : s, s);
      }
    }
  } else if (discipline === "moving-image") {
    const frames = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < frames; i++) {
      ctx.fillStyle = pick(inks);
      const fw = w * (0.3 + rand() * 0.5);
      const fh = fw * 0.6;
      ctx.globalAlpha = 0.55 + rand() * 0.45;
      ctx.fillRect(rand() * (w - fw), (h / frames) * i + rand() * 20, fw, fh);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = ground;
    for (let y = 8; y < h; y += 22) { ctx.fillRect(8, y, 10, 12); ctx.fillRect(w - 18, y, 10, 12); }
  } else {
    const figures = 3 + Math.floor(rand() * 5);
    for (let i = 0; i < figures; i++) {
      ctx.strokeStyle = pick(inks);
      ctx.lineWidth = 6 + rand() * 14;
      ctx.beginPath();
      const x = w * rand();
      const y = h * (0.3 + rand() * 0.5);
      ctx.arc(x, y, 30 + rand() * 120, Math.PI * rand(), Math.PI * (1 + rand()));
      ctx.stroke();
    }
  }
}
