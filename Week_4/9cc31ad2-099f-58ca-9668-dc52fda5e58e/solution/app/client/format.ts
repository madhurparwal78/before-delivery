// Display formats, applied only at the edge: times m:ss.mmm, signed deltas with a true minus,
// coins with thousands separators, speeds from metres per second.

export const MINUS = "−";

export function fmtTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function fmtDelta(ms: number): string {
  if (ms === 0) return "0.000 s";
  const abs = Math.abs(ms);
  return `${ms < 0 ? MINUS : "+"}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")} s`;
}

export function fmtCoins(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtSignedCoins(n: number): string {
  return n === 0 ? "0" : `${n < 0 ? MINUS : "+"}${fmtCoins(Math.abs(n))}`;
}

export type Units = "kmh" | "mph";
const SPEED_FACTOR: Record<Units, number> = { kmh: 3.6, mph: 2.23694 };
export const UNIT_LABEL: Record<Units, string> = { kmh: "km/h", mph: "mph" };

export function speedValue(mps: number, units: Units): number {
  return Math.round(mps * SPEED_FACTOR[units]);
}

export function fmtSpeed(mps: number, units: Units): string {
  return `${speedValue(mps, units)} ${UNIT_LABEL[units]}`;
}

// Time deltas: negative is faster (gain). Coin amounts: positive is a gain.
export function deltaClass(ms: number): string {
  return ms < 0 ? "gain" : ms > 0 ? "loss" : "even";
}

export function coinClass(n: number): string {
  return n > 0 ? "gain" : n < 0 ? "loss" : "even";
}
