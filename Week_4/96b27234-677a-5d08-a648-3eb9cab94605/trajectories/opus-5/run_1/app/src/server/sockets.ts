import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { config } from './config.js';
import { one, query } from './db.js';
import { worldNow } from './clock.js';
import { SESSION_COOKIE, personForToken, readCookie } from './auth.js';
import type { PersonRow } from './auth.js';
import type { PersonEvent, SessionEvent } from './events.js';
import {
  detailFor,
  getOpenSession,
  lensFor,
  memberOf,
  projectName,
  projectPerson
} from './sessions.js';
import {
  markOffline,
  markOnline,
  onValkeyState,
  personChannel,
  sessionChannel,
  subscribe,
  unsubscribe,
  valkeyUp
} from './services/valkey.js';

interface Conn {
  socket: WebSocket;
  personId: string;
  sessionId: string | null;
}

const server = new WebSocketServer({ noServer: true });
const sessionConns = new Map<string, Set<Conn>>();
const personConns = new Map<string, Set<Conn>>();
const sessionHandlers = new Map<string, (payload: unknown) => void>();
const personHandlers = new Map<string, (payload: unknown) => void>();
const droppedPeople = new Set<string>();

function send(conn: Conn, frame: unknown): void {
  if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(frame));
}

async function personById(personId: string): Promise<PersonRow | null> {
  return one<PersonRow>('select * from people where id = $1', [personId]);
}

async function sendSnapshot(conn: Conn): Promise<void> {
  if (conn.sessionId === null) return;
  const session = await getOpenSession(conn.sessionId);
  const person = await personById(conn.personId);
  if (session === null || person === null) return;
  if ((await memberOf(session.id, person.id)) === null) return;
  send(conn, { type: 'room', session: await detailFor(person, session) });
}

async function fanOutSession(sessionId: string, event: SessionEvent): Promise<void> {
  const conns = sessionConns.get(sessionId);
  if (!conns || conns.size === 0) return;
  for (const conn of conns) {
    const person = await personById(conn.personId);
    if (person === null) continue;
    const lens = await lensFor(person);
    if (event.type === 'person-arrived' || event.type === 'person-moved') {
      send(conn, { type: event.type, person: projectPerson(lens, event.person) });
    } else if (event.type === 'person-left' || event.type === 'host-changed') {
      send(conn, {
        type: event.type,
        personId: event.personId,
        displayName: projectName(lens, event.personId, event.displayName)
      });
    } else if (event.type === 'chat') {
      if (event.message.fromId !== conn.personId && !event.recipients.includes(conn.personId)) continue;
      send(conn, {
        type: 'chat',
        message: {
          ...event.message,
          fromName: projectName(lens, event.message.fromId, event.message.fromName)
        }
      });
    } else if (event.type === 'vote') {
      send(conn, {
        type: 'vote',
        vote: { ...event.vote, targetName: projectName(lens, event.vote.targetId, event.vote.targetName) }
      });
    } else {
      send(conn, { type: 'session-ended' });
    }
  }
}

function fanOutPerson(personId: string, event: PersonEvent): void {
  const conns = personConns.get(personId);
  if (!conns) return;
  for (const conn of conns) send(conn, event);
}

async function attachSession(conn: Conn, sessionId: string): Promise<void> {
  let conns = sessionConns.get(sessionId);
  if (!conns) {
    conns = new Set();
    sessionConns.set(sessionId, conns);
    const handler = (payload: unknown): void => {
      void fanOutSession(sessionId, payload as SessionEvent);
    };
    sessionHandlers.set(sessionId, handler);
    await subscribe(sessionChannel(sessionId), handler);
  }
  conns.add(conn);
}

async function detachSession(conn: Conn): Promise<void> {
  if (conn.sessionId === null) return;
  const conns = sessionConns.get(conn.sessionId);
  if (!conns) return;
  conns.delete(conn);
  if (conns.size > 0) return;
  sessionConns.delete(conn.sessionId);
  const handler = sessionHandlers.get(conn.sessionId);
  if (handler) {
    sessionHandlers.delete(conn.sessionId);
    await unsubscribe(sessionChannel(conn.sessionId), handler);
  }
}

