import sharp from 'sharp';

// Garment and object illustrations are drawn by the app's own code from simple
// shapes in the swatch colours. No photographs are shipped.
export const SWATCHES: Record<string, string> = {
  stone: '#efe9e1',
  ink: '#1c1a17',
  vermilion: '#b3372b',
  night: '#131722',
  moss: '#4d5233',
  sand: '#d8c39a',
  rust: '#a45c33',
  fog: '#cfd2cd'
};

// A simple shape drawing per seed look: coat, knit, trouser, shirt, cup, and so on.
export async function drawLook(shape: number, palette: string[]): Promise<Buffer> {
  const [a, b, c] = palette.map(p => SWATCHES[p] ?? SWATCHES.stone);
  const w = 800; const h = 1000;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${SWATCHES.stone}"/>`);
  parts.push(`<rect x="60" y="60" width="${w - 120}" height="${h - 120}" fill="none" stroke="${SWATCHES.fog}" stroke-width="3"/>`);
  switch (shape % 7) {
    case 1: parts.push(...coat(a, b, c, w, h)); break;
    case 2: parts.push(...knit(a, b, c, w, h)); break;
    case 3: parts.push(...trousers(a, b, c, w, h)); break;
    case 4: parts.push(...shirt(a, b, c, w, h)); break;
    case 5: parts.push(...table(a, b, c, w, h)); break;
    case 6: parts.push(...cardigan(a, b, c, w, h)); break;
    default: parts.push(...cup(a, b, c, w, h)); break;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function coat(a: string, _b: string, c: string, w: number, h: number): string[] {
  const cx = w / 2;
  return [
    `<path d="M ${cx - 140} 220 L ${cx - 200} 900 L ${cx + 200} 900 L ${cx + 140} 220 Z" fill="${a}"/>`,
    `<rect x="${cx - 30}" y="260" width="60" height="560" fill="${c}"/>`,
    `<rect x="${cx - 150}" y="250" width="70" height="420" fill="${c}" opacity="0.55"/>`,
    `<rect x="${cx + 80}" y="250" width="70" height="420" fill="${c}" opacity="0.55"/>`,
    `<circle cx="${cx}" cy="180" r="70" fill="${c}"/>`
  ];
}

function knit(a: string, b: string, c: string, w: number, h: number): string[] {
  const cx = w / 2;
  const rows: string[] = [];
  for (let i = 0; i < 10; i++) {
    rows.push(`<line x1="${cx - 120}" y1="${260 + i * 55}" x2="${cx + 120}" y2="${260 + i * 55}" stroke="${c}" stroke-width="4" opacity="0.5"/>`);
  }
  return [
    `<path d="M ${cx - 120} 260 L ${cx - 170} 880 L ${cx + 170} 880 L ${cx + 120} 260 Z" fill="${a}"/>`,
    ...rows,
    `<rect x="${cx - 130}" y="230" width="260" height="40" rx="18" fill="${b}"/>`
  ];
}

function trousers(a: string, b: string, c: string, w: number, h: number): string[] {
  const cx = w / 2;
  return [
    `<path d="M ${cx - 90} 240 L ${cx - 100} 860 L ${cx - 25} 860 L ${cx} 420 L ${cx + 25} 860 L ${cx + 100} 860 L ${cx + 90} 240 Z" fill="${a}"/>`,
    `<rect x="${cx - 100}" y="220" width="200" height="60" rx="12" fill="${b}"/>`,
    `<line x1="${cx}" y1="430" x2="${cx}" y2="470" stroke="${c}" stroke-width="6"/>`
  ];
}

function shirt(a: string, b: string, c: string, w: number, h: number): string[] {
  const cx = w / 2;
  return [
    `<path d="M ${cx - 130} 250 L ${cx - 180} 840 L ${cx + 180} 840 L ${cx + 130} 250 Z" fill="${a}"/>`,
    `<path d="M ${cx - 130} 250 L ${cx} 380 L ${cx + 130} 250" fill="none" stroke="${b}" stroke-width="10"/>`,
    `<circle cx="${cx}" cy="180" r="60" fill="${c}"/>`
  ];
}

function table(a: string, b: string, c: string, w: number, h: number): string[] {
  const cx = w / 2;
  return [
    `<rect x="${cx - 220}" y="560" width="440" height="26" rx="8" fill="${b}"/>`,
    `<rect x="${cx - 180}" y="586" width="24" height="300" fill="${c}"/>`,
    `<rect x="${cx + 156}" y="586" width="24" height="300" fill="${c}"/>`,
    `<path d="M ${cx - 80} 430 L ${cx + 80} 430 L ${cx + 110} 560 L ${cx - 110} 560 Z" fill="${a}"/>`,
    `<rect x="${cx - 30}" y="360" width="60" height="70" fill="${c}"/>`
  ];
}

function cardigan(a: string, b: string, c: string, w: number, h: number): string[] {
  const cx = w / 2;
  return [
    `<path d="M ${cx - 150} 240 L ${cx - 40} 300 L ${cx - 60} 880 L ${cx + 60} 880 L ${cx + 40} 300 L ${cx + 150} 240 Z" fill="${a}"/>`,
    `<path d="M ${cx - 40} 300 L ${cx - 55} 870" stroke="${b}" stroke-width="14" fill="none"/>`,
    `<path d="M ${cx + 40} 300 L ${cx + 55} 870" stroke="${b}" stroke-width="14" fill="none"/>`,
    `<circle cx="${cx}" cy="170" r="66" fill="${c}"/>`
  ];
}

function cup(a: string, b: string, c: string, w: number, h: number): string[] {
  void h;
  const cx = w / 2;
  return [
    `<path d="M ${cx - 110} 420 L ${cx - 90} 720 L ${cx + 90} 720 L ${cx + 110} 420 Z" fill="${a}"/>`,
    `<ellipse cx="${cx}" cy="420" rx="110" ry="28" fill="${b}"/>`,
    `<path d="M ${cx + 110} 480 L ${cx + 190} 480 L ${cx + 190} 590 L ${cx + 115} 590" fill="none" stroke="${c}" stroke-width="18"/>`,
    `<line x1="${cx - 150}" y1="730" x2="${cx + 150}" y2="730" stroke="${c}" stroke-width="14"/>`
  ];
}
