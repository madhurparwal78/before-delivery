import { crosscutPanels, type PanelShape } from './sail.ts';
import { outlinesOverlap } from './geometry.ts';
import type { Pt } from './geometry.ts';

export function placedOutline(panel: PanelShape, x: number, y: number, rotation: 0 | 180): Pt[] {
  const { outline, length_mm, width_mm } = panel;
  if (rotation === 0) return outline.map((p) => [p[0]! + x, p[1]! + y] as [number, number]);
  return outline.map((p) => [length_mm - p[0]! + x, width_mm - p[1]! + y] as [number, number]);
}

export function firstFit(
  panel: PanelShape,
  claimLength: number,
  usableWidth: number,
  laidOutlines: readonly Pt[][],
): { x: number; y: 0; rotation: 0 | 180 } | null {
  let best: { x: number; rotation: 0 | 180 } | null = null;
  for (const rotation of [0 as const, 180 as const]) {
    const probeXs = candidateXs(panel, rotation, claimLength, laidOutlines);
    for (const x of probeXs) {
      const outline = placedOutline(panel, x, 0, rotation);
      if (outline.some((p) => p[0]! < 0 || p[0]! > claimLength || p[1]! < 0 || p[1]! > usableWidth)) continue;
      if (laidOutlines.some((o) => outlinesOverlap(outline, o))) continue;
      if (best === null || x < best.x) best = { x, rotation };
      break;
    }
  }
  return best ? { x: best.x, y: 0, rotation: best.rotation } : null;
}

/**
 * Critical x values where overlap or containment can begin: vertex-vertex alignments and
 * vertex-to-edge-line contacts, both directions, ceiled to whole mm, plus 0.
 */
function candidateXs(panel: PanelShape, rotation: 0 | 180, claimLength: number, laidOutlines: readonly Pt[][]): number[] {
  const turned = placedOutline(panel, 0, 0, rotation);
  const values = new Set<number>([0]);
  for (const laid of laidOutlines) {
    const n = laid.length;
    for (let i = 0; i < n; i++) {
      const p = laid[i]!;
      const q = laid[(i + 1) % n]!;
      for (const t of turned) {
        values.add(p[0]! - t[0]!);
        addVertexEdge(values, p, q, t);
      }
      addEdgeVertex(values, turned, p);
    }
  }
  return [...values].filter((x) => x >= 0 && x <= claimLength).sort((a, b) => a - b);
}

/** Turned vertex t placed at (x,0) lies on the line through laid edge (p,q). */
function addVertexEdge(values: Set<number>, p: Pt, q: Pt, t: Pt): void {
  const dx = q[0]! - p[0]!;
  const dy = q[1]! - p[1]!;
  if (dy === 0) return;
  const x0 = (p[0]! - t[0]!) + ((p[1]! - t[1]!) * dx) / dy;
  addRational(values, x0);
}

/** Laid vertex p lies on the line through a turned edge. */
function addEdgeVertex(values: Set<number>, turned: readonly Pt[], p: Pt): void {
  const n = turned.length;
  for (let i = 0; i < n; i++) {
    const s = turned[i]!;
    const s2 = turned[(i + 1) % n]!;
    const dx = s2[0]! - s[0]!;
    const dy = s2[1]! - s[1]!;
    if (dy === 0) continue;
    const x0 = (p[0]! - s[0]!) + ((p[1]! - s[1]!) * dx) / dy;
    addRational(values, x0);
  }
}

function addRational(values: Set<number>, x0: number): void {
  if (Number.isInteger(x0)) {
    values.add(x0);
  } else {
    values.add(Math.ceil(x0));
    values.add(Math.floor(x0));
  }
}

export function panelByNumber(panels: readonly PanelShape[], number: number): PanelShape | undefined {
  return panels.find((p) => p.number === number);
}

export { crosscutPanels };
export type { PanelShape };

/**
 * Lay every panel in order at its automatic position, as the seed does for imported drawings.
 * Panels that fit nowhere are skipped, and the caller records the used length.
 */
export function firstFitSequence(panels: readonly PanelShape[], claimLength: number, usableWidth: number): { panel_number: number; x: number; y: number; rotation: 0 | 180 }[] {
  const laid: Pt[][] = [];
  const lays: { panel_number: number; x: number; y: number; rotation: 0 | 180 }[] = [];
  for (const panel of panels) {
    const fit = firstFit(panel, claimLength, usableWidth, laid);
    if (!fit) continue;
    lays.push({ panel_number: panel.number, x: fit.x, y: fit.y, rotation: fit.rotation });
    laid.push(placedOutline(panel, fit.x, fit.y, fit.rotation));
  }
  return lays;
}
