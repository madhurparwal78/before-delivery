/** Domain constants and limits, shared by the server and the browser. */

import type { FamilySlug, FinishCode, LightState } from "./types.js";

export const FINISHES: ReadonlyArray<{ code: FinishCode; name: string }> = [
  { code: "WH", name: "Matte White" },
  { code: "BK", name: "Matte Black" },
  { code: "BR", name: "Brushed Brass" },
  { code: "BZ", name: "Aged Bronze" },
  { code: "CH", name: "Charcoal" },
  { code: "SN", name: "Satin Nickel" },
];

export const FINISH_NAME: Record<FinishCode, string> = Object.fromEntries(
  FINISHES.map((f) => [f.code, f.name]),
) as Record<FinishCode, string>;

export const PRODUCT_FAMILIES: ReadonlyArray<Exclude<FamilySlug, "clearance">> = [
  "downlights",
  "track-spots",
  "pendants",
  "surface",
];

export const ALL_FAMILY_SLUGS: readonly FamilySlug[] = [...PRODUCT_FAMILIES, "clearance"];

/** The beam angles and colour temperatures the filter groups offer. */
export const FILTER_BEAMS: readonly number[] = [15, 24, 36, 60];
export const FILTER_CCTS: readonly number[] = [2700, 3000, 4000];

export const LIMITS = {
  ceilingHeightMm: { min: 2400, max: 4000, default: 2700 },
  roomWidthMm: { min: 2000, max: 20000, default: 6000 },
  roomDepthMm: { min: 2000, max: 20000, default: 4500 },
  quantity: { min: 1, max: 999 },
  commentBody: { min: 1, max: 2000 },
  shareRecipients: { min: 1, max: 10 },
  shareMessage: { max: 1000 },
  purchaseOrder: { max: 40 },
  refundReason: { min: 1, max: 200 },
  declineReason: { min: 1, max: 500 },
  password: { min: 10 },
  idempotencyKey: { min: 1, max: 100 },
  compareCodes: { min: 1, max: 4 },
  jsonBodyBytes: 100_000,
  coverImageBytes: 5_000_000,
  stockBadgeThreshold: 5,
  nudgeMm: 100,
  shiftNudgeMm: 500,
} as const;

/** Placements and keyboard nudges snap to this grid. */
export const PLACEMENT_GRID_MM = 100;

export const CEILING_SLIDER_STEP_MM = 100;

/** Auto lighting bands, read from the viewer's local hour. */
export function lightStateForHour(hour: number): LightState {
  if (hour >= 5 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 16) return "day";
  if (hour >= 17 && hour <= 20) return "evening";
  return "night";
}

/** Rounds a millimetre figure to the placement grid, halves up. */
export function snapToGrid(valueMm: number): number {
  return Math.round(valueMm / PLACEMENT_GRID_MM) * PLACEMENT_GRID_MM;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const ORDER_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ORDER_KEY_LENGTH = 8;

/** The published test card that the bank always declines. */
export const DECLINE_TEST_CARD = "4000000000000002";

export function normaliseCardNumber(raw: string): string {
  return raw.replace(/\s+/g, "");
}

export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isValidNzbn(value: string): boolean {
  return /^94\d{11}$/.test(value);
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** Loose but practical address check, used by sign-up, shares and the newsletter. */
export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed) && trimmed.length <= 254;
}
