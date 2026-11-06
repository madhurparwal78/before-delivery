import type { IncomingMessage, ServerResponse } from "node:http";
import { withClient, isDatabaseOk } from "./db.ts";
import type { Client, Pool } from "./db.ts";
import type { Config } from "./env.ts";
import { nowMs } from "./clock.ts";
import type { Ctx, PersonRow } from "./scope.ts";
import { requireCtx, visibleScope } from "./scope.ts";
import { issueJson, issueByKey } from "./domain.ts";
import { messageById, messageJsonFor, knockJson } from "./proj.ts";
import { unreadCountsFor } from "./store.ts";

interface LiveStream {
  workspaceId: string;
  personId: string;
  lastId: number;
  write: (chunk: string) => void;
  close: () => void;
  closed: boolean;
}

const live = new Set<LiveStream>();

export function localStreamCount(personId?: string): number {
  let n = 0;
  for (const s of live) {
    if (personId === undefined || s.personId === personId) n++;
  }
  return n;
}

function sseWrite(stream: LiveStream, id: number | undefined, name: string, data: unknown): void {
  if (stream.closed) return;
  if (id !== undefined) {
    stream.write(`id: ${id}\n`);
    stream.lastId = Math.max(stream.lastId, id);
  }
  stream.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** The SSE endpoint: replay from Last-Event-ID, then live delivery. */
export async function handleEventsEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
  person: PersonRow
): Promise<void> {
  if (!isDatabaseOk()) {
    const body = JSON.stringify({ error: { code: "database_unavailable", message: "The database is unreachable." } });
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }
  const lastEventId = Math.max(0, Number(req.headers["last-event-id"] ?? 0) || 0);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let finished = false;
  const stream: LiveStream = {
    workspaceId: person.workspace_id,
    personId: person.id,
    lastId: lastEventId,
    write: (chunk) => res.write(chunk),
    close: () => {
      if (finished) return;
      finished = true;
      stream.closed = true;
      clearInterval(keepalive);
      live.delete(stream);
      res.end();
      void releaseStreamState(stream);
    },
    closed: false,
  };
  live.add(stream);

  const keepalive = setInterval(() => {
    if (!stream.closed) res.write(": keepalive\n\n");
  }, 15000);

  req.on("close", () => stream.close());
  res.on("close", () => stream.close());

  await withClient(async (client) => {
    await client.query(
      `INSERT INTO stream_state (person_id, workspace_id, stream_count, last_disconnect)
       VALUES ($1, $2, 1, null)
       ON CONFLICT (person_id) DO UPDATE SET stream_count = stream_state.stream_count + 1`,
      [person.id, person.workspace_id]
    );
  });

  try {
    await withClient(async (client) => {
      const ctx = await requireCtx(client, person.id);
      // Only the 1,000 most recent events are kept; older cursors get one reset.
      const oldest = await client.query<{ id: string }>(
        "SELECT id FROM events WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1 OFFSET 999",
        [person.workspace_id]
      );
      const newest = await client.query<{ id: string }>(
        "SELECT id FROM events WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1",
        [person.workspace_id]
      );
      const newestId = Number(newest.rows[0]?.id ?? 0);
      if (lastEventId > 0) {
        if (oldest.rows.length === 0 || lastEventId < Number(oldest.rows[0].id)) {
          res.write("event: reset\ndata: {}\n\n");
          stream.lastId = Math.max(stream.lastId, newestId);
          return;
        }
      }
      const rows = await client.query<{ id: string; name: string; data: unknown }>(
        "SELECT id, name, data FROM events WHERE workspace_id = $1 AND id > $2 ORDER BY id ASC LIMIT 1000",
        [person.workspace_id, lastEventId]
      );
      for (const row of rows.rows) {
        await projectAndSend(cfg, client, ctx, stream, Number(row.id), row.name, row.data);
      }
      stream.lastId = Math.max(stream.lastId, newestId);
    });
  } catch {
    res.write("event: reset\ndata: {}\n\n");
  }
}

async function releaseStreamState(stream: LiveStream): Promise<void> {
  try {
    await withClient(async (client) => {
      await client.query(
        `UPDATE stream_state SET stream_count = GREATEST(stream_count - 1, 0),
           last_disconnect = CASE WHEN stream_count - 1 <= 0 THEN $1 ELSE last_disconnect END
         WHERE person_id = $2 AND workspace_id = $3`,
        [new Date(nowMs()).toISOString(), stream.personId, stream.workspaceId]
      );
    });
  } catch {
    // The sweeper reconciles occupancy when the database is reachable again.
  }
}

/**
 * Project one stored event for one person and send it, if they may see it now.
 * The per-event access check happens here, on live delivery and on replay alike.
 */
