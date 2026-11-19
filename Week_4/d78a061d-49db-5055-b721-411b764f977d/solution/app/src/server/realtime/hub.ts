import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { publicOrigin } from '../config.js';
import { query } from '../db.js';
import { accountForAuthToken, type AccountRow } from '../accounts.js';
import { parseCookies, SESSION_COOKIE } from '../http.js';
import {
  closeConnection,
  heartbeat,
  lapsedPresence,
  registerConnection,
  settlePresence,
  setJoinedSession,
} from '../presence.js';
import { PING_INTERVAL_MS, PING_TIMEOUT_MS, UUID_RE } from '../../shared/constants.js';
import {
  EMOTES,
  type ClientMessage,
  type EmoteName,
  type ServerEvent,
  type ServerMessage,
  type Snapshot,
} from '../../shared/types.js';
import { chatStream, messageBySeq, renderMessage } from '../chat.js';
import { readEvent, readEventsSince, appendEvent } from './streams.js';
import { onBus, publish, type BusMessage } from './bus.js';
import { loadParty, partyIdOf, partyStream } from '../domain/party.js';
import { joinSession, onSnapshot, submitIntent, type QueuedIntent } from '../sessions/engine.js';
import type { Locale } from '../../shared/i18n/index.js';

interface Connection {
  id: string;
  socket: WebSocket;
  accountId: string;
  locale: Locale;
  partyId: string | null;
  sessionId: string | null;
  alive: boolean;
  /** The last seq per stream the client said it showed, from its latest hello. */
  resume: Record<string, number>;
}

const connections = new Map<string, Connection>();
const misses = new Map<string, number>();
const server = new WebSocketServer({ noServer: true });

function followedStreams(connection: Connection): string[] {
  const streams = [`me:${connection.accountId}`, chatStream('lobby')];
  if (connection.partyId !== null) {
    streams.push(partyStream(connection.partyId), chatStream(`party-${connection.partyId}`));
  }
  if (connection.sessionId !== null) {
    streams.push(`session:${connection.sessionId}`, chatStream(`session-${connection.sessionId}`));
  }
  return streams;
}

function sendTo(connection: Connection, message: ServerMessage): void {
  if (connection.socket.readyState !== connection.socket.OPEN) return;
  connection.socket.send(JSON.stringify(message));
}

async function localisedEvent(
  stream: string,
  seq: number,
  locale: Locale,
): Promise<ServerEvent | null> {
  if (stream.startsWith('chat:')) {
    const channel = stream.slice('chat:'.length);
    const row = await messageBySeq(channel, seq);
    if (row === null) return null;
    return {
      type: 'event',
      stream,
      seq,
      event_id: row.id,
      event: { kind: 'chat_message', message: renderMessage(row, locale) },
    };
  }
  return readEvent(stream, seq);
}

async function sendEvent(connection: Connection, stream: string, seq: number): Promise<void> {
  const event = await localisedEvent(stream, seq, connection.locale);
  if (event === null) return;
  sendTo(connection, event);
}

/** Sends each event above the client's resume point for the given streams, and nothing at or below it. */
async function resumeStreams(connection: Connection, streams: string[]): Promise<void> {
  for (const stream of streams) {
    const after = connection.resume[stream];
    if (typeof after !== 'number' || !Number.isInteger(after) || after < 0) continue;
    if (stream.startsWith('chat:')) {
      const channel = stream.slice('chat:'.length);
      const rows = await query<{ seq: string }>(
        'SELECT seq FROM chat_messages WHERE channel = $1 AND seq > $2 ORDER BY seq',
        [channel, after],
      );
      for (const row of rows) await sendEvent(connection, stream, Number(row.seq));
      continue;
    }
    for (const event of await readEventsSince(stream, after)) sendTo(connection, event);
  }
}

async function sendPartyState(connection: Connection): Promise<void> {
  if (connection.partyId === null) return;
  const party = await loadParty(connection.partyId);
  if (party === null) return;
  sendTo(connection, { type: 'state', stream: partyStream(party.id), party });
}

async function refreshParty(connection: Connection): Promise<void> {
  connection.partyId = await partyIdOf(connection.accountId);
}

async function friendIdsOf(accountId: string): Promise<string[]> {
  const rows = await query<{ other: string }>(
    `SELECT CASE WHEN low_id = $1 THEN high_id ELSE low_id END AS other
     FROM friendships WHERE low_id = $1 OR high_id = $1`,
    [accountId],
  );
  return rows.map((row) => row.other);
}

/** Posts a presence change to every friend and refreshes the account's party, whose member connection follows it. */
async function settleAndAnnounce(accountId: string): Promise<void> {
  const presence = await settlePresence(accountId);
  if (presence === null) return;
  for (const friendId of await friendIdsOf(accountId)) {
    await appendEvent(`me:${friendId}`, { kind: 'presence', account_id: accountId, presence });
  }
  const partyId = await partyIdOf(accountId);
  if (partyId !== null) await publish({ kind: 'party', party_id: partyId });
}

function isEmote(value: unknown): value is EmoteName {
  return typeof value === 'string' && (EMOTES as readonly string[]).includes(value);
}

