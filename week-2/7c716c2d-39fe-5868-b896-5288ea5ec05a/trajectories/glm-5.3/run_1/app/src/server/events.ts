import type { Client, Pool } from "./db.ts";

export interface StoredEvent {
  id: number;
  workspace_id: string;
  name: string;
  data: unknown;
}

export interface StreamClient {
  workspaceId: string;
  personId: string;
  send: (event: { id?: number; name: string; data: unknown }) => void;
  close: () => void;
}

interface HubState {
  clients: Set<StreamClient>;
}

const hubs = new Map<string, HubState>();

function hubFor(workspaceId: string): HubState {
  let hub = hubs.get(workspaceId);
  if (!hub) {
    hub = { clients: new Set() };
    hubs.set(workspaceId, hub);
  }
  return hub;
}

export function addStreamClient(client: StreamClient): void {
  hubFor(client.workspaceId).clients.add(client);
}

export function removeStreamClient(client: StreamClient): void {
  hubFor(client.workspaceId).clients.delete(client);
}

export function streamCountFor(personId: string): number {
  let n = 0;
  for (const hub of hubs.values()) {
    for (const c of hub.clients) {
      if (c.personId === personId) n++;
    }
  }
  return n;
}

let notifier: ((payload: string) => void) | null = null;

export async function listenForEvents(pool: Pool): Promise<void> {
  const client = await pool.connect();
  client.on("notification", (msg) => {
    if (msg.channel === "tally_events" && msg.payload) {
      notifier?.(msg.payload);
    }
  });
  client.on("error", () => {
    // The listen connection died; release it and reconnect on the next tick of the monitor.
    try {
      client.release();
    } catch {
      // already released
    }
  });
  await client.query("LISTEN tally_events");
  notifier = (payload: string) => {
    try {
      const parsed = JSON.parse(payload) as { ids: number[] };
      for (const id of parsed.ids) pendingIds.push(id);
    } catch {
      // ignore malformed payloads
    }
  };
}

/** Ids notified by any app copy; the dispatch loop delivers them to live streams. */
const pendingIds: number[] = [];

export function takePendingIds(): number[] {
  const out = pendingIds.splice(0, pendingIds.length);
  return out;
}

/** The published notification payload names the event ids stored by a change. */
export async function publishEvents(client: Client, workspaceId: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await client.query("SELECT pg_notify('tally_events', $1)", [
    JSON.stringify({ ids }),
  ]);
  void workspaceId;
}
