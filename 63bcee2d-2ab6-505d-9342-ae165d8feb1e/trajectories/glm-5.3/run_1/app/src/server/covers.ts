// Procedural SVG covers for case studies.

import { PNG } from 'pngjs';

function hueOf(slug: string): number {
  let hash = 0;
  for (const char of slug) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

export function coverSvg(slug: string): string {
  const hue = hueOf(slug);
  const dark = `hsl(${hue}, 22%, 14%)`;
  const mid = `hsl(${hue}, 26%, 30%)`;
  const light = `hsl(${hue}, 30%, 48%)`;
  const ink = '#1b1b18';
  const lines: string[] = [];
  // Drafted elevation: horizon line, storefront rhythm, sun.
  lines.push(`<rect x="0" y="0" width="1200" height="640" fill="${dark}"/>`);
  lines.push(`<rect x="0" y="380" width="1200" height="260" fill="${mid}"/>`);
  for (let i = 0; i < 7; i++) {
    const x = 120 + i * 150;
    lines.push(`<rect x="${x}" y="300" width="96" height="220" fill="${light}" stroke="${ink}" stroke-width="2"/>`);
    lines.push(`<line x1="${x}" y1="300" x2="${x}" y2="520" stroke="${ink}" stroke-width="2"/>`);
  }
  lines.push(`<circle cx="960" cy="140" r="64" fill="none" stroke="${light}" stroke-width="3"/>`);
  lines.push(`<line x1="0" y1="520" x2="1200" y2="520" stroke="${ink}" stroke-width="3"/>`);
  lines.push(`<line x1="0" y1="560" x2="1200" y2="560" stroke="${ink}" stroke-width="1.5"/>`);
  const title = slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  lines.push(`<text x="60" y="600" font-family="serif" font-size="28" fill="#f3ede2">${escapeXml(title)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640">${lines.join('')}</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Procedural render for the seeded viewpoint: a line-drawn entrance elevation. */
export function viewpointRenderPng(): Buffer {
  const width = 1600;
  const height = 1000;
  const png = new PNG({ width, height });
  // Plaster background.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) << 2;
      const tone = 238 - ((x + y) % 7);
      png.data[index] = tone;
      png.data[index + 1] = tone - 6;
      png.data[index + 2] = tone - 22;
      png.data[index + 3] = 255;
    }
  }
  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x1 + ((x2 - x1) * i) / steps);
      const y = Math.round(y1 + ((y2 - y1) * i) / steps);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = (width * y + x) << 2;
      png.data[index] = 40;
      png.data[index + 1] = 40;
      png.data[index + 2] = 38;
    }
  };
  const drawRect = (x: number, y: number, w: number, h: number) => {
    drawLine(x, y, x + w, y);
    drawLine(x + w, y, x + w, y + h);
    drawLine(x + w, y + h, x, y + h);
    drawLine(x, y + h, x, y);
  };
  // Ground line, storefront, mullions, door, signage band.
  drawLine(80, 860, 1520, 860);
  drawRect(240, 320, 1120, 540);
  for (let i = 1; i < 7; i++) {
    drawLine(240 + (i * 1120) / 7, 320, 240 + (i * 1120) / 7, 860);
  }
  drawRect(700, 520, 200, 340); // door
  drawLine(240, 380, 1360, 380); // transom
  drawRect(520, 200, 560, 120); // signage
  drawLine(80, 940, 1520, 940); // paving joint
  return PNG.sync.write(png);
}

/** Procedural site photo for the seeded viewpoint: the same view as built. */
export function viewpointPhotoPng(): Buffer {
  const width = 1600;
  const height = 1000;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) << 2;
      const wall = 226 - ((x * 3 + y * 2) % 11);
      const floor = y > 860 ? 178 - ((x + y) % 9) : wall;
      png.data[index] = floor;
      png.data[index + 1] = floor - 4;
      png.data[index + 2] = floor - 14;
      png.data[index + 3] = 255;
    }
  }
  const fill = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const index = (width * yy + xx) << 2;
        png.data[index] = r;
        png.data[index + 1] = g;
        png.data[index + 2] = b;
      }
    }
  };
  // Slightly skewed storefront, protection sheet, tool case — the site today.
  fill(236, 330, 1090, 520, 168, 176, 186);
  fill(236, 380, 1090, 12, 60, 64, 68);
  fill(700, 540, 190, 300, 92, 96, 100);
  fill(520, 210, 540, 100, 120, 126, 132);
  fill(80, 862, 1440, 6, 120, 124, 128);
  fill(1380, 600, 120, 90, 140, 96, 60); // tool case
  return PNG.sync.write(png);
}

/** A minimal valid PDF sheet for the seeded drawing register. */
export function seedPdf(title: string, subtitle: string): Buffer {
  const content = `BT /F1 18 Tf 60 760 Td (${title.replace(/[()\\]/g, '')}) Tj ET\nBT /F1 12 Tf 60 730 Td (${subtitle.replace(/[()\\]/g, '')}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startxref = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += offset.toString().padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** The seeded shopfront elevation SVG (script-free). */
export function seedSheetSvg(): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="842" height="595" viewBox="0 0 842 595">
  <rect width="842" height="595" fill="#f3ede2"/>
  <g stroke="#1b1b18" fill="none" stroke-width="2">
    <rect x="80" y="120" width="682" height="360"/>
    <line x1="80" y1="170" x2="762" y2="170"/>
    <line x1="251" y1="120" x2="251" y2="480"/>
    <line x1="422" y1="120" x2="422" y2="480"/>
    <line x1="593" y1="120" x2="593" y2="480"/>
    <rect x="356" y="300" width="130" height="180"/>
    <line x1="80" y1="480" x2="762" y2="480"/>
    <line x1="40" y1="500" x2="802" y2="500"/>
  </g>
  <text x="90" y="110" font-family="serif" font-size="20" fill="#1b1b18">Shopfront elevation</text>
</svg>`;
  return Buffer.from(svg, 'utf8');
}
