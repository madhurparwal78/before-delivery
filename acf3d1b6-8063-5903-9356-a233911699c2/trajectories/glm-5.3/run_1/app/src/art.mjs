// Deterministic abstract art drawn by the app from a phrase, in one soft shared language.
// Pure function of (phrase, aspect, seed): the same inputs always draw the same picture.

function hash(str) {
  // 32-bit FNV-1a, promoted carefully
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rngFrom(seed) {
  // mulberry32
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Soft, film-adjacent palettes. A palette is a list of band colours plus a glow colour.
const PALETTES = [
  { name: 'dusk', bands: ['#2b3a67', '#3d5a80', '#98c1d9', '#e0fbfc'], glow: '#ee6c4d' },
  { name: 'ember', bands: ['#3a2618', '#8c5b3f', '#d9a066', '#f2e3c6'], glow: '#ff8c42' },
  { name: 'harbour', bands: ['#101d42', '#27496d', '#5f8a9b', '#cfd7d7'], glow: '#f4d35e' },
  { name: 'meadow', bands: ['#1b3a2f', '#3f6c51', '#8bbf6d', '#e9f5db'], glow: '#f2c14e' },
  { name: 'orchid', bands: ['#31284a', '#5a4a7f', '#9d8ab5', '#e8dff2'], glow: '#e07be0' },
  { name: 'paper', bands: ['#3d3a36', '#6e675f', '#b0a99f', '#efeae0'], glow: '#d98e6c' },
  { name: 'neon', bands: ['#160f30', '#2e1a5e', '#6d3bd6', '#b8a6ff'], glow: '#f72585' },
  { name: 'tide', bands: ['#06283d', '#136f8c', '#47b5c3', '#dff6f3'], glow: '#ffd166' },
  { name: 'rose', bands: ['#402029', '#7d4a5a', '#c98d96', '#f4e3e0'], glow: '#ff6b6b' },
  { name: 'stone', bands: ['#2f3336', '#4a5157', '#8f9aa3', '#e3e8ea'], glow: '#9fc2cc' },
];

// Mood words gently bias palette and composition choices.
const MOODS = {
  night: ['night', 'dark', 'midnight', 'dusk', 'evening', 'noir'],
  dawn: ['dawn', 'morning', 'sunrise', 'daybreak', 'golden hour', 'golden'],
  water: ['water', 'sea', 'ocean', 'harbour', 'harbor', 'harbor', 'rain', 'wet', 'river', 'lake', 'tide', 'storm', 'spray'],
  forest: ['forest', 'tree', 'trees', 'leaf', 'leaves', 'moss', 'wood', 'meadow', 'garden', 'jungle'],
  warm: ['fire', 'flame', 'ember', 'candle', 'lantern', 'warm', 'autumn', 'amber', 'summer'],
  cold: ['winter', 'snow', 'ice', 'frost', 'cold', 'arctic', 'chill'],
  city: ['city', 'street', 'neon', 'urban', 'tram', 'shop', 'sign', 'signs', 'downtown'],
  soft: ['soft', 'gentle', 'quiet', 'calm', 'slow', 'dream', 'mist', 'fog', 'misty'],
  desert: ['desert', 'sand', 'dune', 'dunes', 'beach', 'sunset', 'dry'],
  flower: ['flower', 'flowers', 'bloom', 'spring', 'petal', 'blossom', 'tulip', 'rose'],
};

function pickPalette(prompt, rand) {
  const lower = ` ${prompt.toLowerCase()} `;
  let best = null; let bestHits = -1; let bestIdx = 0;
  const order = ['night', 'dawn', 'water', 'forest', 'warm', 'cold', 'city', 'desert', 'flower', 'soft'];
  for (const mood of order) {
    let hits = 0;
    for (const word of MOODS[mood]) if (lower.includes(` ${word}`) || lower.includes(`${word} `) || lower.includes(word)) hits++;
    if (hits > bestHits) { bestHits = hits; best = mood; }
  }
  const preferred = {
    night: [0, 6, 9], dawn: [3, 1, 7], water: [2, 7, 9], forest: [3, 9, 4],
    warm: [1, 5, 3], cold: [7, 9, 0], city: [6, 0, 5], desert: [1, 7, 5],
    flower: [8, 4, 1], soft: [4, 3, 2],
  };
  const list = best ? preferred[best] : null;
  const idx = list ? list[Math.floor(rand() * list.length) % list.length] : Math.floor(rand() * PALETTES.length);
  return PALETTES[idx % PALETTES.length];
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ASPECTS = { '16:9': [960, 540], '9:16': [540, 960], '1:1': [720, 720] };

/**
 * Draw one deterministic abstract picture.
 * @param {string} phrase source text; its words drive the palette and composition
 * @param {string} aspect '16:9' | '9:16' | '1:1'
 * @param {object} [opts]
 * @param {boolean} opts.animate loop over `duration` seconds when true (video pictures)
 * @param {number} opts.duration loop length in seconds for animated pictures
 * @param {boolean} opts.staticArt public-site art style (fixed hero-like compositions)
 * @returns {string} an SVG document
 */
export function drawArt(phrase, aspect, opts = {}) {
  const [W, H] = ASPECTS[aspect] || ASPECTS['16:9'];
  const seed = hash(`${phrase}::${aspect}::${opts.staticArt ? 'fixed' : 'gen'}`);
  const rand = rngFrom(seed);
  const palette = pickPalette(phrase, rand);
  const words = phrase.trim().split(/\s+/).filter(Boolean).length;
  const wordShapes = Math.min(14, 3 + words);

  const animate = !!opts.animate;
  const loopSec = Math.max(4, Math.min(30, Number(opts.duration) || 10));

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img">`);
  if (animate) parts.push(`<title>${esc(phrase)} \u2014 looping ${loopSec}s</title>`);
  else parts.push(`<title>${esc(phrase)}</title>`);
  parts.push(`<defs>`);
  const gid = `g${seed.toString(36)}`;
  const sky = palette.bands[0];
  const mid = palette.bands[1];
  const light = palette.bands[2];
  const pale = palette.bands[3];
  parts.push(`<linearGradient id="${gid}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${mid}"/></linearGradient>`);
  parts.push(`<radialGradient id="${gid}glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${palette.glow}" stop-opacity="0.85"/><stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/></radialGradient>`);
  parts.push(`<linearGradient id="${gid}fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${sky}" stop-opacity="0"/><stop offset="0.25" stop-color="${sky}" stop-opacity="1"/><stop offset="0.75" stop-color="${sky}" stop-opacity="1"/><stop offset="1" stop-color="${sky}" stop-opacity="0"/></linearGradient>`);
  parts.push(`<clipPath id="${gid}clip"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>`);
  parts.push(`</defs>`);
  parts.push(`<g clip-path="url(#${gid}clip)">`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#${gid}sky)"/>`);

  // Soft horizon bands, gently staggered. Animated versions drift slowly and loop.
  const bands = 3 + Math.floor(rand() * 3);
  const baseline = H * (0.42 + rand() * 0.2);
  for (let b = 0; b < bands; b++) {
    const y = baseline + (b * H) / (bands + 1) * (0.9 + rand() * 0.1);
    const color = [palette.bands[1], palette.bands[2], palette.bands[3]][b % 3];
    const op = 0.32 + rand() * 0.4;
    const wob = 8 + rand() * 26;
    const amp = H * (0.03 + rand() * 0.06);
    let d = `M -40 ${y.toFixed(1)}`;
    const steps = 6;
    for (let s2 = 0; s2 <= steps; s2++) {
      const x = -40 + ((W + 80) / steps) * s2;
      const yy = y + Math.sin((s2 / steps) * Math.PI * (1 + b) + rand() * 0.4) * amp;
      d += ` L ${x.toFixed(1)} ${yy.toFixed(1)}`;
    }
    d += ` L ${W + 40} ${H + 40} L -40 ${H + 40} Z`;
    let anim = '';
    if (animate) {
      anim = `<animateTransform attributeName="transform" type="translate" values="0 0; ${(-wob).toFixed(1)} ${(b % 2 ? -6 : 6)}; 0 0" dur="${(loopSec * (0.8 + b * 0.2)).toFixed(1)}s" repeatCount="indefinite"/>`;
    }
    parts.push(`<path d="${d}" fill="${color}" opacity="${op.toFixed(2)}">${anim}</path>`);
  }

  // A glow, placed where the words point it.
  const gx = W * (0.15 + rand() * 0.7);
  const gy = H * (0.2 + rand() * 0.35);
  const gr = Math.min(W, H) * (0.24 + rand() * 0.22);
  const glowAnim = animate ? `<animate attributeName="opacity" values="0.5;0.8;0.5" dur="${loopSec}s" repeatCount="indefinite"/>` : '';
  parts.push(`<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="${gr.toFixed(1)}" fill="url(#${gid}glow)">${glowAnim}</circle>`);

  // Shapes seeded by the prompt's words: rings, arcs and quiet marks.
  for (let i = 0; i < wordShapes; i++) {
    const x = rand() * W;
    const y = baseline * (0.3 + rand() * 0.5) + rand() * H * 0.45;
    const r = (6 + rand() * Math.min(W, H) * 0.11) * (0.5 + rand() * 0.8);
    const kind = Math.floor(rand() * 3);
    const stroke = [palette.bands[3], palette.glow, palette.bands[2]][i % 3];
    const op = 0.18 + rand() * 0.4;
    if (kind === 0) {
      const dur = animate ? loopSec * (0.9 + rand() * 0.4).toFixed(1) : 0;
      const anim = animate ? `<animateTransform attributeName="transform" type="translate" values="0 0; ${(rand() * 40 - 20).toFixed(1)} ${(rand() * 30 - 15).toFixed(1)}; 0 0" dur="${dur}s" repeatCount="indefinite"/>` : '';
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${(1.2 + rand() * 2.4).toFixed(1)}" opacity="${op.toFixed(2)}">${anim}</circle>`);
    } else if (kind === 1) {
      const x1 = x, y1 = y, x2 = x + (rand() - 0.5) * W * 0.5, y2 = y + (rand() - 0.5) * H * 0.4;
      const mx = (x1 + x2) / 2 + (rand() - 0.5) * 80, my = (y1 + y2) / 2 + (rand() - 0.5) * 80;
      const anim = animate ? `<animate attributeName="opacity" values="${op.toFixed(2)};${(op * 0.4).toFixed(2)};${op.toFixed(2)}" dur="${loopSec}s" repeatCount="indefinite"/>` : '';
      parts.push(`<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${(1 + rand() * 2).toFixed(1)}" opacity="${op.toFixed(2)}" stroke-linecap="round">${anim}</path>`);
    } else {
      const s = r;
      const anim = animate ? `<animateTransform attributeName="transform" type="rotate" from="0 ${(x).toFixed(1)} ${(y).toFixed(1)}" to="360 ${(x).toFixed(1)} ${(y).toFixed(1)}" dur="${(loopSec * 2).toFixed(0)}s" repeatCount="indefinite"/>` : '';
      parts.push(`<rect x="${(x - s / 2).toFixed(1)}" y="${(y - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" rx="${(s / 4).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.4" opacity="${(op * 0.8).toFixed(2)}">${anim}</rect>`);
    }
  }

  // A quiet veil top and bottom, in the palette's own tone.
  parts.push(`<rect width="${W}" height="${H * 0.22}" fill="url(#${gid}fade)" opacity="0.25"/>`);
  parts.push(`<rect y="${H * 0.78}" width="${W}" height="${H * 0.22}" fill="${sky}" opacity="0.3"/>`);
  parts.push(`<rect width="${W}" height="${H}" fill="none" stroke="${pale}" stroke-opacity="0.12" stroke-width="2"/>`);
  parts.push(`</g></svg>`);

  return parts.join('');
}

/** A decorative frame for the public site; carries an empty alt in use. */
export function artUri(phrase, aspect, opts = {}) {
  return `data:image/svg+xml,${encodeURIComponent(drawArt(phrase, aspect, opts))}`;
}
