import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';

export type ClientScope =
  | { kind: 'manager'; managerId: string }
  | { kind: 'operator' };

export interface ManagerBroadcast {
  gameweekStatus?: unknown;
  notice?: { id: string; kind: string; gameweek: number; message: string; read: boolean; created: string };
  unread?: number;
  squadUpdate?: unknown;
  receipt?: { manager_id: string; gameweek: number; receipt: 'stored' | 'pending' };
  points?: {
    perPlayer: { player_id: string; delta: number; team_points: number }[];
    gameweek_total: number;
    eventLabel?: string;
    playerName?: string;
    eventPlayerId?: string;
  };
  standings?: unknown;
  price?: { player_id: string; price_tenths: number };
  history?: unknown;
}

export interface OperatorBroadcast {
  event?: unknown;
  gameweekStatus?: unknown;
}

type Broadcast = ManagerBroadcast | OperatorBroadcast;

interface Connection {
  socket: WebSocket;
  scope: ClientScope;
}

export class BroadcastHub {
  private readonly connections = new Set<Connection>();

  attach(server: Server): void {
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const scope = this.scopeFromPath(url.pathname, request);
      if (scope === null) {
        socket.close(4000, 'unknown socket path');
        return;
      }
      const connection: Connection = { socket, scope };
      this.connections.add(connection);
      socket.on('close', () => {
        this.connections.delete(connection);
      });
      socket.on('error', () => {
        this.connections.delete(connection);
      });
    });
  }

  private scopeFromPath(path: string, request: IncomingMessage): ClientScope | null {
    const cookieHeader = request.headers.cookie ?? '';
    const cookies = new Map<string, string>();
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      cookies.set(name, rest.join('='));
    }
    const sessionId = cookies.get('elevens_session') ?? '';
    if (path === '/live' && sessionId !== '') return { kind: 'manager', managerId: sessionId };
    if (path === '/live/operator') return { kind: 'operator' };
    return null;
  }

  broadcastToManagers(message: ManagerBroadcast): void {
    for (const connection of this.connections) {
      if (connection.scope.kind === 'manager') {
        this.send(connection.socket, message);
      }
    }
  }

  broadcastToSession(sessionId: string, message: ManagerBroadcast): void {
    for (const connection of this.connections) {
      if (connection.scope.kind === 'manager' && connection.scope.managerId === sessionId) {
        this.send(connection.socket, message);
      }
    }
  }

  broadcastToOperators(message: OperatorBroadcast): void {
    for (const connection of this.connections) {
      if (connection.scope.kind === 'operator') {
        this.send(connection.socket, message);
      }
    }
  }

  private send(socket: WebSocket, message: ManagerBroadcast | OperatorBroadcast): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
