import { decFromInt, decRound, decToString, decDiv, decMul, sqcmToSqft } from "./decimal.js";
import { apiMessages } from "./copy.js";

export type Placement = { name: PatternName; x: number; y: number; rotation: Rotation; state: "tray" | "placed" };
export type PatternName = "Seat" | "Back" | "Left side" | "Right side" | "Headrest";
export type Rotation = 0 | 90 | 180 | 270;

export const HIDE_WIDTH_CM = 200;
export const HIDE_HEIGHT_CM = 240;
export const HIDE_AREA_SQFT = "51.67";
export const FLAWS = [
  { x: 120, y: 80, width: 30, height: 20 },
  { x: 20, y: 200, width: 16, height: 12 },
];

export const PATTERN_ORDER: PatternName[] = ["Seat", "Back", "Left side", "Right side", "Headrest"];
export const PATTERN_BOX: Record<PatternName, { width: number; height: number }> = {
  Seat: { width: 62, height: 58 },
  Back: { width: 62, height: 74 },
  "Left side": { width: 30, height: 74 },
  "Right side": { width: 30, height: 74 },
  Headrest: { width: 40, height: 22 },
};
const GRAIN_BOUND: Record<PatternName, boolean> = { Seat: true, Back: true, "Left side": true, "Right side": true, Headrest: false };

export const isPatternName = (v: string): v is PatternName => (PATTERN_ORDER as string[]).includes(v);

/** The effective box of a piece at a rotation. */
export function boxAt(name: PatternName, rotation: Rotation): { width: number; height: number } {
  const box = PATTERN_BOX[name]!;
  if (rotation === 90 || rotation === 270) return { width: box.height, height: box.width };
  return box;
}
export const allowedRotations = (name: PatternName): Rotation[] =>
  GRAIN_BOUND[name] ? [0, 180] : [0, 90, 180, 270];

export type PlaceRefusal =
  | { kind: "offHide" }
  | { kind: "flaw"; flaw: { x: number; y: number } }
  | { kind: "overlap"; other: PatternName };

export type PlaceCheck = { ok: true } | { ok: false; refusal: PlaceRefusal };

/** Decide one placement: off the hide, then flaw, then overlap. Touching edges allowed. */
export function checkPlacement(name: PatternName, x: number, y: number, rotation: Rotation, others: { name: PatternName; x: number; y: number; rotation: Rotation }[]): PlaceCheck {
  const box = boxAt(name, rotation);
  if (x < 0 || y < 0 || x + box.width > HIDE_WIDTH_CM || y + box.height > HIDE_HEIGHT_CM) {
    return { ok: false, refusal: { kind: "offHide" } };
  }
  for (const flaw of FLAWS) {
    const crosses = x < flaw.x + flaw.width && x + box.width > flaw.x && y < flaw.y + flaw.height && y + box.height > flaw.y;
    if (crosses) return { ok: false, refusal: { kind: "flaw", flaw: { x: flaw.x, y: flaw.y } } };
  }
  for (const other of others) {
    if (other.name === name) continue;
    const obox = boxAt(other.name, other.rotation);
    const overlaps = x < other.x + obox.width && x + box.width > other.x && y < other.y + obox.height && y + box.height > other.y;
    if (overlaps) return { ok: false, refusal: { kind: "overlap", other: other.name } };
  }
  return { ok: true };
}

export type PlacementOutcome =
  | { ok: true }
  | { ok: false; code: "F-47" | "F-48" | "F-49" | "F-50" | "F-08" | "F-112"; message: string };

/** Validate rotation then placement for the API. */
export function decidePlacement(
  name: PatternName,
  raw: { x: unknown; y: unknown; rotation: unknown },
  others: { name: PatternName; x: number; y: number; rotation: Rotation }[]
): PlacementOutcome {
  const rotationRaw = raw.rotation;
  if (rotationRaw === null || rotationRaw === undefined) {
    return { ok: false, code: "F-112", message: apiMessages.notANumber };
  }
  if (typeof rotationRaw !== "number" || !Number.isInteger(rotationRaw)) {
    return { ok: false, code: "F-112", message: apiMessages.notANumber };
  }
  if (![0, 90, 180, 270].includes(rotationRaw)) {
    return { ok: false, code: "F-08", message: apiMessages.numberRange };
  }
  const rotation = rotationRaw as Rotation;
  if (!allowedRotations(name).includes(rotation)) {
    return { ok: false, code: "F-50", message: apiMessages.grainBound.replace("<part>", name) };
  }
  for (const key of ["x", "y"] as const) {
    const v = raw[key];
    if (v === null || v === undefined || typeof v === "boolean") {
      return { ok: false, code: "F-112", message: apiMessages.notANumber };
    }
    if (typeof v === "string") {
      if (!/^-?\d+$/.test(v)) return { ok: false, code: "F-112", message: apiMessages.notANumber };
    } else if (typeof v !== "number") {
      return { ok: false, code: "F-112", message: apiMessages.notANumber };
    }
  }
  const x = typeof raw.x === "number" ? raw.x : Number(raw.x as string);
  const y = typeof raw.y === "number" ? raw.y : Number(raw.y as string);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, code: "F-08", message: apiMessages.numberRange };
  if (x < 0 || y < 0) return { ok: false, code: "F-47", message: apiMessages.offHideMsg(name) };
  const check = checkPlacement(name, x, y, rotation, others);
  if (check.ok) return { ok: true };
  if (check.refusal.kind === "offHide") return { ok: false, code: "F-47", message: apiMessages.offHideMsg(name) };
  if (check.refusal.kind === "flaw") {
    return { ok: false, code: "F-48", message: apiMessages.flawMsg(name, check.refusal.flaw.x, check.refusal.flaw.y) };
  }
  return { ok: false, code: "F-49", message: apiMessages.overlapMsg(name, check.refusal.other) };
}

/** The used-leather figure: placed pieces' area, half up, two decimals sq ft and one percent. */
export function usedFigure(placed: { name: PatternName; rotation: Rotation }[]): { usedSqFt: string; usedPercent: string } {
  const sqcm = placed.reduce((sum, p) => sum + PATTERN_BOX[p.name]!.width * PATTERN_BOX[p.name]!.height, 0);
  const sqft = decRound(sqcmToSqft(sqcm), 2);
  const percentBasis = decDiv(decFromInt(sqcm), decFromInt(48000));
  const percent = decRound(decMul(percentBasis, decFromInt(100)), 1);
  return { usedSqFt: decToString(sqft, 2), usedPercent: decToString(percent, 1) };
}
