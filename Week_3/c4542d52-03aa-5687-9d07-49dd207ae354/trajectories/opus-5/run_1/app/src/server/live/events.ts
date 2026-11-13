import type { LiveEvent, Role } from "../../shared/types.js";
import type { Transaction } from "../db.js";
import { withTransaction } from "../db.js";
import { publish } from "./hub.js";

export interface Audience {
  all?: boolean;
  persons?: string[];
  roles?: Role[];
}

export interface DeliverableEvent {
  event: LiveEvent;
  audience: Audience;
}

export type Emit = (type: string, data: Record<string, unknown>, audience: Audience) => Promise<void>;

export function audienceMatches(audience: Audience, personId: string, role: Role): boolean {
  if (audience.all === true) return true;
  if (audience.persons !== undefined && audience.persons.includes(personId)) return true;
  if (audience.roles !== undefined && audience.roles.includes(role)) return true;
  return false;
}

async function insertEvent(
  tx: Transaction,
  queued: DeliverableEvent[],
  type: string,
  data: Record<string, unknown>,
  audience: Audience,
): Promise<void> {
  const row = await tx.queryOne<{ seq: number; at: Date }>(
    "insert into live_events (type, data, audience) values ($1, $2, $3) returning seq, at",
    [type, JSON.stringify(data), JSON.stringify(audience)],
  );
  if (row === null) throw new Error("the live event was not written");
  queued.push({ event: { seq: Number(row.seq), type, at: row.at.toISOString(), data }, audience });
}

/**
 * Runs a register change in one transaction and publishes its events only after
 * the change is committed, so every open page reads the new state.
 */
export async function writeWithEvents<T>(run: (tx: Transaction, emit: Emit) => Promise<T>): Promise<T> {
  const queued: DeliverableEvent[] = [];
  const value = await withTransaction(async (tx) => {
    const emit: Emit = (type, data, audience) => insertEvent(tx, queued, type, data, audience);
    return run(tx, emit);
  });
  for (const item of queued) publish(item);
  return value;
}

export async function replayEvents(tx: Transaction, since: number): Promise<DeliverableEvent[]> {
  const rows = await tx.query<{
    seq: number;
    at: Date;
    type: string;
    data: Record<string, unknown>;
    audience: Audience;
  }>(
    `select seq, at, type, data, audience
       from (select seq, at, type, data, audience from live_events where seq > $1 order by seq desc limit 1000) recent
      order by seq asc`,
    [since],
  );
  return rows.map((row) => ({
    event: { seq: Number(row.seq), type: row.type, at: row.at.toISOString(), data: row.data },
    audience: row.audience,
  }));
}
