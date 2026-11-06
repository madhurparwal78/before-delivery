// Counter status: whether billing and photo storage answer, from a probe at most 5 seconds old.
// The probe only informs the Counter; every lending or settling request still tries billing itself.

import type { CounterStatus } from "../../shared/api.js";
import { billingReachable } from "./killbill.js";
import { storageReachable } from "./storage.js";

const MAX_AGE_MS = 5_000;

let latest: { status: CounterStatus; at: number } | undefined;
let inFlight: Promise<CounterStatus> | undefined;

async function probe(): Promise<CounterStatus> {
  const [billing, storage] = await Promise.all([billingReachable(), storageReachable()]);
  const status: CounterStatus = {
    billing: billing ? "up" : "down",
    photo_storage: storage ? "up" : "down",
    checked_at: new Date().toISOString(),
  };
  latest = { status, at: Date.now() };
  return status;
}

export async function counterStatus(): Promise<CounterStatus> {
  if (latest && Date.now() - latest.at < MAX_AGE_MS) return latest.status;
  inFlight ??= probe().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
