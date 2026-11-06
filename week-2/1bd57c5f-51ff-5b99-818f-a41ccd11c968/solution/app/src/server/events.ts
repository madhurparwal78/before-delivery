import type { ServerResponse } from "node:http";
import pg from "pg";
import { isCrew, type Trade, type Visit } from "../shared/domain";
import { canSeeItem, canSeeNote, jobAccess, type JobAccess } from "./access";
import type { PersonRow } from "./auth";
import { config } from "./config";
import { computeCosts } from "./costs";
import { afterCommit, beforeCommit, maybeOne, one, pool, rows, transactionScope, type Tx } from "./db";
import { ApiError } from "./errors";
import { projectItem, projectNote, projectRooms } from "./projection";
import type { ItemRecord, NoteRecord, RoomRow } from "./records";
import { countsByScope, countsFor, jobView, type CountsByScope } from "./views";

// The per-job event log. Writes record what they changed with `emit`; just before their
// transaction commits, the records take the next sequence numbers under the job's head row
// lock, so numbers follow commit order with no gaps, and a commit that changed the counts
// or the Costs figures adds one counts and one costs event. Streams on every process wake on
// a Postgres notification and project each event for their caller at delivery.

/** What a write records; ids and payloads are stored whole and projected per receiver. */
type EventDraft =
  | { type: "item"; item: ItemRecord; previousTrade: Trade | null }
  | { type: "item_deleted"; id: string; number: number; trade: Trade | null }
  | { type: "room"; room: RoomRow }
  | { type: "note"; itemId: string; itemTrade: Trade | null; note: NoteRecord; thread: NoteRecord[] }
  | { type: "plan"; revision: number | null; planUrl: string | null }
  | { type: "visit"; visit: Visit; memberId: string }
  | { type: "visit_deleted"; id: string; memberId: string }
  | { type: "job" }
  | { type: "role_ended"; memberId: string };

type StoredEvent =
  | Exclude<EventDraft, { type: "room" }>
  | { type: "counts"; counts: CountsByScope }
  | { type: "costs"; costs: Awaited<ReturnType<typeof computeCosts>> }
  | { type: "room"; room: RoomRow; counts: CountsByScope };

const CHANNEL = "snaglight_events";
const pending = new WeakMap<object, Map<string, EventDraft[]>>();

function draftsFor(tx: Tx, jobId: string): EventDraft[] {
  const scope = transactionScope(tx);
  let byJob = pending.get(scope);
  if (!byJob) {
    const created = new Map<string, EventDraft[]>();
    pending.set(scope, created);
    byJob = created;
    beforeCommit(tx, () => writeEvents(tx, created));
  }
  let list = byJob.get(jobId);
  if (!list) {
    list = [];
    byJob.set(jobId, list);
  }
  return list;
}

/** Records an event of this transaction's commit. */
export function emit(tx: Tx, jobId: string, draft: EventDraft): void {
  draftsFor(tx, jobId).push(draft);
}

/** Marks a commit that may change only the counts or the Costs figures (a contingency setting). */
export function touch(tx: Tx, jobId: string): void {
  draftsFor(tx, jobId);
}

function costFigures(costs: Awaited<ReturnType<typeof computeCosts>>): string {
  const { as_of: _moment, ...figures } = costs;
  return JSON.stringify(figures);
}

