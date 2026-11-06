import { css, palette } from '../palette.js';

function sheet(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context');
  return context;
}

function paperBlob(context: CanvasRenderingContext2D, lobes: Array<[number, number, number]>): void {
  context.fillStyle = css(palette.paper);
  context.strokeStyle = css(palette.ink);
  context.lineWidth = 2;
  context.beginPath();
  for (const [x, y, r] of lobes) {
    context.moveTo(x + r, y);
    context.arc(x, y, r, 0, Math.PI * 2);
  }
  context.fill();
  context.stroke();
}

export function cloudSheet(): HTMLCanvasElement {
  const context = sheet(128, 64);
  paperBlob(context, [
    [36, 38, 20],
    [60, 30, 24],
    [88, 38, 18],
  ]);
  return context.canvas;
}

export function scrapSheet(): HTMLCanvasElement {
  const context = sheet(32, 32);
  context.fillStyle = css(palette.paper);
  context.strokeStyle = css(palette.ink);
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(4, 8);
  context.lineTo(26, 4);
  context.lineTo(29, 22);
  context.lineTo(12, 29);
  context.closePath();
  context.fill();
  context.stroke();
  return context.canvas;
}

/** A tiny paper tag carrying a courier's display name. */
export function tagSheet(name: string): HTMLCanvasElement {
  const measure = sheet(8, 8);
  measure.font = '600 22px "Atkinson Hyperlegible", system-ui, sans-serif';
  const text = name.length > 24 ? `${name.slice(0, 24)}` : name;
  const width = Math.min(360, Math.max(48, Math.ceil(measure.measureText(text).width) + 24));
  const context = sheet(width, 40);
  context.fillStyle = css(palette.paper);
  context.strokeStyle = css(palette.ink);
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(2, 2, width - 4, 36, 6);
  context.fill();
  context.stroke();
  context.font = '600 22px "Atkinson Hyperlegible", system-ui, sans-serif';
  context.fillStyle = css(palette.ink);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, width / 2, 21);
  return context.canvas;
}

/** Icon outlines from Lucide (ISC), drawn in ink on a 24 by 24 grid. */
const EMOTE_GLYPHS: Record<string, string[]> = {
  wave: [
    'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
    'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
    'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
    'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  ],
  cheer: [
    'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
  ],
  sleepy: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  heart: [
    'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  ],
};

function drawGlyph(context: CanvasRenderingContext2D, paths: string[], size: number): void {
  context.save();
  context.translate((64 - size) / 2, (56 - size) / 2);
  context.scale(size / 24, size / 24);
  context.lineWidth = (4 * 24) / size;
  context.lineJoin = 'round';
  for (const path of paths) {
    context.stroke(new Path2D(path));
  }
  context.restore();
}

/** A small paper speech bubble with the emote's ink icon. */
export function emoteSheet(emote: string): HTMLCanvasElement {
  const context = sheet(64, 76);
  context.fillStyle = css(palette.paper);
  context.strokeStyle = css(palette.ink);
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(3, 3, 58, 56, 10);
  context.moveTo(26, 58);
  context.lineTo(32, 72);
  context.lineTo(40, 58);
  context.fill();
  context.stroke();
  context.strokeStyle = css(palette.ink);
  context.lineCap = 'round';
  const glyph = EMOTE_GLYPHS[emote];
  if (glyph !== undefined) drawGlyph(context, glyph, 36);
  return context.canvas;
}
