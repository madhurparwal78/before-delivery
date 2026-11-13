// The event outbox, its relay through Valkey and the server-sent event streams.
import type { ServerResponse } from "node:http";
import { config } from "./config";
import { db, transaction, Queries, type Tx } from "./db";
import type { Ctx } from "./http";
import { HANDLED, get, post, type Route } from "./route";
import { ApiError } from "./errors";
import { newId } from "./ids";
import { noContent } from "./reply";
import { OUTBOX_LOCK, RELAY_LOCK } from "./schema";
import { attempt, key, listen, listenPattern, valkey } from "./valkey";

interface OutboxRow {
  seq: number;
  part_slug: string;
  type: string;
  room_id: string | null;
  data: unknown;
}

/** One committed event as it travels through Valkey. `to` lists who may see it; null means everyone who can read the part. */
interface Message {
  seq: number;
  slug: string;
  type: string;
  to: string[] | null;
  data: unknown;
}

const HEARTBEAT_MS = 15_000;
const RELAY_INTERVAL_MS = 1000;
const PRUNE_EVERY_TICKS = 60;
const REPLAY_LIMIT = 1000;

/**
 * Writes an event in the caller's transaction. Callers lock the part row first and this takes the outbox lock
 * second, so event ids follow commit order and a reader never sees a later id before an earlier one.
 */
export async function emit(tx: Tx, slug: string, type: string, roomId: string | null, data: object): Promise<void> {
  await tx.run("SELECT pg_advisory_xact_lock($1)", [OUTBOX_LOCK]);
  await tx.run("INSERT INTO outbox (part_slug, type, room_id, data) VALUES ($1, $2, $3, $4)", [slug, type, roomId, JSON.stringify(data)]);
  tx.onCommit(kick);
}

type AudienceCache = Map<string, string[] | null>;

async function audience(queries: Queries, row: OutboxRow, cache: AudienceCache): Promise<string[] | null> {
  const cacheKey = `${row.part_slug}|${row.room_id ?? ""}`;
  const known = cache.get(cacheKey);
  if (known !== undefined) return known;
  const found = await queries.row<{ visibility: string; owner_id: string; reviewers: string[] }>(
    `SELECT p.visibility, p.owner_id,
            COALESCE(array_agg(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS reviewers
       FROM parts p
       LEFT JOIN rooms r ON r.part_slug = p.slug AND ($2::text IS NULL OR r.id = $2)
       LEFT JOIN room_reviewers rr ON rr.room_id = r.id
       LEFT JOIN users u ON u.email_fold = rr.email_fold AND u.verified
      WHERE p.slug = $1
      GROUP BY p.slug`,
    [row.part_slug, row.room_id],
  );
  const to = found === undefined || (row.room_id === null && found.visibility === "public") ? null : [found.owner_id, ...found.reviewers];
  cache.set(cacheKey, to);
  return to;
}

const message = (row: OutboxRow, to: string[] | null): Message => ({ seq: row.seq, slug: row.part_slug, type: row.type, to, data: row.data });

// ------------------------------------------------------------------------------------------------ relay

let relaying = false;
let again = false;

/** Publishes every committed, unrelayed row to its part channel, in id order, one process at a time. */
async function relayOnce(): Promise<void> {
  if (relaying) {
    again = true;
    return;
  }
  relaying = true;
  try {
    do {
      again = false;
      await transaction(async (tx) => {
        const lock = await tx.row<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS locked", [RELAY_LOCK]);
        if (!lock?.locked) return;
        const rows = await tx.rows<OutboxRow>("SELECT seq, part_slug, type, room_id, data FROM outbox WHERE NOT relayed ORDER BY seq LIMIT 200");
        const cache: AudienceCache = new Map();
        for (const row of rows) {
          await valkey.publish(key(`part:${row.part_slug}`), JSON.stringify(message(row, await audience(tx, row, cache))));
        }
        await tx.run("UPDATE outbox SET relayed = true WHERE seq = ANY($1::bigint[])", [rows.map((row) => row.seq)]);
        again = rows.length === 200;
      });
    } while (again);
  } catch {
    // Valkey or the database is unavailable; the next tick tries again and streams catch up from the outbox.
  } finally {
    relaying = false;
  }
}

function kick(): void {
  void relayOnce();
}

