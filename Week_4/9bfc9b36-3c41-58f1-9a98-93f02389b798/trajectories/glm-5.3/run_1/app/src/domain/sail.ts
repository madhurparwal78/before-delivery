import { mulHalf } from './int.ts';
import { shoelaceArea, type Pt } from './geometry.ts';

export interface PanelShape {
  number: number;
  outline: Pt[];
  length_mm: number;
  width_mm: number;
  area_mm2: number;
}

export interface RuleFigures {
  seam_overlap_mm: number;
  roach_permille: number;
  tolerance_mm: number;
  min_offcut_width_mm: number;
  min_offcut_length_mm: number;
}

export function roundHalfAway(n: number): number {
  return n >= 0 ? Math.floor(n + 0.5) : Math.ceil(n - 0.5);
}

export function sailArea(kind: 'mainsail' | 'headsail', dims: { P: number; E: number; LL: number; LP: number }, roachPermille: number): number {
  return kind === 'mainsail'
    ? mulHalf(dims.P * dims.E, roachPermille, 2000)
    : mulHalf(dims.LL * dims.LP, 1, 2);
}

export function foretriangleArea(i: number, j: number): number {
  return mulHalf(i * j, 1, 2);
}

/**
 * Crosscut panel construction. The sail is the right triangle tack (0,0), clew (foot,0),
 * head (0,luff); the leech runs from clew to head. Panels are perpendicular to the leech.
 * Vertices are built in leech coordinates (s along the leech from the clew, v toward the tack)
 * and mapped to the panel frame as x = round(v), y = round(s - a), rounding half away from zero.
 */
export function crosscutPanels(luff: number, foot: number, usableWidth: number, seamOverlap: number, firstNumber = 1): PanelShape[] {
  const leech = Math.sqrt(foot * foot + luff * luff);
  const w = usableWidth - seamOverlap;
  if (leech <= 0 || w <= 0) return [];
  const sT = (foot * foot) / leech;
  const vT = (foot * luff) / leech;
  const depth = (s: number): number => (s <= sT ? (luff * s) / foot : (foot * (leech - s)) / luff);
  const count = Math.ceil(leech / w);
  const panels: PanelShape[] = [];
  for (let k = 1; k <= count; k++) {
    const a = (k - 1) * w;
    const b = Math.min(k * w, leech);
    const leechVertices: [number, number][] = [
      [a, 0],
      [b, 0],
      [b, depth(b)],
    ];
    if (a < sT && sT < b) leechVertices.push([sT, vT]);
    leechVertices.push([a, depth(a)]);
    const outline: [number, number][] = [];
    for (const [s, v] of leechVertices) {
      const point: [number, number] = [roundHalfAway(v), roundHalfAway(s - a)];
      const prev = outline[outline.length - 1];
      if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
      outline.push(point);
    }
    if (outline.length > 1) {
      const first = outline[0]!;
      const last = outline[outline.length - 1]!;
      if (first[0] === last[0] && first[1] === last[1]) outline.pop();
    }
    const length_mm = Math.max(...outline.map((p) => p[0]!));
    const width_mm = Math.max(...outline.map((p) => p[1]!));
    const { num, den } = shoelaceArea(outline);
    const area_mm2 = mulHalf(num, 1, den);
    panels.push({ number: firstNumber + k - 1, outline, length_mm, width_mm, area_mm2 });
  }
  return panels;
}
