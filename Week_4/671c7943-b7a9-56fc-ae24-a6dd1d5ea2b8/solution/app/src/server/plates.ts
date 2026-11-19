import type { Motif } from "../shared/types.js";

function hash(text: string): () => number {
  let state = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    state = Math.imul(state ^ text.charCodeAt(index), 3432918353);
    state = (state << 13) | (state >>> 19);
  }
  return () => {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

interface Tones {
  paper: string;
  light: string;
  mid: string;
  strong: string;
  dark: string;
  accent: string;
}

function tonesOf(hue: number): Tones {
  return {
    paper: hex(hue, 30, 94),
    light: hex(hue, 30, 85),
    mid: hex(hue, 34, 67),
    strong: hex(hue, 40, 42),
    dark: hex(hue, 46, 19),
    accent: hex(hue, 52, 32),
  };
}

const f = (value: number): string => String(Math.round(value * 10) / 10);

function arcPath(cx: number, cy: number, radius: number, from: number, sweep: number): string {
  const start = (from * Math.PI) / 180;
  const end = ((from + sweep) * Math.PI) / 180;
  const large = sweep > 180 ? 1 : 0;
  return `M${f(cx + radius * Math.cos(start))} ${f(cy + radius * Math.sin(start))}A${f(radius)} ${f(radius)} 0 ${large} 1 ${f(cx + radius * Math.cos(end))} ${f(cy + radius * Math.sin(end))}`;
}

function arcs(tones: Tones, random: () => number): string {
  const cx = 470 + random() * 120;
  const cy = 430 + random() * 140;
  const palette = [tones.dark, tones.strong, tones.accent, tones.mid, tones.dark, tones.strong, tones.mid];
  const rings = Array.from({ length: 7 }, (_, index) => {
    const radius = 90 + index * 82;
    const width = 38 + random() * 26;
    const from = random() * 360;
    const sweep = 150 + random() * 170;
    return `<path d="${arcPath(cx, cy, radius, from, sweep)}" fill="none" stroke="${palette[index]}" stroke-width="${f(width)}"/>`;
  });
  const sx = random() > 0.5 ? 180 : 820;
  const sy = random() > 0.5 ? 220 : 780;
  const second = Array.from({ length: 3 }, (_, index) => {
    const radius = 70 + index * 64;
    return `<path d="${arcPath(sx, sy, radius, random() * 360, 190 + random() * 120)}" fill="none" stroke="${index === 1 ? tones.accent : tones.light}" stroke-width="30"/>`;
  });
  return [
    `<rect width="1000" height="1000" fill="${tones.paper}"/>`,
    `<circle cx="${f(sx)}" cy="${f(sy)}" r="150" fill="${tones.light}"/>`,
    ...rings,
    ...second,
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(52 + random() * 20)}" fill="${tones.dark}"/>`,
  ].join("");
}

function grid(tones: Tones, random: () => number): string {
  const cells = 8;
  const size = 1000 / cells;
  const fills = [tones.dark, tones.strong, tones.mid, tones.accent, tones.light];
  const parts = [`<rect width="1000" height="1000" fill="${tones.paper}"/>`];
  const taken = new Set<number>();
  for (let block = 0; block < 4; block += 1) {
    const span = block === 0 ? 3 : 2;
    const column = Math.floor(random() * (cells - span + 1));
    const row = Math.floor(random() * (cells - span + 1));
    parts.push(`<rect x="${column * size}" y="${row * size}" width="${span * size}" height="${span * size}" fill="${fills[block]}"/>`);
    for (let dx = 0; dx < span; dx += 1) for (let dy = 0; dy < span; dy += 1) taken.add((row + dy) * cells + column + dx);
  }
  for (let index = 0; index < 14; index += 1) {
    const cell = Math.floor(random() * cells * cells);
    if (taken.has(cell)) continue;
    taken.add(cell);
    parts.push(`<rect x="${(cell % cells) * size}" y="${Math.floor(cell / cells) * size}" width="${size}" height="${size}" fill="${fills[Math.floor(random() * fills.length)]}"/>`);
  }
  for (let line = 0; line <= cells; line += 1) {
    parts.push(`<path d="M${line * size} 0V1000M0 ${line * size}H1000" stroke="${tones.dark}" stroke-width="${line % 4 === 0 ? 5 : 2}" opacity="0.55"/>`);
  }
  parts.push(`<circle cx="${f(250 + random() * 500)}" cy="${f(250 + random() * 500)}" r="${f(70 + random() * 50)}" fill="none" stroke="${tones.dark}" stroke-width="8"/>`);
  return parts.join("");
}