async function handleMessage(connection: Connection, raw: string): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof value !== 'object' || value === null || typeof (value as { type?: unknown }).type !== 'string') {
    return;
  }
  const parsed = value as ClientMessage;
  const sessionId = (value as { session_id?: unknown }).session_id;
  if ((parsed.type === 'join_session' || parsed.type === 'intent') && !(typeof sessionId === 'string' && UUID_RE.test(sessionId))) {
    return;
  }

  if (parsed.type === 'heartbeat') {
    await heartbeat(connection.id);
    await settleAndAnnounce(connection.accountId);
    return;
  }

  if (parsed.type === 'hello') {
    await refreshParty(connection);
    await heartbeat(connection.id);
    await settleAndAnnounce(connection.accountId);
    connection.resume =
      typeof parsed.resume === 'object' && parsed.resume !== null ? parsed.resume : {};
    await resumeStreams(connection, followedStreams(connection));
    await sendPartyState(connection);
    return;
  }

  if (parsed.type === 'join_session') {
    // The connection counts toward the session before the member is marked back, so a
    // concurrent connection scan never sees a joined member without a connection.
    await setJoinedSession(connection.id, parsed.session_id);
    const outcome = await joinSession(parsed.session_id, connection.accountId);
    if (outcome.kind !== 'joined') await setJoinedSession(connection.id, connection.sessionId);
    if (outcome.kind === 'joined') {
      connection.sessionId = parsed.session_id;
      await refreshParty(connection);
      sendTo(connection, {
        type: 'joined',
        session_id: parsed.session_id,
        tick: outcome.tick,
      });
      await resumeStreams(connection, [
        `session:${parsed.session_id}`,
        chatStream(`session-${parsed.session_id}`),
      ]);
      return;
    }
    sendTo(connection, {
      type: 'join_refused',
      session_id: parsed.session_id,
      event:
        outcome.kind === 'session_complete'
          ? {
              kind: 'session_complete',
              story_id: outcome.story_id,
              chapter: outcome.chapter,
            }
          : { kind: outcome.kind },
    });
    return;
  }

  if (parsed.type === 'intent') {
    // A malformed intent is not one of the three actions and gets no ack.
    if (typeof parsed.intent_id !== 'string') return;
    const base = { accountId: connection.accountId, intentId: parsed.intent_id };
    let intent: QueuedIntent;
    if (parsed.action === 'move_to' && Number.isFinite(parsed.x) && Number.isFinite(parsed.z)) {
      intent = { ...base, action: 'move_to', x: parsed.x as number, z: parsed.z as number };
    } else if (parsed.action === 'swing') {
      intent = { ...base, action: 'swing' };
    } else if (parsed.action === 'emote' && isEmote(parsed.emote)) {
      intent = { ...base, action: 'emote', emote: parsed.emote };
    } else {
      return;
    }
    const ack = await submitIntent(parsed.session_id, connection.accountId, intent);
    sendTo(connection, { type: 'ack', intent_id: parsed.intent_id, ...ack });
  }
}

export function startHub(): void {
  onSnapshot((sessionId: string, snapshot: Snapshot) => {
    for (const connection of connections.values()) {
      if (connection.sessionId === sessionId) {
        sendTo(connection, { type: 'snapshot', session: snapshot });
      }
    }
  });

  onBus((message: BusMessage) => {
    void (async () => {
      if (message.kind === 'event') {
        for (const connection of connections.values()) {
          if (followedStreams(connection).includes(message.stream)) {
            await sendEvent(connection, message.stream, message.seq);
          }
        }
        return;
      }
      if (message.kind === 'party') {
        for (const connection of connections.values()) {
          await refreshParty(connection);
          if (connection.partyId === message.party_id) await sendPartyState(connection);
        }
      }
    })().catch(() => undefined);
  });

  // Presence lapses 30 seconds after the last heartbeat even while a socket stays open.
  setInterval(() => {
    void (async () => {
      for (const accountId of await lapsedPresence()) await settleAndAnnounce(accountId);
    })().catch(() => undefined);
  }, 1000);

  // A ping every 2 seconds; a connection that has not answered the last two
  // pings is closed, so a silent connection counts as closed within 4 seconds.
  setInterval(() => {
    for (const connection of connections.values()) {
      if (connection.alive) {
        misses.set(connection.id, 0);
      } else {
        const missed = (misses.get(connection.id) ?? 0) + 1;
        misses.set(connection.id, missed);
        if (missed * PING_INTERVAL_MS >= PING_TIMEOUT_MS) {
          misses.delete(connection.id);
          connection.socket.terminate();
          continue;
        }
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }, PING_INTERVAL_MS);
}

export async function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== publicOrigin) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  const account: AccountRow | null = token === undefined ? null : await accountForAuthToken(token);
  if (account === null) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  server.handleUpgrade(req, socket, head, (ws) => {
    openConnection(ws, account);
  });
}

/**
 * Listeners go on before any await, so a client that sends hello and join_session
 * the moment the socket opens never loses them to the registration round trips.
 */
function openConnection(socket: WebSocket, account: AccountRow): void {
  const connection: Connection = {
    id: randomUUID(),
    socket,
    accountId: account.id,
    locale: account.locale,
    partyId: null,
    sessionId: null,
    alive: true,
    resume: {},
  };
  connections.set(connection.id, connection);

  let ready = false;
  const queued: string[] = [];
  const dispatch = (raw: string): void => {
    handleMessage(connection, raw).catch(() => undefined);
  };

  socket.on('pong', () => {
    connection.alive = true;
  });
  socket.on('message', (data) => {
    const raw = data.toString();
    if (ready) dispatch(raw);
    else queued.push(raw);
  });
  socket.on('close', () => {
    void (async () => {
      connections.delete(connection.id);
      misses.delete(connection.id);
      await closeConnection(connection.id);
      await settleAndAnnounce(account.id);
    })().catch(() => undefined);
  });
  socket.on('error', () => {
    socket.terminate();
  });

  void (async () => {
    connection.partyId = await partyIdOf(account.id);
    await registerConnection(connection.id, account.id);
    await settleAndAnnounce(account.id);
    ready = true;
    for (const raw of queued.splice(0)) dispatch(raw);
  })().catch(() => {
    socket.terminate();
  });
}
