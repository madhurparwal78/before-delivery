export const COOKIE_NAME = "pc_session";

export const HUES: readonly number[] = [30, 40, 50, 60, 185, 200, 215, 230, 250, 270, 290, 310];

/** A player's bean hue: H[(id × 5) mod 12]. */
export function hueFor(userId: number): number {
  return HUES[(userId * 5) % 12];
}

export type Presence = "offline" | "online" | "in_party" | "in_match";

export const PRESENCE_TEXT: Record<Presence, string> = {
  offline: "Offline",
  online: "Online",
  in_party: "In a party",
  in_match: "In a match",
};

export type UserPublic = { id: number; handle: string; hue: number };

export type Me = UserPublic & { email: string; emailVerified: boolean };

export type PartyState = "idle" | "queued" | "in_lobby" | "in_match";

export type Party = {
  id: number;
  state: PartyState;
  leaderId: number;
  members: { user: UserPublic; joinedAt: string }[];
  lobbyId: number | null;
  matchId: number | null;
  queuedAt: string | null;
};

export type RoundKind = "race" | "survival" | "final";

export type BeanState = "alive" | "falling" | "respawning" | "qualified" | "eliminated";

export const TICKS_PER_SECOND = 20;

export const ROUND_TABLE: {
  n: number;
  kind: RoundKind;
  name: string;
  label: string;
  timeLimitSeconds: number;
}[] = [
  { n: 1, kind: "race", name: "Wobble Dash", label: "Race", timeLimitSeconds: 60 },
  { n: 2, kind: "survival", name: "Sweeper Spin", label: "Survival", timeLimitSeconds: 45 },
  { n: 3, kind: "final", name: "Crown Climb", label: "Final", timeLimitSeconds: 60 },
];

export function roundDef(n: number): {
  n: number;
  kind: RoundKind;
  name: string;
  label: string;
  timeLimitSeconds: number;
} {
  const found = ROUND_TABLE.find((r) => r.n === n);
  if (!found) throw new Error(`unknown round ${n}`);
  return found;
}

export function slotsFor(kind: RoundKind, starters: number): number {
  if (kind === "survival") return Math.ceil(0.5 * starters);
  if (kind === "final") return 1;
  return Math.ceil(0.6 * starters);
}

export function slotsLabel(kind: RoundKind): string {
  return kind === "survival" ? "Falls to go" : "Slots left";
}

export function roundName(n: number): string {
  return roundDef(n).name;
}

/** Positions leave the simulation rounded to three decimals, halves away from zero. */
export function round3(value: number): number {
  const scaled = value * 1000;
  const floor = Math.floor(Math.abs(scaled) + 0.5);
  return scaled < 0 ? -floor / 1000 : floor / 1000;
}

export function formatPosition(value: number): string {
  return round3(value).toFixed(3);
}

export function formatClock(secondsLeft: number): string {
  const whole = Math.max(0, Math.ceil(secondsLeft));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
