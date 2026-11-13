import type { Response } from 'express';

type Client = { res: Response; teamId: string | null; userId: string | null; versionId: string | null; pageId: string | null; siteId: string | null };

const clients = new Set<Client>();

export function subscribe(res: Response, opts: { teamId: string | null; userId: string | null; versionId: string | null; pageId: string | null; siteId: string | null }): Client {
  const client: Client = { res, ...opts };
  clients.add(client);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
  return client;
}

export function unsubscribe(client: Client): void {
  clients.delete(client);
}

export function sendTo(client: Client, event: string, data: unknown): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

type Filter = (c: Client) => boolean;

function broadcast(event: string, data: unknown, filter: Filter): void {
  for (const c of [...clients]) {
    if (filter(c)) sendTo(c, event, data);
  }
}

export const events = {
  navigation(versionId: string, data: unknown): void {
    broadcast('navigation', data, (c) => c.versionId === versionId || c.pageId !== null);
  },
  page(pageId: string, versionId: string, data: unknown): void {
    broadcast('page', data, (c) => c.pageId === pageId || (c.versionId === versionId && c.pageId === null));
  },
  presence(pageId: string, data: unknown): void {
    broadcast('presence', data, (c) => c.pageId === pageId);
  },
  report(versionId: string, data: unknown): void {
    broadcast('report', data, (c) => c.versionId === versionId);
  },
  role(teamId: string, userId: string, role: string): void {
    broadcast('role', { userId, role }, (c) => c.teamId === teamId || c.userId === userId);
  },
  invite(teamId: string, data: unknown): void {
    broadcast('invite', data, (c) => c.teamId === teamId);
  },
  analytics(teamId: string, siteId: string): void {
    broadcast('analytics', { siteId }, (c) => c.teamId === teamId);
  },
  published(siteId: string, versionId: string, snapshotId: string, changedPageIds: string[]): void {
    broadcast('published', { versionId, snapshotId, changedPageIds }, (c) => c.siteId === siteId);
  },
};

export function openStreams(): number {
  return clients.size;
}
