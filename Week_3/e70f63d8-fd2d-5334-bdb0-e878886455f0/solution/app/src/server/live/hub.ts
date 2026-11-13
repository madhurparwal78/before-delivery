import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, EventKind, GroupTable, MatchState, ServerMessage, User } from '../../shared/wire.js';
import { canSeeMatch, canSeeTournament, matchIdByCode } from '../db/lookup.js';
import { isValkeyUp, publish, unwatchChannel, watchChannel } from '../services/valkey.js';
import { config } from '../config.js';
import { userOfRequest } from '../http/session.js';
import { claimPen, releaseAfterGrace, renewPen } from './pen.js';
import { viewerState } from './viewer.js';

const HEARTBEAT_MS = 15_000;
const MIN_RENEW_MS = 50;
const RENEWALS_PER_GRACE = 5;

type Watch =
  | { kind: 'code'; matchId: string; code: string }
  | { kind: 'match'; matchId: string; scoring: boolean }
  | { kind: 'tournament'; tournamentId: string };

interface Client {
  ws: WebSocket;
  user: User | null;
  watch: Watch | null;
  penId: string | null;
  renewing: NodeJS.Timeout | null;
  alive: boolean;
}

/** What goes through the live channels: the connection's JSON, before each socket gets its own rendering of it. */
type ChannelMessage =
  | { type: 'state'; event: { kind: EventKind; seq: number }; state: MatchState }
  | { type: 'pen'; holder: string | null }
  | { type: 'link-off' }
  | { type: 'table'; tournament: string; groups: GroupTable[] };

const matchChannel = (id: string): string => `match:${id}`;
const tournamentChannel = (id: string): string => `tournament:${id}`;

const clients = new Set<Client>();

const send = (client: Client, message: ServerMessage): void => {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(message));
};

const reject = (client: Client): void => {
  send(client, { type: 'error', code: 'NOT_FOUND' });
  client.ws.close();
};

const channelOf = (watch: Watch): string => (watch.kind === 'tournament' ? tournamentChannel(watch.tournamentId) : matchChannel(watch.matchId));

const watchersOf = (channel: string): { client: Client; watch: Watch }[] =>
  [...clients].flatMap((client) => (client.watch && channelOf(client.watch) === channel ? [{ client, watch: client.watch }] : []));

const register = (client: Client, watch: Watch): void => {
  client.watch = watch;
  watchChannel(channelOf(watch));
  if (!isValkeyUp()) send(client, { type: 'live', status: 'paused' });
};

const unregister = (client: Client): void => {
  const watch = client.watch;
  client.watch = null;
  if (watch && watchersOf(channelOf(watch)).length === 0) unwatchChannel(channelOf(watch));
};

const relay = (channel: string, message: ChannelMessage): void => {
  for (const { client, watch } of watchersOf(channel)) {
    if (message.type === 'state' && watch.kind !== 'tournament') {
      send(client, watch.kind === 'code' ? { ...message, state: viewerState(message.state, watch.code) } : message);
    } else if (message.type === 'pen' && watch.kind === 'match' && client.penId === null) {
      send(client, { type: 'pen', pen: null, holder: message.holder });
    } else if (message.type === 'link-off' && watch.kind === 'code') {
      unregister(client);
      send(client, { type: 'link-off' });
    } else if (message.type === 'table' && watch.kind === 'tournament') {
      send(client, message);
    }
  }
};

/** What the Valkey connection calls: a channel message to pass on, and the news that Valkey went away. */
export const relayHandlers = {
  onMessage: (channel: string, text: string): void => relay(channel, JSON.parse(text) as ChannelMessage),
  onDown: (): void => {
    for (const client of clients) if (client.watch) send(client, { type: 'live', status: 'paused' });
  },
};

export const publishState = (matchId: string, event: { kind: EventKind; seq: number }, state: MatchState): Promise<boolean> =>
  publish(matchChannel(matchId), { type: 'state', event, state } satisfies ChannelMessage);
export const publishLinkOff = (matchId: string): Promise<boolean> =>
  publish(matchChannel(matchId), { type: 'link-off' } satisfies ChannelMessage);
