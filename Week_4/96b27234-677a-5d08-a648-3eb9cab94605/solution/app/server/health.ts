import { databaseReady } from "./db.js";
import { minioFlaggedDown, storageReachable } from "./storage.js";
import { valkeyFlaggedDown, valkeyReachable } from "./valkey.js";

let valkeyUp = false;
let minioUp = false;

/** The last answer from each service, refreshed every second, so the health route answers at once. */
export function startProbes(): void {
  const probe = async (): Promise<void> => {
    [valkeyUp, minioUp] = await Promise.all([valkeyReachable(), storageReachable()]);
  };
  const tick = (): void => {
    probe().finally(() => setTimeout(tick, 1000));
  };
  tick();
}

export const healthStatus = (): "ok" | "unavailable" =>
  databaseReady() && valkeyUp && minioUp && !valkeyFlaggedDown() && !minioFlaggedDown() ? "ok" : "unavailable";