export function startRelay(): void {
  let ticks = 0;
  setInterval(() => {
    kick();
    ticks += 1;
    if (ticks % PRUNE_EVERY_TICKS === 0) {
      void db
        .run("DELETE FROM outbox WHERE relayed AND created_at < now() - make_interval(secs => $1)", [config.outboxRetentionSeconds])
        .then(() => db.run("DELETE FROM idempotency WHERE created_at < now() - make_interval(secs => $1)", [config.idempotencyTtlSeconds]))
        .catch(() => undefined);
    }
  }, RELAY_INTERVAL_MS).unref();
}

// ------------------------------------------------------------------------------------------------ streams

class EventStream {
  private lastSent: number;
  private pending: Message[] | null = [];

  constructor(
    private readonly res: ServerResponse,
    private readonly userId: string | null,
    private readonly slugs: Set<string> | null,
    after: number,
  ) {
    this.lastSent = after;
  }

  private visible(m: Message): boolean {
    if (this.slugs && !this.slugs.has(m.slug)) return false;
    return m.to === null || (this.userId !== null && m.to.includes(this.userId));
  }

  private write(m: Message): void {
    if (m.seq <= this.lastSent) return;
    this.lastSent = m.seq;
    this.res.write(`id: ${m.seq}\nevent: ${m.type}\ndata: ${JSON.stringify(m.data)}\n\n`);
  }

  deliver(m: Message): void {
    if (!this.visible(m)) return;
    if (this.pending) this.pending.push(m);
    else this.write(m);
  }

  /** Sends what the client missed, then everything that arrived while that was read. */
  async catchUp(): Promise<void> {
    const rows = await db.rows<OutboxRow>(
      "SELECT seq, part_slug, type, room_id, data FROM outbox WHERE seq > $1 AND ($2::text[] IS NULL OR part_slug = ANY($2)) ORDER BY seq LIMIT $3",
      [this.lastSent, this.slugs ? [...this.slugs] : null, REPLAY_LIMIT],
    );
    const cache: AudienceCache = new Map();
    for (const row of rows) {
      const m = message(row, await audience(db, row, cache));
      if (this.visible(m)) this.write(m);
    }
    const arrived = this.pending ?? [];
    this.pending = null;
    for (const m of arrived) this.write(m);
  }

  skipCatchUp(): void {
    this.pending = null;
  }

  close(): void {
    this.res.end();
  }
}

const streams = new Set<EventStream>();

listenPattern("part:*", (payload) => {
  const m = JSON.parse(payload) as Message;
  for (const stream of streams) stream.deliver(m);
});

async function openStream(ctx: Ctx): Promise<typeof HANDLED> {
  if (!(ctx.header("accept") ?? "").includes("text/event-stream")) {
    throw new ApiError(406, "not_acceptable", "Send Accept: text/event-stream to open the event stream.");
  }
  const user = await ctx.user();
  const parts = ctx.url.searchParams.get("parts") ?? "";
  const slugs = parts === "*" ? null : new Set(parts.split(",").filter((slug) => slug !== ""));
  const lastId = /^\d+$/.test(ctx.header("last-event-id") ?? "") ? Number(ctx.header("last-event-id")) : null;
  const stream = new EventStream(ctx.res, user?.id ?? null, slugs, lastId ?? 0);
  ctx.res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  ctx.res.write("retry: 1000\n\n");
  streams.add(stream);
  const heartbeat = setInterval(() => ctx.res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  ctx.res.on("close", () => {
    clearInterval(heartbeat);
    streams.delete(stream);
  });
  if (lastId === null) stream.skipCatchUp();
  else await stream.catchUp();
  return HANDLED;
}

// ------------------------------------------------------------------------------------------------ dropping streams

function closeLocalStreams(): void {
  for (const stream of streams) stream.close();
}

const dropsStarted = new Set<string>();
const acknowledgements = new Map<string, () => void>();

listen("drop-streams", (token) => {
  if (dropsStarted.has(token)) return;
  closeLocalStreams();
  void attempt((client) => client.publish(key("drop-streams-ack"), token), 0);
});
listen("drop-streams-ack", (token) => acknowledgements.get(token)?.());

/** Closes every open stream on every app process, answering once the others have confirmed. */
async function dropStreams() {
  closeLocalStreams();
  const token = newId();
  dropsStarted.add(token);
  const receivers = await attempt((client) => client.publish(key("drop-streams"), token), 0);
  let missing = Math.max(0, receivers - 1);
  if (missing > 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      acknowledgements.set(token, () => {
        missing -= 1;
        if (missing === 0) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }
  acknowledgements.delete(token);
  dropsStarted.delete(token);
  return noContent;
}

export const eventRoutes: Route[] = [get("/api/events", openStream), post("/api/grading/drop-streams", dropStreams)];
