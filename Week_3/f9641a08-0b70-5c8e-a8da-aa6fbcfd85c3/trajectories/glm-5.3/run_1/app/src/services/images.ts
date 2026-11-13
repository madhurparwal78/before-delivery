/**
 * Generated product imagery: drawn bag studies in the variant's colour on the
 * product page and in greyscale in the masthead. No photographs, no people.
 */

export type ViewName = 'Front' | 'Side' | 'Back' | 'Open';

export const VIEW_NAMES: ViewName[] = ['Front', 'Side', 'Back', 'Open'];

export const COLOUR_HEX: Record<string, string> = {
  'Graphite': '#3b3f42',
  'Sage': '#9caf88',
  'Signal Red': '#d8402f',
  'Silver': '#c9ccd1',
  'Navy': '#2b3a55',
  'Teal': '#0f6b63',
  'Yellow': '#e6b93f',
  'Blue': '#2f5bd8',
  'Sand': '#cbb392',
  'Tan': '#b98d5a',
  'Black': '#26282a',
  'Grey': '#7d8185',
};

export function colourHex(name: string): string {
  return COLOUR_HEX[name] ?? '#3b3f42';
}

/** Draws a flat vector study of the bag in the given colour. */
export function bagSvg(colour: string, view: ViewName, product: string, dims: { h: number; w: number; d: number }): string {
  const fill = colourHex(colour);
  const dark = shade(fill, -0.25);
  const light = shade(fill, 0.18);
  const stroke = '#1c1e20';
  const w = 600;
  const h = 600;
  const body = bodyFor(view, dims, fill, light, dark, stroke);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(product)} in ${esc(colour)}">
<rect width="${w}" height="${h}" fill="#212427"/>
${body}
</svg>`;
}

function bodyFor(view: ViewName, dims: { h: number; w: number; d: number }, fill: string, light: string, dark: string, stroke: string): string {
  if (view === 'Side') return shellSide(fill, light, dark, stroke, dims);
  if (view === 'Back') return shellBack(fill, light, dark, stroke, dims);
  if (view === 'Open') return shellOpen(fill, light, dark, stroke, dims);
  return shellFront(fill, light, dark, stroke, dims);
}

function shellFront(fill: string, light: string, dark: string, stroke: string, dims: { h: number; w: number; d: number }): string {
  return `
<g>
  <rect x="150" y="150" width="300" height="330" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="6"/>
  <rect x="150" y="150" width="300" height="90" fill="${light}" stroke="${stroke}" stroke-width="6"/>
  <rect x="255" y="120" width="90" height="40" rx="8" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
  <circle cx="255" cy="250" r="14" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
  <circle cx="345" cy="250" r="14" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
  <rect x="280" y="320" width="40" height="120" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
  <rect x="240" y="470" width="40" height="14" fill="${stroke}"/>
  <rect x="320" y="470" width="40" height="14" fill="${stroke}"/>
</g>`;
}

function shellSide(fill: string, light: string, dark: string, stroke: string, dims: { h: number; w: number; d: number }): string {
  const depth = Math.max(60, Math.min(240, dims.d * 6));
  return `
<g>
  <rect x="${300 - depth / 2}" y="170" width="${depth}" height="300" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="6"/>
  <rect x="${300 - depth / 2}" y="170" width="${depth}" height="70" fill="${light}" stroke="${stroke}" stroke-width="6"/>
  <rect x="270" y="130" width="60" height="50" rx="8" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
  <circle cx="${300 - depth / 2 + 20}" cy="470" r="16" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
  <circle cx="${300 + depth / 2 - 20}" cy="470" r="16" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
</g>`;
}

function shellBack(fill: string, light: string, dark: string, stroke: string, dims: { h: number; w: number; d: number }): string {
  return `
<g>
  <rect x="150" y="150" width="300" height="330" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="6"/>
  <rect x="255" y="110" width="90" height="52" rx="10" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
  <rect x="285" y="100" width="30" height="18" fill="${stroke}"/>
  <rect x="160" y="330" width="280" height="130" fill="${light}" stroke="${stroke}" stroke-width="6" opacity="0.6"/>
  <rect x="240" y="470" width="40" height="14" fill="${stroke}"/>
  <rect x="320" y="470" width="40" height="14" fill="${stroke}"/>
</g>`;
}

function shellOpen(fill: string, light: string, dark: string, stroke: string, dims: { h: number; w: number; d: number }): string {
  return `
<g>
  <rect x="150" y="200" width="300" height="280" rx="14" fill="${dark}" stroke="${stroke}" stroke-width="6"/>
  <rect x="150" y="120" width="300" height="80" rx="10" fill="${light}" stroke="${stroke}" stroke-width="6" transform="rotate(-6 300 160)"/>
  <rect x="190" y="240" width="220" height="90" fill="${light}" stroke="${stroke}" stroke-width="6"/>
  <rect x="190" y="350" width="220" height="90" fill="${fill}" stroke="${stroke}" stroke-width="6"/>
  <rect x="240" y="470" width="40" height="14" fill="${stroke}"/>
  <rect x="320" y="470" width="40" height="14" fill="${stroke}"/>
</g>`;
}

/** Greyscale study for the masthead mosaic. */
export function greyStudy(index: number): string {
  const tone = ['#5a5f63', '#6b7074', '#7d8286', '#8d9296'][index % 4];
  const stroke = '#1c1e20';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
<rect width="600" height="400" fill="#212427"/>
<rect x="160" y="90" width="280" height="230" rx="16" fill="${tone}" stroke="${stroke}" stroke-width="6"/>
<rect x="160" y="90" width="280" height="60" fill="${shade(tone, 0.15)}" stroke="${stroke}" stroke-width="6"/>
<rect x="250" y="60" width="100" height="38" rx="8" fill="${shade(tone, -0.25)}" stroke="${stroke}" stroke-width="6"/>
<rect x="240" y="320" width="40" height="12" fill="${stroke}"/>
<rect x="320" y="320" width="40" height="12" fill="${stroke}"/>
</svg>`;
}

/** Flat masthead tile. */
export function tileSvg(colour: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect width="600" height="400" fill="${colour}"/></svg>`;
}

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = clamp256(((n >> 16) & 0xff) + amount * 255);
  const g = clamp256(((n >> 8) & 0xff) + amount * 255);
  const b = clamp256((n & 0xff) + amount * 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function clamp256(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