async function projectAndSend(
  cfg: Config,
  client: Client,
  ctx: Ctx,
  stream: LiveStream,
  id: number,
  name: string,
  dataRaw: unknown
): Promise<void> {
  const data = (typeof dataRaw === "string" ? (JSON.parse(dataRaw) as Record<string, unknown>) : (dataRaw as Record<string, unknown>));
  const scope = await visibleScope(ctx);
  switch (name) {
    case "message":
    case "thread_reply": {
      const row = await messageById(client, Number(data.id));
      if (!row || row.deleted) return;
      if (!scope.channelIds.has(row.channel_id)) return;
      sseWrite(stream, id, name, await messageJsonFor(client, row, ctx.person.id, ctx.zone));
      return;
    }
    case "message_deleted": {
      if (!scope.channelIds.has(String(data.channel_id))) return;
      sseWrite(stream, id, name, data);
      return;
    }
    case "unread": {
      if (String(data.person_id) !== ctx.person.id) return;
      sseWrite(stream, id, name, await unreadCountsFor(client, ctx.person.id));
      return;
    }
    case "typing": {
      if (!scope.channelIds.has(String(data.channel_id))) return;
      sseWrite(stream, id, name, data);
      return;
    }
    case "presence": {
      if (String(data.person_id) !== ctx.person.id && !scope.personIds.has(String(data.person_id))) return;
      sseWrite(stream, id, name, data);
      return;
    }
    case "room": {
      sseWrite(stream, id, name, data);
      return;
    }
    case "knock": {
      const row = await client.query<{ id: string; room_id: string; person_id: string; status: string; created_at: Date }>(
        "SELECT id, room_id, person_id, status, created_at FROM knocks WHERE id = $1",
        [String(data.id)]
      );
      if (row.rows.length === 0) return;
      const knock = row.rows[0];
      const isKnocker = knock.person_id === ctx.person.id;
      const inside = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM room_occupants WHERE room_id = $1 AND person_id = $2",
        [knock.room_id, ctx.person.id]
      );
      if (!isKnocker && Number(inside.rows[0].n) === 0) return;
      sseWrite(stream, id, name, knockJson(knock, ctx.zone, cfg.knockTtlSeconds));
      return;
    }
    case "issue": {
      const row = await issueByKey(ctx, String(data.key));
      if (!row || !scope.projectIds.has(row.project_id)) return;
      sseWrite(stream, id, name, await issueJson(ctx, row));
      return;
    }
    case "doc": {
      if (!scope.projectIds.has(String(data.project_id))) return;
      sseWrite(stream, id, name, data);
      return;
    }
    case "notice": {
      sseWrite(stream, id, name, data);
      return;
    }
    case "revoked": {
      if (String(data.person_id) !== ctx.person.id) return;
      sseWrite(stream, id, name, { scope: data.scope, id: data.scope_id });
      stream.close();
      return;
    }
    default:
      return;
  }
}

let dispatchCursor = 0;
let dispatchStarted = false;

/** The dispatch loop: polls the event log and pushes to matching live streams. */
export function startDispatchLoop(pool: Pool, cfg: Config): void {
  if (dispatchStarted) return;
  dispatchStarted = true;
  void (async () => {
    try {
      await withClient(async (client) => {
        const res = await client.query<{ id: string }>("SELECT id FROM events ORDER BY id DESC LIMIT 1");
        dispatchCursor = Number(res.rows[0]?.id ?? 0);
      });
    } catch {
      dispatchCursor = 0;
    }
  })();
  setInterval(() => {
    void dispatchTick(cfg);
  }, 250);
}

async function dispatchTick(cfg: Config): Promise<void> {
  if (live.size === 0) return;
  if (!isDatabaseOk()) return;
  try {
    await withClient(async (client) => {
      const res = await client.query<{ id: string; workspace_id: string; name: string; data: unknown }>(
        "SELECT id, workspace_id, name, data FROM events WHERE id > $1 ORDER BY id ASC LIMIT 200",
        [dispatchCursor]
      );
      for (const row of res.rows) {
        const id = Number(row.id);
        dispatchCursor = Math.max(dispatchCursor, id);
        for (const stream of [...live]) {
          if (stream.workspaceId !== row.workspace_id) continue;
          if (stream.lastId >= id) continue;
          try {
            const ctx = await requireCtx(client, stream.personId);
            await projectAndSend(cfg, client, ctx, stream, id, row.name, row.data);
          } catch {
            // The person's access changed or they were removed; close their stream.
            stream.close();
          }
        }
      }
    });
  } catch {
    // The database hiccupped; the next tick retries from the same cursor.
  }
}
