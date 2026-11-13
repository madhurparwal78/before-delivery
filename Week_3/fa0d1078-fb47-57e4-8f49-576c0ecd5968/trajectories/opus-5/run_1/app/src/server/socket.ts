import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { isCellName, isDigit, type Cell, type Digit } from '../shared/board';
import type { ServerSocketMessage } from '../shared/api';
import { isPlainDate } from '../shared/dates';
import {
  applyDuelMove,
  attachSocket,
  detachSocket,
  roomByCode,
  seatIn,
  setReady,
  type DuelSocket,
} from './duels';
import { ApiError } from './errors';
import { appOrigin, assertSocketOrigin, parseCookies, SESSION_COOKIE } from './http';
import { playerForSession, type PlayerRow } from './players';
import { keys, subscribe } from './valkey';

interface Connection {
  socket: DuelSocket;
  player: PlayerRow;
  code: string | null;
  unsubscribe: (() => void) | null;
}

const MOVE_OPS = ['enter', 'note', 'erase', 'undo', 'redo'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function attachSocketServer(server: Server): void {
  const sockets = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    try {
      assertSocketOrigin(req, appOrigin(req));
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError('INTERNAL');
      const body = JSON.stringify(error.body);
      socket.write(
        `HTTP/1.1 ${error.status} Forbidden\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
      socket.destroy();
      return;
    }
    // The session is read before the handshake so no early message is missed.
    void (async () => {
      const value = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const player = value ? await playerForSession(value).catch(() => null) : null;
      sockets.handleUpgrade(req, socket, head, (ws) => {
        if (!player) {
          ws.close(4401);
          return;
        }
        open(ws, player);
      });
    })();
  });
}

function open(ws: WebSocket, player: PlayerRow): void {
  const connection: Connection = {
    socket: {
      playerId: player.id,
      send: (message: ServerSocketMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
    },
    player,
    code: null,
    unsubscribe: null,
  };

  ws.on('message', (raw) => handle(connection, raw.toString()));
  ws.on('close', () => {
    if (connection.code) detachSocket(connection.socket, connection.code);
    connection.unsubscribe?.();
  });
}

function handle(connection: Connection, raw: string): void {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isRecord(message) || typeof message.type !== 'string') return;

  switch (message.type) {
    case 'room': {
      if (typeof message.code !== 'string') return;
      const code = message.code.toUpperCase();
      if (connection.code && connection.code !== code) {
        detachSocket(connection.socket, connection.code);
      }
      connection.code = code;
      attachSocket(connection.socket, code, connection.player);
      return;
    }
    case 'ready': {
      if (typeof message.ready !== 'boolean' || !connection.code) return;
      const room = roomByCode(connection.code);
      if (!room) return;
      const seat = seatIn(room, connection.player.id);
      if (!seat) return;
      setReady(room, seat, message.ready);
      return;
    }
    case 'move': {
      if (!connection.code) return;
      const op = message.op;
      if (typeof op !== 'string' || !(MOVE_OPS as readonly string[]).includes(op)) return;
      const room = roomByCode(connection.code);
      if (!room) return;
      const seat = seatIn(room, connection.player.id);
      if (!seat) return;
      const cell = isCellName(message.cell) ? (message.cell as Cell) : undefined;
      const digit = isDigit(message.digit) ? (message.digit as Digit) : undefined;
      applyDuelMove(room, seat, op as (typeof MOVE_OPS)[number], cell, digit);
      return;
    }
    case 'leaderboard': {
      if (!isPlainDate(message.date)) return;
      connection.unsubscribe?.();
      connection.unsubscribe = subscribe(keys.leaderboardChannel(message.date), (payload) => {
        connection.socket.send(payload as ServerSocketMessage);
      });
      return;
    }
    default:
      return;
  }
}
