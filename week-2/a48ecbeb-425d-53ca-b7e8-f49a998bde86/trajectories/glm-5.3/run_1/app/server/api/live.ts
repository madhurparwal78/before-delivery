import type { Request, Response } from 'express';

export interface LiveClient {
  id: number;
  send: (event: string, data: unknown) => void;
  close: () => void;
}

const liveClients = new Set<LiveClient>();
let liveNextId = 1;

export function broadcastLive(event: 'stock' | 'review', data: unknown): void {
  for (const client of liveClients) {
    try {
      client.send(event, data);
    } catch {
      client.close();
    }
  }
}

export function liveHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  const client: LiveClient = {
    id: liveNextId++,
    send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    close: () => {
      liveClients.delete(client);
      try {
        res.end();
      } catch {}
    },
  };
  liveClients.add(client);
  req.on('close', () => {
    liveClients.delete(client);
  });
}

export function liveClientCount(): number {
  return liveClients.size;
}
