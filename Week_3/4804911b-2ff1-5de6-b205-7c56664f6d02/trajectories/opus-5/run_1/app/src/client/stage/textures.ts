import { FRONT_BOX, GRAIN_STRIP, PACK_SIZES, PANEL_GEOMETRY, type PackFormat } from './geometry.js';

export const ACCENT = { r: 255, g: 217, b: 220 };
const PAPER = '#ffffff';
const INK = '#2a2a2a';
const CARMINE = '#9c1220';

export interface PanelCopy {
  mrpLine: string;
  lines: string[];
  revisedLine: string | null;
}

function faceCanvas(format: PackFormat, width: number): HTMLCanvasElement {
  const size = PACK_SIZES[format];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((width * size.h) / size.w);
  return canvas;
}

/** A deterministic printed grain, so a reload draws the same pixels. */
function seededNoise(context: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }): void {
  let seed = 0x2f6e2b1;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 0x100000000;
    return seed / 0x100000000;
  };
  const block = 3;
  for (let y = rect.y; y < rect.y + rect.h; y += block) {
    for (let x = rect.x; x < rect.x + rect.w; x += block) {
      const level = 232 + Math.round(random() * 22);
      context.fillStyle = `rgb(${level},${level},${level})`;
      context.fillRect(x, y, block, block);
    }
  }
}

function fitLines(
  context: CanvasRenderingContext2D,
  value: string,
  box: { w: number; h: number },
  family: string,
): { size: number; lines: string[] } {
  for (let size = Math.floor(box.h / 2.2); size >= 6; size -= 1) {
    context.font = `${size}px ${family}`;
    const words = value.split(/\s+/).filter((word) => word !== '');
    const lines: string[] = [];
    let current = '';
    let fits = true;
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (context.measureText(candidate).width <= box.w) {
        current = candidate;
        continue;
      }
      if (current === '') {
        fits = context.measureText(word).width <= box.w;
        if (!fits) break;
      }
      lines.push(current);
      current = word;
    }
    if (current !== '') lines.push(current);
    if (fits && lines.length * size * 1.15 <= box.h) return { size, lines };
  }
  context.font = `6px ${family}`;
  return { size: 6, lines: [value.slice(0, 20)] };
}

/** The pack front: the live drink name and variant inside the published front box. */
export function buildFrontTexture(format: PackFormat, drinkName: string, variant: string): HTMLCanvasElement {
  const canvas = faceCanvas(format, 420);
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = PAPER;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = CARMINE;
  context.fillRect(0, 0, canvas.width, Math.round(canvas.height * 0.12));
  context.fillRect(0, Math.round(canvas.height * 0.92), canvas.width, Math.round(canvas.height * 0.08));
  seededNoise(context, {
    x: Math.round(GRAIN_STRIP.x * canvas.width),
    y: Math.round(GRAIN_STRIP.y * canvas.height),
    w: Math.round(GRAIN_STRIP.w * canvas.width),
    h: Math.round(GRAIN_STRIP.h * canvas.height),
  });

  const box = {
    x: FRONT_BOX.x * canvas.width,
    y: FRONT_BOX.y * canvas.height,
    w: FRONT_BOX.w * canvas.width,
    h: FRONT_BOX.h * canvas.height,
  };
  context.save();
  const margin = Math.max(3, box.h * 0.04);
  context.beginPath();
  context.rect(box.x + margin, box.y + margin, box.w - margin * 2, box.h - margin * 2);
  context.clip();
  const inner = { w: box.w - margin * 2, h: box.h - margin * 2 };
  const nameBox = { w: inner.w, h: inner.h * 0.62 };
  const name = fitLines(context, drinkName, nameBox, '"Bebas Neue", sans-serif');
  context.fillStyle = INK;
  context.textBaseline = 'top';
  let y = box.y + margin;
  context.font = `${name.size}px "Bebas Neue", sans-serif`;
  for (const line of name.lines) {
    context.fillText(line, box.x + margin, y);
    y += name.size * 1.1;
  }
  const variantBox = { w: inner.w, h: Math.max(10, box.y + box.h - margin - y) };
  const variantFit = fitLines(context, variant, variantBox, '"EB Garamond", serif');
  context.font = `${variantFit.size}px "EB Garamond", serif`;
  for (const line of variantFit.lines) {
    context.fillText(line, box.x + margin, y);
    y += variantFit.size * 1.15;
  }
  context.restore();
  return canvas;
}

/** The declaration panel: the server's facts, with a grain strip clear of text. */
export function buildPanelTexture(format: PackFormat, copy: PanelCopy): HTMLCanvasElement {
  const canvas = faceCanvas(format, 420);
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = PAPER;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = CARMINE;
  context.fillRect(0, 0, canvas.width, Math.round(canvas.height * 0.08));

  const mrp = PANEL_GEOMETRY[format].mrp;
  const mrpBox = {
    x: mrp.x * canvas.width,
    y: mrp.y * canvas.height,
    w: mrp.w * canvas.width,
    h: mrp.h * canvas.height,
  };
  context.strokeStyle = INK;
  context.lineWidth = 2;
  context.strokeRect(mrpBox.x, mrpBox.y, mrpBox.w, mrpBox.h);
  context.save();
  context.beginPath();
  context.rect(mrpBox.x + 2, mrpBox.y + 2, mrpBox.w - 4, mrpBox.h - 4);
  context.clip();
  const mrpFit = fitLines(context, copy.mrpLine, { w: mrpBox.w - 10, h: mrpBox.h - 8 }, '"Bebas Neue", sans-serif');
  context.fillStyle = INK;
  context.textBaseline = 'top';
  context.font = `${mrpFit.size}px "Bebas Neue", sans-serif`;
  let mrpY = mrpBox.y + 5;
  for (const line of mrpFit.lines) {
    context.fillText(line, mrpBox.x + 5, mrpY);
    mrpY += mrpFit.size * 1.1;
  }
  context.restore();

  context.fillStyle = INK;
  context.textBaseline = 'top';
  const bodySize = Math.max(9, Math.round(canvas.height * 0.028));
  context.font = `${bodySize}px "EB Garamond", serif`;
  let y = canvas.height * 0.52;
  for (const line of copy.lines) {
    context.fillText(line, canvas.width * 0.08, y, canvas.width * 0.84);
    y += bodySize * 1.3;
  }

  seededNoise(context, {
    x: Math.round(GRAIN_STRIP.x * canvas.width),
    y: Math.round(GRAIN_STRIP.y * canvas.height),
    w: Math.round(GRAIN_STRIP.w * canvas.width),
    h: Math.round(GRAIN_STRIP.h * canvas.height),
  });
  return canvas;
}

/** The die-cut sticker: a flat accent face with its revised price as a minority of ink. */
export function buildStickerTexture(revisedLine: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 148;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = `rgb(${ACCENT.r},${ACCENT.g},${ACCENT.b})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = CARMINE;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  context.font = '34px "Bebas Neue", sans-serif';
  context.fillText(revisedLine, canvas.width / 2, canvas.height / 2, canvas.width * 0.86);
  return canvas;
}

export function sideTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = '#f4f4f4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = CARMINE;
  context.fillRect(0, 0, canvas.width, 10);
  return canvas;
}