async function writeEvents(tx: Tx, byJob: Map<string, EventDraft[]>): Promise<void> {
  for (const [jobId, drafts] of byJob) {
    const head = await one<{ seq: string; counts: string | null; costs: string | null }>(
      tx,
      `INSERT INTO event_heads (job_id) VALUES ($1) ON CONFLICT (job_id) DO UPDATE SET job_id = EXCLUDED.job_id
       RETURNING seq, counts, costs`,
      [jobId],
    );
    const counts = await countsByScope(tx, jobId);
    const costs = await computeCosts(tx, jobId, null);
    const events: StoredEvent[] = drafts.map((draft) => (draft.type === "room" ? { ...draft, counts } : draft));
    if (JSON.stringify(counts) !== head.counts) events.push({ type: "counts", counts });
    if (costFigures(costs) !== head.costs) events.push({ type: "costs", costs });
    let seq = Number(head.seq);
    for (const event of events) {
      seq += 1;
      await tx.query("INSERT INTO event_log (job_id, seq, type, payload) VALUES ($1, $2, $3, $4::jsonb)", [
        jobId,
        seq,
        event.type,
        JSON.stringify(event),
      ]);
    }
    await tx.query("UPDATE event_heads SET seq = $2, counts = $3, costs = $4 WHERE job_id = $1", [
      jobId,
      seq,
      JSON.stringify(counts),
      costFigures(costs),
    ]);
    if (events.length > 0) {
      await tx.query("DELETE FROM event_log WHERE job_id = $1 AND seq <= $2", [jobId, seq - config.eventRetentionCount]);
      await tx.query("SELECT pg_notify($1, $2)", [CHANNEL, jobId]);
    }
    afterCommit(tx, () => wake(jobId));
  }
}

/** Sets a new job's baseline so its first write emits counts and costs only when they change. */
export async function startEventLog(tx: Tx, jobId: string): Promise<void> {
  await tx.query(
    `INSERT INTO event_heads (job_id, seq, counts, costs) VALUES ($1, 0, $2, $3)
     ON CONFLICT (job_id) DO NOTHING`,
    [jobId, JSON.stringify(await countsByScope(tx, jobId)), costFigures(await computeCosts(tx, jobId, null))],
  );
}

// ---------- Delivery ----------

type Frame = { type: string; data: unknown } | null;

/** What one receiver gets for a stored event: its projection, or nothing when out of scope. */
async function project(access: JobAccess, event: StoredEvent): Promise<Frame> {
  const crew = isCrew(access.role);
  switch (event.type) {
    case "item":
      if (canSeeItem(access, event.item.trade)) return { type: "item", data: { item: projectItem(access, event.item) } };
      if (event.previousTrade !== null && canSeeItem(access, event.previousTrade)) {
        return { type: "item_deleted", data: { id: event.item.id, number: event.item.number } };
      }
      return null;
    case "item_deleted":
      return canSeeItem(access, event.trade) ? { type: "item_deleted", data: { id: event.id, number: event.number } } : null;
    case "room": {
      const scoped = countsFor(access, event.counts).rooms.find((room) => room.id === event.room.id)!.counts;
      const [room] = projectRooms([event.room], []);
      return { type: "room", data: { room: { ...room, counts: scoped } } };
    }
    case "counts":
      return { type: "counts", data: countsFor(access, event.counts) };
    case "note":
      if (!canSeeItem(access, event.itemTrade) || !canSeeNote(access, event.note.audience)) return null;
      return { type: "note", data: { item_id: event.itemId, note: projectNote(access, event.note, event.thread) } };
    case "plan":
      return { type: "plan", data: { revision: event.revision, plan_url: event.planUrl } };
    case "visit":
      return crew || event.memberId === access.memberId ? { type: "visit", data: { visit: event.visit } } : null;
    case "visit_deleted":
      return crew || event.memberId === access.memberId ? { type: "visit_deleted", data: { id: event.id } } : null;
    case "costs":
      return crew ? { type: "costs", data: event.costs } : null;
    case "job":
      return { type: "job", data: { job: await jobView(pool, access) } };
    case "role_ended":
      return event.memberId === access.memberId ? { type: "role_ended", data: {} } : null;
  }
}

const listeners = new Map<string, Set<() => void>>();

function wake(jobId: string): void {
  for (const listener of listeners.get(jobId) ?? []) listener();
}

