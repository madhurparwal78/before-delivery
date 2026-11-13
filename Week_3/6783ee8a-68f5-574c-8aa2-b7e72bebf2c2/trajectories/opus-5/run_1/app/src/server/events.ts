import type { ServerResponse } from 'node:http';
import type { Cell, KernelStatus, PresenceEntry, RunResultStatus } from '../shared/types.js';
import { dropExpired, dropTab, presentIn } from './presence.js';

export type NotebookEvent =
  | { type: 'cells'; cells: Cell[] }
  | { type: 'saved_cells'; cells: Cell[]; tab_id: string }
  | { type: 'cell'; cell: Cell }
  | { type: 'kernel'; kernel_status: KernelStatus }
  | {
      type: 'run';
      cell_id: string;
      position: number;
      status: RunResultStatus;
      execution_count: number | null;
      error_name: string | null;
    }
  | { type: 'presence'; present: PresenceEntry[] }
  | { type: 'checkpoints' }
  | { type: 'revoked' };

interface Client {
  tabId: string;
  userId: string;
  res: ServerResponse;
}

const clients = new Map<string, Set<Client>>();

export function openStream(notebookId: string, tabId: string, userId: string, res: ServerResponse): () => void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(`event: ready\ndata: {}\n\n`);
  const client: Client = { tabId, userId, res };
  const set = clients.get(notebookId) ?? new Set<Client>();
  set.add(client);
  clients.set(notebookId, set);

  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  return () => {
    clearInterval(keepAlive);
    const live = clients.get(notebookId);
    if (live) {
      live.delete(client);
      if (live.size === 0) clients.delete(notebookId);
    }
  };
}

export function broadcast(notebookId: string, event: NotebookEvent): void {
  const live = clients.get(notebookId);
  if (!live) return;
  const payload = `event: notebook\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of live) client.res.write(payload);
}

/** Ends the streams of a person who has lost access to the notebook. */
export function endStreamsForUser(notebookId: string, userId: string): void {
  const live = clients.get(notebookId);
  if (!live) return;
  for (const client of [...live]) {
    if (client.userId !== userId) continue;
    client.res.write(`event: notebook\ndata: ${JSON.stringify({ type: 'revoked' })}\n\n`);
    client.res.end();
    live.delete(client);
  }
}

export function endStreamsForNotebook(notebookId: string): void {
  const live = clients.get(notebookId);
  if (!live) return;
  for (const client of [...live]) client.res.end();
  clients.delete(notebookId);
}

export async function announcePresence(notebookId: string): Promise<void> {
  broadcast(notebookId, { type: 'presence', present: await presentIn(notebookId) });
}

/** Drops a closed tab's presence marker and lock, then tells the others. */
export async function releaseTab(tabId: string): Promise<void> {
  const notebookId = await dropTab(tabId);
  if (notebookId) await announcePresence(notebookId);
}

export function startPresenceSweeper(): void {
  setInterval(() => {
    void dropExpired().then(async (notebookIds) => {
      for (const notebookId of notebookIds) await announcePresence(notebookId);
    });
  }, 1000).unref();
}
