import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { bus } from './bus.js';
import { env } from './env.js';
import { ApiError } from './errors.js';
import { parseCookies } from './http.js';
import {
  beginClock,
  emoteAllowed,
  getMatch,
  markReady,
  matchJson,
  offerRematch,
  previewAllowed,
  pushOpponentStatus,
  resign,
  seatOf,
  setConnected,
  submitShot,
} from './match.js';
import { playerForSessionId } from './players.js';
import { roomJson } from './rooms.js';
import type { Seat } from '../shared/types.js';

const EMOTES = ['nice-shot', 'well-played', 'oops', 'thinking', 'good-game', 'hello'];

interface SeatToken {
  matchId: string;
  playerId: string;
}

const seatTokens = new Map<string, SeatToken>();

function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const candidate = new URL(origin);
    if (host !== undefined && candidate.host === host) return true;
    return candidate.host === new URL(env.appPublicUrl).host;
  } catch {
    return false;
  }
}

export function attachSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws' || !sameOrigin(req.headers.origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void open(ws, url, parseCookies(req.headers.cookie));
    });
  });
}

/** The tab's reconnect token lets a reloaded tab rejoin its seat. */
async function resolvePlayerId(cookies: Record<string, string>, seatToken: string | null): Promise<string | null> {
  const sessionId = cookies.dc_session;
  if (sessionId !== undefined) {
    const player = await playerForSessionId(sessionId).catch(() => null);
    if (player !== null) return player.id;
  }
  if (seatToken !== null) {
    const held = seatTokens.get(seatToken);
    if (held !== undefined) return held.playerId;
  }
  return null;
}

async function open(ws: WebSocket, url: URL, cookies: Record<string, string>): Promise<void> {
  const playerId = await resolvePlayerId(cookies, url.searchParams.get('rt'));
  const matchIdParam = url.searchParams.get('match');
  const roomCode = url.searchParams.get('room');

  const send = (type: string, payload: unknown): void => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type, ...(payload as Record<string, unknown>) }));
  };
  const leaves: (() => void)[] = [];
  if (playerId !== null) leaves.push(bus.joinPlayer(playerId, send));

  let matchId: string | null = null;
  if (matchIdParam !== null && playerId !== null) {
    const match = await getMatch(matchIdParam).catch(() => null);
    if (match !== null && seatOf(match, playerId) !== null) {
      matchId = match.id;
      leaves.push(bus.joinMatch(match.id, send));
      const token = randomBytes(18).toString('base64url');
      seatTokens.set(token, { matchId: match.id, playerId });
      await setConnected(match.id, playerId, true);
      beginClock(match);
      send('state', { ...matchJson(match), reconnectToken: token });
      pushOpponentStatus(match);
    } else if (match !== null) {
      send('error', { code: 'NOT_IN_MATCH' });
    }
  }

  if (roomCode !== null) {
    leaves.push(bus.joinMatch(`room:${roomCode.toUpperCase()}`, send));
    const json = await roomJson(roomCode).catch(() => null);
    if (json !== null) send('roomStatus', json);
  }

  /** The server pings every 2 seconds; no pong for 5 seconds counts as a disconnect. */
  let lastPong = Date.now();
  const heartbeat = setInterval(() => {
    if (Date.now() - lastPong > 5000) {
      ws.close();
      return;
    }
    send('ping', {});
  }, 2000);

  ws.on('message', (raw) => {
    lastPong = Date.now();
    void handle(raw.toString(), { matchId, playerId, send });
  });
  ws.on('close', () => {
    clearInterval(heartbeat);
    for (const leave of leaves) leave();
    if (matchId !== null && playerId !== null) void setConnected(matchId, playerId, false);
  });
  ws.on('error', () => ws.close());
}

interface Session {
  matchId: string | null;
  playerId: string | null;
  send: (type: string, payload: unknown) => void;
}

async function handle(raw: string, session: Session): Promise<void> {
  let message: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return;
    message = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  const type = message.type;
  if (typeof type !== 'string' || type === 'pong') return;
  if (session.matchId === null || session.playerId === null) return;

  const match = await getMatch(session.matchId).catch(() => null);
  if (match === null) return;
  const seat = seatOf(match, session.playerId);
  if (seat === null) return;

  try {
    await act(type, message, match.id, seat, session);
  } catch (error) {
    if (error instanceof ApiError) session.send('error', { code: error.code });
    else session.send('error', { code: 'SERVER_ERROR' });
  }
}

async function act(
  type: string,
  message: Record<string, unknown>,
  matchId: string,
  seat: Seat,
  session: Session,
): Promise<void> {
  const match = await getMatch(matchId);
  if (match === null) return;
  const playerId = session.playerId as string;

  switch (type) {
    case 'ready':
      await markReady(match, seat);
      if (match.roomCode !== null) {
        bus.toMatch(`room:${match.roomCode}`, 'roomStatus', await roomJson(match.roomCode));
      }
      return;
    case 'place':
    case 'aim': {
      if (!previewAllowed(matchId, playerId)) {
        session.send('error', { code: 'RATE_LIMITED' });
        return;
      }
      bus.toMatch(matchId, 'preview', {
        seat,
        x: Number(message.x ?? 0),
        dx: Number(message.dx ?? 0),
        dy: Number(message.dy ?? 0),
        p: Number(message.p ?? 0),
      });
      return;
    }
    case 'shoot':
      await submitShot(match, seat, {
        shotSeq: Number(message.shotSeq ?? 0),
        x: Number(message.x ?? 0),
        dx: Number(message.dx ?? 0),
        dy: Number(message.dy ?? 0),
        p: Number(message.p ?? 0),
        modelVersion: String(message.modelVersion ?? ''),
      });
      return;
    case 'emote': {
      const emote = String(message.emote ?? '');
      if (!EMOTES.includes(emote)) {
        session.send('error', { code: 'INVALID_EMOTE' });
        return;
      }
      if (!emoteAllowed(matchId, playerId)) {
        session.send('error', { code: 'RATE_LIMITED' });
        return;
      }
      bus.toMatch(matchId, 'emote', { seat, emote });
      return;
    }
    case 'resign':
      await resign(match, seat);
      return;
    case 'rematch': {
      const result = await offerRematch(match, seat, message.accept === true);
      session.send('rematchStatus', result);
      return;
    }
    default:
      return;
  }
}
