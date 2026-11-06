// Sessions and artwork entries share one state machine. Every move is recorded in an attributed history.
import { parseWall } from "../../shared/brussels.ts";
import type { User } from "../auth.ts";
import { transaction, type Db } from "../db/index.ts";
import { ApiError, FieldErrors, notFound } from "../http.ts";
import { audit } from "./audit.ts";
import { isoUtc } from "./time.ts";

type ItemKind = "session" | "entry";
type Mover = "curator" | "artist" | "system";

/** The legal moves (brief: Programme states and publishing). Everything else is illegal_transition. */
const MOVES: { from: string; to: string; by: readonly Mover[] }[] = [
  { from: "draft", to: "review", by: ["curator", "artist"] },
  { from: "review", to: "draft", by: ["curator"] },
  { from: "review", to: "scheduled", by: ["curator"] },
  { from: "scheduled", to: "review", by: ["curator"] },
  { from: "scheduled", to: "published", by: ["system"] },
  { from: "scheduled", to: "cancelled", by: ["curator"] },
  { from: "published", to: "cancelled", by: ["curator"] },
];

const TABLE: Record<ItemKind, string> = { session: "sessions", entry: "entries" };

function mover(actor: User): Mover {
  return actor.role === "curator" ? "curator" : "artist";
}

type History = { from: string; to: string; at: string; by: string }[];

export async function history(q: Db, kind: ItemKind, id: string): Promise<History> {
  const rows = await q.all<{ from_state: string; to_state: string; at: Date; by: string }>(
    "SELECT from_state, to_state, at, by FROM state_history WHERE item_kind = $1 AND item_id = $2 ORDER BY seq", [kind, id]);
  return rows.map((r) => ({ from: r.from_state, to: r.to_state, at: isoUtc(r.at), by: r.by }));
}

async function record(q: Db, kind: ItemKind, id: string, from: string, to: string, at: Date, by: string, note: string | null): Promise<void> {
  await q.query("INSERT INTO state_history (item_kind, item_id, from_state, to_state, at, by, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [kind, id, from, to, at, by, note]);
  const version = kind === "session" ? ", version = version + 1" : "";
  await q.query(`UPDATE ${TABLE[kind]} SET status = $2${version} WHERE id = $1`, [id, to]);
}

/** Moves every scheduled item whose publishing instant has come to published, at exactly that instant. */
async function publishDue(q: Db, now: Date, only?: { kind: ItemKind; id: string }): Promise<void> {
  for (const kind of ["session", "entry"] as const) {
    if (only && only.kind !== kind) continue;
    const due = await q.all<{ id: string; publish_at: Date }>(
      `SELECT id, publish_at FROM ${TABLE[kind]} WHERE status = 'scheduled' AND publish_at <= $1 AND ($2::text IS NULL OR id = $2)
       FOR UPDATE SKIP LOCKED`, [now, only?.id ?? null]);
    for (const item of due) {
      await record(q, kind, item.id, "scheduled", "published", item.publish_at, "system", null);
      await audit(q, "system", `${kind}.published`, { type: kind, id: item.id }, { publish_at: isoUtc(item.publish_at) }, item.publish_at);
    }
  }
}

export async function publishSweep(): Promise<void> {
  await transaction((tx) => publishDue(tx, new Date()));
}

type MoveRequest = { to: unknown; note: unknown; publish_at: unknown };
type MoveHooks = {
  /** Extra 422 checks for this move (an entry needs an image before review). */
  validate?: (to: string) => Promise<Record<string, string>>;
  /** Side effects of the move inside the same transaction; returns how many orders got refunds. */
  apply?: (to: string) => Promise<number>;
};

/**
 * Runs one requested move: the item must already be locked and visible to the actor (404 is the caller's).
 * Order of checks: 409 illegal_transition, then 422, then the move itself.
 */
export async function move(q: Db, kind: ItemKind, id: string, actor: User, request: MoveRequest, hooks: MoveHooks = {}): Promise<{ refunds: number }> {
  const now = new Date();
  await publishDue(q, now, { kind, id });
  const current = await q.one<{ status: string }>(`SELECT status FROM ${TABLE[kind]} WHERE id = $1`, [id]);
  if (!current) throw notFound();
  const to = typeof request.to === "string" ? request.to : "";
  const legal = MOVES.some((m) => m.from === current.status && m.to === to && m.by.includes(mover(actor)));
  if (!legal) throw new ApiError(409, "illegal_transition", { from: current.status, to });
  const errors: Record<string, string> = { ...(await hooks.validate?.(to)) };
  let publishAt: Date | null = null;
  if (to === "scheduled") {
    if (request.publish_at === null || request.publish_at === undefined || request.publish_at === "") errors.publish_at = "required";
    else {
      const parsed = parseWall(request.publish_at);
      if (!parsed.ok) errors.publish_at = "invalid";
      else if (parsed.instant <= now.getTime()) errors.publish_at = "not_in_future";
      else publishAt = new Date(parsed.instant);
    }
  }
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  const note = typeof request.note === "string" && request.note.trim() ? request.note.trim().slice(0, 1000) : null;
  if (to !== "cancelled") await q.query(`UPDATE ${TABLE[kind]} SET publish_at = $2 WHERE id = $1`, [id, publishAt]);
  await record(q, kind, id, current.status, to, now, actor.email, note);
  const refunds = (await hooks.apply?.(to)) ?? 0;
  await audit(q, actor, `${kind}.moved`, { type: kind, id }, { from: current.status, to, note, refunds_started: refunds });
  return { refunds };
}
