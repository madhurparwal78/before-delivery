import { probeDatabase } from "./db.js";
import { probeMail } from "./mail.js";
import { probeStorage } from "./storage.js";

export interface ServiceHealth {
  database: boolean;
  storage: boolean;
  mail: boolean;
  checkedAt: Date;
}

const CACHE_MS = 5000;
let cached: ServiceHealth | null = null;
let inFlight: Promise<ServiceHealth> | null = null;

/** Probes every backend service, each with its own timeout, caching the result for at most 5 seconds. */
export async function serviceHealth(): Promise<ServiceHealth> {
  if (cached && Date.now() - cached.checkedAt.getTime() < CACHE_MS) return cached;
  if (!inFlight) {
    inFlight = Promise.all([probeDatabase(), probeStorage(), probeMail()])
      .then(([database, storage, mail]) => {
        cached = { database, storage, mail, checkedAt: new Date() };
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
