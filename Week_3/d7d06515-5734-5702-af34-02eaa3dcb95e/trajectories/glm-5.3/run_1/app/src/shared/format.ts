import type { Point, Units, ColourName } from "./types.js";

/** Half away from zero, to n decimals, no thousands separators. */
export function round(value: number, decimals = 6): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
}

export function fmtNumber(value: number, decimals: number): string {
  const rounded = round(value, decimals);
  return rounded.toFixed(decimals);
}

/** Lengths, coordinates and areas per units. Meters: 3 decimals; millimetres: 2. */
export function formatLength(mm: number, units: Units): string {
  if (units === "m") return fmtNumber(mm / 1000, 3);
  return fmtNumber(mm, 2);
}

export function formatArea(mm2: number, units: Units): string {
  if (units === "m") return fmtNumber(mm2 / 1_000_000, 3);
  return fmtNumber(mm2, 2);
}

export function formatAngle(degrees: number): string {
  return `${fmtNumber(normaliseAngle(degrees), 2)}°`;
}

/** Date-times as MMM D, YYYY, h:mm A in the studio time zone. */
export function formatDateTime(epochMs: number, zone: string): string {
  const d = new Date(epochMs);
  const month = d.toLocaleString("en-US", { timeZone: zone, month: "short" });
  const day = d.toLocaleString("en-US", { timeZone: zone, day: "numeric" });
  const year = d.toLocaleString("en-US", { timeZone: zone, year: "numeric" });
  const time = d
    .toLocaleString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();
  return `${month} ${day}, ${year}, ${time}`;
}

export function formatTime(epochMs: number, zone: string): string {
  return new Date(epochMs).toLocaleTimeString("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** File sizes, decimal units, one decimal. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${round(bytes / 1000, 1).toFixed(1)} KB`;
  return `${round(bytes / 1_000_000, 1).toFixed(1)} MB`;
}

export function formatDateKey(epochMs: number, zone: string): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.toLocaleString("en-US", { timeZone: zone, year: "numeric" })}-${pad(
    Number(d.toLocaleString("en-US", { timeZone: zone, month: "numeric" })),
  )}-${pad(Number(d.toLocaleString("en-US", { timeZone: zone, day: "numeric" })))}`;
}

export function formatExpiry(epochMs: number, zone: string): string {
  const d = new Date(epochMs);
  const month = d.toLocaleString("en-US", { timeZone: zone, month: "short" });
  const day = d.toLocaleString("en-US", { timeZone: zone, day: "numeric" });
  const year = d.toLocaleString("en-US", { timeZone: zone, year: "numeric" });
  return `Expires ${month} ${day}, ${year}, 11:59 PM (${zone})`;
}

/** Counts rule: 1 object, otherwise <n> objects, including 0. */
export function objectCount(n: number): string {
  return n === 1 ? `1 object` : `${n} objects`;
}

export function itemCount(n: number): string {
  return n === 1 ? `1 item` : `${n} items`;
}

export function unsupportedCount(n: number): string {
  return n === 1 ? `1 unsupported object` : `${n} unsupported objects`;
}

/** Colours as ACI numbers for DXF, negative when off. */
export const aciColours: Record<ColourName, number> = {
  ByLayer: 256,
  Red: 1,
  Yellow: 2,
  Green: 3,
  Cyan: 4,
  Blue: 5,
  Magenta: 6,
  White: 7,
};

export function parsePointText(text: string): Point | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const match = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
  if (!match) return null;
  return [Number.parseFloat(match[1]), Number.parseFloat(match[2])];
}

export function isFiniteNumberText(text: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(text.trim());
}

export function normaliseAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return round(a, 6);
}

export function polar(from: Point, distance: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return [round(from[0] + distance * Math.cos(rad), 6), round(from[1] + distance * Math.sin(rad), 6)];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function pointEq(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function fmtCoord(value: number, units: Units): string {
  return formatLength(value, units);
}

/** Whole comma-thousands number, e.g. 5,000,000. */
export function fmtThousands(n: number): string {
  return n.toLocaleString("en-US");
}
