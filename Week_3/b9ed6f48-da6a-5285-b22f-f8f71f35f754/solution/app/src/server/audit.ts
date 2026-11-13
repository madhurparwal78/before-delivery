// The staff action record: append-only, one row per staff write or automatic publication
// (brief: Business rules › Staff action record). A trigger refuses updates and deletes.

import type { Db } from "./db.js";
import { rows } from "./db.js";

type StaffAction =
  | "item_created"
  | "item_edited"
  | "transition"
  | "published"
  | "media_uploaded"
  | "source_created"
  | "session_created"
  | "session_cancelled"
  | "refund"
  | "order_note"
  | "price_change";

export async function recordAction(db: Db, actorEmail: string, action: StaffAction, targetType: string, targetId: string, detail: Record<string, unknown> = {}): Promise<void> {
  await db.query("INSERT INTO staff_actions (actor_email, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)", [
    actorEmail,
    action,
    targetType,
    targetId,
    JSON.stringify(detail),
  ]);
}

interface ActionRow {
  id: number;
  at: Date;
  actor_email: string;
  action: StaffAction;
  target_type: string;
  target_id: string;
  detail: Record<string, unknown>;
}

export async function listActions(db: Db): Promise<unknown[]> {
  const found = await rows<ActionRow>(db, "SELECT * FROM staff_actions ORDER BY at DESC, id DESC LIMIT 500");
  return found.map((r) => ({ ...r, id: String(r.id), at: r.at.toISOString() }));
}
