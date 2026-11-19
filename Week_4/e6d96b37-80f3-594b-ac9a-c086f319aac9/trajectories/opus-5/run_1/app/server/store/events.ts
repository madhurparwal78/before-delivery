import type { Sql } from '../providers/db.ts';
import { namespaceNow } from '../domain/clock.ts';
import type { Actor, DeskEvent, EventType } from '../../shared/types.ts';

/**
 * The append-only desk event log. Each committed command appends its own event,
 * plus any further event a rule names for the same transaction, each with the
 * next desk sequence. History is never rewritten.
 */

export interface AppendedEvent extends DeskEvent {
  payload: Record<string, unknown>;
}

async function nextSequence(sql: Sql, ns: string): Promise<number> {
  const bumped = await sql.query<{ next_sequence: string }>(
    `UPDATE namespaces SET next_sequence = next_sequence + 1
      WHERE ns = $1 RETURNING next_sequence - 1 AS next_sequence`,
    [ns],
  );
  const row = bumped.rows[0];
  if (!row) throw new Error(`unknown namespace ${ns}`);
  return Number(row.next_sequence);
}

export async function appendEvent(
  sql: Sql,
  ns: string,
  event: {
    type: EventType;
    actor: Actor;
    commandId: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<AppendedEvent> {
  const sequence = await nextSequence(sql, ns);
  const at = await namespaceNow(sql, ns);
  const payload = event.payload ?? {};
  await sql.query(
    `INSERT INTO desk_events (ns, sequence, command_id, actor, type, at, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ns, sequence, event.commandId, event.actor, event.type, at, payload],
  );
  return {
    sequence,
    command_id: event.commandId,
    actor: event.actor,
    type: event.type,
    at: at.toISOString(),
    payload,
  };
}

export async function appendAuditMark(
  sql: Sql,
  ns: string,
  mark: { cell: string; actor: Actor; commandId: string },
): Promise<number> {
  const sequence = await nextSequence(sql, ns);
  await sql.query(
    `INSERT INTO audit_marks (ns, sequence, cell, mark, actor, command_id)
     VALUES ($1,$2,$3,'missing',$4,$5)`,
    [ns, sequence, mark.cell, mark.actor, mark.commandId],
  );
  return sequence;
}

/* -- live stream --------------------------------------------------------- */

export type StreamListener = (event: AppendedEvent) => void;

const listeners = new Map<string, Set<StreamListener>>();

export function subscribe(ns: string, listener: StreamListener): () => void {
  let set = listeners.get(ns);
  if (!set) {
    set = new Set();
    listeners.set(ns, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(ns);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(ns);
  };
}

/** Open screens receive every committed change within FLAN_LIVE_MS. */
export function publish(ns: string, events: AppendedEvent[]): void {
  const set = listeners.get(ns);
  if (!set || events.length === 0) return;
  for (const event of events) {
    for (const listener of [...set]) listener(event);
  }
}
