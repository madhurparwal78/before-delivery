// The one drawn language of the app: soft bands, a glow, a horizon and a few simple shapes whose palette and
// arrangement come from a phrase. Generation outputs, the public site's frames and the template art all use it.
// The same phrase, aspect and length always give the same SVG.

import type { Aspect } from './catalog.js';

export interface PictureSpec {
  phrase: string;
  aspect: Aspect;
  /** Loop length in seconds for a video; a still picture has none. */
  seconds?: number | null;
  /** Accessible name; decorative pictures have none. */
  label?: string | null;
  /** Prefix for gradient ids when several pictures share one document. */
  idPrefix?: string;
}

const SIZES: Record<Aspect, [number, number]> = { '16:9': [1600, 900], '9:16': [900, 1600], '1:1': [1200, 1200] };

interface Mood {
  words: string[];
  hue: number;
  sat: number;
  light: number;
  glowHue: number;
}

// Each mood lights the scene: sky hue, saturation, how bright the sky is, and the glow's hue.
const MOODS: Mood[] = [
  { words: ['night', 'midnight', 'moon', 'star', 'dark', 'lantern', 'lamplight'], hue: 232, sat: 48, light: 20, glowHue: 38 },
  { words: ['neon', 'dance', 'club', 'violet', 'purple'], hue: 276, sat: 62, light: 24, glowHue: 320 },
  { words: ['dusk', 'sunset', 'golden', 'amber', 'autumn', 'warm', 'honey', 'copper'], hue: 22, sat: 70, light: 58, glowHue: 42 },
  { words: ['dawn', 'morning', 'first light', 'linen', 'soft', 'pastel'], hue: 205, sat: 46, light: 82, glowHue: 36 },
  { words: ['snow', 'winter', 'frost', 'ice', 'salt'], hue: 212, sat: 30, light: 86, glowHue: 200 },
  { words: ['rain', 'fog', 'mist', 'grey', 'overcast', 'wet', 'cloud'], hue: 214, sat: 20, light: 58, glowHue: 46 },
  { words: ['forest', 'pine', 'orchard', 'green', 'lawn', 'garden', 'plant', 'leaf', 'leaves'], hue: 146, sat: 36, light: 46, glowHue: 58 },
  { words: ['sea', 'ocean', 'harbour', 'harbor', 'river', 'tide', 'water', 'ferry', 'boat', 'pier', 'canal'], hue: 196, sat: 52, light: 52, glowHue: 30 },
  { words: ['red', 'fire', 'flame', 'ember', 'tomato', 'ketchup'], hue: 6, sat: 66, light: 40, glowHue: 30 },
  { words: ['desert', 'dune', 'sand', 'clay', 'ceramic'], hue: 32, sat: 50, light: 66, glowHue: 18 },
];

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hsl(h: number, s: number, l: number, a = 1): string {
  const hue = ((Math.round(h) % 360) + 360) % 360;
  const light = Math.max(4, Math.min(96, Math.round(l)));
  return a === 1 ? `hsl(${hue} ${Math.round(s)}% ${light}%)` : `hsl(${hue} ${Math.round(s)}% ${light}% / ${a})`;
}

function moodOf(phrase: string, rand: () => number): Mood {
  const lower = phrase.toLowerCase();
  const found = MOODS.filter((mood) => mood.words.some((word) => lower.includes(word)));
  if (found.length) {
    // Two moods in one phrase blend: the first sets the sky, the second tints the glow.
    return found.length > 1 ? { ...found[0], glowHue: found[1].glowHue } : found[0];
  }
  const hue = Math.floor(rand() * 360);
  return { words: [], hue, sat: 44, light: 56 + rand() * 20, glowHue: (hue + 150) % 360 };
}

function bandPath(width: number, height: number, base: number, amplitude: number, rand: () => number): string {
  const steps = 4;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    points.push([(width * i) / steps, base + (rand() - 0.5) * 2 * amplitude]);
  }
  let d = `M${-width * 0.2} ${height * 1.2} L${-width * 0.2} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < steps; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const mid = (x0 + x1) / 2;
    d += ` C${mid.toFixed(1)} ${y0.toFixed(1)} ${mid.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  d += ` L${width * 1.2} ${points[steps][1].toFixed(1)} L${width * 1.2} ${height * 1.2} Z`;
  return d;
}

