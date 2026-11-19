// The turn window: how long a party occupies its table, and the quarter-hour slots that covers.
import { addMinutes } from "../clock.js";
import { catalog } from "../catalog.js";

export const SLOT_MINUTES = 15;

export interface TurnWindow {
  start: Date;
  end: Date;
}

function turnMinutes(partySize: number): number {
  for (const [range, minutes] of Object.entries(catalog().rules.turn_minutes)) {
    const [low, high] = range.split("-").map(Number);
    if (low !== undefined && high !== undefined && partySize >= low && partySize <= high) return minutes;
  }
  throw new Error(`no turn time is published for a party of ${partySize}`);
}

/** The party's turn time plus the reset, from the start instant. */
export function turnWindow(partySize: number, start: Date): TurnWindow {
  return { start, end: addMinutes(start, turnMinutes(partySize) + catalog().rules.reset_minutes) };
}

/** Every quarter-hour instant from the window's start up to, but not including, its end. */
export function coveredSlots(window: TurnWindow): Date[] {
  const slots: Date[] = [];
  for (let at = window.start; at < window.end; at = addMinutes(at, SLOT_MINUTES)) slots.push(at);
  return slots;
}

/** Windows that only touch do not overlap. */
export function windowsOverlap(a: TurnWindow, b: TurnWindow): boolean {
  return a.start < b.end && b.start < a.end;
}
