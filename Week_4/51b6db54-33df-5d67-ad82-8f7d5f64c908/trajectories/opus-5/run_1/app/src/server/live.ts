import type { ServerResponse } from 'node:http';

export interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

interface Client {
  id: number;
  res: ServerResponse;
  spriteId: number | null;
  projectId: number | null;
  personId: number | null;
  shareToken: string | null;
  jobId: number | null;
}

let nextId = 1;
const clients = new Set<Client>();

export function openStream(
  res: ServerResponse,
  filters: Partial<Omit<Client, 'id' | 'res'>>,
): Client {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': open\n\n');
  const client: Client = {
    id: nextId,
    res,
    spriteId: filters.spriteId ?? null,
    projectId: filters.projectId ?? null,
    personId: filters.personId ?? null,
    shareToken: filters.shareToken ?? null,
    jobId: filters.jobId ?? null,
  };
  nextId += 1;
  clients.add(client);
  return client;
}

export function closeStream(client: Client): void {
  clients.delete(client);
  try {
    client.res.end();
  } catch {
    /* the socket is already gone */
  }
}

function write(client: Client, event: LiveEvent): void {
  try {
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

export function publishSprite(spriteId: number, event: LiveEvent): void {
  for (const client of clients) if (client.spriteId === spriteId) write(client, event);
}

export function publishProject(projectId: number, event: LiveEvent): void {
  for (const client of clients) if (client.projectId === projectId) write(client, event);
}

export function publishPerson(personId: number, event: LiveEvent): void {
  for (const client of clients) if (client.personId === personId) write(client, event);
}

export function publishShare(token: string, event: LiveEvent): void {
  for (const client of clients) if (client.shareToken === token) write(client, event);
}

export function publishJob(jobId: number, event: LiveEvent): void {
  for (const client of clients) if (client.jobId === jobId) write(client, event);
}

export function closeJobStreams(jobId: number): void {
  for (const client of [...clients]) if (client.jobId === jobId) closeStream(client);
}

export function closeShareStreams(token: string): void {
  for (const client of [...clients]) if (client.shareToken === token) closeStream(client);
}

export function startHeartbeat(): void {
  setInterval(() => {
    for (const client of clients) {
      try {
        client.res.write(': beat\n\n');
      } catch {
        clients.delete(client);
      }
    }
  }, 15000).unref();
}
