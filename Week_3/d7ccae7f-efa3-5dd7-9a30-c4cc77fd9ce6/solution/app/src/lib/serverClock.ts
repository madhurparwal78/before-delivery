import { z } from "zod";

const timeSchema = z.object({ serverNow: z.number() });
const SAMPLES = 4;
const RESYNC_MS = 30_000;

let offset = 0;

// Estimates the server clock from /api/time round trips (the sample with the shortest trip wins).
async function syncClock(): Promise<void> {
  let best: { trip: number; offset: number } | null = null;
  for (let i = 0; i < SAMPLES; i++) {
    const sentAt = performance.now();
    const wallBefore = Date.now();
    const response = await fetch("/api/time", { credentials: "same-origin" });
    const { serverNow } = timeSchema.parse(await response.json());
    const trip = performance.now() - sentAt;
    if (!best || trip < best.trip) best = { trip, offset: serverNow - (wallBefore + trip / 2) };
  }
  if (best) offset = best.offset;
}

const serverNow = (): number => Date.now() + offset;

export function secondsLeft(deadlineAt: number): number {
  return Math.max(0, Math.ceil((deadlineAt - serverNow()) / 1000));
}

export function keepClockSynced(): () => void {
  void syncClock().catch(() => undefined);
  const timer = setInterval(() => void syncClock().catch(() => undefined), RESYNC_MS);
  return () => clearInterval(timer);
}
