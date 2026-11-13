// Which state changes a draw may take on its way to released, and when a visit page has ended.

import type { DrawState } from "../shared/api";
import { conflict, type ApiError } from "./errors";

interface DrawFacts {
  state: DrawState;
  kit_codes: readonly string[];
}

export const notBooked = (): ApiError => conflict("not_booked", "Only a booked draw can change.");
export const alreadyCollected = (): ApiError => conflict("already_collected", "This draw is already collected.");
export const notReady = (): ApiError => conflict("not_ready", "Results can be released once the report is stored.");

export function requireBooked(draw: DrawFacts): void {
  if (draw.state !== "booked") throw notBooked();
}

export function requireNotCollected(draw: DrawFacts): void {
  if (draw.state !== "booked") throw alreadyCollected();
}

export function requireCollectable(draw: DrawFacts, drawDay: boolean): void {
  requireNotCollected(draw);
  if (!drawDay) throw conflict("not_draw_day", "You can mark this draw collected on the visit day.");
  if (draw.kit_codes.length === 0) throw conflict("kit_code_required", "Enter at least one kit code before marking collected.");
}

export function requireCollectedOrReady(draw: DrawFacts): void {
  if (draw.state !== "collected" && draw.state !== "ready") {
    throw conflict("not_collected", "Results can be brought in for a collected draw.");
  }
}

export function requireReady(draw: DrawFacts): void {
  if (draw.state !== "ready") throw notReady();
}

export function visitPageHasEnded(endedAt: Date | null, endsAt: Date, now: Date): boolean {
  return endedAt !== null || endsAt <= now;
}
