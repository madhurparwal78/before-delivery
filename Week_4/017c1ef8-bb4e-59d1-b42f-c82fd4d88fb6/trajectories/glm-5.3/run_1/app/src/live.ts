import { Response } from 'express';
import { randomUUID } from 'node:crypto';

type Client = { memberId: string; send: (event: string, data: unknown) => void; close: () => void };

const clients = new Set<Client>();

export const addClient = (memberId: string, send: (event: string, data: unknown) => void, close: () => void): Client => {
  const client: Client = { memberId, send, close };
  clients.add(client);
  return client;
};

export const removeClient = (client: Client): void => { clients.delete(client); };

const to = (memberId: string, event: string, data: unknown): void => {
  for (const c of clients) {
    if (c.memberId === memberId) c.send(event, data);
  }
};

const toMany = (memberIds: Iterable<string>, event: string, data: unknown): void => {
  for (const id of memberIds) to(id, event, data);
};

/** Push an event to one member's open pages. */
export const pushTo = (memberId: string, event: string, data: unknown): void => to(memberId, event, data);

/** Push an event to several members. */
export const pushToAll = (memberIds: Iterable<string>, event: string, data: unknown): void =>
  toMany(memberIds, event, data);

/** Push an event to every connected member. */
export const broadcast = (event: string, data: unknown): void => {
  for (const c of clients) c.send(event, data);
};

export const sseHeaders = (res: Response): void => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
};

export const makeSseSender = (res: Response) => (event: string, data: unknown): void => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const connectionCount = (): number => clients.size;
export const newEventId = (): string => randomUUID();
