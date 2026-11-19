import type { WebSocket } from 'ws';

/**
 * The live hub: per-map WebSocket connections with per-map sequence
 * numbers, presence colours and replay-by-sequence delivery.
 */

export interface LiveClient {
  ws: WebSocket;
  mapId: string;
  username: string;
  role: string;
  guest: boolean;
  since: number;
  lastSeqSent: number;
  followView: boolean;
}

export interface PresenceRow {
  mapId: string;
  username: string;
  role: string;
  guest: boolean;
  colour: number;
  view: { zoom: number; pan_x: number; pan_y: number; width: number; height: number };
  cursor: { x: number; y: number; topic_id: string | null };
}

export interface QueuedMessage {
  seq: number;
  payload: Record<string, unknown>;
  filter?: (c: LiveClient) => boolean;
}

export class LiveHub {
  clients = new Set<LiveClient>();
  /** Messages kept per map so reconnecting clients can replay. */
  private history = new Map<string, QueuedMessage[]>();
  private presence = new Map<string, Map<string, PresenceRow>>();

  attach(c: LiveClient): void {
    this.clients.add(c);
    // replay
    const hist = this.history.get(c.mapId) ?? [];
    for (const m of hist) {
      if (m.seq <= c.since) continue;
      if (m.filter && !m.filter(c)) continue;
      this.send(c, m.payload);
      c.lastSeqSent = m.seq;
    }
  }

  detach(c: LiveClient): void {
    this.clients.delete(c);
  }

  send(c: LiveClient, payload: Record<string, unknown>): void {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(payload));
  }

  presenceMap(mapId: string): Map<string, PresenceRow> {
    const m = this.presence.get(mapId);
    if (m) return m;
    const fresh = new Map<string, PresenceRow>();
    this.presence.set(mapId, fresh);
    return fresh;
  }

  /** Allocate the lowest free branch colour index. */
  allocateColour(mapId: string, username: string): number {
    const pm = this.presenceMap(mapId);
    const used = new Set<number>();
    for (const [k, v] of pm) if (k !== username) used.add(v.colour);
    for (let i = 0; i < 8; i += 1) if (!used.has(i)) return i;
    return pm.size % 8;
  }

  setPresence(mapId: string, username: string, row: PresenceRow): void {
    this.presenceMap(mapId).set(username, row);
  }

  dropPresence(mapId: string, username: string): void {
    this.presenceMap(mapId).delete(username);
  }

  listPresence(mapId: string): PresenceRow[] {
    return [...this.presenceMap(mapId).values()];
  }

  /** Broadcast a message; every recipient sees the per-map seq. */
  broadcast(mapId: string, type: string, body: Record<string, unknown>, filter?: (c: LiveClient) => boolean): number {
    const hist = this.history.get(mapId) ?? [];
    const seq = hist.length > 0 ? hist[hist.length - 1].seq + 1 : 1;
    const payload = { seq, type, ...body };
    hist.push({ seq, payload, filter });
    this.history.set(mapId, hist);
    for (const c of this.clients) {
      if (c.mapId !== mapId) continue;
      if (filter && !filter(c)) continue;
      this.send(c, payload);
      c.lastSeqSent = seq;
    }
    return seq;
  }

  /** A notice aimed at one person only. */
  noticeTo(mapId: string, username: string, text: string, extra: Record<string, unknown> = {}): void {
    this.broadcast(mapId, 'notice', { notice: text, ...extra }, (c) => c.username === username);
  }

  latestSeq(mapId: string): number {
    const hist = this.history.get(mapId) ?? [];
    return hist.length > 0 ? hist[hist.length - 1].seq : 0;
  }
}