/** One connection per process listens for commits on every process sharing the database. */
export async function listenForEvents(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  client.on("notification", (message) => {
    if (message.payload) wake(message.payload);
  });
  client.on("error", (error) => {
    console.error("event listener lost its connection:", error.message);
    setTimeout(() => void listenForEvents(), 1_000);
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  } catch (error) {
    console.error("event listener could not connect:", (error as Error).message);
    setTimeout(() => void listenForEvents(), 1_000);
  }
}

const TICK_MS = 1_000;
const KEEP_ALIVE_MS = 15_000;

function resumePoint(header: string | string[] | undefined, query: string | null): number | null {
  for (const raw of [Array.isArray(header) ? header[0] : header, query]) {
    if (raw !== undefined && raw !== null && /^\d{1,15}$/.test(raw.trim())) return Number(raw.trim());
  }
  return null;
}

interface StreamRequest {
  person: PersonRow;
  tokenHash: string;
  jobId: string;
  lastEventId: string | string[] | undefined;
  after: string | null;
}

/** Checks access before the stream opens; the usual 401, 404 and role_ended answers come from here. */
export async function openStream(request: StreamRequest): Promise<(res: ServerResponse) => void> {
  const access = await jobAccess(pool, request.person, request.jobId);
  const head = await maybeOne<{ seq: string }>(pool, "SELECT seq FROM event_heads WHERE job_id = $1", [access.job.id]);
  const latest = Number(head?.seq ?? 0);
  const wanted = resumePoint(request.lastEventId, request.after);
  return (res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    });
    void runStream(res, request, access, latest, wanted);
  };
}

async function runStream(res: ServerResponse, request: StreamRequest, start: JobAccess, latest: number, wanted: number | null) {
  let cursor = latest;
  let closed = false;
  let access = start;
  const write = (text: string) => {
    if (!closed) res.write(text);
  };
  if (wanted !== null) {
    const oldest = await maybeOne<{ seq: string }>(pool, "SELECT min(seq) AS seq FROM event_log WHERE job_id = $1 HAVING count(*) > 0", [
      access.job.id,
    ]);
    const firstKept = Number(oldest?.seq ?? latest + 1);
    if (wanted > latest || (wanted < latest && wanted + 1 < firstKept)) write(`id: ${latest}\nevent: reset\ndata: {}\n\n`);
    else cursor = wanted;
  }
  let busy = false;
  let again = false;
  const deliver = async (): Promise<void> => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        const live = await maybeOne(pool, "SELECT 1 FROM sessions WHERE token_hash = $1", [request.tokenHash]);
        if (!live) return finish();
        const events = await rows<{ seq: string; payload: StoredEvent }>(
          pool,
          "SELECT seq, payload FROM event_log WHERE job_id = $1 AND seq > $2 ORDER BY seq",
          [access.job.id, cursor],
        );
        if (events.length > 0) {
          try {
            access = await jobAccess(pool, request.person, request.jobId);
          } catch (error) {
            if (!(error instanceof ApiError) || error.code !== "role_ended") return finish();
          }
        }
        for (const event of events) {
          cursor = Number(event.seq);
          const frame = await project(access, event.payload);
          if (!frame) continue;
          write(`id: ${cursor}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame.data)}\n\n`);
          if (frame.type === "role_ended") return finish();
        }
      } while (again && !closed);
    } catch (error) {
      console.error("event stream delivery failed:", (error as Error).message);
    } finally {
      busy = false;
    }
  };
  const listener = () => void deliver();
  const set = listeners.get(access.job.id) ?? new Set();
  set.add(listener);
  listeners.set(access.job.id, set);
  const tick = setInterval(listener, TICK_MS);
  const keepAlive = setInterval(() => write(": keep-alive\n\n"), KEEP_ALIVE_MS);
  function finish(): void {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    clearInterval(keepAlive);
    set.delete(listener);
    res.end();
  }
  res.on("close", finish);
  void deliver();
}
