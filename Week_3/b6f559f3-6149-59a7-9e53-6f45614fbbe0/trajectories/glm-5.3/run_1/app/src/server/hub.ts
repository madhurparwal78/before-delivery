// The live channel: presence, changes, locks and version announcements.
import type WebSocket from 'ws';

export interface HubMessage {
  type: 'presence' | 'change' | 'lock' | 'version' | 'hello';
  projectId: string;
  [key: string]: unknown;
}

interface Client {
  ws: WebSocket;
  personId: string | null;
  name: string | null;
  projectId: string | null;
  kind: 'editor' | 'embed';
}

export class Hub {
  #clients = new Set<Client>();

  connect(ws: WebSocket): Client {
    const client: Client = { ws, personId: null, name: null, projectId: null, kind: 'editor' };
    this.#clients.add(client);
    ws.on('close', () => {
      this.#clients.delete(client);
      if (client.projectId && client.kind === 'editor' && client.personId) {
        this.broadcast(client.projectId, {
          type: 'presence',
          projectId: client.projectId,
          people: this.peopleIn(client.projectId),
        });
      }
    });
    return client;
  }

  peopleIn(projectId: string): { id: string; name: string }[] {
    const seen = new Map<string, string>();
    for (const c of this.#clients) {
      if (c.projectId === projectId && c.personId && c.kind === 'editor') {
        seen.set(c.personId, c.name ?? '');
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }

  clientFor(ws: WebSocket): Client | null {
    for (const c of this.#clients) {
      if (c.ws === ws) return c;
    }
    return null;
  }

  broadcast(projectId: string, msg: HubMessage): void {
    const text = JSON.stringify(msg);
    for (const c of this.#clients) {
      if (c.projectId === projectId && c.ws.readyState === 1) {
        c.ws.send(text);
      }
    }
  }

  // Live changes reach every other open editor and viewer within 2 s.
  broadcastChanges(projectId: string, seq: number, changes: unknown, by: { id: string; name: string }): void {
    this.broadcast(projectId, { type: 'change', projectId, seq, changes, by });
  }

  broadcastLock(projectId: string, lock: { layerId: string; heldBy: { id: string; name: string } | null }): void {
    this.broadcast(projectId, { type: 'lock', projectId, lock });
  }

  broadcastVersion(projectId: string, number: number): void {
    this.broadcast(projectId, { type: 'version', projectId, number });
  }
}
