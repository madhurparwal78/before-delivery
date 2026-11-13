// What a pack is: silhouette, size and the published panel geometry. One source for WebGL, SVG and the published rectangles.
import type { Format, PackFacts } from "../../shared/types";

export type Rect = readonly [number, number, number, number];
export type Point = readonly [number, number];

export const PANEL_GEOMETRY: Record<Format, { mrp: Rect; sticker: Rect }> = {
  carton: { mrp: [0.08, 0.3, 0.4, 0.16], sticker: [0.54, 0.28, 0.38, 0.22] },
  pet: { mrp: [0.1, 0.42, 0.36, 0.14], sticker: [0.52, 0.4, 0.38, 0.2] },
  glass: { mrp: [0.12, 0.48, 0.34, 0.14], sticker: [0.52, 0.46, 0.36, 0.2] },
  can: { mrp: [0.1, 0.36, 0.36, 0.14], sticker: [0.5, 0.34, 0.4, 0.2] },
};
export const FRONT_BOX: Rect = [0.1, 0.18, 0.8, 0.44];
export const STICKER_TILT_DEG = -4;

/** Outline points in face coordinates (u across 0..1, v down 0..1). Every body covers v >= 0.2 across the full width. */
const OUTLINES: Record<Format, Point[]> = {
  carton: [[0, 1], [0, 0.18], [0.1, 0.06], [0.37, 0.06], [0.37, 0], [0.63, 0], [0.63, 0.06], [0.9, 0.06], [1, 0.18], [1, 1]],
  pet: [[0.04, 1], [0, 0.97], [0, 0.2], [0.28, 0.12], [0.35, 0.1], [0.35, 0.05], [0.33, 0.05], [0.33, 0], [0.67, 0], [0.67, 0.05], [0.65, 0.05], [0.65, 0.1], [0.72, 0.12], [1, 0.2], [1, 0.97], [0.96, 1]],
  glass: [[0.05, 1], [0, 0.98], [0, 0.19], [0.38, 0.13], [0.4, 0.12], [0.4, 0.04], [0.38, 0.04], [0.38, 0], [0.62, 0], [0.62, 0.04], [0.6, 0.04], [0.6, 0.12], [0.62, 0.13], [1, 0.19], [1, 0.98], [0.95, 1]],
  can: [[0.06, 1], [0, 0.94], [0, 0.14], [0.06, 0.08], [0.06, 0.02], [0.1, 0], [0.9, 0], [0.94, 0.02], [0.94, 0.08], [1, 0.14], [1, 0.94], [0.94, 1]],
};

/** height / width of the face, and depth / width. */
const PROPORTIONS: Record<Format, { aspect: number; depth: number }> = {
  carton: { aspect: 1.75, depth: 0.62 },
  pet: { aspect: 2.25, depth: 0.55 },
  glass: { aspect: 2.5, depth: 0.5 },
  can: { aspect: 1.95, depth: 0.7 },
};

const WORLD_HEIGHT = 1;
const TEXTURE_WIDTH = 512;

export interface PackSpec {
  format: Format;
  outline: Point[];
  width: number;
  height: number;
  depth: number;
  texW: number;
  texH: number;
  ground: string;
  panelGround: string;
  side: string;
  box: string;
  mark: string;
}

const PINK = "rgb(240,185,189)";
const WHITE = "rgb(255,255,255)";
const CARMINE = "rgb(156,18,32)";
const CHARCOAL = "rgb(42,42,42)";
/** front ground, name box, small print; backs are all charcoal so the sticker is the one pink thing */
const GROUNDS: Record<Format, { front: string; box: string; mark: string }> = {
  carton: { front: PINK, box: CHARCOAL, mark: CARMINE },
  pet: { front: WHITE, box: CARMINE, mark: CARMINE },
  glass: { front: CHARCOAL, box: CARMINE, mark: PINK },
  can: { front: CHARCOAL, box: "rgb(138,16,28)", mark: PINK },
};

export function specFor(format: Format): PackSpec {
  const p = PROPORTIONS[format];
  const width = WORLD_HEIGHT / p.aspect;
  return {
    format,
    outline: OUTLINES[format],
    width,
    height: WORLD_HEIGHT,
    depth: width * p.depth,
    texW: TEXTURE_WIDTH,
    texH: Math.round(TEXTURE_WIDTH * p.aspect),
    ground: GROUNDS[format].front,
    panelGround: CHARCOAL,
    side: "rgb(110,12,22)",
    box: GROUNDS[format].box,
    mark: GROUNDS[format].mark,
  };
}

// ---- the published lines ------------------------------------------------------------------------------------------

import { formatDate, rupees } from "../../shared/copy";

interface PanelLines {
  mrp: string;
  packed: string;
  bestBefore: string;
  unit: string | null;
  revised: string | null;
  oldWrapper: boolean;
}

export function panelLines(facts: PackFacts): PanelLines {
  return {
    mrp: `MRP Rs ${rupees(facts.printedMrpPaise)}`,
    packed: `Packed ${formatDate(facts.packedDate)}`,
    bestBefore: `Best before ${formatDate(facts.bestBeforeDate)}`,
    unit: facts.unitSalePrice ? `Rs ${facts.unitSalePrice.rupees} per ${facts.unitSalePrice.per}` : null,
    revised: facts.revisedMrpPaise === null ? null : `Revised MRP Rs ${rupees(facts.revisedMrpPaise)}`,
    oldWrapper: facts.oldWrapper,
  };
}

/** Every line drawn on the panel and sticker, joined by ` | ` (data-panel-text). */
export function panelText(facts: PackFacts): string {
  const l = panelLines(facts);
  return [l.mrp, l.packed, l.bestBefore, l.unit, l.revised, l.oldWrapper ? "Old wrapper" : null]
    .filter((x): x is string => x !== null)
    .join(" | ");
}

export const rectStr = (r: Rect): string => r.map((v) => +v.toFixed(3)).join(",");