async function attachPerson(conn: Conn): Promise<void> {
  let conns = personConns.get(conn.personId);
  if (!conns) {
    conns = new Set();
    personConns.set(conn.personId, conns);
    const handler = (payload: unknown): void => {
      fanOutPerson(conn.personId, payload as PersonEvent);
    };
    personHandlers.set(conn.personId, handler);
    await subscribe(personChannel(conn.personId), handler);
  }
  conns.add(conn);
}

async function detachPerson(conn: Conn): Promise<boolean> {
  const conns = personConns.get(conn.personId);
  if (!conns) return false;
  conns.delete(conn);
  if (conns.size > 0) return false;
  personConns.delete(conn.personId);
  const handler = personHandlers.get(conn.personId);
  if (handler) {
    personHandlers.delete(conn.personId);
    await unsubscribe(personChannel(conn.personId), handler);
  }
  return true;
}

async function clearDropDeadline(personId: string): Promise<void> {
  droppedPeople.delete(personId);
  await query('update session_members set drop_deadline = null where person_id = $1 and active = true', [personId]);
}

async function startDropGrace(personId: string): Promise<void> {
  const person = await personById(personId);
  if (person === null) return;
  const now = await worldNow(person.world_id);
  const deadline = new Date(now.getTime() + config.dropGraceSeconds * 1000);
  await query(
    `update session_members set drop_deadline = $2 where person_id = $1 and active = true and drop_deadline is null`,
    [personId, deadline]
  );
}

async function deliverPendingNotices(conn: Conn): Promise<void> {
  const notices = await query<{ id: string; kind: string }>(
    'select id, kind from pending_notices where person_id = $1 order by created_at asc',
    [conn.personId]
  );
  for (const notice of notices) {
    send(conn, { type: notice.kind });
    await query('delete from pending_notices where id = $1', [notice.id]);
  }
}

export async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): Promise<void> {
  const refuse = (): void => {
    socket.destroy();
  };
  const person = await personForToken(readCookie(req.headers.cookie, SESSION_COOKIE));
  if (person === null || !person.confirmed || person.suspended) return refuse();
  if (!valkeyUp()) return refuse();

  const parts = url.pathname.split('/').filter((part) => part !== '');
  if (parts[0] !== 'ws') return refuse();
  let sessionId: string | null = null;
  if (parts[1] === 'sessions' && typeof parts[2] === 'string') {
    const session = await getOpenSession(parts[2]);
    if (session === null) return refuse();
    if ((await memberOf(session.id, person.id)) === null) return refuse();
    sessionId = session.id;
  } else if (parts[1] !== 'me') {
    return refuse();
  }

  server.handleUpgrade(req, socket, head, (ws) => {
    const conn: Conn = { socket: ws, personId: person.id, sessionId };
    void (async () => {
      try {
        if (conn.sessionId !== null) {
          await attachSession(conn, conn.sessionId);
          await sendSnapshot(conn);
        } else {
          await attachPerson(conn);
          await markOnline(conn.personId);
          await clearDropDeadline(conn.personId);
          await deliverPendingNotices(conn);
        }
      } catch {
        ws.close();
      }
    })();
    ws.on('close', () => {
      void (async () => {
        if (conn.sessionId !== null) {
          await detachSession(conn);
          return;
        }
        const last = await detachPerson(conn);
        if (!last) return;
        try {
          await markOffline(conn.personId);
          await startDropGrace(conn.personId);
        } catch {
          droppedPeople.add(conn.personId);
        }
      })();
    });
    ws.on('error', () => undefined);
  });
}

export function watchSocketsForOutage(): void {
  onValkeyState((up) => {
    if (up) {
      void (async () => {
        for (const personId of [...droppedPeople]) {
          droppedPeople.delete(personId);
          await markOffline(personId).catch(() => undefined);
          await startDropGrace(personId).catch(() => undefined);
        }
      })();
      return;
    }
    for (const conns of sessionConns.values()) {
      for (const conn of conns) conn.socket.close();
    }
  });
}
