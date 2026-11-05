// The crate's whole picture is derived from a line in this one place: which slots hold a unit and
// in which top colour, the lid, the stamp and the crate's name. Both renderers (WebGL and the still
// drawing) read a CrateView and nothing else about the line.
import { gridColumns, type Line } from "../line.js";

export type Tone = "mine" | "taken" | "dropped";
export type StampKind = "sealed" | "taken_up" | "dropped";
export type UnitKind = "jar" | "bottle" | "jug" | "lb";

export interface CrateView {
  /** `Crate of <case>: <filled> of <pack> units pledged, <state>` */
  name: string;
  cols: number;
  rows: number;
  unit: UnitKind;
  /** One entry per slot in reading order: the unit's top colour, or null for an empty slot. */
  slots: (Tone | null)[];
  /** The lid is shut and carries this stamp, or (dropped) the front face carries it. */
  lidShut: boolean;
  stamp: StampKind | null;
}

const STATE_WORD: Record<Line["status"], string> = { filling: "filling", sealed: "sealed", taken_up: "taken up", dropped: "dropped" };

export function crateView(line: Line): CrateView {
  const cols = gridColumns(line.pack);
  const dropped = line.status === "dropped";
  const shut = line.status === "sealed" || line.status === "taken_up";
  return {
    name: `Crate of ${line.case_name}: ${line.pledged_units} of ${line.pack} units pledged, ${STATE_WORD[line.status]}`,
    cols,
    rows: line.pack / cols,
    unit: line.unit as UnitKind,
    slots: line.cells.map((c) => (c === "empty" ? null : dropped ? "dropped" : c)),
    lidShut: shut,
    stamp: shut ? (line.status as StampKind) : dropped ? "dropped" : null,
  };
}

/** Unit top colours are the colours of the grid's cells on kraft, read from the stylesheet. */
export function palette(): Record<Tone, string> {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return { mine: token("--signal"), taken: token("--ink"), dropped: token("--muted") };
}

// ---- Geometry shared by both renderers (world units; x right, y up, z towards the viewer) -------

export const BOX = { w: 3.6, d: 2.7, h: 0.95 };
/** The slots tile this inset area of the floor. */
const FLOOR = { w: 3.3, d: 2.0 };
/** The slots sit this far towards the back wall, so the front row clears the front rim. */
const SLOT_SHIFT = -0.22;
/** How far above its slot a unit starts (or ends) its drop. */
export const DROP_HEIGHT = 0.9;
/** The lid stands this far from shut (degrees) when it is open. */
export const LID_OPEN_DEG = 40;

interface SlotSpot {
  x: number;
  z: number;
}

/** The first slot is back-left, the row runs left to right and later rows come towards the viewer. */
export function slotSpot(index: number, cols: number, rows: number): SlotSpot {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: -FLOOR.w / 2 + ((col + 0.5) * FLOOR.w) / cols, z: SLOT_SHIFT - FLOOR.d / 2 + ((row + 0.5) * FLOOR.d) / rows };
}

/** The unit's footprint radius, from the tighter of the slot's two pitches. */
export function unitRadius(cols: number, rows: number): number {
  return Math.min(0.36, 0.38 * Math.min(FLOOR.w / cols, FLOOR.d / rows));
}

type Part =
  | { shape: "cyl"; r: number; y0: number; y1: number; body: string; dx?: number }
  | { shape: "box"; w: number; d: number; y0: number; y1: number; body: string };

interface UnitShape {
  parts: Part[];
  /** The flat unshaded top: a disc or a square of this half-size, at this height. */
  top: { shape: "disc" | "square"; r: number; y: number };
}

const GLASS = "#b9c9c4";
const GLASS_DARK = "#8fa39d";
const PAPER = "#d9cfb6";
const SACK = "#bfa77a";
const LID_BAND = "#7d786c";

/** Body forms follow the line's unit; bodies are neutral glass, paper and kraft tones. */
export function unitShape(unit: UnitKind, r: number): UnitShape {
  switch (unit) {
    case "jar":
      return {
        parts: [
          { shape: "cyl", r, y0: 0, y1: 1.1 * r, body: GLASS },
          { shape: "cyl", r: 0.9 * r, y0: 1.1 * r, y1: 1.4 * r, body: LID_BAND },
        ],
        top: { shape: "disc", r: 0.74 * r, y: 1.4 * r + 0.012 },
      };
    case "bottle":
      return {
        parts: [
          { shape: "cyl", r: 0.78 * r, y0: 0, y1: 1.5 * r, body: GLASS_DARK },
          { shape: "cyl", r: 0.42 * r, y0: 1.5 * r, y1: 2.2 * r, body: GLASS_DARK },
          { shape: "cyl", r: 0.5 * r, y0: 2.2 * r, y1: 2.5 * r, body: LID_BAND },
        ],
        top: { shape: "disc", r: 0.46 * r, y: 2.5 * r + 0.012 },
      };
    case "jug":
      return {
        parts: [
          { shape: "cyl", r: 0.92 * r, y0: 0, y1: 1.5 * r, body: PAPER },
          { shape: "cyl", r: 0.46 * r, y0: 1.5 * r, y1: 1.95 * r, body: PAPER },
          { shape: "cyl", r: 0.2 * r, y0: 0.5 * r, y1: 1.7 * r, body: LID_BAND, dx: 1.02 * r },
        ],
        top: { shape: "disc", r: 0.44 * r, y: 1.95 * r + 0.012 },
      };
    case "lb":
      return {
        parts: [{ shape: "box", w: 1.7 * r, d: 1.25 * r, y0: 0, y1: 1.7 * r, body: SACK }],
        top: { shape: "square", r: 0.62 * r, y: 1.7 * r + 0.012 },
      };
  }
}
