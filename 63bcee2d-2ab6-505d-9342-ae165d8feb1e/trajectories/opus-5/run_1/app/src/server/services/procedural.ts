/** Procedural test renders, sheet files and case-study covers. */

import jpeg from 'jpeg-js';

interface Canvas {
  data: Buffer;
  width: number;
  height: number;
}

type Rgb = readonly [number, number, number];

function canvas(width: number, height: number, background: Rgb): Canvas {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = background[0];
    data[index * 4 + 1] = background[1];
    data[index * 4 + 2] = background[2];
    data[index * 4 + 3] = 255;
  }
  return { data, width, height };
}

function plot(target: Canvas, x: number, y: number, colour: Rgb): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const offset = (Math.floor(y) * target.width + Math.floor(x)) * 4;
  target.data[offset] = colour[0];
  target.data[offset + 1] = colour[1];
  target.data[offset + 2] = colour[2];
  target.data[offset + 3] = 255;
}

function strokeLine(
  target: Canvas,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  colour: Rgb,
  weight = 2,
): void {
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = fromX + ((toX - fromX) * step) / steps;
    const y = fromY + ((toY - fromY) * step) / steps;
    for (let offsetX = 0; offsetX < weight; offsetX += 1) {
      for (let offsetY = 0; offsetY < weight; offsetY += 1) {
        plot(target, x + offsetX, y + offsetY, colour);
      }
    }
  }
}

function strokeRect(
  target: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: Rgb,
  weight = 2,
): void {
  strokeLine(target, x, y, x + width, y, colour, weight);
  strokeLine(target, x + width, y, x + width, y + height, colour, weight);
  strokeLine(target, x + width, y + height, x, y + height, colour, weight);
  strokeLine(target, x, y + height, x, y, colour, weight);
}

function fillRect(
  target: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: Rgb,
): void {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      plot(target, x + column, y + row, colour);
    }
  }
}

/** A repeatable pseudo-random sequence, so every run draws the same picture. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const INK: Rgb = [26, 27, 24];
const PLASTER: Rgb = [237, 230, 218];
const SAGE: Rgb = [122, 138, 116];

/** A line-drawn shopfront elevation, as the designer's intended render. */
export function renderImageBytes(width: number, height: number): Buffer {
  const target = canvas(width, height, [250, 247, 240]);
  const next = sequence(20_260_101);

  for (let x = 0; x < width; x += 80) {
    strokeLine(target, x, 0, x, height, [226, 220, 208], 1);
  }
  for (let y = 0; y < height; y += 80) {
    strokeLine(target, 0, y, width, y, [226, 220, 208], 1);
  }

  const floor = Math.round(height * 0.86);
  strokeLine(target, 0, floor, width, floor, INK, 3);

  const shopLeft = Math.round(width * 0.08);
  const shopRight = Math.round(width * 0.92);
  const soffit = Math.round(height * 0.14);
  strokeRect(target, shopLeft, soffit, shopRight - shopLeft, floor - soffit, INK, 3);

  const bays = 4;
  const bayWidth = (shopRight - shopLeft) / bays;
  for (let bay = 1; bay < bays; bay += 1) {
    const x = shopLeft + bayWidth * bay;
    strokeLine(target, x, soffit, x, floor, INK, 2);
  }

  const transom = Math.round(soffit + (floor - soffit) * 0.22);
  strokeLine(target, shopLeft, transom, shopRight, transom, INK, 2);

  const doorLeft = Math.round(shopLeft + bayWidth * 1.3);
  const doorWidth = Math.round(bayWidth * 0.7);
  strokeRect(target, doorLeft, transom, doorWidth, floor - transom, INK, 2);
  strokeLine(target, doorLeft + doorWidth / 2, transom, doorLeft + doorWidth / 2, floor, INK, 2);

  const counterTop = Math.round(floor - (floor - soffit) * 0.28);
  const counterLeft = Math.round(shopLeft + bayWidth * 2.4);
  fillRect(target, counterLeft, counterTop, Math.round(bayWidth * 1.3), 8, SAGE);
  strokeRect(target, counterLeft, counterTop, Math.round(bayWidth * 1.3), floor - counterTop, INK, 2);

  for (let lamp = 0; lamp < 6; lamp += 1) {
    const x = shopLeft + bayWidth * 0.3 + lamp * ((shopRight - shopLeft) / 6);
    strokeLine(target, x, soffit, x, soffit + 60, INK, 2);
    fillRect(target, x - 14, soffit + 60, 30, 10, INK);
  }

  for (let mark = 0; mark < 400; mark += 1) {
    const x = next() * width;
    const y = floor + next() * (height - floor);
    strokeLine(target, x, y, x + 18, y, [214, 207, 194], 1);
  }

  return Buffer.from(jpeg.encode({ data: target.data, width, height }, 88).data);
}

