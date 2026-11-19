import { api, refusal } from '../api';
import { navigate } from '../router';
import { raise } from '../ui';
import type { LayerInfo, PresenceEntry, SpriteEvent, Workspace } from '../../shared/types';
import type { CommentInfo } from '../../shared/types';
import { applyEvent } from './patch';
import type { Model, PendingStroke } from './model';
import { clearTeamWindows, say } from './team';

interface Connection {
  source: EventSource | null;
  buffered: Map<number, SpriteEvent>;
  flushing: Promise<void> | null;
  retry: ReturnType<typeof setTimeout> | null;
  cursorBusy: boolean;
  cursorDirty: boolean;
}

const connections = new WeakMap<Model, Connection>();

const connection = (m: Model): Connection => {
  let c = connections.get(m);
  if (!c) connections.set(m, (c = { source: null, buffered: new Map(), flushing: null, retry: null, cursorBusy: false, cursorDirty: false }));
  return c;
};

export function syncText(m: Model): void {
  m.syncLines = m.online ? m.syncLines : [`Offline · ${m.plural(unsent(m).length, 'stroke')} queued`];
  m.changed();
}

export async function reload(m: Model): Promise<void> {
  const result = await api<Workspace>('GET', `/api/sprites/${m.spriteId}/workspace`);
  if (!result.ok) return;
  m.load(result.body);
  connection(m).buffered.clear();
  m.changed();
}

/** Applies events strictly in sequence order; a gap is filled from the events route. */
async function drain(m: Model): Promise<number> {
  const c = connection(m);
  let applied = 0;
  for (;;) {
    const next = c.buffered.get(m.seq + 1);
    if (!next) break;
    c.buffered.delete(next.seq);
    applied += 1;
    if (applyEvent(m, next)) await reload(m);
  }
  for (const seq of [...c.buffered.keys()]) if (seq <= m.seq) c.buffered.delete(seq);
  m.changed();
  return applied;
}

export async function receive(m: Model, event: SpriteEvent): Promise<void> {
  const c = connection(m);
  if (event.seq <= m.seq) return;
  c.buffered.set(event.seq, event);
  await drain(m);
  if (c.buffered.size > 0) await catchUp(m);
}

/** Fetches every event after the last one applied and applies it; returns how many it applied. */
export async function catchUp(m: Model): Promise<number> {
  const result = await api<{ events: SpriteEvent[] }>('GET', `/api/sprites/${m.spriteId}/events?since=${m.seq}`);
  if (!result.ok) return 0;
  const c = connection(m);
  for (const event of result.body.events) if (event.seq > m.seq) c.buffered.set(event.seq, event);
  return drain(m);
}

/** A role change or removal that landed before the stream opened reaches this session through one re-read. */
async function reconcileAccess(m: Model): Promise<void> {
  const result = await api<Workspace>('GET', `/api/sprites/${m.spriteId}/workspace`);
  if (connection(m).source === null) return;
  if (!result.ok) {
    if (result.status !== 404) return;
    raise(`You no longer have access to ${m.projectName}`);
    disconnect(m);
    navigate('/projects');
  } else if (result.body.role !== m.role) {
    m.role = result.body.role;
    raise(`Your role is now ${result.body.role}`);
    m.changed();
  }
}

export function connect(m: Model, reconcile = false): void {
  const c = connection(m);
  c.source?.close();
  const source = new EventSource(`/api/sprites/${m.spriteId}/live?since=${m.seq}`);
  c.source = source;
  const on = <T,>(name: string, handler: (data: T) => void): void =>
    source.addEventListener(name, (event) => handler(JSON.parse((event as MessageEvent<string>).data) as T));
  on<{ now: number; presence: PresenceEntry[] }>('ready', (data) => {
    m.clockBase = { server: data.now, local: performance.now() };
    m.presence = data.presence;
    for (const person of data.presence) if (person.cursor) m.cursors.set(person.id, { ...person.cursor, id: person.id, name: person.name, lastActive: person.lastActive });
    m.changed();
    if (reconcile) {
      reconcile = false;
      void reconcileAccess(m);
    }
  });
  // A stream the server refused (the person lost access before it opened) closes for good: re-read once.
  source.addEventListener('error', () => {
    if (reconcile && source.readyState === EventSource.CLOSED) {
      reconcile = false;
      void reconcileAccess(m);
    }
  });
  on<SpriteEvent>('op', (event) => void receive(m, event));
  on<{ layers: LayerInfo[] }>('layers', ({ layers }) => {
    m.setLayers(layers);
    m.changed();
  });
  on<{ user: PresenceEntry }>('joined', ({ user }) => {
    if (!m.presence.some((p) => p.id === user.id)) m.presence = [...m.presence, user];
    say(m, `${user.name} joined`);
  });
  on<{ user: { id: number; name: string } }>('left', ({ user }) => {
    m.presence = m.presence.filter((p) => p.id !== user.id);
    m.cursors.delete(user.id);
    say(m, `${user.name} left`);
  });
  on<{ id: number; name: string; x: number; y: number; frame: number; lastActive: number }>('cursor', (data) => {
    m.cursors.set(data.id, data);
    const entry = m.presence.find((p) => p.id === data.id);
    if (entry) entry.lastActive = data.lastActive;
    m.changed();
  });
  on<{ now: number }>('clock', ({ now }) => {
    m.clockBase = { server: now, local: performance.now() };
    m.changed();
  });
  on<CommentInfo>('comment', (comment) => {
    const at = m.comments.findIndex((c2) => c2.id === comment.id);
    if (at >= 0) m.comments[at] = comment;
    m.changed();
  });
  on<{ role?: string; removed?: boolean }>('access', (data) => {
    if (data.removed) {
      raise(`You no longer have access to ${m.projectName}`);
      disconnect(m);
      navigate('/projects');
    } else if (data.role) {
      m.role = data.role as Model['role'];
      raise(`Your role is now ${data.role}`);
      m.changed();
    }
  });
}

