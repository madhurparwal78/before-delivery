import type { ServerResponse } from 'node:http';
import { one } from './db';

interface Subscriber {
  response: ServerResponse;
  pens: Set<string>;
  userId: string | null;
}

const subscribers = new Set<Subscriber>();

const write = (subscriber: Subscriber, event: string, data: unknown): void => {
  subscriber.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const subscribe = (
  response: ServerResponse,
  pens: string[],
  userId: string | null,
): (() => void) => {
  const subscriber: Subscriber = { response, pens: new Set(pens), userId };
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
};

export const emitCounts = async (penId: string): Promise<void> => {
  const watching = [...subscribers].filter((subscriber) => subscriber.pens.has(penId));
  if (watching.length === 0) return;
  const row = await one<{ likes: number; forks: number }>(
    `select (select count(*) from likes l where l.pen_id = p.id)::int as likes,
            (select count(*) from pens f where f.source_pen_id = p.id)::int as forks
       from pens p where p.id = $1`,
    [penId],
  );
  if (!row) return;
  for (const subscriber of watching) {
    write(subscriber, 'counts', { pen_id: penId, likes: row.likes, forks: row.forks });
  }
};

export const emitHead = (penId: string, head: number): void => {
  for (const subscriber of subscribers) {
    if (subscriber.pens.has(penId)) write(subscriber, 'head', { pen_id: penId, head });
  }
};

export const emitAccountVerified = (userId: string): void => {
  for (const subscriber of subscribers) {
    if (subscriber.userId === userId) write(subscriber, 'account', { verified: true });
  }
};

export const keepAlive = (): void => {
  for (const subscriber of subscribers) subscriber.response.write(': keep-alive\n\n');
};
