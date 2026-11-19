import { roundHalfAway, squareFeet, squareMetres } from '../shared/units';
import { ceilSquareRootOver, roundSurd } from './surd';

/**
 * The one place that builds crosscut panels, perpendicular to the leech, at the
 * cloth's usable width less the pinned seam overlap.
 */

export type Point = readonly [number, number];

export interface PanelGeometry {
  readonly number: number;
  readonly outline: readonly Point[];
  readonly length_mm: number;
  readonly width_mm: number;
  readonly area_mm2: number;
}

/** The absolute shoelace area of a closed outline, halved, half away from zero. */
export function outlineArea(outline: readonly Point[]): number {
  let twice = 0n;
  for (let i = 0; i < outline.length; i += 1) {
    const here = outline[i] as Point;
    const next = outline[(i + 1) % outline.length] as Point;
    twice += BigInt(here[0]) * BigInt(next[1]) - BigInt(next[0]) * BigInt(here[1]);
  }
  const absolute = twice < 0n ? -twice : twice;
  return roundHalfAway(absolute, 2n);
}

function dropRepeats(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const previous = kept[kept.length - 1];
    if (previous && previous[0] === point[0] && previous[1] === point[1]) continue;
    kept.push(point);
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (kept.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) kept.pop();
  return kept;
}

/**
 * Builds every panel of a sail laid out as the right triangle with tack (0,0),
 * clew (foot,0) and head (0,luff), cut across the leech at spacing w.
 */
export function buildPanels(luffMm: number, footMm: number, spacingMm: number): PanelGeometry[] {
  const luff = BigInt(luffMm);
  const foot = BigInt(footMm);
  const w = BigInt(spacingMm);
  const lambdaSquared = foot * foot + luff * luff; // Λ²
  const count = ceilSquareRootOver(lambdaSquared, w);

  // The tack in leech coordinates: s_T = foot² ÷ Λ, v_T = foot × luff ÷ Λ.
  const tackAlong = (offset: bigint): number => roundSurd(foot * foot, -offset * lambdaSquared, lambdaSquared, lambdaSquared);
  const tackAcross = roundSurd(foot * luff, 0n, lambdaSquared, lambdaSquared);

  // s ≤ s_T  ⟺  s·Λ ≤ foot²  ⟺  s²·Λ² ≤ foot⁴
  const footFourth = foot * foot * foot * foot;
  const beforeTack = (s: bigint): boolean => s * s * lambdaSquared <= footFourth;

  /** The sail's depth h(s), rounded across the panel. */
  const depthAt = (s: bigint): number =>
    beforeTack(s)
      ? roundSurd(0n, luff * s, foot, lambdaSquared) // luff × s ÷ foot, a whole ratio
      : roundSurd(foot, -foot * s, luff, lambdaSquared); // foot × (Λ − s) ÷ luff

  const panels: PanelGeometry[] = [];
  for (let k = 1; k <= count; k += 1) {
    const a = BigInt(k - 1) * w;
    const nominalB = BigInt(k) * w;
    const bIsLeech = nominalB * nominalB >= lambdaSquared;

    // y = round(s − a) for each vertex's distance along the leech.
    const alongA = 0;
    const alongB = bIsLeech ? roundSurd(1n, -a, 1n, lambdaSquared) : Number(nominalB - a);
    const depthB = bIsLeech ? 0 : depthAt(nominalB);
    const depthA = depthAt(a);

    const vertices: Point[] = [
      [0, alongA],
      [0, alongB],
      [depthB, alongB],
    ];
    // The tack vertex belongs to this panel only when a < s_T < b. The leech end
    // is always past the tack, since foot² < foot² + luff² = Λ².
    const tackAfterA = a * a * lambdaSquared < footFourth;
    const tackBeforeB = bIsLeech || footFourth < nominalB * nominalB * lambdaSquared;
    if (tackAfterA && tackBeforeB) {
      vertices.push([tackAcross, tackAlong(a)]);
    }
    vertices.push([depthA, alongA]);

    const outline = dropRepeats(vertices);
    const lengthMm = Math.max(...outline.map((point) => point[0]));
    const widthMm = Math.max(...outline.map((point) => point[1]));
    panels.push({
      number: k,
      outline,
      length_mm: lengthMm,
      width_mm: widthMm,
      area_mm2: outlineArea(outline),
    });
  }
  return panels;
}

export interface PanelView extends PanelGeometry {
  readonly area_m2: string;
  readonly area_ft2: string;
}

export function panelView(panel: PanelGeometry): PanelView {
  return {
    ...panel,
    outline: panel.outline.map((point) => [point[0], point[1]] as Point),
    area_m2: squareMetres(panel.area_mm2),
    area_ft2: squareFeet(panel.area_mm2),
  };
}
