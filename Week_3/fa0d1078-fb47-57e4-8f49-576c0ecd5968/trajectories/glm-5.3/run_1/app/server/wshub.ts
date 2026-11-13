import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from './ws.js';

// The WebSocket hub. Every message is one JSON object with exactly the fields
// shown. No message to a player ever contains the other player's digits,
// notes, selection, email or ids; in a duel no message contains the solution.

export interface ClientState {
  playerId: string;
  displayName: string;
  roomCode: string | null;
  leaderboardDate: string | null;
}

export type WsHandler = (client: WebSocket, message: Record<string, unknown>) => void;

export interface WsHub {
  attach(server: import('node:http').Server): void;
  clientsOfRoom(code: string): WebSocket[];
  clientsOfLeaderboard(date: string): WebSocket[];
  send(client: WebSocket, message: Record<string, unknown>): void;
  stateOf(client: WebSocket): ClientState | undefined;
  handle(handler: WsHandler): void;
}

export function createHub(sessionOf: (token: string) => Promise<{ player_id: string; display_name: string } | null>): WsHub {
  const states = new WeakMap<WebSocket, ClientState>();
  const clients = new Set<WebSocket>();
  let handler: WsHandler = () => {};

  const hub: WsHub = {
    attach(server) {
      const wss = new WebSocketServer(server);
      wss.onConnection((client: WebSocket, req: IncomingMessage) => {
        const token = readSessionFromUpgrade(req);
        if (!token) {
          // Without a valid session the server closes the socket with 4401.
          client.close(4401, 'UNAUTHENTICATED');
          return;
        }
        sessionOf(token).then((player) => {
          if (!player) {
            client.close(4401, 'UNAUTHENTICATED');
            return;
          }
          states.set(client, { playerId: player.player_id, displayName: player.display_name, roomCode: null, leaderboardDate: null });
          clients.add(client);
          client.onMessage((data) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(data.toString('utf8'));
            } catch {
              return;
            }
            if (typeof parsed === 'object' && parsed !== null) {
              handler(client, parsed as Record<string, unknown>);
            }
          });
          const removed = () => {
            clients.delete(client);
          };
          client.onClose(removed);
        });
      });
    },
    clientsOfRoom(code) {
      const out: WebSocket[] = [];
      for (const c of clients) {
        const s = states.get(c);
        if (s && s.roomCode === code) out.push(c);
      }
      return out;
    },
    clientsOfLeaderboard(date) {
      const out: WebSocket[] = [];
      for (const c of clients) {
        const s = states.get(c);
        if (s && s.leaderboardDate === date) out.push(c);
      }
      return out;
    },
    send(client, message) {
      client.send(JSON.stringify(message));
    },
    stateOf(client) {
      return states.get(client);
    },
    handle(fn) {
      handler = fn;
    },
  };

  return hub;
}

function readSessionFromUpgrade(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === 'seam_session') return part.slice(idx + 1).trim();
  }
  return null;
}
