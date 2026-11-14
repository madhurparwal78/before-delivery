import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Person, ServerFrame, Summary } from '../shared/types.ts';
import { attempt, formChannel, presenceKey, summaryChannel, valkeyUp } from './valkey.ts';

// Every open socket on this app instance, and the fan-out of live frames through Valkey so that every
// instance reaches its own sockets (brief: Services, Valkey). With Valkey down, frames reach this instance only.

export type View = 'builder' | 'summary' | 'response';

export interface Peer {
  id: string;
  socket: WebSocket;
  view: View;
  formId: string;
  responseId: string | null;
  user: Person | null;
  joinedAt: number;
}

const peers = new Map<string, Peer>();
const PRESENCE_SECONDS = 30;
const PRESENCE_REFRESH_MS = 10_000;

export function addPeer(socket: WebSocket, view: View, formId: string, user: Person | null, responseId: string | null): Peer {
  const peer: Peer = { id: randomUUID(), socket, view, formId, responseId, user, joinedAt: Date.now() };
  peers.set(peer.id, peer);
  return peer;
}

export function removePeer(peer: Peer): void {
  peers.delete(peer.id);
}

export const formIdsWithPeers = (): string[] => [...new Set([...peers.values()].map((p) => p.formId))];

export function sendFrame(peer: Peer, frame: ServerFrame): void {
  if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(JSON.stringify(frame));
}

function toPeers(formId: string, wanted: (peer: Peer) => boolean, frame: ServerFrame): void {
  for (const peer of peers.values()) if (peer.formId === formId && wanted(peer)) sendFrame(peer, frame);
}

const isBuilder = (peer: Peer): boolean => peer.view === 'builder';

/** Frames that cross instances over `nf:form:<id>`; the instance that gets the payload delivers to its own sockets. */
type FormEvent =
  | { kind: 'frame'; frame: ServerFrame }
  | { kind: 'moved'; response: string };

export function deliverFormEvent(formId: string, event: FormEvent): void {
  if (event.kind === 'moved') {
    toPeers(formId, (peer) => peer.view === 'response' && peer.responseId === event.response, { type: 'moved' });
    return;
  }
  const { frame } = event;
  if (frame.type === 'applied' || frame.type === 'presence') toPeers(formId, isBuilder, frame);
  else if (frame.type === 'form_state') toPeers(formId, () => true, frame);
}

function deliverSummary(formId: string, summary: Summary): void {
  toPeers(formId, (peer) => peer.view === 'summary', { type: 'summary', summary });
}

/** Publish through Valkey when it is up (delivery happens when the message comes back), else deliver here only. */
export async function publishFormEvent(formId: string, event: FormEvent): Promise<void> {
  const sent = await attempt((client) => client.publish(formChannel(formId), JSON.stringify(event)));
  if (sent === null) deliverFormEvent(formId, event);
}

export async function publishSummary(formId: string, summary: Summary): Promise<void> {
  const sent = await attempt((client) => client.publish(summaryChannel(formId), JSON.stringify(summary)));
  if (sent === null) deliverSummary(formId, summary);
}

export function handleChannel(channel: string, payload: string): void {
  const [, kind, formId] = channel.split(':');
  if (!formId) return;
  if (kind === 'form') deliverFormEvent(formId, JSON.parse(payload) as FormEvent);
  else if (kind === 'summary') deliverSummary(formId, JSON.parse(payload) as Summary);
}

// ---- Presence: hash nf:presence:<form id>, one field per open builder socket, 30-second expiry ----

interface PresenceEntry { id: string; name: string; at: number }

export async function presenceNow(formId: string): Promise<Person[]> {
  const hash = await attempt((client) => client.hgetall(presenceKey(formId)));
  const entries = Object.values(hash ?? {}).map((raw) => JSON.parse(raw) as PresenceEntry).sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const editors: Person[] = [];
  for (const entry of entries) {
    if (!seen.has(entry.id)) editors.push({ id: entry.id, name: entry.name });
    seen.add(entry.id);
  }
  return editors;
}

async function announcePresence(formId: string): Promise<void> {
  await publishFormEvent(formId, { kind: 'frame', frame: { type: 'presence', editors: await presenceNow(formId) } });
}

export async function enterPresence(peer: Peer): Promise<void> {
  if (!peer.user || !valkeyUp()) return;
  const entry: PresenceEntry = { id: peer.user.id, name: peer.user.name, at: peer.joinedAt };
  await attempt(async (client) => {
    await client.hset(presenceKey(peer.formId), peer.id, JSON.stringify(entry));
    await client.expire(presenceKey(peer.formId), PRESENCE_SECONDS);
  });
  await announcePresence(peer.formId);
}

export async function leavePresence(peer: Peer): Promise<void> {
  if (peer.view !== 'builder') return;
  await attempt((client) => client.hdel(presenceKey(peer.formId), peer.id));
  await announcePresence(peer.formId);
}


export function keepPresenceAlive(): void {
  setInterval(() => {
    for (const peer of peers.values()) {
      if (peer.view === 'builder') void attempt((client) => client.expire(presenceKey(peer.formId), PRESENCE_SECONDS));
    }
  }, PRESENCE_REFRESH_MS).unref();
}
