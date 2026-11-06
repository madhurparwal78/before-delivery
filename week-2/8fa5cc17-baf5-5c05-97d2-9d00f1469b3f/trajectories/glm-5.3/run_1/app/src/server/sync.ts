// The live sync channel: the numbered event log in PostgreSQL, replay on
// reconnect, and per-session streams.

import type { Pool, PoolClient } from "pg";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Ctx } from "./context.js";

export interface LoggedEvent {
  id: number;
  event: string;
  data: Record<string, unknown>;
}

/** Append a numbered event inside the caller's transaction. */
export async function recordEvent(client: PoolClient, event: string, data: Record<string, unknown>): Promise<number> {
  const res = await client.query<{ id: string }>("INSERT INTO sync_events (event_type, data, created_at) VALUES ($1, $2, now()) RETURNING id", [event, JSON.stringify(data)]);
  return Number(res.rows[0].id);
}

/** Events kept for replay: at least 10 minutes. */
export async function pruneEvents(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM sync_events WHERE created_at < now() - interval '15 minutes'");
}

interface StreamTarget {
  write: (chunk: string) => void;
}

export interface SseClient {
  sessionId: string;
  send: (event: string, data: Record<string, unknown>, id: number | null) => void;
  close: () => void;
}

/**
 * The live sync channel. Every live session of the owner receives the events
 * it is entitled to; a stream also receives its own session's end notice.
 */
export class LiveSync {
  private readonly ctx: Ctx;
  private clients = new Map<string, Set<SseClient>>(); // session id -> streams
  private pruner: NodeJS.Timeout | null = null;
  private poller: NodeJS.Timeout | null = null;
  private lastSentId = 0;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  startPruner(): void {
    if (this.pruner !== null) return;
    this.pruner = setInterval(() => {
      pruneEvents(this.ctx.pool).catch(() => undefined);
    }, 60000);
  }

  /** Broadcast every committed event in the log to the connected streams. */
  startPoller(): void {
    if (this.poller !== null) return;
    this.poller = setInterval(() => {
      void this.drain();
    }, 100);
  }

  private async drain(): Promise<void> {
    try {
      const latest = await this.latestId();
      if (this.lastSentId === 0) {
        // a fresh server: never replay the whole log to new connections
        this.lastSentId = latest;
        return;
      }
      if (latest <= this.lastSentId) return;
      const res = await this.ctx.pool.query<{ id: string; event_type: string; data: Record<string, unknown> }>(
        "SELECT id::text AS id, event_type, data FROM sync_events WHERE id > $1 ORDER BY id ASC",
        [this.lastSentId]
      );
      for (const row of res.rows) {
        const id = Number(row.id);
        if (id > this.lastSentId) this.lastSentId = id;
        for (const set of this.clients.values()) {
          for (const c of set) c.send(row.event_type, row.data, id);
        }
      }
    } catch {
      // the next tick retries
    }
  }

  /** Broadcast a committed event to every live stream. */
  broadcast(event: LoggedEvent): void {
    for (const set of this.clients.values()) {
      for (const c of set) c.send(event.event, event.data, event.id);
    }
  }

  /** A session ended: tell its streams and close them within two seconds. */
  sessionEnded(sessionId: string): void {
    const set = this.clients.get(sessionId);
    if (set === undefined) return;
    for (const c of set) {
      c.send("session.ended", {}, null);
      setTimeout(() => c.close(), 1500);
    }
    this.clients.delete(sessionId);
  }

  /** Close a session's streams without the session.ended event (rotation). */
  closeSession(sessionId: string): void {
    const set = this.clients.get(sessionId);
    if (set === undefined) return;
    for (const c of set) c.close();
    this.clients.delete(sessionId);
  }

  presenceChanged(data: Record<string, unknown>, forBlockSession: string | null): void {
    void forBlockSession;
    for (const set of this.clients.values()) {
      for (const c of set) c.send("presence.changed", data, null);
    }
  }

  addClient(sessionId: string, client: SseClient): () => void {
    let set = this.clients.get(sessionId);
    if (set === undefined) {
      set = new Set();
      this.clients.set(sessionId, set);
    }
    set.add(client);
    return () => {
      const s = this.clients.get(sessionId);
      if (s === undefined) return;
      s.delete(client);
      if (s.size === 0) this.clients.delete(sessionId);
    };
  }

  /** Replay kept events above the given id, in order. */
  async replayAfter(lastId: number): Promise<LoggedEvent[]> {
    const res = await this.ctx.pool.query<{ id: string; event_type: string; data: Record<string, unknown> }>(
      "SELECT id, event_type, data FROM sync_events WHERE id > $1 ORDER BY id ASC LIMIT 10000",
      [lastId]
    );
    return res.rows.map((r) => ({ id: Number(r.id), event: r.event_type, data: r.data }));
  }

  async latestId(): Promise<number> {
    const res = await this.ctx.pool.query<{ id: string | null }>("SELECT max(id) AS id FROM sync_events");
    return res.rows[0]?.id === null || res.rows[0]?.id === undefined ? 0 : Number(res.rows[0].id);
  }
}

/** Serve the SSE stream for one session. */
export async function serveEvents(ctx: Ctx, sync: LiveSync, req: IncomingMessage, res: ServerResponse, sessionId: string): Promise<void> {
  const lastHeader = Array.isArray(req.headers["last-event-id"]) ? req.headers["last-event-id"][0] : req.headers["last-event-id"];
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const writeEvent = (event: string, data: Record<string, unknown>, id: number | null): void => {
    if (id !== null) res.write(`id: ${id}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  res.write("retry: 2000\n");
  const client: SseClient = {
    sessionId,
    send: writeEvent,
    close: () => {
      try {
        res.end();
      } catch {
        // already closed
      }
    },
  };
  const remove = sync.addClient(sessionId, client);

  let closed = false;
  req.on("close", () => {
    closed = true;
    remove();
  });

  const keepAlive = setInterval(() => {
    if (closed) return;
    res.write(": keep-alive\n\n");
  }, 15000);

  // resume: replay missed events, or reset
  const lastStr = lastHeader === undefined ? null : String(lastHeader);
  if (lastStr !== null && /^\d+$/.test(lastStr) && Number(lastStr) > 0) {
    const lastId = Number(lastStr);
    const latest = await sync.latestId();
    const missed = await sync.replayAfter(lastId);
    const contiguous =
      lastId <= latest &&
      (missed.length > 0 ? missed[0].id === lastId + 1 : latest === lastId) &&
      (missed.length > 0 ? missed[missed.length - 1].id === latest : true);
    if (!contiguous) {
      writeEvent("sync.reset", {}, null);
      res.write(`id: ${latest}\n`);
    } else {
      for (const ev of missed) writeEvent(ev.event, ev.data, ev.id);
    }
  }
  // drop presence when the channel closes
  req.on("close", () => {
    ctx.pool.query("DELETE FROM presence WHERE session_id = $1", [sessionId]).catch(() => undefined);
  });
  void ctx;
  res.on("close", () => {
    clearInterval(keepAlive);
    remove();
  });
}