function stack(tones: Tones, random: () => number): string {
  const fills = [tones.dark, tones.strong, tones.mid, tones.accent, tones.light, tones.paper];
  const parts = [`<rect width="1000" height="1000" fill="${tones.paper}"/>`];
  let top = 0;
  let index = 0;
  while (top < 1000) {
    const height = Math.min(1000 - top, 70 + random() * 190);
    const inset = random() > 0.45 ? random() * 260 : 0;
    const right = random() > 0.55 ? random() * 200 : 0;
    parts.push(`<rect x="${f(inset)}" y="${f(top)}" width="${f(1000 - inset - right)}" height="${f(height)}" fill="${fills[index % fills.length]}"/>`);
    if (random() > 0.6) parts.push(`<rect x="${f(inset + 40)}" y="${f(top + height * 0.4)}" width="${f(120 + random() * 200)}" height="${f(Math.max(10, height * 0.2))}" fill="${tones.paper}" opacity="0.85"/>`);
    top += height;
    index += 1;
  }
  parts.push(`<path d="M0 ${f(500 + random() * 120)}H1000" stroke="${tones.dark}" stroke-width="6"/>`);
  return parts.join("");
}

const DRAW: Record<Motif, (tones: Tones, random: () => number) => string> = { arcs, grid, stack };

function frame(inner: string): string {
  return `<svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true">${inner}</svg>`;
}

/** The plate of one project: its hue and motif, with the slug (and a screen number) seeding the composition. */
export function projectPlate(hue: number, motif: Motif, slug: string, screen = 0): string {
  return frame(DRAW[motif](tonesOf(hue), hash(`${slug}:${screen}`)));
}

const ACCENT_HUE = 172;

/** The small arcs plate that sits beside the empty-category sentence. */
export function emptyStatePlate(): string {
  return projectPlate(ACCENT_HUE, "arcs", "empty");
}

/** The intro plate: arcs, a ruled grid and stacked bands in the accent hue. */
export function introPlate(): string {
  const tones = tonesOf(ACCENT_HUE);
  const random = hash("intro");
  return frame(
    `<rect width="1000" height="1000" fill="${tones.paper}"/>` +
      `<rect x="0" y="560" width="1000" height="140" fill="${tones.light}"/><rect x="120" y="700" width="880" height="110" fill="${tones.mid}"/><rect x="0" y="810" width="760" height="190" fill="${tones.dark}"/>` +
      `<circle cx="560" cy="380" r="300" fill="${tones.strong}"/><circle cx="560" cy="380" r="210" fill="${tones.paper}"/><circle cx="560" cy="380" r="120" fill="${tones.dark}"/>` +
      `<path d="${arcPath(270, 330, 180, 200, 250)}" fill="none" stroke="${tones.accent}" stroke-width="44"/>` +
      `<path d="${arcPath(270, 330, 250, 190, 200)}" fill="none" stroke="${tones.dark}" stroke-width="14"/>` +
      Array.from({ length: 7 }, (_, index) => `<path d="M${120 + index * 120} 0V540" stroke="${tones.dark}" stroke-width="2" opacity="0.35"/>`).join("") +
      `<rect x="${f(740 + random() * 20)}" y="90" width="140" height="140" fill="${tones.accent}"/>`,
  );
}

/** The drawn portrait of Maren Sollis: a quiet geometric bust in the accent hue with warm skin and hair tones. */
export function portraitPlate(): string {
  const tones = tonesOf(ACCENT_HUE);
  const skin = hex(24, 46, 72);
  const hair = hex(24, 38, 17);
  return frame(
    `<rect width="1000" height="1000" fill="${tones.light}"/>` +
      `<circle cx="500" cy="520" r="400" fill="${tones.paper}"/>` +
      `<path d="M100 1000C120 800 280 730 500 730S880 800 900 1000Z" fill="${tones.dark}"/>` +
      `<path d="M425 610H575V790C545 825 455 825 425 790Z" fill="${skin}"/>` +
      `<path d="M380 735C430 805 570 805 620 735L665 765C600 855 400 855 335 765Z" fill="${tones.strong}"/>` +
      `<ellipse cx="500" cy="450" rx="140" ry="175" fill="${skin}"/>` +
      `<path d="M345 470C315 270 430 190 520 195C650 200 695 320 655 470C640 380 590 330 520 330C440 330 380 380 345 470Z" fill="${hair}"/>` +
      `<path d="M345 460C335 560 355 640 400 690C375 610 372 540 388 450Z" fill="${hair}"/>` +
      `<circle cx="652" cy="525" r="14" fill="${tones.accent}"/>`,
  );
}
