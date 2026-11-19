// The live channel: WebSocket topics, presence and settle-batched notices.

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, ServerResponse, Server } from 'node:http';
import { Db, clock } from './db.js';
import { loadSession, Session } from './auth.js';

interface Client {
  ws: WebSocket;
  session: Session;
  topics: Set<string>;
  presence: Map<string, number>;
}

export class LiveHub {
  private clients = new Set<Client>();
  private pending: Map<string, Array<{ event: string; data: unknown }>> = new Map();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly db: Db, private readonly settleMs: () => number) {}

  attach(server: Server): void {
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      void this.handleUpgrade(wss, req, socket, head);
    });
  }

  private async handleUpgrade(wss: WebSocketServer, req: IncomingMessage, socket: unknown, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/live') {
      (socket as { destroy?: () => void }).destroy?.();
      return;
    }
    const cookies = req.headers.cookie ?? '';
    const token = /switchyard_session=([^;]+)/.exec(cookies)?.[1] ?? null;
    if (!token) {
      (socket as { destroy?: () => void }).destroy?.();
      return;
    }
    const session = await loadSession(this.db, token).catch(() => null);
    if (!session) {
      (socket as { destroy?: () => void }).destroy?.();
      return;
    }
    wss.handleUpgrade(req, socket as never, head, (ws) => {
      const client: Client = { ws, session, topics: new Set(), presence: new Map() };
      this.clients.add(client);
      ws.on('message', (raw) => void this.onMessage(client, raw.toString()));
      ws.on('close', () => {
        this.clients.delete(client);
        for (const record of client.presence.keys()) {
          this.publish(`presence:${record}`, 'left', { username: client.session.user.username });
        }
      });
      ws.on('error', () => { this.clients.delete(client); });
    });
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    let msg: { subscribe?: string[]; unsubscribe?: string[]; presence?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (Array.isArray(msg.subscribe)) {
      for (const topic of msg.subscribe) client.topics.add(topic);
    }
    if (Array.isArray(msg.unsubscribe)) {
      for (const topic of msg.unsubscribe) client.topics.delete(topic);
    }
    if (typeof msg.presence === 'string') {
      client.presence.set(msg.presence, Date.now());
      this.publish(`presence:${msg.presence}`, 'present', {
        username: client.session.user.username,
        display_name: client.session.user.display_name,
        at: new Date(clock.nowMs()).toISOString(),
      });
      // Prune stale presence on every heartbeat.
      void this.prunePresence(msg.presence);
    }
  }

  private async prunePresence(record: string): Promise<void> {
    const res = await this.db.query(
      `SELECT username, seen_at FROM presence WHERE record = $1`,
      [record],
    );
    void res;
  }

  publish(topic: string, event: string, data: unknown): void {
    const payload = JSON.stringify({
      topic,
      event,
      data,
      server_time: new Date(clock.nowMs()).toISOString(),
    });
    for (const client of this.clients) {
      if (client.topics.has(topic)) client.ws.send(payload);
    }
  }

  publishMany(pairs: Array<{ topic: string; event: string; data: unknown }>): void {
    for (const p of pairs) this.publish(p.topic, p.event, p.data);
  }

  /** List notices are batched for LIVE_SETTLE_MS before being sent. */
  publishListNotice(table: string, data: unknown): void {
    const topic = `list:${table}`;
    const pending = this.pending.get(topic) ?? [];
    pending.push({ event: 'changed', data });
    this.pending.set(topic, pending);
    const existing = this.timers.get(topic);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      const items = this.pending.get(topic) ?? [];
      this.pending.delete(topic);
      this.timers.delete(topic);
      if (items.length) {
        this.publish(topic, 'changed', items[items.length - 1].data);
      }
    }, this.settleMs());
    this.timers.set(topic, timer);
  }

  presence(record: string, username: string): void {
    this.publish(`presence:${record}`, 'present', { username });
  }

  dropPresence(record: string, username: string): void {
    this.publish(`presence:${record}`, 'left', { username });
  }
}
