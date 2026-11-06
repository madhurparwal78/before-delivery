// Display formats (brief: Visual design): whole lux and lengths carry no separator; lux-hour
// figures carry comma thousands separators.
import type { PlacementStatus } from "./types";

export function luxText(lux: number): string {
  return `${Math.round(lux)} lux`;
}

export function luxHours(value: number): string {
  return value.toLocaleString("en-GB");
}

export function statusText(status: PlacementStatus | null, holder: string | null): string {
  switch (status) {
    case null:
    case "removed":
      return "Not placed";
    case "proposed":
      return "Proposed";
    case "claimed":
      return `Claimed by ${holder ?? ""}`;
    case "hung":
      return "Hung";
    case "signed_off":
      return "Signed off";
  }
}

export function photoCount(n: number): string {
  if (n === 0) return "No condition photo";
  return n === 1 ? "1 condition photo" : `${n} condition photos`;
}

export function poundsText(value: number): string {
  return `£${value.toLocaleString("en-GB")}`;
}

/** H:MM:SS from whole seconds. */
export function countdownText(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
