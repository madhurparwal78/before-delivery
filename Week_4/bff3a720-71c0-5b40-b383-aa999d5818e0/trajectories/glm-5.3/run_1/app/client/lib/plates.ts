/**
 * Route plates: every image is drawn by a seeded scene renderer with fine film
 * grain — a road, a coast, fields, a ferry ramp or a car interior, in the
 * palette's muted tones. No text inside a drawing.
 */
import { h } from './els.js';

function hash(seed: string): number {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    x ^= seed.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

function rng(seedStr: string): () => number {
  let s = hash(seedStr);
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export type SceneKind = 'road' | 'coast' | 'fields' | 'ferry' | 'interior';

export function sceneKindFor(seed: string): SceneKind {
  const kinds: SceneKind[] = ['road', 'coast', 'fields', 'ferry', 'interior'];
  return kinds[hash(seed) % kinds.length];
}

export interface PlateOpts {
  seed: string;
  caption: string;
  ratio?: string;      // e.g. "16 / 10"
  span?: string;       // grid span classes
  width?: string;      // explicit width at 375
}

export function plate(opts: PlateOpts): HTMLElement {
  const kind = sceneKindFor(opts.seed);
  const rand = rng(opts.seed + kind);
  const svg = renderScene(kind, rand, opts.seed);
  const figure = h('figure', {
    class: 'plate' + (opts.span ? ` ${opts.span}` : ''),
    'data-seed': opts.seed,
    style: (opts.ratio ? `aspect-ratio: ${opts.ratio};` : '') + (opts.width ? `width:${opts.width};` : ''),
  },
    svg,
    h('figcaption', null, opts.caption),
  );
  return figure;
}

function grain(rand: () => number, count: number, w: number, hgt: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = (rand() * w).toFixed(1);
    const y = (rand() * hgt).toFixed(1);
    const o = (0.03 + rand() * 0.06).toFixed(3);
    out += `<circle cx="${x}" cy="${y}" r="0.8" fill="#1c1917" opacity="${o}"/>`;
  }
  return out;
}

function renderScene(kind: SceneKind, rand: () => number, seed: string): SVGElement {
  const w = 480;
  const hgt = 300;
  const id = 'g' + hash(seed).toString(36);
  const sky = ['#b8b3a8', '#c2bdae', '#adaa9c'];
  const ground = ['#8d8778', '#7d7668', '#97907e'];
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  let body = '';
  if (kind === 'road') {
    body = `
      <rect width="${w}" height="${hgt * 0.55}" fill="${pick(sky)}"/>
      <rect y="${hgt * 0.55}" width="${w}" height="${hgt * 0.45}" fill="${pick(ground)}"/>
      <polygon points="0,${hgt} ${w * 0.42},${hgt * 0.55} ${w * 0.58},${hgt * 0.55} ${w},${hgt}" fill="#5a564c"/>
      ${Array.from({ length: 7 }, (_, i) => `<rect x="${w * (0.47 + i * 0.004)}" y="${hgt * (0.58 + i * 0.06)}" width="${4 + i * 2}" height="${2 + i}" fill="#c8c4ba" opacity="0.85"/>`).join('')}
      <circle cx="${w * (0.2 + rand() * 0.6)}" cy="${hgt * 0.18}" r="${hgt * 0.07}" fill="#d9d4c7" opacity="0.7"/>`;
  } else if (kind === 'coast') {
    body = `
      <rect width="${w}" height="${hgt * 0.6}" fill="${pick(sky)}"/>
      <rect y="${hgt * 0.6}" width="${w}" height="${hgt * 0.4}" fill="#5f7a78"/>
      <rect y="${hgt * 0.6}" width="${w}" height="${hgt * 0.04}" fill="#cfd6cf" opacity="0.8"/>
      ${Array.from({ length: 5 }, () => `<path d="M ${rand() * w} ${hgt * (0.62 + rand() * 0.3)} q 20 6 44 0" stroke="#8aa09c" fill="none" opacity="0.7" stroke-width="2"/>`).join('')}
      <ellipse cx="${w * 0.7}" cy="${hgt * 0.2}" rx="${40 + rand() * 40}" ry="${14 + rand() * 10}" fill="#d9d4c7" opacity="0.6"/>`;
  } else if (kind === 'fields') {
    body = `
      <rect width="${w}" height="${hgt * 0.4}" fill="${pick(sky)}"/>
      ${Array.from({ length: 5 }, (_, i) => `<polygon points="0,${hgt * (0.4 + i * 0.12)} ${w},${hgt * (0.42 + i * 0.11)} ${w},${hgt * (0.55 + i * 0.12)} 0,${hgt * (0.53 + i * 0.12)}" fill="${['#9a9280', '#877f6e', '#a49c88', '#7f786a'][i % 4]}" opacity="0.9"/>`).join('')}
      <rect y="${hgt * 0.4}" width="${w}" height="${hgt * 0.6}" fill="#8d8778"/>
      <path d="M ${w * 0.1} ${hgt * 0.9} L ${w * 0.3} ${hgt * 0.42} L ${w * 0.42} ${hgt * 0.42} L ${w * 0.3} ${hgt * 0.9} Z" fill="#5a564c" opacity="0.8"/>`;
  } else if (kind === 'ferry') {
    body = `
      <rect width="${w}" height="${hgt * 0.5}" fill="${pick(sky)}"/>
      <rect y="${hgt * 0.5}" width="${w}" height="${hgt * 0.5}" fill="#5f7a78"/>
      <polygon points="${w * 0.25},${hgt * 0.5} ${w * 0.45},${hgt * 0.5} ${w * 0.4},${hgt * 0.72} ${w * 0.3},${hgt * 0.72}" fill="#6e6a5f"/>
      <rect x="${w * 0.3}" y="${hgt * 0.68}" width="${w * 0.1}" height="${hgt * 0.06}" fill="#4a463e"/>
      <rect x="0" y="${hgt * 0.52}" width="${w}" height="${hgt * 0.02}" fill="#cfd6cf" opacity="0.7"/>`;
  } else {
    body = `
      <rect width="${w}" height="${hgt}" fill="#6e6a5f"/>
      <rect y="${hgt * 0.62}" width="${w}" height="${hgt * 0.38}" fill="#5a564c"/>
      <rect x="${w * 0.18}" y="${hgt * 0.2}" width="${w * 0.64}" height="${hgt * 0.34}" rx="0" fill="#3e3b35"/>
      <rect x="${w * 0.2}" y="${hgt * 0.23}" width="${w * 0.6}" height="${hgt * 0.26}" fill="#8f959b" opacity="0.9"/>
      <rect x="${w * 0.26}" y="${hgt * 0.3}" width="${w * 0.2}" height="${hgt * 0.12}" fill="#7a7365"/>
      <rect x="${w * 0.56}" y="${hgt * 0.42}" width="${w * 0.18}" height="${hgt * 0.1}" fill="#6a6355"/>`;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'plate-art');
  svg.innerHTML = `<defs><filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/></filter></defs>${body}<rect width="${w}" height="${hgt}" filter="url(#${id})"/>${grain(rand, 60, w, hgt)}`;
  return svg;
}
