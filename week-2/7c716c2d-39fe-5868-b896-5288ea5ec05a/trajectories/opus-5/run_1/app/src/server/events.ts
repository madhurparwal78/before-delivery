import pg from 'pg';
import { config } from './config.js';
import { db, isUnavailable, type Queryable } from './db.js';
import type { EventName } from '../shared/types.js';

export type EventScope =
  | { type: 'workspace' }
  | { type: 'channel'; id: string }
  | { type: 'project'; id: string }
  | { type: 'person'; id: string }
  | { type: 'knock'; id: string };

export type StoredEvent = {
  id: number;
  workspaceId: string;
  name: EventName;
  payload: Record<string, unknown>;
  scopeType: EventScope['type'];
  scopeId: string | null;
};

/**
 * Appends an event inside the caller's transaction. The workspace row lock makes
 * ids strictly increasing and commit order equal to id order, so no reader can
 * pass an event that commits later.
 */
export async function appendEvent(
  client: Queryable,
  workspaceId: string,
  name: EventName,
  payload: Record<string, unknown>,
  scope: EventScope,
  createdAt: string,
): Promise<number> {
  const next = await client.one<{ event_seq: number }>(
    'update workspaces set event_seq = event_seq + 1 where id = $1 returning event_seq',
    [workspaceId],
  );
  if (next === undefined) throw new Error(`Unknown workspace ${workspaceId}`);
  const id = Number(next.event_seq);
  await client.query(
    `insert into events (workspace_id, id, name, payload, scope_type, scope_id, created_at)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      workspaceId,
      id,
      name,
      JSON.stringify(payload),
      scope.type,
      scope.type === 'workspace' ? null : scope.id,
      createdAt,
    ],
  );
  await client.query('select pg_notify($1, $2)', ['tr_events', workspaceId]);
  return id;
}

type EventRow = {
  id: number;
  workspace_id: string;
  name: EventName;
  payload: Record<string, unknown>;
  scope_type: EventScope['type'];
  scope_id: string | null;
};

function toStored(row: EventRow): StoredEvent {
  return {
    id: Number(row.id),
    workspaceId: row.workspace_id,
    name: row.name,
    payload: row.payload,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
  };
}

/** Who may receive an event, decided at the moment it is written to a stream. */
export async function recipientsOf(event: StoredEvent): Promise<Set<string>> {
  if (event.scopeType === 'workspace') {
    const rows = await db.query<{ id: string }>(
      'select id from people where workspace_id = $1 and removed = false',
      [event.workspaceId],
    );
    return new Set(rows.map((row) => row.id));
  }
  if (event.scopeType === 'person') {
    return new Set(event.scopeId === null ? [] : [event.scopeId]);
  }
  if (event.scopeType === 'channel') {
    const rows = await db.query<{ person_id: string }>(
      `select cm.person_id from channel_members cm
         join people p on p.id = cm.person_id
        where cm.channel_id = $1 and p.removed = false`,
      [event.scopeId],
    );
    return new Set(rows.map((row) => row.person_id));
  }
  if (event.scopeType === 'project') {
    const rows = await db.query<{ id: string }>(
      `select p.id from people p
        where p.workspace_id = $1 and p.removed = false
          and (p.role in ('owner','member')
               or exists (select 1 from project_guests g where g.person_id = p.id and g.project_id = $2))`,
      [event.workspaceId, event.scopeId],
    );
    return new Set(rows.map((row) => row.id));
  }
  const rows = await db.query<{ person_id: string }>(
    `select k.person_id from knocks k where k.id = $1
     union
     select o.person_id from room_occupants o
       join knocks k2 on k2.room_id = o.room_id
      where k2.id = $1`,
    [event.scopeId],
  );
  return new Set(rows.map((row) => row.person_id));
}

export type Subscriber = {
  personId: string;
  workspaceId: string;
  lastSent: number;
  deliver: (event: StoredEvent) => void;
  close: () => void;
};

const subscribers = new Set<Subscriber>();

export function addSubscriber(subscriber: Subscriber): void {
  subscribers.add(subscriber);
  void pump();
}

export function removeSubscriber(subscriber: Subscriber): void {
  subscribers.delete(subscriber);
}

export async function eventRange(workspaceId: string): Promise<{ oldest: number; newest: number }> {
  const row = await db.one<{ oldest: number | null; newest: number | null }>(
    'select min(id) as oldest, max(id) as newest from events where workspace_id = $1',
    [workspaceId],
  );
  return { oldest: Number(row?.oldest ?? 0), newest: Number(row?.newest ?? 0) };
}

export async function storedEventsAfter(workspaceId: string, after: number, limit: number): Promise<StoredEvent[]> {
  const rows = await db.query<EventRow>(
    `select id, workspace_id, name, payload, scope_type, scope_id from events
      where workspace_id = $1 and id > $2 order by id asc limit $3`,
    [workspaceId, after, limit],
  );
  return rows.map(toStored);
}

let pumping = false;
let pumpAgain = false;

async function pumpOnce(): Promise<void> {
  const byWorkspace = new Map<string, Subscriber[]>();
  for (const subscriber of subscribers) {
    const list = byWorkspace.get(subscriber.workspaceId) ?? [];
    list.push(subscriber);
    byWorkspace.set(subscriber.workspaceId, list);
  }
  for (const [workspaceId, list] of byWorkspace) {
    const from = Math.min(...list.map((subscriber) => subscriber.lastSent));
    let events: StoredEvent[];
    try {
      events = await storedEventsAfter(workspaceId, from, 500);
    } catch (error) {
      if (isUnavailable(error)) continue;
      throw error;
    }
    for (const event of events) {
      const waiting = list.filter((subscriber) => subscriber.lastSent < event.id && subscribers.has(subscriber));
      if (waiting.length === 0) continue;
      const recipients = await recipientsOf(event);
      for (const subscriber of waiting) {
        if (recipients.has(subscriber.personId)) subscriber.deliver(event);
        subscriber.lastSent = event.id;
      }
    }
  }
}

export async function pump(): Promise<void> {
  if (pumping) {
    pumpAgain = true;
    return;
  }
  pumping = true;
  try {
    do {
      pumpAgain = false;
      await pumpOnce();
    } while (pumpAgain);
  } catch {
    // The next tick retries.
  } finally {
    pumping = false;
  }
}

let listener: pg.Client | undefined;

async function connectListener(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl, application_name: 'tallyroom-events' });
  client.on('notification', () => {
    void pump();
  });
  client.on('error', () => {
    listener = undefined;
    client.end().catch(() => undefined);
  });
  await client.connect();
  await client.query('listen tr_events');
  listener = client;
}

export function startEventPump(): void {
  setInterval(() => {
    if (subscribers.size > 0) void pump();
    if (listener === undefined) {
      connectListener().catch(() => {
        listener = undefined;
      });
    }
  }, 400).unref();
}
