// Moderation: mute (clearing the stored emote), unmute, force-rename, and the append-only
// audit with names snapshotted at the moment of each action.
import type pg from "pg";
import { all, one } from "./db";
import { conflict, forbidden, notFound } from "./errors";
import { courierName, iso } from "./ids";
import type { Courier } from "./sessions";

export type ModerationAction = "mute" | "unmute" | "rename";

interface Target {
  id: string;
  role: string;
  display_name: string;
  muted: boolean;
}

/** Step 6: the moderation reference names a courier. */
export async function targetOf(db: pg.PoolClient | pg.Pool, ref: string): Promise<Target> {
  const t = await one<Target>(db, "SELECT id, role, display_name, muted FROM couriers WHERE moderation_ref = $1", [ref]);
  if (!t) throw notFound();
  return t;
}

/** Step 7 beyond the staff check: helpers and the founder only moderate guests and couriers. */
export function requireModeratable(t: Target): void {
  if (t.role !== "guest" && t.role !== "courier") throw forbidden("cannot_moderate_staff");
}

export async function moderate(
  db: pg.PoolClient,
  actor: Courier,
  ref: string,
  action: ModerationAction,
  validateBody: () => void,
): Promise<object> {
  const t = (await one<Target>(
    db,
    "SELECT id, role, display_name, muted FROM couriers WHERE moderation_ref = $1 FOR UPDATE",
    [ref],
  ))!;
  if (action === "mute" && t.muted) throw conflict("already_muted");
  if (action === "unmute" && !t.muted) throw conflict("not_muted");
  validateBody();
  let after = t.display_name;
  let reply: object;
  if (action === "rename") {
    after = courierName();
    await db.query("UPDATE couriers SET display_name = $2, name_locked = true WHERE id = $1", [t.id, after]);
    reply = { display_name: after, name_locked: true };
  } else {
    const muted = action === "mute";
    await db.query("UPDATE couriers SET muted = $2, emote = NULL, emote_at = NULL WHERE id = $1", [t.id, muted]);
    reply = { display_name: t.display_name, muted };
  }
  const actorName = (await one<{ display_name: string }>(db, "SELECT display_name FROM couriers WHERE id = $1", [
    actor.id,
  ]))!.display_name;
  const { seq } = (await one<{ seq: number }>(db, "SELECT nextval('moderation_audit_seq_seq')::bigint AS seq"))!;
  await db.query(
    `INSERT INTO moderation_audit (seq, entry_id, action, actor_role, actor_display_name, moderation_ref,
                                   target_name_before, target_name_after, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [seq, `au_${String(seq).padStart(12, "0")}`, action, actor.role, actorName, ref, t.display_name, after, new Date()],
  );
  return reply;
}

export async function auditEntries(db: pg.Pool | pg.PoolClient): Promise<object> {
  const rows = await all<{
    entry_id: string;
    action: string;
    actor_role: string;
    actor_display_name: string;
    moderation_ref: string;
    target_name_before: string;
    target_name_after: string;
    at: Date;
  }>(
    db,
    `SELECT entry_id, action, actor_role, actor_display_name, moderation_ref, target_name_before, target_name_after, at
       FROM moderation_audit ORDER BY at DESC, entry_id DESC`,
  );
  return { entries: rows.map((r) => ({ ...r, at: iso(r.at) })) };
}
