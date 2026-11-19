/**
 * The four flat piece sets, drawn in the page.  One module shared by the
 * server-rendered board and the browser, so a piece looks the same in the
 * first response as it does after a move.
 *
 * Every set draws all six types with its own silhouette, and a piece carries
 * the same accessible name in every set: the name lives on the square, not on
 * the drawing, so these drawings are hidden from assistive technology.
 */

export const PIECE_WORDS = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
export const FLAT_SETS = ['Classic', 'Staunton Flat', 'Neo', 'Pixel'];
export const DEEP_SETS = ['Marble', 'Wood', 'Glass'];

export function pieceColourWord(char) {
  return char === char.toUpperCase() ? 'White' : 'Black';
}

export function pieceLabel(char) {
  if (!char) return null;
  return `${pieceColourWord(char)} ${PIECE_WORDS[char.toLowerCase()]}`;
}

// --- Classic: solid silhouettes with a turned base ---------------------------

const BASE = '<path class="pc-fill" d="M24 84h52v9H24z"/><path class="pc-fill" d="M30 76h40v8H30z"/>';

const CLASSIC = {
  p: `<circle class="pc-fill" cx="50" cy="24" r="11"/>
      <path class="pc-fill" d="M41 36h18l7 24a34 34 0 0 1-32 0z"/>${BASE}`,
  n: `<path class="pc-fill" d="M38 76c-1-16 3-25 13-32l-5-7-11 8-7-11 12-11 3 4 5-5 5 6c13 5 19 19 19 36 0 5-.4 9-.8 12z"/>
      <circle class="pc-line-fill" cx="47" cy="25" r="2.2"/>
      <path class="pc-line" d="M58 14l6 5" />${BASE}`,
  b: `<circle class="pc-fill" cx="50" cy="17" r="7"/>
      <path class="pc-fill" d="M50 23c14 10 20 22 20 31 0 9-9 14-20 14s-20-5-20-14c0-9 6-21 20-31z"/>
      <path class="pc-line" d="M42 40h16"/>${BASE}`,
  r: `<path class="pc-fill" d="M26 16h11v9h8v-9h10v9h8v-9h11v17l-7 6v29l7 9H26l7-9V39l-7-6z"/>
      <path class="pc-line" d="M34 42h32"/>${BASE}`,
  q: `<path class="pc-fill" d="M20 24l8 16 8-24 6 22 8-24 8 24 6-22 8 24 8-16-6 52H26z"/>
      <circle class="pc-fill" cx="20" cy="20" r="5"/><circle class="pc-fill" cx="50" cy="12" r="5"/>
      <circle class="pc-fill" cx="80" cy="20" r="5"/>
      <path class="pc-line" d="M30 62h40"/>${BASE}`,
  k: `<path class="pc-fill" d="M45 6h10v8h8v10h-8v8H45v-8h-8V14h8z"/>
      <path class="pc-fill" d="M30 36h40l-5 40H35z"/>
      <path class="pc-line" d="M36 56h28"/>${BASE}`,
};

// --- Staunton Flat: a flat, poster-like set on a wide plinth ----------------

const PLINTH = '<rect class="pc-fill" x="18" y="82" width="64" height="12" rx="3"/>'
  + '<rect class="pc-fill" x="26" y="72" width="48" height="10" rx="2"/>';

const STAUNTON = {
  p: `<circle class="pc-fill" cx="50" cy="24" r="15"/>
      <rect class="pc-fill" x="36" y="38" width="28" height="9" rx="3"/>
      <path class="pc-fill" d="M38 47h24l6 25H32z"/>${PLINTH}`,
  n: `<path class="pc-fill" d="M34 72V50l-8-6 10-10-4-12 14 8h8l16 10-10 8 6 24z"/>
      <rect class="pc-line-fill" x="42" y="26" width="7" height="7"/>
      <path class="pc-fill" d="M62 20l10 2-6 10z"/>${PLINTH}`,
  b: `<path class="pc-fill" d="M50 8l20 34H30z"/>
      <rect class="pc-fill" x="28" y="42" width="44" height="10" rx="3"/>
      <path class="pc-fill" d="M34 52h32l4 20H30z"/>
      <rect class="pc-line-fill" x="46" y="18" width="8" height="18"/>${PLINTH}`,
  r: `<path class="pc-fill" d="M22 14h14v9h14v-9h14v9h14v-9h0v20H22z"/>
      <rect class="pc-fill" x="22" y="14" width="56" height="20"/>
      <rect class="pc-line-fill" x="36" y="14" width="10" height="10"/>
      <rect class="pc-line-fill" x="54" y="14" width="10" height="10"/>
      <path class="pc-fill" d="M30 34h40l4 38H26z"/>
      <rect class="pc-line-fill" x="28" y="48" width="44" height="6"/>${PLINTH}`,
  q: `<path class="pc-fill" d="M16 16l12 20 10-26 12 26 12-26 10 26 12-20-8 30H24z"/>
      <circle class="pc-fill" cx="50" cy="8" r="7"/>
      <path class="pc-fill" d="M26 48h48l-6 24H32z"/>
      <rect class="pc-line-fill" x="28" y="56" width="44" height="6"/>${PLINTH}`,
  k: `<rect class="pc-fill" x="44" y="2" width="12" height="30"/>
      <rect class="pc-fill" x="34" y="12" width="32" height="11"/>
      <path class="pc-fill" d="M22 32h56l-8 18H30z"/>
      <path class="pc-fill" d="M30 50h40l-4 22H34z"/>
      <rect class="pc-line-fill" x="32" y="58" width="36" height="6"/>${PLINTH}`,
};

