// Hoof angles, alignment, the marks version check and the readout lines (brief: Business rules, Angles,
// Marks versions, Readout lines). Angles are kept as whole tenths of a degree so no float reaches a reader.

export const HOOVES = ["LF", "RF", "LH", "RH"] as const;
export type Hoof = (typeof HOOVES)[number];
export const isHoof = (value: unknown): value is Hoof => typeof value === "string" && (HOOVES as readonly string[]).includes(value);

export type Alignment = "aligned" | "broken-back" | "broken-forward";

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Angle of a line in tenths of a degree: arctan(|Δy| ÷ |Δx|), rounded to 0.1° with halves away from zero. */
export function angleTenths(line: Line): number {
  const degrees = (Math.atan2(Math.abs(line.y2 - line.y1), Math.abs(line.x2 - line.x1)) * 180) / Math.PI;
  const text = String(degrees);
  if (text.includes("e")) return 0;
  const [whole = "0", fraction = ""] = text.split(".");
  const tenths = Number(whole) * 10 + Number(fraction[0] ?? "0");
  return Number(fraction[1] ?? "0") >= 5 ? tenths + 1 : tenths;
}

/** d = hoof wall − pastern: aligned within ±3.0°, broken-back below, broken-forward above. */
export function alignment(wallTenths: number, pasternTenths: number): Alignment {
  const d = wallTenths - pasternTenths;
  if (Math.abs(d) <= 30) return "aligned";
  return d < 0 ? "broken-back" : "broken-forward";
}

/** Both points inside the photo (edges inclusive) and distinct. */
export function lineFits(line: Line, width: number, height: number): boolean {
  const inside = (x: number, y: number) => x >= 0 && x <= width && y >= 0 && y <= height;
  return inside(line.x1, line.y1) && inside(line.x2, line.y2) && (line.x1 !== line.x2 || line.y1 !== line.y2);
}

/** A save must name the stored version, or null when the hoof has no marks. */
export function versionIsCurrent(sent: unknown, stored: number | null): boolean {
  return stored === null ? sent === null || sent === undefined : sent === stored;
}

export const nextVersion = (stored: number | null): number => (stored ?? 0) + 1;

export const degrees = (tenths: number): number => tenths / 10;
const printed = (tenths: number): string => `${(tenths / 10).toFixed(1)}°`;

function signedDifference(tenths: number): string {
  if (tenths === 0) return "±0.0°";
  return `${tenths > 0 ? "+" : "−"}${(Math.abs(tenths) / 10).toFixed(1)}°`;
}

interface MarkedSide {
  wallTenths: number;
  pasternTenths: number;
  alignment: Alignment;
}

/** Signed differences (current − previous) and the three readout lines. */
export function compareSides(previous: MarkedSide, current: MarkedSide): {
  difference: { hoof_wall: number; pastern: number };
  readout: [string, string, string];
} {
  const wall = current.wallTenths - previous.wallTenths;
  const pastern = current.pasternTenths - previous.pasternTenths;
  return {
    difference: { hoof_wall: degrees(wall), pastern: degrees(pastern) },
    readout: [
      `Hoof wall ${printed(previous.wallTenths)} → ${printed(current.wallTenths)} (${signedDifference(wall)})`,
      `Pastern ${printed(previous.pasternTenths)} → ${printed(current.pasternTenths)} (${signedDifference(pastern)})`,
      `Alignment ${previous.alignment} → ${current.alignment}`,
    ],
  };
}
