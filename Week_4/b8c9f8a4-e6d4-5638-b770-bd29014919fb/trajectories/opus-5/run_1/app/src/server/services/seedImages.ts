import sharp from 'sharp';
import { buildExifApp1, withApp1 } from './exif';

const WIDTH = 1_280;
const HEIGHT = 860;

/** A small deterministic generator, so every seeded image is the same on every start. */
const sequence = (seed: number): (() => number) => {
  let state = seed * 2_654_435_761 + 1;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const facetPath = (next: () => number): string => {
  const points: string[] = [];
  const count = 5;
  for (let i = 0; i <= count; i += 1) {
    const x = (WIDTH / count) * i;
    const y = HEIGHT * (0.26 + next() * 0.3);
    points.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  return `${points.join(' ')} ${WIDTH},${HEIGHT} 0,${HEIGHT}`;
};

/** A generated panel-detail image, drawn in light, with a plate area under the mask. */
const panelDetailSvg = (index: number, panelLabel: string): string => {
  const next = sequence(index + 7);
  const hue = 212 + Math.round(next() * 70);
  const facets = Array.from({ length: 7 }, () => {
    const x = next() * WIDTH;
    const y = HEIGHT * (0.1 + next() * 0.7);
    const w = 120 + next() * 320;
    const h = 60 + next() * 180;
    const opacity = (0.08 + next() * 0.22).toFixed(2);
    const skew = (next() * 30 - 15).toFixed(1);
    return `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="hsl(${hue} 70% 72%)" opacity="${opacity}" transform="rotate(${skew} ${(x + w / 2).toFixed(0)} ${(y + h / 2).toFixed(0)})"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="body" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="hsl(${hue} 55% 78%)"/>
        <stop offset="0.55" stop-color="hsl(${hue - 14} 45% 44%)"/>
        <stop offset="1" stop-color="hsl(${hue - 30} 48% 17%)"/>
      </linearGradient>
      <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.6">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
        <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.04"/>
        <stop offset="1" stop-color="#ff79d2" stop-opacity="0.18"/>
      </linearGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#body)"/>
    ${facets}
    <polygon points="${facetPath(next)}" fill="hsl(${hue - 24} 42% 26%)" opacity="0.72"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sheen)"/>
    <g transform="translate(${(WIDTH * 0.35).toFixed(0)} ${(HEIGHT * 0.7).toFixed(0)})">
      <rect width="${(WIDTH * 0.3).toFixed(0)}" height="${(HEIGHT * 0.12).toFixed(0)}" rx="8" fill="#f2f3d8" stroke="#1d1b33" stroke-width="4"/>
      <rect x="18" y="18" width="${(WIDTH * 0.3 - 36).toFixed(0)}" height="${(HEIGHT * 0.12 - 36).toFixed(0)}" fill="#1d1b33" opacity="0.16"/>
    </g>
    <text x="40" y="${(HEIGHT - 42).toFixed(0)}" font-family="sans-serif" font-size="34" fill="#ffffff" opacity="0.72">${panelLabel}</text>
  </svg>`;
};

const HEXHAM_GPS = {
  latitudeDegrees: [54, 58, 12.4] as const,
  latitudeRef: 'N' as const,
  longitudeDegrees: [2, 6, 18.9] as const,
  longitudeRef: 'W' as const,
};

/** A seeded original, carrying a GPS tag so the buyer copy has something to strip. */
export const seedPhotoBytes = async (index: number, panelLabel: string): Promise<Buffer> => {
  const jpeg = await sharp(Buffer.from(panelDetailSvg(index, panelLabel))).jpeg({ quality: 86 }).toBuffer();
  return withApp1(jpeg, buildExifApp1(HEXHAM_GPS));
};

const invoiceSvg = (): string => `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
  <rect width="1240" height="1754" fill="#ffffff"/>
  <rect x="0" y="0" width="1240" height="150" fill="#1b1a46"/>
  <text x="70" y="96" font-family="sans-serif" font-size="52" fill="#ffffff">Bodyshop invoice</text>
  <text x="70" y="250" font-family="sans-serif" font-size="34" fill="#231a4d">Offside front wing respray</text>
  <text x="70" y="310" font-family="sans-serif" font-size="28" fill="#4a4270">Carried out in 2019 after a car park scrape.</text>
  <line x1="70" y1="360" x2="1170" y2="360" stroke="#cfc7e4" stroke-width="3"/>
  <text x="70" y="430" font-family="sans-serif" font-size="28" fill="#231a4d">Panel preparation and blend</text>
  <text x="70" y="490" font-family="sans-serif" font-size="28" fill="#231a4d">Paint, lacquer and polish</text>
  <text x="70" y="560" font-family="sans-serif" font-size="28" fill="#231a4d">Refit of trim and badge</text>
  <line x1="70" y1="620" x2="1170" y2="620" stroke="#cfc7e4" stroke-width="3"/>
  <text x="70" y="690" font-family="sans-serif" font-size="32" fill="#1b1a46">Paid in full</text>
</svg>`;

export const seedInvoiceBytes = async (): Promise<Buffer> =>
  sharp(Buffer.from(invoiceSvg())).png({ compressionLevel: 9 }).toBuffer();
