// The DESIGN.md palette as Cesium colours.
import { Color } from "@cesium/core";

export const INK = Color.fromCssColorString("#17212F");
export const MUTED = Color.fromCssColorString("#55606E");
export const RULE = Color.fromCssColorString("#9AA5B1");
export const PAPER = Color.fromCssColorString("#F3EEE2");
export const PAPER_SUNK = Color.fromCssColorString("#E9E2D0");
export const FOREST = Color.fromCssColorString("#2E5B3E");
export const VIOLATION = Color.fromCssColorString("#9E4815");
/** The survey grid's ground tone: paper-sunk deepened so the hairline grid reads on it. */
export const GROUND = Color.fromCssColorString("#DCD8C4");

export function statusColour(status: "violation" | "clear"): Color {
  return status === "violation" ? VIOLATION : FOREST;
}
