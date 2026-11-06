/**
 * Live service health. Each service is probed afresh on every request, with no
 * lasting record that one was down, and no probe waits longer than the published
 * per-service budget.
 */

import { HEALTH_PROBE_TIMEOUT_MS } from "../config.js";
import type { ServiceHealth, ServiceName } from "../../shared/types.js";
import { pingPostgres } from "../db/seed.js";
import * as killbill from "./killbill.js";
import * as mail from "./mail.js";
import * as storage from "./storage.js";
import * as pocketbase from "./pocketbase.js";

const PROBES: Record<ServiceName, (timeoutMs: number) => Promise<void>> = {
  postgres: () => pingPostgres(),
  killbill: (timeoutMs) => killbill.ping(timeoutMs),
  mailpit: (timeoutMs) => mail.ping(timeoutMs),
  minio: (timeoutMs) => storage.ping(timeoutMs),
  pocketbase: (timeoutMs) => pocketbase.ping(timeoutMs),
};

async function probe(name: ServiceName): Promise<"up" | "down"> {
  try {
    await withDeadline(PROBES[name](HEALTH_PROBE_TIMEOUT_MS));
    return "up";
  } catch {
    return "down";
  }
}

/** Guards against a probe that ignores its own timeout. */
function withDeadline<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("health probe timed out")), HEALTH_PROBE_TIMEOUT_MS).unref(),
    ),
  ]);
}

export async function probeServices(): Promise<ServiceHealth> {
  const names: ServiceName[] = ["postgres", "killbill", "mailpit", "minio", "pocketbase"];
  const states = await Promise.all(names.map((name) => probe(name)));
  return Object.fromEntries(names.map((name, index) => [name, states[index]])) as ServiceHealth;
}
