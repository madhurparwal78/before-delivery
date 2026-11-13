// Domain rules shared by the server and the browser. Each rule is decided here once.

export type RoundKind = "race" | "survival" | "final";
export type BeanState = "alive" | "falling" | "respawning" | "qualified" | "eliminated";
export type Presence = "offline" | "online" | "in_party" | "in_match";
export type PartyState = "idle" | "queued" | "in_lobby" | "in_match";
export type LobbyState = "filling" | "countdown" | "running" | "finished";
export type RoundState = "pending" | "running" | "resolved";
export type Marker = "last_slot" | "first_out";

export const TICKS_PER_SECOND = 20;
export const LOBBY_SIZE = 12;
export const PARTY_MAX = 4;
export const COUNTDOWN_SECONDS = 10;
export const ROUND_PENDING_SECONDS = 5;
export const INPUT_WINDOW_TICKS = 10;
export const MAX_BUTTONS = 63;
export const MAX_SEED = 4294967295;
export const LINK_LIFETIME_MS = 30 * 60 * 1000;
export const PRESENCE_OFFLINE_MS = 15_000;
export const MESSAGE_MAX = 500;
export const RATE_COUNT = 5;
export const RATE_WINDOW_MS = 5000;
export const HISTORY_SIZE = 50;
export const MATCH_HISTORY_SIZE = 20;

export const BUTTON = { forward: 1, back: 2, left: 4, right: 8, jump: 16, dive: 32 } as const;

interface RoundSpec {
  n: number;
  kind: RoundKind;
  name: string;
  kindLabel: string;
  timeLimitSeconds: number;
}

export const ROUNDS: readonly RoundSpec[] = [
  { n: 1, kind: "race", name: "Wobble Dash", kindLabel: "Race", timeLimitSeconds: 60 },
  { n: 2, kind: "survival", name: "Sweeper Spin", kindLabel: "Survival", timeLimitSeconds: 45 },
  { n: 3, kind: "final", name: "Crown Climb", kindLabel: "Final", timeLimitSeconds: 60 },
];

export function roundSpec(n: number): RoundSpec | undefined {
  return ROUNDS.find((spec) => spec.n === n);
}

export function kindSpec(kind: RoundKind): RoundSpec {
  const spec = ROUNDS.find((candidate) => candidate.kind === kind);
  if (spec === undefined) throw new Error(`unknown round kind ${kind}`);
  return spec;
}

// After a round: the next round's spec, or the match's winner (null when nobody won).
export function afterRound(n: number, qualifiers: readonly number[]): { next: RoundSpec } | { winner: number | null } {
  const next = roundSpec(n + 1);
  if (next === undefined || qualifiers.length <= 1) return { winner: qualifiers.length === 1 ? (qualifiers[0] ?? null) : null };
  return { next };
}

export function timeLimitTicks(kind: RoundKind): number {
  return kindSpec(kind).timeLimitSeconds * TICKS_PER_SECOND;
}

export function slotsFor(kind: RoundKind, starters: number): number {
  if (kind === "race") return Math.ceil((6 * starters) / 10);
  if (kind === "survival") return Math.ceil(starters / 2);
  return 1;
}

export function slotsLabel(kind: RoundKind): string {
  return kind === "survival" ? "Falls to go" : "Slots left";
}

const HUES = [30, 40, 50, 60, 185, 200, 215, 230, 250, 270, 290, 310] as const;

export function hueOf(userId: number): number {
  return HUES[(userId * 5) % 12] ?? HUES[0];
}

// Every bean body, SVG or mesh, is its hue at this saturation and lightness: strong and mid-light.
export const BEAN_BODY = { saturation: 72, lightness: 55 } as const;

export function matchName(id: number): string {
  return `Cup #${id}`;
}

// Positions leave the simulation rounded to three decimals, halves away from zero.
export function round3(value: number): number {
  const rounded = Math.round(Math.abs(value) * 1000) / 1000;
  const signed = value < 0 ? -rounded : rounded;
  return signed === 0 ? 0 : signed;
}

export function formatPosition(value: number): string {
  return value.toFixed(3);
}

export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
