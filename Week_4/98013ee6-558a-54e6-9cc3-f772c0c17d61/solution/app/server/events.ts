import { one, type Db } from "./db.js";
import type { LiveMessage } from "../shared/types.js";

/** Who a live message is for. Routing happens in `live.ts`, on every server instance. */
type Target =
  | { kind: "board"; board: number }
  | { kind: "pin"; pin: number }
  | { kind: "user"; user: number }
  | { kind: "feed"; pinIds: number[] }
  | { kind: "person"; user: number }
  | { kind: "all" };

export interface Envelope {
  target: Target;
  message: LiveMessage;
}

export const LIVE_CHANNEL = "ml_live";

/**
 * Records a live message and notifies every instance. Called with a transaction client the
 * message is delivered only when the transaction commits, in commit order.
 */
export async function emit(db: Db, target: Target, message: LiveMessage): Promise<void> {
  const row = await one<{ id: number }>(db, "INSERT INTO live_events (payload) VALUES ($1) RETURNING id", [
    JSON.stringify({ target, message } satisfies Envelope),
  ]);
  if (row) await db.query("SELECT pg_notify($1, $2)", [LIVE_CHANNEL, String(row.id)]);
}
