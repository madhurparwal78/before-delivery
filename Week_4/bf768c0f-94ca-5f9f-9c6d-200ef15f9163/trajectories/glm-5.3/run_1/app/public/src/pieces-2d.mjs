// The four flat piece sets: Classic, Staunton Flat, Neo, Pixel.
// Every piece keeps one accessible name; the drawing changes, the name does not.
// Pieces are drawn on a 45x45 grid, standard for chess diagrams.

const W = { fill: '#f4efe8', stroke: '#241e18' };
const B = { fill: '#2a2622', stroke: '#f4efe8' };

// Classic: traditional solid silhouettes with outlines
const CLASSIC = {
  p: (c) => `<circle cx="22.5" cy="15" r="5.2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/><path d="M17 38h11l-1.5-8c4-2 4-8-2-10.5-4 1-6 4-6 6.5 0 2 1 3 2 4L17 38z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/>`,
  n: (c) => `<path d="M14 38h17c0-8-2-11-7-14l-2 3 2.5-6c-4-3-9-3.5-9-8l-2 4-4 2 6 4-4 3z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/><circle cx="11.5" cy="13" r="1.3" fill="${c.stroke}"/>`,
  b: (c) => `<circle cx="22.5" cy="10" r="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/><path d="M17 36c6-14 10-14 10-22 0-4-2-6-5-6s-5 2-5 6c0 4 1 6 2 8-2 2-3 8-2 14z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/><path d="M19 30h7M17 34h11" stroke="${c.stroke}" stroke-width="1.2" fill="none"/>`,
  r: (c) => `<path d="M15 12v-6h3v3h2v-3h5v3h2v-3h3v6l-2 2v14l2 2v4h-15v-4l2-2v-14z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/><path d="M17 16h11M17 28h11" stroke="${c.stroke}" stroke-width="1.1" fill="none"/>`,
  q: (c) => `<path d="M10 16l-1.5 18h28L35 16l-4 7-3-10-3.5 10-2-13-2 13L21 13l-3 10z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/><circle cx="10" cy="14" r="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1"/><circle cx="17" cy="11" r="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1"/><circle cx="22.5" cy="9.5" r="2.2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1"/><circle cx="28" cy="11" r="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1"/><circle cx="35" cy="14" r="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1"/><path d="M12 30h21" stroke="${c.stroke}" stroke-width="1.1" fill="none"/>`,
  k: (c) => `<path d="M22.5 8v4M20.5 10h4" stroke="${c.stroke}" stroke-width="1.8"/><path d="M15 36c2-12 5-13 5-18 0-3-1.5-4-1.5-5 0-1.5 2-2.5 4-2.5s4 1 4 2.5c0 1-1.5 2-1.5 5 0 5 3 6 5 18z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/><path d="M16 30h13M17 34h11" stroke="${c.stroke}" stroke-width="1.2" fill="none"/>`,
};

// Staunton Flat: profile silhouettes in the Staunton pattern, flatter shading
const STAUNTON = {
  p: (c) => `<path d="M22.5 13a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM17 37h11c0-4-1-6-2-7h-7c-1 1-2 3-2 7z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/>`,
  n: (c) => `<path d="M16 37c-1-8 1-13 5-16l-3 6 5-8c-3-2-4-4-4-6l3 2 4 1c3 3 5 8 5 12v9z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/><circle cx="20" cy="13" r="1.2" fill="${c.stroke}"/>`,
  b: (c) => `<path d="M22.5 11c-3 0-5 2-5 5 0 2 1 3 2 4-3 4-5 9-5 13h16c0-4-2-9-5-13 1-1 2-2 2-4 0-3-2-5-5-5z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/><path d="M22.5 7v3" stroke="${c.stroke}" stroke-width="1.6"/><path d="M18 28h9" stroke="${c.stroke}" stroke-width="1.1"/>`,
  r: (c) => `<path d="M16 11h3v3h2.5v-3h2v3h2.5v-3h3v5l-1.5 2v13l1.5 2v3H16v-3l1.5-2V18z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/>`,
  q: (c) => `<path d="M11 16l3 18h17l3-18-5 8-3.5-11-3 11-2-14-2 14-3-11z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/><path d="M10.5 13l.5 3M34.5 13l-.5 3" stroke="${c.stroke}" stroke-width="1.6"/><path d="M13.5 29h14" stroke="${c.stroke}" stroke-width="1"/>`,
  k: (c) => `<path d="M21.6 7h1.8v2h2v1.8h-2v2h-1.8v-2h-2V9h2z" fill="${c.stroke}"/><path d="M22.5 13.5c-4 0-5.5 3-5.5 6 0 3 2 4 2 7-2 3-3 6-3 10.5h13c0-4.5-1-7.5-3-10.5 0-3 2-4 2-7 0-3-1.5-6-5.5-6z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/>`,
};

