/**
 * Service probes. The server boots whether or not storage and mail answer, and
 * picks each service up again, without a restart, once it answers.
 */

import { bucketReachable } from "./storage.js";
import { isMailReachable, probeMail } from "./mail.js";
import { ensureFixtureObjects } from "../fixtures/seed.js";
import { pruneIdempotency } from "../domain/idempotency.js";

const PROBE_INTERVAL_MS = 5_000;

export type ServiceState = "ok" | "unreachable";

let storageState: ServiceState = "unreachable";
let mailState: ServiceState = "unreachable";
let checkedAt = new Date().toISOString();
let seeding = false;

export function statusSnapshot(): {
  storage: ServiceState;
  mail: ServiceState;
  checked_at: string;
} {
  return { storage: storageState, mail: mailState, checked_at: checkedAt };
}

export function isStorageReachable(): boolean {
  return storageState === "ok";
}

async function resumeSeeding(): Promise<void> {
  if (seeding) return;
  seeding = true;
  try {
    await ensureFixtureObjects();
  } catch (error) {
    console.error("fixture seeding paused", error);
  } finally {
    seeding = false;
  }
}

async function probe(): Promise<void> {
  const [storage] = await Promise.all([bucketReachable(), probeMail()]);
  storageState = storage ? "ok" : "unreachable";
  mailState = isMailReachable() ? "ok" : "unreachable";
  checkedAt = new Date().toISOString();
  if (storageState === "ok") void resumeSeeding();
}

export function startProbes(): void {
  void probe();
  setInterval(() => void probe(), PROBE_INTERVAL_MS).unref();
  setInterval(() => void pruneIdempotency().catch(() => undefined), 3_600_000).unref();
}
