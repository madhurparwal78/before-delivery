import type { ServerResponse } from 'node:http';

export type DeskEvent =
  | { name: 'rule-in-force'; data: { vault_id: string; rule_id: string; name: string } }
  | { name: 'access-changed'; data: { vault_ids: string[]; ended: { vault_id: string; name: string }[]; cause: 'change' | 'boundary' } }
  | { name: 'session-ended'; data: Record<string, never> }
  | { name: 'billing-changed'; data: Record<string, never> }
  | { name: 'check-finished'; data: { feed: 'ok' | 'unreachable' } }
  | { name: 'review-opened'; data: { review_id: string } }
  | { name: 'review-changed'; data: { review_id: string } }
  | { name: 'seat-confirmed'; data: { person_id: string; name: string; change: 'add' | 'release' } };

const streams = new Map<string, Set<ServerResponse>>();

export function openStream(personId: string, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': open\n\n');
  const set = streams.get(personId) ?? new Set<ServerResponse>();
  set.add(res);
  streams.set(personId, set);
  const beat = setInterval(() => res.write(': beat\n\n'), 15_000);
  const close = (): void => {
    clearInterval(beat);
    set.delete(res);
    if (set.size === 0) streams.delete(personId);
  };
  res.on('close', close);
  res.on('error', close);
}

export function sendTo(personIds: readonly string[], event: DeskEvent): void {
  const payload = `event: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const personId of new Set(personIds)) {
    for (const res of streams.get(personId) ?? []) res.write(payload);
  }
}

export function closeStreamsFor(personId: string): void {
  for (const res of streams.get(personId) ?? []) res.end();
  streams.delete(personId);
}