// Neo: geometric, bold, minimal
const NEO = {
  p: (c) => `<circle cx="22.5" cy="16" r="5" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/><path d="M16 37h13l-2.5-13h-8z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>`,
  n: (c) => `<path d="M13 37V24l9-9 6-3 1 5-4 4 6 3v13z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/><path d="M19 20l4-4" stroke="${c.stroke}" stroke-width="1.6"/>`,
  b: (c) => `<path d="M22.5 9l7 24h-14z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/><circle cx="22.5" cy="12" r="3" fill="${c.stroke}"/>`,
  r: (c) => `<path d="M15 10h4v3h7v-3h4v27H15z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/><path d="M15 18h15M15 30h15" stroke="${c.stroke}" stroke-width="1.4"/>`,
  q: (c) => `<path d="M12 38l3-22 7 9 1-14 1 14 7-9 3 22z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>`,
  k: (c) => `<path d="M20 6h5v3h3v5h-3v3h-5v-3h-3V9h3z" fill="${c.stroke}"/><path d="M14 38l2-18h13l2 18z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/><path d="M16.5 24h12" stroke="${c.stroke}" stroke-width="1.4"/>`,
};

// Pixel: chunky blocky pieces on an 8x8 pixel grid
function px(blocks, c) {
  const cell = 4.4;
  return blocks.map(([x, y, w, h], i) => `<rect x="${4 + x * cell}" y="${4 + y * cell}" width="${w * cell}" height="${h * cell}" fill="${i === 0 ? c.stroke : c.fill}"/>`).join('');
}
const PIXEL = {
  p: (c) => px([[2, 6, 4, 2], [4, 2, 2, 2], [3, 4, 4, 2], [2, 8, 4, 1]], c),
  n: (c) => px([[2, 6, 4, 2], [1, 8, 4, 1], [3, 3, 2, 1], [4, 4, 2, 2], [3, 5, 4, 1], [2, 8, 4, 1]], c),
  b: (c) => px([[2, 6, 4, 2], [3, 1, 2, 1], [4, 2, 2, 1], [3, 3, 3, 1], [2, 4, 5, 2], [2, 8, 4, 1]], c),
  r: (c) => px([[1, 1, 2, 1], [3, 1, 2, 1], [5, 1, 2, 1], [2, 2, 4, 2], [3, 4, 2, 3], [2, 7, 4, 1], [2, 8, 4, 1]], c),
  q: (c) => px([[1, 1, 1, 1], [3, 1, 2, 1], [6, 1, 1, 1], [2, 2, 4, 1], [2, 3, 1, 2], [5, 3, 1, 2], [2, 5, 4, 1], [2, 7, 4, 1], [2, 8, 4, 1]], c),
  k: (c) => px([[3, 0, 2, 1], [3, 1, 2, 1], [2, 2, 4, 1], [2, 3, 4, 1], [3, 4, 2, 2], [2, 6, 4, 1], [2, 7, 4, 1], [2, 8, 4, 1]], c),
};

const SETS = { 'Classic': CLASSIC, 'Staunton Flat': STAUNTON, 'Neo': NEO, 'Pixel': PIXEL };

export function pieceSvg(pieceCode, setName) {
  const set = SETS[setName] || CLASSIC;
  const colour = pieceCode[0] === 'w' ? W : B;
  const type = pieceCode[1];
  const body = (set[type] || set.p)(colour);
  return `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const PIECE_NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
