import type { ServerResponse } from "node:http";
import type { PoolClient } from "pg";
import { callerOf, resolveAccess, type Caller, type Lookup } from "./access";
import { maybeOne, one, pool, rows, transaction } from "./db";
import { notFound, passwordRequired, type Request } from "./http";
import { current, onChange } from "./services/status";
import { may } from "../shared/permissions";
import type { BoardEvent, Role, Services } from "../shared/types";

type Audience = { scope: "all" } | { scope: "staff"; alsoUser?: string } | { scope: "user"; userId: string };

interface StoredEvent {
  id: number;
  boardId: string;
  scope: Audience["scope"];
  userId: string | null;
  data: BoardEvent;
}

interface Stream {
  res: ServerResponse;
  caller: Caller;
  lookup: Lookup;
  role: Role | null;
  lastSent: number;
  backlog: StoredEvent[] | null;
}

const streams = new Map<string, Set<Stream>>();

export interface BoardWrite {
  db: PoolClient;
  emit(event: BoardEvent, audience?: Audience): Promise<void>;
  /** Marks that this write can change who may open the board, so open streams are re-checked after it commits. */
  accessChanged(): void;
}

/**
 * Every write that changes a board runs here: the board row is locked so writes to one board are serialised, events are
 * logged inside the same transaction, and they reach open streams only after the transaction has committed.
 */
export async function writeBoard<T>(boardId: string, work: (write: BoardWrite) => Promise<T>): Promise<T> {
  const committed: StoredEvent[] = [];
  let recheck = false;
  const result = await transaction(async (db) => {
    if (!(await maybeOne(db, `SELECT 1 FROM boards WHERE id = $1 FOR UPDATE`, [boardId]))) throw notFound();
    return work({
      db,
      accessChanged: () => {
        recheck = true;
      },
      emit: async (event, audience = { scope: "all" }) => {
        const userId = audience.scope === "user" ? audience.userId : audience.scope === "staff" ? (audience.alsoUser ?? null) : null;
        const { id } = await one<{ id: number }>(db, `INSERT INTO events (board_id, scope, user_id, data) VALUES ($1, $2, $3, $4) RETURNING id`, [
          boardId,
          audience.scope,
          userId,
          JSON.stringify(event),
        ]);
        committed.push({ id, boardId, scope: audience.scope, userId, data: event });
      },
    });
  });
  if (recheck) await recheckStreams(boardId);
  for (const event of committed) deliver(event);
  return result;
}

function visible(stream: Stream, event: StoredEvent): boolean {
  const userId = stream.caller.user?.id ?? null;
  if (event.scope === "all") return true;
  if (event.scope === "staff") return may("moderate", stream.role, null) || (userId !== null && event.userId === userId);
  return userId !== null && event.userId === userId;
}

function write(stream: Stream, event: StoredEvent): void {
  if (event.id <= stream.lastSent || !visible(stream, event)) return;
  stream.lastSent = event.id;
  stream.res.write(`id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function deliver(event: StoredEvent): void {
  for (const stream of streams.get(event.boardId) ?? []) {
    if (stream.backlog) stream.backlog.push(event);
    else write(stream, event);
  }
}

function close(boardId: string, stream: Stream, reason: "not_found" | "password_required" | null): void {
  if (reason) stream.res.write(`event: access_lost\ndata: ${JSON.stringify({ reason })}\n\n`);
  stream.res.end();
  streams.get(boardId)?.delete(stream);
}

async function recheckStreams(boardId: string): Promise<void> {
  for (const stream of [...(streams.get(boardId) ?? [])]) {
    const access = await resolveAccess(stream.caller, stream.lookup);
    if (access.kind === "ok") stream.role = access.role;
    else close(boardId, stream, access.kind === "password_required" ? "password_required" : "not_found");
  }
}

const KEEP_ALIVE_MS = 15_000;

function serviceLine(services: Services): string {
  return `event: services\ndata: ${JSON.stringify(services)}\n\n`;
}

onChange((services) => {
  for (const set of streams.values()) for (const stream of set) stream.res.write(serviceLine(services));
});

/** Opens a board's event stream for a caller who may read the board; replays what they missed after Last-Event-ID. */
export async function serveStream(request: Request, lookup: Lookup): Promise<void> {
  const caller = await callerOf(request);
  const access = await resolveAccess(caller, lookup);
  if (access.kind === "not_found") throw notFound();
  if (access.kind === "password_required") throw passwordRequired();
  const { res } = request;
  const boardId = access.board.id;
  const lastEventId = Number(request.req.headers["last-event-id"] ?? "");
  const resuming = Number.isInteger(lastEventId) && lastEventId > 0;
  const stream: Stream = { res, caller, lookup, role: access.role, lastSent: resuming ? lastEventId : 0, backlog: resuming ? [] : null };
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(`retry: 2000\n${serviceLine(current())}`);
  const set = streams.get(boardId) ?? new Set<Stream>();
  streams.set(boardId, set);
  set.add(stream);
  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), KEEP_ALIVE_MS);
  const leave = (): void => {
    clearInterval(keepAlive);
    set.delete(stream);
  };
  request.req.on("close", leave);
  res.on("error", leave);
  // Access can end between the check above and the registration (a board deleted, a link rotated): recheck once.
  const now = await resolveAccess(caller, lookup);
  if (now.kind !== "ok") {
    close(boardId, stream, now.kind === "password_required" ? "password_required" : "not_found");
    return;
  }
  if (stream.backlog) {
    const missed = await rows<{ id: number; scope: Audience["scope"]; user_id: string | null; data: BoardEvent }>(
      pool,
      `SELECT id, scope, user_id, data FROM events WHERE board_id = $1 AND id > $2 ORDER BY id`,
      [boardId, lastEventId],
    );
    for (const row of missed) write(stream, { id: row.id, boardId, scope: row.scope, userId: row.user_id, data: row.data });
    const backlog = stream.backlog;
    stream.backlog = null;
    for (const event of backlog) write(stream, event);
  }
}
