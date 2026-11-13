// The staff action record: append-only, one row per staff write or automatic publication
// (brief: Business rules › Staff action record). A trigger refuses updates and deletes.
import { rows } from "./db.js";
export async function recordAction(db, actorEmail, action, targetType, targetId, detail = {}) {
    await db.query("INSERT INTO staff_actions (actor_email, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)", [
        actorEmail,
        action,
        targetType,
        targetId,
        JSON.stringify(detail),
    ]);
}
export async function listActions(db) {
    const found = await rows(db, "SELECT * FROM staff_actions ORDER BY at DESC, id DESC LIMIT 500");
    return found.map((r) => ({ ...r, id: String(r.id), at: r.at.toISOString() }));
}
