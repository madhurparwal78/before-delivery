// Procedural imagery only: a storyboard frame is a pencil-line drawing
// generated from the frame's number, so the desk's only imagery is drawn or
// uploaded, never fetched and never a stock image. A seeded frame's drawing is
// `frame-<number>.svg` at 1280 by 720, made when read and never kept in the
// file store, so a copy starts with the store down.

const WIDTH = 1280;
const HEIGHT = 720;

function seedOf(text: string): number {
  let h = 2166136261;
  for (const byte of Buffer.from(text, "utf8")) {
    h ^= byte;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed: number): () => number {
  let s = seed;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// A deterministic pencil-line storyboard drawing for a frame of a job.
export function frameDrawingSvg(frameNumber: number, actionNote: string): string {
  const seed = seedOf(`${frameNumber}:${actionNote}`);
  const next = rand(seed);
  const lines: string[] = [];
  // The horizon and three or four gentle picture elements, in the visual
  // language of a storyboard frame: a frame line, a horizon, a shape or two.
  lines.push(`<rect x="24" y="24" width="${WIDTH - 48}" height="${HEIGHT - 48}" fill="none" stroke="#1a1a1a" stroke-width="3"/>`);
  const horizon = 300 + Math.floor(next() * 220);
  lines.push(`<line x1="48" y1="${horizon}" x2="${WIDTH - 48}" y2="${horizon - Math.floor(next() * 60)}" stroke="#1a1a1a" stroke-width="2"/>`);
  const shapes = 3 + Math.floor(next() * 3);
  for (let i = 0; i < shapes; i++) {
    const x = 80 + Math.floor(next() * (WIDTH - 200));
    const y = horizon - Math.floor(next() * 180);
    const w = 60 + Math.floor(next() * 260);
    const h = 40 + Math.floor(next() * 200);
    if (next() > 0.5) {
      lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`);
    } else {
      lines.push(`<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 2}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`);
    }
  }
  // An arrow of motion, as a storyboard would carry one.
  const ax = 160 + Math.floor(next() * 500);
  const ay = horizon + 60 + Math.floor(next() * 160);
  lines.push(`<path d="M ${ax} ${ay} C ${ax + 140} ${ay - 70}, ${ax + 260} ${ay + 40}, ${ax + 380} ${ay - 30}" fill="none" stroke="#b3261e" stroke-width="6" stroke-linecap="round"/>`);
  lines.push(`<path d="M ${ax + 380} ${ay - 30} l -34 -6 l 14 30 z" fill="#b3261e"/>`);
  // The caption line, bottom left.
  lines.push(`<line x1="48" y1="${HEIGHT - 60}" x2="${WIDTH - 200}" y2="${HEIGHT - 60}" stroke="#1a1a1a" stroke-width="2"/>`);
  const body = lines.join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
  ${body}
</svg>
`;
}

export const DRAWING_WIDTH = WIDTH;
export const DRAWING_HEIGHT = HEIGHT;
export const DRAWING_MIME = "image/svg+xml";

export function seededDrawingName(frameNumber: number): string {
  return `frame-${frameNumber}.svg`;
}
