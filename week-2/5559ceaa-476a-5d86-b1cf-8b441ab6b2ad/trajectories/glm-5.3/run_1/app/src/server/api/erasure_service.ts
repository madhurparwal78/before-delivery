import type { PoolClient } from "pg";
import { ApiError } from "../errors.js";
import type { Storage } from "../storage.js";
import type { User } from "../../shared/types.js";

interface PoolLike {
  connect(): Promise<PoolClient>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

interface CloseBus {
  closeSockets(projectId: string, userId: string, code: number, reason: string): void;
  publish(projectId: string, frame: Record<string, unknown>): void;
}

export class ErasureService {
  constructor(
    private pool: PoolLike,
    private storage: Storage,
    private bus: CloseBus,
  ) {}

  async eraseUser(user: User): Promise<void> {
    // If storage is unreachable, erasure gives storage_unavailable and nothing is removed.
    if (!(await this.storageReachable())) {
      throw new ApiError("storage_unavailable", "Storage is unreachable, so your account can't be erased right now.");
    }
    const client = await this.pool.connect();
    const oneToOneIds: string[] = [];
    const groupBlobTargets: { projectId: string; checkpointIds: string[] }[] = [];
    const socketProjectIds = await this.allProjectIds(user.id);
    try {
      await client.query("BEGIN");
      const oneToOne = await client.query(
        `SELECT p.id FROM projects p
         JOIN memberships m ON m.project_id = p.id
         WHERE m.user_id = $1 AND m.role = 'student' AND p.kind = 'one_to_one'`,
        [user.id],
      );
      for (const r of oneToOne.rows) oneToOneIds.push(r["id"] as string);
      for (const pid of oneToOneIds) {
        await client.query(`DELETE FROM checkpoint_files WHERE checkpoint_id IN (SELECT id FROM checkpoints WHERE project_id = $1)`, [pid]);
        await client.query(`DELETE FROM checkpoints WHERE project_id = $1`, [pid]);
        await client.query(`DELETE FROM reviewer_links WHERE project_id = $1`, [pid]);
        await client.query(`DELETE FROM import_plans WHERE project_id = $1`, [pid]);
        await client.query(`DELETE FROM restores WHERE project_id = $1`, [pid]);
        await client.query(`DELETE FROM files WHERE project_id = $1`, [pid]);
        await client.query(`DELETE FROM sessions WHERE project_id = $1`, [pid]);
        await client.query(`DELETE FROM memberships WHERE project_id = $1`, [pid]);
        await client.query(`DELETE FROM invite_email_status WHERE project_id = $1`, [pid]);
        await client.query(`DELETE FROM projects WHERE id = $1`, [pid]);
      }
      // Group projects: erase the learner's checkpoints and unreferenced blobs.
      const groups = await client.query(
        `SELECT p.id FROM projects p
         JOIN memberships m ON m.project_id = p.id
         WHERE m.user_id = $1 AND m.role = 'student' AND p.kind = 'group'`,
        [user.id],
      );
      for (const g of groups.rows) {
        const pid = g["id"] as string;
        const mine = await client.query(
          `SELECT id FROM checkpoints WHERE project_id = $1 AND created_by = $2`,
          [pid, user.id],
        );
        const mineIds = mine.rows.map((r) => r["id"] as string);
        if (mineIds.length > 0) {
          groupBlobTargets.push({ projectId: pid, checkpointIds: mineIds });
          await client.query(`DELETE FROM checkpoint_files WHERE checkpoint_id = ANY($1)`, [mineIds]);
          await client.query(`DELETE FROM reviewer_links WHERE checkpoint_id = ANY($1)`, [mineIds]);
          await client.query(`DELETE FROM checkpoints WHERE id = ANY($1)`, [mineIds]);
        }
        // Any later restore pointing at an erased checkpoint must go too.
        await client.query(
          `DELETE FROM restores WHERE project_id = $1 AND checkpoint_id NOT IN (SELECT id FROM checkpoints WHERE project_id = $1)`,
          [pid],
        );
      }
      await client.query(`DELETE FROM memberships WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM invite_email_status WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM auth_tokens WHERE email = $1`, [user.email]);
      await client.query(`DELETE FROM idempotency WHERE user_id = $1`, [user.id]);
      // Idempotency records owned by others may hold the erased address in stored responses.
      if (user.email) {
        await client.query(`DELETE FROM idempotency WHERE response_body::text LIKE '%' || $1 || '%'`, [user.email]);
      }
      await client.query(`DELETE FROM sessions_pg WHERE user_id = $1`, [user.id]);
      // Edit log and audit keep entries, with the actor shown as "Erased learner".
      await client.query(`UPDATE edit_log SET user_id = NULL, user_name = 'Erased learner' WHERE user_id = $1`, [user.id]);
      await client.query(
        `UPDATE audit_events SET actor_id = NULL, actor_name = 'Erased learner' WHERE actor_id = $1`,
        [user.id],
      );
      await client.query(`DELETE FROM email_queue WHERE to_email = $1`, [user.email ?? ""]);
      await client.query(`DELETE FROM users WHERE id = $1`, [user.id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    // Remove the stored objects the rows above pointed at.
    for (const pid of oneToOneIds) {
      await this.storage.deletePrefix(`projects/${pid}/`).catch(() => {});
    }
    for (const target of groupBlobTargets) {
      const manifestKeys = target.checkpointIds.map((id) => this.storage.manifestKey(target.projectId, id));
      await this.storage.deleteKeys(manifestKeys).catch(() => {});
      // Delete each blob that no remaining checkpoint in the project references.
      const remaining = await this.pool.query(
        `SELECT DISTINCT sha256 FROM checkpoint_files cf
         JOIN checkpoints c ON c.id = cf.checkpoint_id WHERE c.project_id = $1`,
        [target.projectId],
      );
      const referenced = new Set(remaining.rows.map((r) => r["sha256"] as string));
      const blobs = await this.storage.listPrefix(`projects/${target.projectId}/blobs/`).catch(() => [] as string[]);
      const orphans = blobs.filter((key) => !referenced.has(key.split("/").pop() ?? ""));
      await this.storage.deleteKeys(orphans).catch(() => {});
    }
    // Close sockets for every project they were in.
    for (const pid of socketProjectIds) {
      this.bus.closeSockets(pid, user.id, 4403, "removed");
    }
  }

  private async allProjectIds(userId: string): Promise<string[]> {
    const r = await this.pool.query(
      `SELECT project_id FROM memberships WHERE user_id = $1`,
      [userId],
    );
    return r.rows.map((row) => row["project_id"] as string);
  }

  private async storageReachable(): Promise<boolean> {
    const key = "healthcheck/erasure-probe";
    try {
      await this.storage.putObject(key, Buffer.from("ping"));
      await this.storage.deleteObject(key);
      return true;
    } catch {
      return false;
    }
  }
}

/** The single place the sign-in landing path is decided. */
export async function landingPath(
  pool: PoolLike,
  userId: string,
  purpose: string,
  inviteProjectId: string | null,
): Promise<string> {
  if (purpose === "invite" && inviteProjectId) {
    const still = await pool.query(
      `SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2`,
      [inviteProjectId, userId],
    );
    if ((still.rowCount ?? 0) > 0) return `/projects/${inviteProjectId}`;
    return "/";
  }
  const projects = await pool.query(
    `SELECT project_id FROM memberships WHERE user_id = $1`,
    [userId],
  );
  if ((projects.rowCount ?? 0) === 1) {
    const only = projects.rows[0];
    if (only) return `/projects/${only["project_id"] as string}`;
  }
  return "/";
}
