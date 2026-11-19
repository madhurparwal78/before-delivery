import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { userForRequest } from './auth.js';
import { projectAccess } from './repo.js';
import type { LiveMessage, PresencePerson } from '../shared/types.js';

interface Client {
  socket: WebSocket;
  userId: string;
  name: string;
  projectId: string;
  workspaceId: string;
  selected: string | null;
  lastSeen: number;
}

const clients = new Set<Client>();

function clientsOfProject(projectId: string): Client[] {
  return [...clients].filter((client) => client.projectId === projectId);
}

export function presenceOf(projectId: string): PresencePerson[] {
  const byUser = new Map<string, PresencePerson>();
  for (const client of clientsOfProject(projectId)) {
    const existing = byUser.get(client.userId);
    if (existing) {
      if (client.selected) existing.selected = client.selected;
    } else {
      byUser.set(client.userId, {
        userId: client.userId,
        name: client.name,
        selected: client.selected,
      });
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function send(client: Client, message: LiveMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(message));
  }
}

export function broadcastToProject(projectId: string, message: LiveMessage): void {
  for (const client of clientsOfProject(projectId)) send(client, message);
}

export function broadcastPresence(projectId: string): void {
  const people = presenceOf(projectId);
  broadcastToProject(projectId, { type: 'presence', people });
}

export function broadcastToWorkspace(workspaceId: string, message: LiveMessage): void {
  for (const client of clients) {
    if (client.workspaceId === workspaceId) send(client, message);
  }
}

function dropStaleClients(): void {
  const cutoff = Date.now() - config.presenceTimeoutSeconds * 1000;
  const touched = new Set<string>();
  for (const client of [...clients]) {
    if (client.lastSeen < cutoff) {
      clients.delete(client);
      client.socket.terminate();
      touched.add(client.projectId);
    }
  }
  for (const projectId of touched) broadcastPresence(projectId);
}

export function attachLiveChannel(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/live') {
      socket.destroy();
      return;
    }
    const projectId = url.searchParams.get('project');
    if (!projectId) {
      socket.destroy();
      return;
    }
    void (async () => {
      const user = await userForRequest(req);
      if (!user) {
        socket.destroy();
        return;
      }
      const access = await projectAccess(user.id, projectId);
      if (!access) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = {
          socket: ws,
          userId: user.id,
          name: user.name,
          projectId,
          workspaceId: access.project.workspace_id,
          selected: null,
          lastSeen: Date.now(),
        };
        clients.add(client);
        broadcastPresence(projectId);
        ws.on('message', (raw) => {
          client.lastSeen = Date.now();
          let parsed: unknown;
          try {
            parsed = JSON.parse(String(raw));
          } catch {
            return;
          }
          const message = parsed as { type?: string; itemId?: string | null };
          if (message.type === 'select') {
            const next = message.itemId ?? null;
            if (next !== client.selected) {
              client.selected = next;
              broadcastPresence(projectId);
            }
          }
        });
        ws.on('close', () => {
          clients.delete(client);
          broadcastPresence(projectId);
        });
      });
    })();
  });

  setInterval(dropStaleClients, 1000).unref();
}
