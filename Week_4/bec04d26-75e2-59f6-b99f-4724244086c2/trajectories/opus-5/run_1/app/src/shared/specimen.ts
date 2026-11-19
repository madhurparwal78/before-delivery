export type TileColour = 'orange' | 'sage' | 'yellow' | 'black';

/**
 * The steady per-state rotation: four flat colours taken in order by the
 * state's position in the practice's states sorted by code, so one state
 * always has one colour.
 */
export const TILE_ROTATION: readonly TileColour[] = ['orange', 'sage', 'yellow', 'black'];

export function tileColour(stateIndex: number): TileColour {
  const length = TILE_ROTATION.length;
  return TILE_ROTATION[((stateIndex % length) + length) % length];
}

export const TILE_INK: Record<TileColour, string> = {
  orange: '#1b1b1b',
  sage: '#1b1b1b',
  yellow: '#1b1b1b',
  black: '#f4f3ee',
};

export const TILE_FILL: Record<TileColour, string> = {
  orange: '#f0661f',
  sage: '#9bb295',
  yellow: '#e9f24a',
  black: '#111111',
};

/**
 * The folded return specimen: a sheet with one folded corner, stamped with the
 * state's two-letter code and the period, drawn in lines on the tile colour.
 */
export function foldedReturnSvg(
  stateCode: string,
  periodStamp: string,
  colour: TileColour,
): string {
  const ink = TILE_INK[colour];
  const sheet = colour === 'black' ? '#1d1d1d' : 'rgba(255,255,255,0.58)';
  return `<svg class="specimen-sheet" viewBox="0 0 200 250" role="img" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
  <path d="M24 16 H140 L176 52 V234 H24 Z" fill="${sheet}" stroke="${ink}" stroke-width="4" stroke-linejoin="miter"/>
  <path d="M140 16 V52 H176" fill="none" stroke="${ink}" stroke-width="4" stroke-linejoin="miter"/>
  <path d="M140 16 L176 52" fill="none" stroke="${ink}" stroke-width="2"/>
  <line x1="44" y1="88" x2="156" y2="88" stroke="${ink}" stroke-width="3"/>
  <line x1="44" y1="106" x2="156" y2="106" stroke="${ink}" stroke-width="3"/>
  <line x1="44" y1="124" x2="118" y2="124" stroke="${ink}" stroke-width="3"/>
  <rect x="44" y="150" width="112" height="68" fill="none" stroke="${ink}" stroke-width="3"/>
  <text x="100" y="185" fill="${ink}" font-family="'Tilt Warp','Plus Jakarta Sans',sans-serif" font-size="28" text-anchor="middle">${escapeSvg(stateCode)}</text>
  <text x="100" y="208" fill="${ink}" font-family="'Plus Jakarta Sans',sans-serif" font-size="14" text-anchor="middle">${escapeSvg(periodStamp)}</text>
</svg>`;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
