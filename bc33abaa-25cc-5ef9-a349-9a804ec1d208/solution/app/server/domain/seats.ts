// Seat accounting: seats used is active members plus open invitations.
import { rows, type Db } from "../db.js";

export async function seatsUsed(db: Db, workspaceId: string, now: Date): Promise<number> {
  const [row] = await rows<{ used: number }>(db,
    `SELECT (SELECT count(*) FROM members WHERE workspace_id = $1 AND removed_at IS NULL)::int
          + (SELECT count(*) FROM invites WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2)::int AS used`,
    [workspaceId, now]);
  return row.used;
}

/** Serialises seat-changing work for one workspace inside the caller's transaction. */
export async function lockSeats(db: Db, workspaceId: string): Promise<void> {
  await db.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [workspaceId]);
}
