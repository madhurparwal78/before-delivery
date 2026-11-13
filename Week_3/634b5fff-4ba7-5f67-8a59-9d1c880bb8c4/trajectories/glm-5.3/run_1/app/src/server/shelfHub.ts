import type { Response } from 'express';

interface Client { res: Response; alive: boolean }

const clients = new Set<Client>();

export function addShelfClient(res: Response): () => void {
  const client: Client = { res, alive: true };
  clients.add(client);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(':ok\n\n');
  const ping = setInterval(() => {
    if (!client.alive) return;
    try { res.write(':ping\n\n'); } catch { client.alive = false; }
  }, 5000);
  res.on('close', () => {
    client.alive = false;
    clearInterval(ping);
    clients.delete(client);
  });
  return () => {
    client.alive = false;
    clients.delete(client);
  };
}

export function publishBox(number: number, state: 'available' | 'held' | 'taken'): void {
  const data = JSON.stringify({ number, state });
  for (const c of clients) {
    if (!c.alive) continue;
    try { c.res.write(`event: box\ndata: ${data}\n\n`); } catch { c.alive = false; clients.delete(c); }
  }
}

export function publishSales(salesPaused: boolean, salesOpen: boolean): void {
  const data = JSON.stringify({ salesPaused, salesOpen });
  for (const c of clients) {
    if (!c.alive) continue;
    try { c.res.write(`event: sales\ndata: ${data}\n\n`); } catch { c.alive = false; clients.delete(c); }
  }
}