export function disconnect(m: Model): void {
  const c = connection(m);
  c.source?.close();
  c.source = null;
  if (c.retry) clearTimeout(c.retry);
  clearTeamWindows();
}

export interface ReplayReport {
  accepted: number;
  refused: string[];
}

const frameOf = (m: Model, p: PendingStroke): number => m.frames.findIndex((f) => f.id === Number(p.celKey.split(':')[0])) + 1;

export const unsent = (m: Model): PendingStroke[] => m.pending.filter((p) => !p.sent);

/** Sends queued strokes in order, one at a time; a refusal rolls the stroke back. */
export function flush(m: Model, report?: ReplayReport): Promise<void> {
  const c = connection(m);
  const run = async (): Promise<void> => {
    for (;;) {
      const next = unsent(m)[0];
      if (!next || !m.online) return;
      const result = await api<{ seq: number }>('POST', next.path, { ...next.body, frame: frameOf(m, next) });
      if (result.status === 0) {
        if (m.online) c.retry = setTimeout(() => void flush(m), 2000);
        return;
      }
      if (result.ok) {
        if (report) report.accepted += 1;
        if (m.seq >= result.body.seq) m.pending = m.pending.filter((p) => p !== next);
        else next.sent = true;
      } else {
        m.pending = m.pending.filter((p) => p !== next);
        const message = refusal(result).message;
        if (report) report.refused.push(message);
        else raise(message);
      }
      m.touchDocument();
      m.changed();
    }
  };
  c.flushing = (c.flushing ?? Promise.resolve()).then(run).finally(() => {
    c.flushing = null;
  });
  return c.flushing;
}

export function queueStroke(m: Model, stroke: PendingStroke): void {
  m.pending.push(stroke);
  m.touchDocument();
  syncText(m);
  void flush(m);
}

export function setupNetwork(m: Model): () => void {
  const goOffline = (): void => {
    m.online = false;
    connection(m).source?.close();
    syncText(m);
  };
  const goOnline = (): void => {
    void (async () => {
      m.online = true;
      const missed = await catchUp(m);
      const report: ReplayReport = { accepted: 0, refused: [] };
      await flush(m, report);
      await catchUp(m);
      const lines = [`Reconnected · ${m.plural(missed + report.accepted, 'update')} applied`];
      if (report.refused.length > 0) lines.push(`${m.plural(report.refused.length, 'stroke')} refused: ${report.refused[0]}`);
      m.syncLines = lines;
      m.changed();
      connect(m);
    })();
  };
  addEventListener('offline', goOffline);
  addEventListener('online', goOnline);
  return () => {
    removeEventListener('offline', goOffline);
    removeEventListener('online', goOnline);
  };
}

/** Tells the others where this person's cursor is, one request at a time. */
export function sendCursor(m: Model): void {
  const c = connection(m);
  if (!m.online) return;
  if (c.cursorBusy) {
    c.cursorDirty = true;
    return;
  }
  c.cursorBusy = true;
  void api('POST', `/api/sprites/${m.spriteId}/cursor`, { x: m.cursor[0], y: m.cursor[1], frame: m.frameNumber }).finally(() => {
    c.cursorBusy = false;
    if (c.cursorDirty) {
      c.cursorDirty = false;
      sendCursor(m);
    }
  });
}

