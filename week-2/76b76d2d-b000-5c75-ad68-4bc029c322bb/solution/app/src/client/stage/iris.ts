/** Iris Pull (brief: Motion and effects). Every value is a pure function of scroll position and viewport size. */

export const SEGMENT_PX = 1000;
const DEEP_LINK_P = 700;
const ACTIVATION_P = 300;
const FSTOPS = ["22", "16", "11", "8", "5.6", "4", "2.8", "2", "1.4"] as const;

export type IrisFrame = {
  segment: number; local: number; open: number; rotation: number; radius: number; fstop: string; rail: number; tint: number; active: number;
};

export function viewportDiagonal(): number {
  return Math.hypot(window.innerWidth, window.innerHeight);
}

/** The frame for scroll position y on a stage of `count` seasons. */
export function irisFrame(y: number, count: number, diagonal: number): IrisFrame {
  const segment = Math.max(0, Math.min(count - 1, Math.floor(y / SEGMENT_PX)));
  const local = Math.max(0, Math.min(SEGMENT_PX, y - SEGMENT_PX * segment));
  const open = local < 400 ? local / 400 : local < 700 ? 1 : (1000 - local) / 300;
  const rail = local < 400 ? 0 : local < 700 ? (local - 400) / 300 : (1000 - local) / 300;
  const tint = local < 700 || segment === count - 1 ? 0 : (local - 700) / 300;
  const active = local >= ACTIVATION_P ? segment : Math.max(0, segment - 1);
  return { segment, local, ...apertureOf(open, diagonal), rail, tint, active };
}

/** The selected season's final values, used under reduced motion. */
export function openFrame(index: number, diagonal: number): IrisFrame {
  return { segment: index, local: DEEP_LINK_P, ...apertureOf(1, diagonal), rail: 1, tint: 0, active: index };
}

function apertureOf(open: number, diagonal: number) {
  return {
    open,
    rotation: 40 * open,
    radius: (diagonal / 2) * (0.04 + 0.96 * open),
    fstop: FSTOPS[Math.min(8, Math.floor(8 * open))] ?? "22",
  };
}

export function deepLinkY(index: number): number {
  return SEGMENT_PX * index + DEEP_LINK_P;
}

const TINTS: [number, number, number][] = [
  [0x1a, 0x0b, 0x0c], // deep oxblood
  [0x08, 0x14, 0x13], // deep blue-green
  [0x17, 0x11, 0x0a], // deep umber
];

/** Ground tint of season k crossfaded toward season k + 1 by t. */
export function groundColour(segment: number, t: number): string {
  const from = TINTS[segment % 3] ?? TINTS[0]!;
  const to = TINTS[(segment + 1) % 3] ?? TINTS[0]!;
  const mix = from.map((c, i) => Math.round(c + ((to[i] ?? c) - c) * t));
  return `rgb(${mix.join(" ")})`;
}

/** Nine blades: blade i's inner edge is the aperture side whose normal points at rotation + 40°·i. */
export const BLADES = 9;
const HALF = Math.PI / BLADES;

export function bladePolygon(i: number, rotationDeg: number, radius: number, far: number): [number, number][] {
  const a = (rotationDeg * Math.PI) / 180 + (2 * Math.PI * i) / BLADES;
  const n: [number, number] = [Math.cos(a), Math.sin(a)];
  const e: [number, number] = [-n[1], n[0]];
  const half = radius * Math.tan(HALF);
  const start: [number, number] = [radius * n[0] - half * e[0], radius * n[1] - half * e[1]];
  const end: [number, number] = [radius * n[0] + far * e[0], radius * n[1] + far * e[1]];
  const back = a - HALF;
  return [start, end, [end[0] + far * n[0], end[1] + far * n[1]], [start[0] + far * Math.cos(back), start[1] + far * Math.sin(back)]];
}
