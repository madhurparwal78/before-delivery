// Service state: checked in the background every few seconds so GET /api/status is never more
// than 10 seconds behind, with a `notice` event to every workspace when a state changes.
import { authenticate } from "./auth.js";
import { databaseReachable, query, tx } from "./db.js";
import { emit } from "./events.js";
import { route } from "./router.js";
import { killbillReachable } from "./killbill.js";
import { heldCount, lastDeliveryFailed } from "./outbox.js";
import { storageHealthy } from "./s3.js";

const state = { database: true, storage: true, billing: true };

export async function checkServices(): Promise<void> {
  const [database, storage, billing] = await Promise.all([databaseReachable(), storageHealthy(), killbillReachable()]);
  const changed = state.storage !== storage || state.billing !== billing || state.database !== database;
  Object.assign(state, { database, storage, billing });
  if (!changed || !database) return;
  try {
    const workspaces = await query<{ id: string }>("SELECT id FROM workspaces");
    await tx(async (db) => {
      for (const { id } of workspaces) await emit(db, id, "notice", {});
    });
  } catch {
    // the schema may not be ready yet; pages still poll the status every 10 s
  }
}

route("GET", "/api/status", { access: "public" }, async (ctx) => {
  const database = await databaseReachable();
  let held: number | null = null;
  let waiting = 0;
  if (database) {
    try {
      const person = await authenticate(ctx.req);
      waiting = await heldCount(person?.workspace_id ?? null);
      if (person?.role === "owner") held = waiting;
    } catch {
      held = null;
    }
  }
  return {
    status: 200,
    body: {
      database: database ? "ok" : "unavailable",
      mail: waiting > 0 || lastDeliveryFailed() ? "delayed" : "ok",
      storage: state.storage ? "ok" : "unavailable",
      billing: state.billing ? "ok" : "unavailable",
      held_mail: held,
    },
  };
});
