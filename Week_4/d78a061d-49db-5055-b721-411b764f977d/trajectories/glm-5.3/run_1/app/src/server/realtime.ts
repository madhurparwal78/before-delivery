import { query } from './db.js';
import type { Locale } from '../shared/domain.js';
import { openConnection, closeConnection, heartbeat, sessionConnectionCount, isAccountOnline, type Connection } from './presence.js';

/**
 * The realtime hub: streams, seq resume and event publishing (DP-51, DP-64).
 * Every event carries an event_id and a per-stream seq that rises by 1 and continues across restarts.
 */
export type StreamName = string; // 'me:<id>', 'chat:<channel>', 'party:<id>', 'session:<id>'

export interface ClientSocket {
  accountId: string;
  connection: Connection;
  send: (text: string) => void;
  followedStreams: Set<StreamName>;
  resumeSeq: Map<StreamName, number>;
  locale: () => Locale;
}

const sockets = new Set<ClientSocket>();

export function attachSocket(socket: ClientSocket): void {
  sockets.add(socket);
}

export function detachSocket(socket: ClientSocket): void {
  sockets.delete(socket);
}

async function nextEventSeq(stream: StreamName): Promise<number> {
  const res = await query(
    `insert into streams (stream, last_seq) values ($1, 0)
     on conflict (stream) do update set last_seq = streams.last_seq + 1 returning last_seq`,
    [stream],
  );
  return Number((res.rows[0] as { last_seq: string } | undefined)?.last_seq ?? 0);
}

export async function appendEvent(stream: StreamName, event: Record<string, unknown>): Promise<{ event_id: string; seq: number }> {
  const eventId = crypto.randomUUID();
  const seq = await nextEventSeq(stream);
  await query('insert into events (event_id, stream, seq, event) values ($1, $2, $3, $4)', [
    eventId, stream, seq, JSON.stringify(event),
  ]);
  return { event_id: eventId, seq };
}

export async function eventsAfter(stream: StreamName, afterSeq: number): Promise<{ event_id: string; seq: number; event: Record<string, unknown> }[]> {
  const res = await query<{ event_id: string; seq: string; event: Record<string, unknown> }>(
    'select event_id, seq, event from events where stream = $1 and seq > $2 order by seq asc limit 500',
    [stream, afterSeq],
  );
  return res.rows.map((r) => ({ event_id: r.event_id, seq: Number(r.seq), event: r.event }));
}

export function socketsFollowingStream(stream: StreamName): ClientSocket[] {
  return [...sockets].filter((s) => s.followedStreams.has(stream));
}

export async function publish(stream: StreamName, event: Record<string, unknown>): Promise<void> {
  const stored = await appendEvent(stream, event);
  const payload = JSON.stringify({
    type: 'event',
    stream,
    seq: stored.seq,
    event_id: stored.event_id,
    event: { ...event, event_id: stored.event_id, seq: stored.seq },
  });
  for (const socket of socketsFollowingStream(stream)) {
    socket.send(payload);
  }
}

export function publishMe(accountId: string, event: Record<string, unknown>): Promise<void> {
  return publish(`me:${accountId}`, event);
}

export function publishModelStatus(accountId: string, modelId: string, status: string, failedCount: number | null): Promise<void> {
  const payload: Record<string, unknown> = { kind: 'model_status', model_id: modelId, status };
  if (status === 'accepted' || status === 'rejected') payload.failed_count = failedCount;
  return publishMe(accountId, payload);
}

export function publishChatEvent(channel: string, row: { id: string; seq: number; kind: string; author: { account_id: string; display_name: string } | null; body: string | null; code: string | null; params: Record<string, string> | null; created_at: Date }): Promise<void> {
  return publish(`chat:${channel}`, {
    kind: 'chat_message',
    message: {
      id: row.id,
      seq: row.seq,
      kind: row.kind,
      author: row.author,
      body: row.body,
      code: row.code,
      params: row.params ?? {},
      created_at: row.created_at.toISOString(),
    },
  });
}

export async function publishPartyState(partyId: string): Promise<void> {
  const { partyById, partyMembers, partyJson } = await import('./parties.js');
  const party = await partyById(partyId);
  if (!party) return;
  const members = await partyMembers(partyId);
  const state = partyJson(party, members);
  const payload = JSON.stringify({ type: 'state', stream: `party:${partyId}`, party: state });
  for (const socket of socketsFollowingStream(`party:${partyId}`)) {
    socket.send(payload);
  }
}

export async function publishSessionEvent(sessionId: string, kind: string, params: Record<string, unknown>): Promise<void> {
  await publish(`session:${sessionId}`, { kind, ...params });
}

export async function publishSnapshot(sessionId: string, snapshot: Record<string, unknown>): Promise<void> {
  const payload = JSON.stringify({ type: 'snapshot', session: snapshot });
  for (const socket of socketsFollowingStream(`session:${sessionId}`)) {
    socket.send(payload);
  }
}

export async function publishSeatReleased(sessionId: string, accountId: string): Promise<void> {
  await publishSessionEvent(sessionId, 'seat_released', { account_id: accountId });
}

export async function publishSessionEndedByGrace(sessionId: string): Promise<void> {
  await publishSessionEvent(sessionId, 'session_ended', {});
}

export async function resumeFor(socket: ClientSocket, resume: Record<string, number>): Promise<void> {
  for (const [stream, afterSeq] of Object.entries(resume)) {
    socket.resumeSeq.set(stream, afterSeq);
    const events = await eventsAfter(stream, afterSeq);
    for (const event of events) {
      socket.send(JSON.stringify({ type: 'event', stream, seq: event.seq, event_id: event.event_id, event: event.event }));
    }
  }
}

export { openConnection, closeConnection, heartbeat, sessionConnectionCount, isAccountOnline, sockets };
export type { Connection };
