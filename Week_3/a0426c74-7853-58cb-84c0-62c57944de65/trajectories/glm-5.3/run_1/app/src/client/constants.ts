export const PRESENCE_COLOURS = [
  '', // index 0 unused
  '#9fb98a', // sage
  '#d9b06a', // amber
  '#84b6bd', // sky
  '#d98a80', // rose
  '#b28ab5', // violet
  '#b5d08a', // lime
  '#e0a08f', // coral
  '#d9cb9f', // sand
] as const;

export const PANEL_NAMES = ['Entities', 'Layers', 'Properties', 'Parameters', 'Xrefs', 'Versions', 'Issues', 'Markups'] as const;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

export function nearestMultipleOf45(angle: number): number | null {
  let a = angle % 360;
  if (a < 0) a += 360;
  for (let k = 0; k < 8; k++) {
    const target = k * 45;
    if (Math.abs(a - target) <= 5 || Math.abs(a - target - 360) <= 5) return target % 360;
  }
  return null;
}

export function handleOrder(handle: string): number {
  const match = handle.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function normaliseAngle(degrees: number): number {
  let a = degrees % 360;
  if (a < 0) a += 360;
  return a;
}

export function handleNumber(handle: string): number {
  const match = handle.match(/\d+/);
  return match ? Number(match[0]) : 0;
}
