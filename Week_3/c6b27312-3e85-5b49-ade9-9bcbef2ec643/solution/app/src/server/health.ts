// Readiness, storage health and the public configuration.
import { publicConfig } from "./config";
import { database } from "./db";
import { get, type Route } from "./route";
import { jsonReply } from "./reply";
import { storageReachable } from "./storage";

/** True once the schema is applied and the first seed pass is done (or storage made it impossible). */
export const readiness = { seeded: false };

const PROBE_TTL_MS = 1000;
let probed: { at: number; reachable: boolean } = { at: 0, reachable: true };

/** Whether storage answered within the last second; probing at most once per second. */
async function storageUp(): Promise<boolean> {
  if (Date.now() - probed.at > PROBE_TTL_MS) probed = { at: Date.now(), reachable: await storageReachable() };
  return probed.reachable;
}

export const healthRoutes: Route[] = [
  get(
    "/api/health",
    async () => {
      if (!database.ready || !readiness.seeded) return jsonReply(503, { status: "unavailable", database: "down" });
      return (await storageUp()) ? jsonReply(200, { status: "ok" }) : jsonReply(200, { status: "unavailable", storage: "down" });
    },
    { needsDatabase: false },
  ),
  get("/api/config", async () => jsonReply(200, publicConfig), { needsDatabase: false }),
];
