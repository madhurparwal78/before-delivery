// Reachability of Kill Bill and MinIO. Every request contacts the service anew; a failed call marks
// it down at once, a background probe every two seconds brings it back without a restart.
import type { Services } from "../shared/api";

type Name = keyof Services;

const state: Record<Name, { up: boolean; checkedAt: number }> = {
  billing: { up: false, checkedAt: 0 },
  storage: { up: false, checkedAt: 0 },
};

export function markService(name: Name, up: boolean): void {
  state[name] = { up, checkedAt: Date.now() };
}

export function servicesReport(): Services {
  return { billing: state.billing.up ? "up" : "down", storage: state.storage.up ? "up" : "down" };
}

/** Thrown when a service is unreachable or times out; the router turns it into the 503 code. */
export class Unreachable extends Error {
  constructor(readonly service: Name, cause: unknown) {
    super(`${service} unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    markService(service, false);
  }
}

const PROBE_EVERY_MS = 2000;

export function startProbes(probes: Record<Name, () => Promise<void>>): void {
  const run = (name: Name): void => {
    probes[name]()
      .then(() => markService(name, true))
      .catch(() => markService(name, false))
      .finally(() => {
        setTimeout(() => run(name), PROBE_EVERY_MS).unref();
      });
  };
  run("billing");
  run("storage");
}