export const publishTable = (tournamentId: string, groups: GroupTable[]): Promise<boolean> =>
  publish(tournamentChannel(tournamentId), { type: 'table', tournament: tournamentId, groups } satisfies ChannelMessage);

const stopRenewing = (client: Client): void => {
  if (client.renewing) clearInterval(client.renewing);
  client.renewing = null;
};

const grant = (client: Client, matchId: string, penId: string): void => {
  client.penId = penId;
  stopRenewing(client);
  client.renewing = setInterval(() => { void renewPen(matchId, penId); }, Math.max(MIN_RENEW_MS, config.penGraceMs / RENEWALS_PER_GRACE));
};

const askForPen = async (client: Client, matchId: string): Promise<void> => {
  if (client.penId !== null) return;
  const user = client.user;
  if (!user) return reject(client);
  const answer = await claimPen(matchId, user.display_name);
  if (answer.pen !== null) {
    grant(client, matchId, answer.pen);
    await publish(matchChannel(matchId), { type: 'pen', holder: user.display_name } satisfies ChannelMessage);
  }
  send(client, { type: 'pen', pen: answer.pen, holder: answer.holder });
};

const handle = async (client: Client, message: ClientMessage): Promise<void> => {
  if (message.type === 'watch' && 'code' in message) {
    const matchId = await matchIdByCode(message.code);
    if (matchId === null) return reject(client);
    register(client, { kind: 'code', matchId, code: message.code });
  } else if (message.type === 'watch' && 'match' in message) {
    if (!client.user || !(await canSeeMatch(client.user.id, message.match))) return reject(client);
    register(client, { kind: 'match', matchId: message.match, scoring: false });
  } else if (message.type === 'watch' && 'tournament' in message) {
    if (!client.user || !(await canSeeTournament(client.user.id, message.tournament))) return reject(client);
    register(client, { kind: 'tournament', tournamentId: message.tournament });
  } else if (message.type === 'score') {
    if (!client.user || !(await canSeeMatch(client.user.id, message.match))) return reject(client);
    register(client, { kind: 'match', matchId: message.match, scoring: true });
    await askForPen(client, message.match);
  } else if (message.type === 'take-pen') {
    const watch = client.watch;
    if (watch?.kind !== 'match' || !watch.scoring || watch.matchId !== message.match) return;
    await askForPen(client, message.match);
  }
};

const isClientMessage = (value: unknown): value is ClientMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  switch (message['type']) {
    case 'watch': return ['code', 'match', 'tournament'].some((field) => typeof message[field] === 'string');
    case 'score':
    case 'take-pen': return typeof message['match'] === 'string';
    default: return false;
  }
};

const parse = (data: string): ClientMessage | null => {
  try {
    const value: unknown = JSON.parse(data);
    return isClientMessage(value) ? value : null;
  } catch {
    return null;
  }
};

const closed = (client: Client): void => {
  clients.delete(client);
  stopRenewing(client);
  const watch = client.watch;
  const penId = client.penId;
  unregister(client);
  if (watch?.kind === 'match' && penId !== null) {
    void releaseAfterGrace(watch.matchId, penId, () => {
      void publish(matchChannel(watch.matchId), { type: 'pen', holder: null } satisfies ChannelMessage);
    });
  }
};

const sockets = new WebSocketServer({ noServer: true });

/** Accepts a WebSocket upgrade unless its Origin is another host. */
export const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
  const origin = req.headers.origin;
  if (origin !== undefined && new URL(origin).host !== req.headers.host) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  userOfRequest(req).then((user) => {
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, user, watch: null, penId: null, renewing: null, alive: true };
      clients.add(client);
      let queue = Promise.resolve();
      ws.on('message', (data: Buffer) => {
        const message = parse(data.toString('utf8'));
        if (message) queue = queue.then(() => handle(client, message)).catch(() => undefined);
      });
      ws.on('pong', () => { client.alive = true; });
      ws.on('close', () => closed(client));
      ws.on('error', () => undefined);
    });
  }).catch(() => socket.destroy());
};

setInterval(() => {
  for (const client of clients) {
    if (!client.alive) client.ws.terminate();
    else {
      client.alive = false;
      client.ws.ping();
    }
  }
}, HEARTBEAT_MS).unref();