// --- Neo: geometry only, each type a different primitive --------------------

const NEO = {
  p: `<circle class="pc-fill" cx="50" cy="30" r="14"/><path class="pc-fill" d="M50 46l22 38H28z"/>`,
  n: `<path class="pc-fill" d="M20 86l10-44 12-6-6-16 18 8 26 14-14 10 12 34z"/>
      <circle class="pc-line-fill" cx="44" cy="34" r="3"/>`,
  b: `<path class="pc-fill" d="M50 10l30 74H20z"/><path class="pc-line-wide" d="M50 34v26"/>`,
  r: `<path class="pc-fill" d="M20 18h14v12h12V18h14v12h12V18h8v66H20z"/>`,
  q: `<path class="pc-fill" d="M14 20l12 22 12-30 12 30 12-30 12 30 12-22-10 64H24z"/>
      <circle class="pc-fill" cx="50" cy="8" r="7"/>`,
  k: `<path class="pc-fill" d="M22 30h56v54H22z"/>
      <path class="pc-cut" d="M44 38h12v14h14v12H56v14H44V64H30V52h14z"/>
      <path class="pc-fill" d="M44 4h12v12h12v12H32V16h12z"/>`,
};

// --- Pixel: blocks on a ten by ten grid -------------------------------------

const PIXEL_GRIDS = {
  p: [
    '..........',
    '....##....',
    '...####...',
    '...####...',
    '....##....',
    '...####...',
    '..######..',
    '.########.',
    '.########.',
    '..........',
  ],
  n: [
    '..........',
    '...##.....',
    '..####.#..',
    '.#######..',
    '.########.',
    '...######.',
    '....#####.',
    '...######.',
    '.########.',
    '..........',
  ],
  b: [
    '..........',
    '....##....',
    '...#..#...',
    '...####...',
    '..##..##..',
    '..######..',
    '...####...',
    '..######..',
    '.########.',
    '..........',
  ],
  r: [
    '..........',
    '.#.##.##.#',
    '.#.##.##.#',
    '.########.',
    '..######..',
    '..######..',
    '..######..',
    '.########.',
    '##########',
    '..........',
  ],
  q: [
    '..........',
    '.#..##..#.',
    '.##.##.##.',
    '.#.####.#.',
    '.########.',
    '..######..',
    '..######..',
    '.########.',
    '##########',
    '..........',
  ],
  k: [
    '....##....',
    '..######..',
    '....##....',
    '..######..',
    '.########.',
    '.##.##.##.',
    '..######..',
    '..######..',
    '.########.',
    '##########',
  ],
};

function pixelSvg(type) {
  const grid = PIXEL_GRIDS[type];
  const cell = 10;
  let out = '';
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') { x += 1; continue; }
      let span = 1;
      while (row[x + span] === '#') span += 1;
      out += `<rect class="pc-fill" x="${x * cell}" y="${y * cell}" width="${span * cell}" height="${cell}"/>`;
      x += span;
    }
  });
  return out;
}

const SETS = {
  Classic: (type) => CLASSIC[type],
  'Staunton Flat': (type) => STAUNTON[type],
  Neo: (type) => NEO[type],
  Pixel: (type) => pixelSvg(type),
};

/**
 * The flat drawing of one piece.  `char` is a FEN letter: upper case for
 * White, lower case for Black.
 */
export function pieceSvg(setName, char, { className = '' } = {}) {
  if (!char) return '';
  const type = char.toLowerCase();
  const build = SETS[setName] || SETS.Classic;
  const inner = build(type);
  const colour = char === char.toUpperCase() ? 'white' : 'black';
  return `<svg class="piece piece-${colour} piece-${type} ${className}" viewBox="0 0 100 100" aria-hidden="true" focusable="false" data-piece="${char}">${inner}</svg>`;
}

export function flatSetName(name) {
  return FLAT_SETS.includes(name) ? name : 'Classic';
}
