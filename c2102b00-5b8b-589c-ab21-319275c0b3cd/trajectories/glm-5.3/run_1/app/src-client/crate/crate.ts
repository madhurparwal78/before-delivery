import { Line, CellValue } from "../api.js";

export type CrateCause =
  | "first"
  | "font"
  | "line"
  | "turn"
  | "size"
  | "shown"
  | "context-restored"
  | "sequence";

export interface CrateSpec {
  caseKey: string;
  line: Line;
  turn: number;
  blockBg: "kraft" | "green";
  columns: number;
  /** Cell indexes whose units sit raised by a fraction (0 = in place). */
  raised: Map<number, number>;
  /** Lid angle in degrees, 0 = shut, 100 = fully open. */
  lidAngle: number;
  /** Stamp scale, 1 = pressed on. 0 = no stamp. */
  stampScale: number;
}

export const BG_COLORS = { kraft: "#E5D8BE", green: "#2A4E31" } as const;

export const TOP_COLORS = {
  mine: "#B5541A",
  taken: "#26211A",
  dropped: "#6B5C48",
} as const;

export const INK = "#26211A";
export const KRAFT_LIGHT = "#F1E7D2";
export const INSIDE_TONE = "#EFE5CD";
export const BOX_FACE = "#D8C7A0";
export const BOX_FACE_DARK = "#C9B58C";
export const GLASS = "#CFCBBB";
export const PAPER = "#DCCDA9";

/** Grid columns for a pack: smallest divisor at least the square root. */
export function gridColumns(pack: number): number {
  for (let c = Math.ceil(Math.sqrt(pack)); c <= pack; c++) {
    if (pack % c === 0) return c;
  }
  return pack;
}

export function crateName(line: Line): string {
  const state = line.status === "filling" ? "filling" : line.status === "sealed" ? "sealed" : line.status === "taken_up" ? "taken up" : "dropped";
  return `Crate of ${line.case_name}: ${line.pledged_units} of ${line.pack} units pledged, ${state}`;
}

/** The single place that decides whether a line may be drawn. */
export function lineIsNewer(shown: number | null, candidate: number): boolean {
  return shown === null || candidate > shown;
}