export function drawPicture({ phrase, aspect, seconds = null, label = null, idPrefix = 'k' }: PictureSpec): string {
  const [width, height] = SIZES[aspect];
  const rand = random(hash(`${phrase}|${aspect}`));
  const mood = moodOf(phrase, rand);
  const id = (name: string) => `${idPrefix}-${name}`;
  const dark = mood.light < 35;
  const skyTop = hsl(mood.hue, mood.sat, mood.light - 8);
  const skyBottom = hsl(mood.hue + 18, mood.sat + 6, mood.light + (dark ? 16 : 10));
  const glowX = width * (0.2 + rand() * 0.6);
  const glowY = height * (0.18 + rand() * 0.3);
  const glowR = Math.min(width, height) * (0.28 + rand() * 0.16);
  const horizon = height * (0.5 + rand() * 0.14);

  const bands = [0, 1, 2, 3].map((i) => {
    const hue = mood.hue + (i % 2 ? 24 : -16) + (rand() - 0.5) * 30;
    const light = dark ? mood.light + 6 + i * 6 : mood.light - 6 - i * 7;
    return {
      d: bandPath(width, height, horizon + i * height * 0.1, height * (0.035 + rand() * 0.05), rand),
      top: hsl(hue, mood.sat + 8, light + 8, 0.92),
      bottom: hsl(hue + 10, mood.sat, light - 6, 0.98),
    };
  });

  const shapes = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => ({
    x: width * (0.1 + rand() * 0.8),
    y: height * (0.15 + rand() * 0.5),
    r: Math.min(width, height) * (0.012 + rand() * 0.03),
    round: rand() > 0.5,
    fill: hsl(mood.glowHue + (rand() - 0.5) * 30, 80, dark ? 72 : 92, 0.85),
  }));

  const loop = seconds ? `${seconds}s` : null;
  const title = label ? `<title>${escapeXml(label)}</title>` : '';
  const role = label ? ` role="img" aria-label="${escapeXml(label)}"` : ' aria-hidden="true"';
  const motion = loop
    ? `<style>` +
      `.${id('band')}{animation:${id('drift')} ${loop} ease-in-out infinite}` +
      `.${id('band')}:nth-of-type(2n){animation-direction:reverse}` +
      `.${id('glow')}{animation:${id('pulse')} ${loop} ease-in-out infinite;transform-origin:${glowX.toFixed(0)}px ${glowY.toFixed(0)}px}` +
      `.${id('shape')}{animation:${id('rise')} ${loop} ease-in-out infinite}` +
      `@keyframes ${id('drift')}{0%,100%{transform:translateX(0)}50%{transform:translateX(${(width * 0.06).toFixed(0)}px)}}` +
      `@keyframes ${id('pulse')}{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.12);opacity:1}}` +
      `@keyframes ${id('rise')}{0%,100%{transform:translateY(0)}50%{transform:translateY(-${(height * 0.04).toFixed(0)}px)}}` +
      `@media (prefers-reduced-motion:reduce){.${id('band')},.${id('glow')},.${id('shape')}{animation:none}}` +
      `</style>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"${role}>` +
    title +
    motion +
    `<defs>` +
    `<linearGradient id="${id('sky')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBottom}"/></linearGradient>` +
    `<radialGradient id="${id('glow-fill')}"><stop offset="0" stop-color="${hsl(mood.glowHue, 92, 82)}" stop-opacity="0.95"/><stop offset="0.45" stop-color="${hsl(mood.glowHue, 86, 66)}" stop-opacity="0.45"/><stop offset="1" stop-color="${hsl(mood.glowHue, 80, 60)}" stop-opacity="0"/></radialGradient>` +
    bands
      .map(
        (band, i) =>
          `<linearGradient id="${id(`band-${i}`)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${band.top}"/><stop offset="1" stop-color="${band.bottom}"/></linearGradient>`,
      )
      .join('') +
    `</defs>` +
    `<rect width="${width}" height="${height}" fill="url(#${id('sky')})"/>` +
    `<circle class="${id('glow')}" cx="${glowX.toFixed(1)}" cy="${glowY.toFixed(1)}" r="${glowR.toFixed(1)}" fill="url(#${id('glow-fill')})"/>` +
    shapes
      .map((s) =>
        s.round
          ? `<circle class="${id('shape')}" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r.toFixed(1)}" fill="${s.fill}"/>`
          : `<rect class="${id('shape')}" x="${(s.x - s.r).toFixed(1)}" y="${(s.y - s.r).toFixed(1)}" width="${(s.r * 2).toFixed(1)}" height="${(s.r * 2.6).toFixed(1)}" rx="${(s.r * 0.6).toFixed(1)}" fill="${s.fill}"/>`,
      )
      .join('') +
    `<g>` +
    bands.map((band, i) => `<path class="${id('band')}" d="${band.d}" fill="url(#${id(`band-${i}`)})"/>`).join('') +
    `</g>` +
    `</svg>`
  );
}
