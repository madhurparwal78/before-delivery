// Live pushes over the WebSocket. Each connection belongs to one player.
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

export type PushMessage =
  | { type: 'balance'; balance: number; movementId: string; purchaseId: string | null }
  | { type: 'run'; runId: string; status: string }
  | { type: 'championship'; leagues: unknown; trophy: boolean }
  | { type: 'board'; layoutId: string; mode: string; class: string; row: unknown }
  | { type: 'lobby'; lobby: unknown };

interface Client {
  ws: WebSocket;
  playerId: string;
  lobbyId: string | null;
  isAlive: boolean;
}

export class PushHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<Client>();

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/v1/ws' });
    this.wss.on('connection', (ws: WebSocket, req) => {
      const playerId = (req as { playerId?: string }).playerId ?? '';
      if (!playerId) {
        ws.close(4001, 'UNAUTHENTICATED');
        return;
      }
      const client: Client = { ws, playerId, lobbyId: null, isAlive: true };
      this.clients.add(client);
      ws.on('pong', () => { client.isAlive = true; });
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string; lobbyId?: string; keyState?: unknown };
          if (msg.type === 'subscribe' && typeof msg.lobbyId === 'string') {
            client.lobbyId = msg.lobbyId;
            void this.onLobbySubscribe?.(client.playerId, client.lobbyId, msg.keyState);
          } else if (msg.type === 'keyState' && client.lobbyId) {
            this.onKeyState?.(client.playerId, client.lobbyId, msg.keyState);
          }
        } catch {
          // Ignore malformed messages.
        }
      });
      ws.on('close', () => {
        this.clients.delete(client);
        if (client.lobbyId) this.onLobbyDisconnect?.(client.playerId, client.lobbyId);
      });
    });
    const timer = setInterval(() => {
      for (const c of this.clients) {
        if (!c.isAlive) { c.ws.terminate(); this.clients.delete(c); continue; }
        c.isAlive = false;
        c.ws.ping();
      }
    }, 10000);
    timer.unref?.();
  }

  /** Messages the browser may send, handled by the lobby module. */
  onLobbySubscribe: ((playerId: string, lobbyId: string, keyState: unknown) => Promise<void>) | null = null;
  onKeyState: ((playerId: string, lobbyId: string, keyState: unknown) => void) | null = null;
  onLobbyDisconnect: ((playerId: string, lobbyId: string) => void) | null = null;

  sendToPlayer(playerId: string, msg: PushMessage): void {
    const text = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.playerId === playerId && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(text);
      }
    }
  }

  sendToAll(msg: PushMessage): void {
    const text = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
    }
  }

  sendToLobby(lobbyId: string, msg: PushMessage): void {
    const text = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.lobbyId === lobbyId && c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
    }
  }

  lobbyMemberIds(lobbyId: string): string[] {
    return [...this.clients].filter(c => c.lobbyId === lobbyId).map(c => c.playerId);
  }

  lobbyHasConnection(lobbyId: string, playerId: string): boolean {
    return [...this.clients].some(c => c.lobbyId === lobbyId && c.playerId === playerId);
  }

  /** Handles a verified upgrade, called from the HTTP server's upgrade event. */
  wssHandleUpgrade(req: { playerId?: string }, socket: import('node:stream').Duplex, head: Buffer): void {
    this.wss?.handleUpgrade(req as never, socket, head, (ws) => {
      this.wss?.emit('connection', ws, req);
    });
  }
}