/** The same viewpoint photographed on site: warmer, grainier, slightly out. */
export function sitePhotoBytes(width: number, height: number): Buffer {
  const target = canvas(width, height, [214, 203, 186]);
  const next = sequence(20_261_020);

  const floor = Math.round(height * 0.865);
  fillRect(target, 0, floor, width, height - floor, [168, 156, 140]);
  strokeLine(target, 0, floor, width, floor, [92, 86, 76], 3);

  const shopLeft = Math.round(width * 0.085);
  const shopRight = Math.round(width * 0.918);
  const soffit = Math.round(height * 0.145);
  fillRect(target, shopLeft, soffit, shopRight - shopLeft, floor - soffit, [196, 188, 172]);
  strokeRect(target, shopLeft, soffit, shopRight - shopLeft, floor - soffit, [84, 79, 70], 4);

  const bays = 4;
  const bayWidth = (shopRight - shopLeft) / bays;
  for (let bay = 1; bay < bays; bay += 1) {
    const lean = bay === 1 ? 9 : 0;
    const x = shopLeft + bayWidth * bay;
    strokeLine(target, x + lean, soffit, x, floor, [84, 79, 70], 3);
  }

  const transom = Math.round(soffit + (floor - soffit) * 0.23);
  strokeLine(target, shopLeft, transom, shopRight, transom, [84, 79, 70], 3);

  const counterTop = Math.round(floor - (floor - soffit) * 0.28);
  const counterLeft = Math.round(shopLeft + bayWidth * 2.4);
  fillRect(target, counterLeft, counterTop, Math.round(bayWidth * 1.3), floor - counterTop, [
    150, 140, 124,
  ]);
  fillRect(target, counterLeft, counterTop, Math.round(bayWidth * 1.3), 10, [120, 134, 114]);
  strokeLine(
    target,
    counterLeft + bayWidth * 0.9,
    counterTop,
    counterLeft + bayWidth * 1.3,
    counterTop - 12,
    [96, 90, 80],
    4,
  );

  for (let grain = 0; grain < width * height * 0.12; grain += 1) {
    const x = Math.floor(next() * width);
    const y = Math.floor(next() * height);
    const offset = (y * width + x) * 4;
    const shift = Math.round((next() - 0.5) * 26);
    for (let channel = 0; channel < 3; channel += 1) {
      const at = offset + channel;
      target.data[at] = Math.max(0, Math.min(255, (target.data[at] ?? 0) + shift));
    }
  }

  return Buffer.from(jpeg.encode({ data: target.data, width, height }, 86).data);
}

function pdfEscape(value: string): string {
  return value.replace(/([()\\])/g, '\\$1');
}

/** A small, valid PDF drawing sheet. */
export function sheetPdfBytes(sheetCode: string, title: string, revision: string): Buffer {
  const content = [
    '0.1 0.105 0.094 RG 2 w',
    '40 40 762 515 re S',
    '40 40 762 70 re S',
    '560 40 m 560 110 l S',
    'BT /F1 22 Tf 60 420 Td (' + pdfEscape(title) + ') Tj ET',
    'BT /F1 13 Tf 60 70 Td (' + pdfEscape(`${sheetCode}  REV ${revision}`) + ') Tj ET',
    'BT /F1 11 Tf 580 70 Td (MARROW HALL INTERIORS) Tj ET',
    '120 180 m 720 180 l S',
    '120 180 m 120 380 l S',
    '720 180 m 720 380 l S',
    '120 380 m 720 380 l S',
    '270 180 m 270 380 l S',
    '420 180 m 420 380 l S',
    '570 180 m 570 380 l S',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A script-free SVG drawing sheet. */
export function sheetSvgBytes(sheetCode: string, title: string, revision: string): Buffer {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 842 595" width="842" height="595" role="img" aria-label="${title}">
  <rect width="842" height="595" fill="#f4efe6"/>
  <g fill="none" stroke="#1a1b18" stroke-width="2">
    <rect x="40" y="40" width="762" height="515"/>
    <rect x="40" y="485" width="762" height="70"/>
    <path d="M560 485 V555"/>
    <path d="M120 180 H720 M120 180 V380 M720 180 V380 M120 380 H720"/>
    <path d="M270 180 V380 M420 180 V380 M570 180 V380"/>
  </g>
  <text x="60" y="140" font-family="Helvetica, sans-serif" font-size="26" fill="#1a1b18">${title}</text>
  <text x="60" y="528" font-family="Helvetica, sans-serif" font-size="14" fill="#1a1b18">${sheetCode} REV ${revision}</text>
  <text x="580" y="528" font-family="Helvetica, sans-serif" font-size="12" fill="#1a1b18">MARROW HALL INTERIORS</text>
</svg>
`;
  return Buffer.from(svg, 'utf8');
}

const COVER_INK = '#14170f';
const COVER_PLASTER = '#ece4d6';
const COVER_OXIDE = '#9c3b22';

/** The procedural cover drawn for a case study, served from /media/covers. */
export function coverSvg(slug: string, title: string): string {
  const next = sequence(
    [...slug].reduce((total, character) => total + character.charCodeAt(0) * 31, 7),
  );
  const bars = Array.from({ length: 9 }, (_unused, index) => {
    const x = 60 + index * 140;
    const height = 120 + Math.round(next() * 480);
    return `<rect x="${x}" y="${720 - height}" width="92" height="${height}" fill="${
      index % 3 === 0 ? COVER_OXIDE : COVER_INK
    }" opacity="${index % 2 === 0 ? '0.92' : '0.6'}"/>`;
  }).join('');
  const rules = Array.from({ length: 6 }, (_unused, index) => {
    const y = 120 + index * 100;
    return `<path d="M0 ${y} H1400" stroke="${COVER_INK}" stroke-width="1" opacity="0.18"/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 720" width="1400" height="720" role="img" aria-label="${escapeXml(
    title,
  )}">
  <rect width="1400" height="720" fill="${COVER_PLASTER}"/>
  ${rules}
  ${bars}
  <path d="M0 719 H1400" stroke="${COVER_INK}" stroke-width="2"/>
</svg>
`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { PLASTER, INK };
