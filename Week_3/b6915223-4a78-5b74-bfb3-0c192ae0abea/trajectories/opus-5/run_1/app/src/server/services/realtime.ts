import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import type { CurrentGameweek, EventType, Notice } from '../../shared/types.ts';
import { sessionManager } from '../game/sessions.ts';

export interface PointsMessage {
  type: 'points';
  event_id: string;
  player_id: string;
  player_name: string;
  event_type: EventType;
  voided: boolean;
  counts: boolean;
  team_delta: number;
  player_team_points: number;
  gameweek_total: number;
  multiplier: number;
}

export type ServerMessage =
  | { type: 'gameweek'; gameweek: CurrentGameweek }
  | { type: 'squad' }
  | { type: 'standings' }
  | { type: 'notice'; notice: Notice; unread: number }
  | PointsMessage;

const sockets = new Map<string, Set<WebSocket>>();

export const attachRealtime = (server: Server): void => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/live') {
      socket.destroy();
      return;
    }
    void sessionManager(request.headers.cookie).then((manager) => {
      if (manager === null) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const set = sockets.get(manager.id) ?? new Set<WebSocket>();
        set.add(ws);
        sockets.set(manager.id, set);
        ws.on('close', () => {
          set.delete(ws);
          if (set.size === 0) sockets.delete(manager.id);
        });
        ws.on('error', () => ws.close());
      });
    });
  });
};

export const sendTo = (managerId: string, message: ServerMessage): void => {
  const payload = JSON.stringify(message);
  for (const socket of sockets.get(managerId) ?? []) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
};

export const broadcast = (message: ServerMessage): void => {
  const payload = JSON.stringify(message);
  for (const set of sockets.values()) {
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
};

export const broadcastExcept = (managerIds: Set<string>, message: ServerMessage): void => {
  const payload = JSON.stringify(message);
  for (const [managerId, set] of sockets) {
    if (managerIds.has(managerId)) continue;
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
};
