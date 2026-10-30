// What a station is doing at one dial minute, as the viewer may see it.
import type { Block, DialStation, FullBlock } from "../../shared/api";
import { DAY_MINUTES, STEP_MINUTES } from "../../shared/kitchen";

export type TileKind = "free" | "booked" | "held" | "cleaning";

export interface StationState {
  kind: TileKind;
  block: Block | null;
  /** Minute the state ends that day, if it does. */
  until: number | null;
}

export const STATE_WORDS: Record<TileKind, string> = {
  free: "Free",
  booked: "Booked",
  held: "Held",
  cleaning: "Cleaning",
};

export function isFullBlock(block: Block | null): block is FullBlock {
  return block !== null && (block.kind === "booking" || block.kind === "hold");
}

export function stationStateAt(station: DialStation, minute: number): StationState {
  const probe = Math.min(minute, DAY_MINUTES - 1);
  const block = station.blocks.find((b) => b.start_minute <= probe && probe < b.end_minute) ?? null;
  if (!block) {
    const next = station.blocks.find((b) => b.start_minute > probe);
    return { kind: "free", block: null, until: next ? next.start_minute : null };
  }
  const kind: TileKind = block.kind === "hold" ? "held" : block.kind === "cleaning" ? "cleaning" : "booked";
  return { kind, block, until: block.end_minute };
}

/** The `<state>` part of the tile's accessible name. */
export function stateName(state: StationState): string {
  if (isFullBlock(state.block)) return `${state.kind === "held" ? "held" : "booked"} by ${state.block.tenant_name}`;
  return state.kind;
}

export function openCount(stations: DialStation[], minute: number): number {
  return stations.filter((s) => stationStateAt(s, minute).kind === "free").length;
}

export function snapStep(minute: number): number {
  return Math.round(minute / STEP_MINUTES) * STEP_MINUTES;
}

export function clampMinute(minute: number): number {
  return Math.min(DAY_MINUTES, Math.max(0, minute));
}

/** "m:ss" for a countdown in milliseconds. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
