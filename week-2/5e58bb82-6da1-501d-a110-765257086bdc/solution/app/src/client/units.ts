// Display units. The API, the CSV and the report stay in SI; only what is shown changes.
import type { Position, Units } from "./api";

const FT = 0.3048;
const KN = 1852 / 3600;
const FT2 = 0.09290304;

/** Half away from zero, on the shortest decimal form of the value. */
export function round(value: number, places: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const [mantissa, exponent = "0"] = String(Math.abs(value)).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  const keep = whole.length + Number(exponent) + places;
  if (keep < 0) return 0;
  const padded = digits.padEnd(keep + 1, "0");
  let head = BigInt(padded.slice(0, keep) || "0");
  if (Number(padded[keep]) >= 5) head += 1n;
  const result = Number(head) / 10 ** places;
  return value < 0 ? -result : result;
}

const one =(value: number) => round(value, 1).toFixed(1);

export const lengthUnit = (u: Units) => (u === "metric" ? "m" : "ft");
export const speedUnit = (u: Units) => (u === "metric" ? "m/s" : "kn");

export const toLength = (metres: number, u: Units) => (u === "metric" ? metres : metres / FT);
export const fromLength = (value: number, u: Units) => (u === "metric" ? value : value * FT);
export const fromSpeed = (value: number, u: Units) => (u === "metric" ? value : value * KN);

export const length = (metres: number, u: Units) => `${one(toLength(metres, u))} ${lengthUnit(u)}`;
export const speed = (mps: number, u: Units) => `${one(u === "metric" ? mps : mps / KN)} ${speedUnit(u)}`;
export const area = (m2: number, u: Units) => (u === "metric" ? `${round(m2, 0)} m²` : `${round(m2 / FT2, 0)} ft²`);
export const position = (p: Position, u: Units) => `E ${one(toLength(p.easting, u))} N ${one(toLength(p.northing, u))}`;
export const hours = (h: number) => `${one(h)} h`;
export const interval = (h: number) => `${String(round(h, 3))} h`;

/** UTC clock time from a server timestamp; the device clock is never consulted. */
export const hms = (iso: string) => iso.slice(11, 19);
