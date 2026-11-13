// Fixed server-clock-minute rate limits (uploads, searches, sign-ins) and the per-second tail limit.
import { config } from "./config";
import { errors } from "./errors";
import { now } from "./clock";

export type RateKind = "upload" | "login" | "search" | "tail";

export const rates: Record<RateKind, number> = {
  upload: config.settings.uploadRate,
  login: config.settings.loginRate,
  search: config.settings.searchRate,
  tail: config.settings.tailRate,
};

const MINUTE_MS = 60_000;
const windows = new Map<string, { window: number; count: number }>();

export function consume(kind: Exclude<RateKind, "tail">, subject: string): void {
  const at = now();
  const window = Math.floor(at / MINUTE_MS);
  const key = `${kind}:${subject}`;
  const entry = windows.get(key);
  const count = entry && entry.window === window ? entry.count + 1 : 1;
  windows.set(key, { window, count });
  if (windows.size > 50_000) {
    for (const [name, value] of windows) if (value.window < window) windows.delete(name);
  }
  if (count > rates[kind]) {
    const seconds = Math.max(1, Math.ceil(((window + 1) * MINUTE_MS - at) / 1000));
    throw errors.rateLimited(seconds);
  }
}

/** One tail's per-second budget: how many of `arrived` lines may be sent now. */
export function tailBudget(state: { second: number; sent: number }, arrived: number): number {
  const second = Math.floor(now() / 1000);
  if (state.second !== second) {
    state.second = second;
    state.sent = 0;
  }
  const allowed = Math.max(0, Math.min(arrived, rates.tail - state.sent));
  state.sent += allowed;
  return allowed;
}
