import { minutesSeconds } from "./clock.ts";
import type { Bay, StripTimer } from "../../shared/wire.ts";

/** The bay move table: the bay each clearance sends a strip to, and the clearance a forward move out of each bay sends. */
export const CLEARED_BAY = {
  PUSH: "Pushback",
  TAXI: "Taxi",
  CONTACT: "Hand-off",
  LINEUP: "Line up",
  TAKEOFF: "Departed",
  LAND: "Landed",
} as const satisfies Record<string, Bay>;

export const FORWARD_VERB: Partial<Record<Bay, keyof typeof CLEARED_BAY>> = {
  Pending: "PUSH",
  Pushback: "TAXI",
  Taxi: "CONTACT",
  Holding: "LINEUP",
  "Line up": "TAKEOFF",
  Arrivals: "LAND",
};

export interface Timers {
  pushSeconds: number;
  lineupSeconds: number;
  takeoffRollSeconds: number;
  landingRollSeconds: number;
  crossSeconds: number;
  handoffOfferSeconds: number;
  arrivalProtectSeconds: number;
  goAroundSeconds: number;
  readbackCorrectSeconds: number;
  readbackErrorEvery: number;
  simSeedOffset: number;
  slotToleranceSeconds: number;
  windChangeDelaySeconds: number;
}

export type Wake = "L" | "M" | "H" | "J";
export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8";
type Severity = "critical" | "warning" | "advisory";

export const RULES: Record<RuleId, { severity: Severity; penalty: number }> = {
  R1: { severity: "critical", penalty: 20 },
  R2: { severity: "warning", penalty: 15 },
  R3: { severity: "warning", penalty: 15 },
  R4: { severity: "warning", penalty: 10 },
  R5: { severity: "critical", penalty: 30 },
  R6: { severity: "advisory", penalty: 5 },
  R7: { severity: "advisory", penalty: 10 },
  R8: { severity: "critical", penalty: 20 },
};

export const alertTexts = {
  R1: (runway: string, occupant: string) => `Runway ${runway} occupied by ${occupant}.`,
  R2: (required: number, leader: string, leaderWake: Wake, elapsed: number) =>
    `Wake: ${minutesSeconds(required)} required behind ${leader} (${leaderWake}), ${minutesSeconds(elapsed)} elapsed.`,
  R3: (arrival: string, due: number) => `Arrival ${arrival} due in ${minutesSeconds(due)}; departure not allowed.`,
  R4: (place: string, earlier: string, later: string) => `Taxi conflict on ${place}: ${earlier} and ${later}.`,
  R5: (point: string, callsign: string) => `Runway incursion at ${point} by ${callsign}.`,
  R6Late: (callsign: string, point: string) => `Late handoff: ${callsign} reached ${point} on Ground.`,
  R6Offer: (callsign: string) => `Handoff not accepted: ${callsign}.`,
  R7: (callsign: string) => `Readback error not corrected: ${callsign}.`,
  R8: (runway: string) => `Runway ${runway} is closed.`,
};

/** Wake minimum in seconds, leader by follower. Exactly the minimum is allowed. */
const WAKE_MINIMUM: Record<Wake, Record<Wake, number>> = {
  J: { L: 180, M: 180, H: 120, J: 120 },
  H: { L: 120, M: 120, H: 90, J: 90 },
  M: { L: 90, M: 60, H: 60, J: 60 },
  L: { L: 60, M: 60, H: 60, J: 60 },
};

export const wakeMinimum = (leader: Wake, follower: Wake): number => WAKE_MINIMUM[leader][follower];

const NEAR_OFFER = 15;
const NEAR_WAKE = 15;
const NEAR_DUE = 120;
const NEAR_SLOT = 60;

export const offerTimer = (left: number): StripTimer => ({
  kind: "offer",
  text: `Offer ${minutesSeconds(left)}`,
  near: left <= NEAR_OFFER,
});

export const wakeTimer = (left: number): StripTimer => ({
  kind: "wake",
  text: `Wake ${minutesSeconds(left)}`,
  near: left <= NEAR_WAKE,
});

export const dueTimer = (left: number): StripTimer => ({
  kind: "due",
  text: `Due ${minutesSeconds(left)}`,
  near: left <= NEAR_DUE,
});

/** `left` is negative once the end of the slot tolerance has passed. */
export const slotTimer = (left: number): StripTimer => ({
  kind: "slot",
  text: left >= 0 ? `Slot ${minutesSeconds(left)}` : `Slot late ${minutesSeconds(-left)}`,
  near: left <= NEAR_SLOT,
});

const PASS_MARK = 75;

/** The score: 100 less every penalty, floored at 0. */
export const scoreOf = (penalties: number[]): number => Math.max(0, 100 - penalties.reduce((sum, penalty) => sum + penalty, 0));

export const isPassed = (score: number): boolean => score >= PASS_MARK;

/** Slot delay in minutes: each full minute waited beyond the end of the slot tolerance costs one point. */
export function slotDelayMinutes(takeoffStart: number, slotTime: number, tolerance: number): number {
  return Math.max(0, Math.floor((takeoffStart - (slotTime + tolerance)) / 60));
}

export const slotDelayText = (callsign: string, minutes: number): string => `Slot delay ${callsign}: ${minutes} min`;

/** The fault in a wind setting, or null: direction 0 to 360 degrees, speed 0 to 200 knots, whole numbers. */
export function windFault(dir: unknown, kt: unknown): string | null {
  if (typeof dir !== "number" || !Number.isInteger(dir) || dir < 0 || dir > 360) return "Wind direction must be a whole number from 0 to 360.";
  if (typeof kt !== "number" || !Number.isInteger(kt) || kt < 0 || kt > 200) return "Wind speed must be a whole number from 0 to 200.";
  return null;
}

export type Speed = 1 | 2 | 4;

/** A sim speed, or null when the value is not 1, 2 or 4. */
export const readSpeed = (value: unknown): Speed | null => (value === 1 || value === 2 || value === 4 ? value : null);
