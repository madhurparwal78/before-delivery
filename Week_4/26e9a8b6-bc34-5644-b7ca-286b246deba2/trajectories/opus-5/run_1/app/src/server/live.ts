import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { readCookie, SESSION_COOKIE } from './http/respond.js';
import { userForSession } from './domain/accounts.js';
import { coauthorIds, loadGuide } from './domain/guides.js';
import type { SessionUser } from '../shared/types.js';

export type LiveEvent =
  | { kind: 'presence'; guide: string; people: PresencePerson[] }
  | {
      kind: 'field';
      guide: string;
      field: string;
      value: unknown;
      revision: number;
      field_revision: number;
      guide_total: number;
      guide_total_text: string;
      by: string;
      by_id: string;
    }
  | { kind: 'step_added'; guide: string; step: { id: string; number: number }; by_id: string }
  | { kind: 'step_deleted'; guide: string; step_id: string; number: number; by_id: string }
  | { kind: 'step_moved'; guide: string; order: string[]; from: number; to: number; by_id: string }
  | { kind: 'part_deleted'; guide: string; part_id: string; by_id: string }
  | { kind: 'version'; guide: string; number: number; saved_by: string; restored_from: number | null }
  | { kind: 'question'; guide: string; guide_title: string; question: unknown; asker_id: string }
  | {
      kind: 'answer';
      guide: string;
      guide_title: string;
      question: unknown;
      step: number;
      author_name: string;
      asker_id: string;
    }
  | { kind: 'like'; guide: string; like_count: number }
  | { kind: 'fork'; guide: string; fork_count: number }
  | { kind: 'model'; guide: string; model: unknown }
  | { kind: 'guide_state'; guide: string; state: string; published_version: number | null };

export interface PresencePerson {
  user_id: string;
  name: string;
  step: number | null;
}

interface Subscriber {
  socket: WebSocket;
  user: SessionUser | null;
  topics: Set<string>;
  guideId: string | null;
  clientId: string;
}

interface BufferedEvent {
  id: number;
  topics: string[];
  event: LiveEvent;
}

const BUFFER_LIMIT = 4000;

interface PresenceEntry {
  userId: string;
  name: string;
  step: number | null;
  timer: NodeJS.Timeout | null;
}

/**
 * One in-process hub behind the single live connection. Changes reach every
 * open page on this app instance, and a reconnecting page replays what it
 * missed from the buffer by its last event id.
 */
class LiveHub {
  private nextId = 1;
  private readonly buffer: BufferedEvent[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private readonly presence = new Map<string, Map<string, PresenceEntry>>();

  publish(event: LiveEvent, topics: readonly string[]): void {
    const entry: BufferedEvent = { id: this.nextId, topics: [...topics], event };
    this.nextId += 1;
    this.buffer.push(entry);
    if (this.buffer.length > BUFFER_LIMIT) this.buffer.shift();
    const frame = JSON.stringify({ id: entry.id, event });
    for (const subscriber of this.subscribers) {
      if (topics.some((topic) => subscriber.topics.has(topic))) subscriber.socket.send(frame);
    }
  }

  replay(subscriber: Subscriber, since: number): void {
    for (const entry of this.buffer) {
      if (entry.id <= since) continue;
      if (!entry.topics.some((topic) => subscriber.topics.has(topic))) continue;
      subscriber.socket.send(JSON.stringify({ id: entry.id, event: entry.event }));
    }
  }

  add(subscriber: Subscriber): void {
    this.subscribers.add(subscriber);
  }

  remove(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
    if (subscriber.guideId !== null) this.leave(subscriber.guideId, subscriber.clientId);
  }

  peopleIn(guideId: string): PresencePerson[] {
    const entries = this.presence.get(guideId);
    if (!entries) return [];
    return [...entries.values()].map((entry) => ({
      user_id: entry.userId,
      name: entry.name,
      step: entry.step,
    }));
  }

  enter(guideId: string, clientId: string, user: SessionUser, step: number | null): void {
    let entries = this.presence.get(guideId);
    if (!entries) {
      entries = new Map<string, PresenceEntry>();
      this.presence.set(guideId, entries);
    }
    const existing = entries.get(clientId);
    if (existing?.timer) clearTimeout(existing.timer);
    entries.set(clientId, { userId: user.id, name: user.name, step, timer: null });
    this.announcePresence(guideId);
  }

  /** The entry leaves the list after the published presence grace. */
  private leave(guideId: string, clientId: string): void {
    const entries = this.presence.get(guideId);
    const entry = entries?.get(clientId);
    if (!entries || !entry || entry.timer !== null) return;
    entry.timer = setTimeout(() => {
      entries.delete(clientId);
      if (entries.size === 0) this.presence.delete(guideId);
      this.announcePresence(guideId);
    }, config.limits.presence_grace_seconds * 1000);
  }

  private announcePresence(guideId: string): void {
    this.publish({ kind: 'presence', guide: guideId, people: this.peopleIn(guideId) }, [
      `guide:${guideId}`,
    ]);
  }
}

export const live = new LiveHub();

export const guideTopic = (guideId: string): string => `guide:${guideId}`;
export const userTopic = (userId: string): string => `user:${userId}`;

interface HelloMessage {
  type: 'hello';
  since?: number;
  guide?: string;
  step?: number | null;
  client?: string;
}

interface PresenceMessage {
  type: 'presence';
  step: number | null;
}

type ClientMessage = HelloMessage | PresenceMessage;

export function attachLive(server: import('node:http').Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/live') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void openConnection(ws, req);
    });
  });
}

async function openConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
  const user = await userForSession(readCookie(req.headers.cookie, SESSION_COOKIE));
  const subscriber: Subscriber = {
    socket,
    user,
    topics: new Set<string>(),
    guideId: null,
    clientId: '',
  };
  if (user !== null) subscriber.topics.add(userTopic(user.id));
  live.add(subscriber);

  socket.on('message', (raw: Buffer | string) => {
    void handleMessage(subscriber, String(raw));
  });
  socket.on('close', () => live.remove(subscriber));
  socket.on('error', () => live.remove(subscriber));
}

async function handleMessage(subscriber: Subscriber, raw: string): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }
  if (message.type === 'hello') {
    subscriber.clientId = message.client ?? '';
    if (typeof message.guide === 'string') {
      const guide = await loadGuide(message.guide);
      if (guide !== null) {
        const editors = [guide.owner_id, ...(await coauthorIds(guide.id))];
        const readable =
          guide.visibility === 'public' && guide.state !== 'draft'
            ? true
            : subscriber.user !== null && editors.includes(subscriber.user.id);
        if (readable) {
          subscriber.guideId = guide.id;
          subscriber.topics.add(guideTopic(guide.id));
          if (subscriber.user !== null && editors.includes(subscriber.user.id)) {
            live.enter(
              guide.id,
              subscriber.clientId,
              subscriber.user,
              message.step ?? null,
            );
          }
          subscriber.socket.send(
            JSON.stringify({
              id: 0,
              event: { kind: 'presence', guide: guide.id, people: live.peopleIn(guide.id) },
            }),
          );
        }
      }
    }
    live.replay(subscriber, message.since ?? 0);
    subscriber.socket.send(JSON.stringify({ id: 0, event: { kind: 'ready' } }));
    return;
  }
  if (subscriber.guideId !== null && subscriber.user !== null) {
    live.enter(subscriber.guideId, subscriber.clientId, subscriber.user, message.step);
  }
}
