import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors.js";
import type { Storage } from "../storage.js";
import type { Config } from "../config.js";
import type { Bus } from "./ctx.js";
import type { User } from "../../shared/types.js";
import { checkWrite, requireAllowedWrite } from "./rules.js";
import { audit } from "./helpers.js";

interface StoredCheckpointFile {
  file_id: string;
  path: string;
  sha256: string;
  size: number;
  content: string;
}

interface PoolLike {
  connect(): Promise<PoolClient>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

export class CheckpointService {
  constructor(
    private pool: PoolLike,
    private storage: Storage,
    private bus: Bus,
    private cfg: Config,
  ) {}

  async saveCheckpoint(projectId: string, user: User, name: string): Promise<{ status: number; checkpoint: Record<string, unknown> }> {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      throw new ApiError("validation", "Give the checkpoint a name of 1 to 80 characters.", {
        fields: { name: "Give the checkpoint a name of 1 to 80 characters." },
      });
    }
    const client = await this.pool.connect();
    let checkpointId = "";
    try {
      await client.query("BEGIN");
      const files = await client.query(
        `SELECT id, path, sha256, size, content FROM files WHERE project_id = $1 ORDER BY path`,
        [projectId],
      );
      checkpointId = crypto.randomUUID();
      await client.query(
        `INSERT INTO checkpoints (id, project_id, name, state, created_by, file_count, upload_deadline)
         VALUES ($1,$2,$3,'pending_upload',$4,$5, now() + make_interval(secs => $6))`,
        [checkpointId, projectId, trimmed, user.id, files.rowCount, this.cfg.checkpointUploadDeadlineSeconds],
      );
      for (const f of files.rows as unknown as { id: string; path: string; sha256: string; size: number; content: string }[]) {
        await client.query(
          `INSERT INTO checkpoint_files (checkpoint_id, file_id, path, sha256, size, content)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [checkpointId, f.id, f.path, f.sha256, f.size, f.content],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const out = await this.uploadCheckpoint(checkpointId);
    return { status: out.status, checkpoint: out.checkpoint };
  }

  /** Try to upload every blob and the manifest. Called on save and by the retry sweep. */
  async uploadCheckpoint(checkpointId: string): Promise<{ status: number; checkpoint: Record<string, unknown> }> {
    const r = await this.pool.query(
      `SELECT id, project_id, state, upload_deadline FROM checkpoints WHERE id = $1`,
      [checkpointId],
    );
    if (r.rowCount === 0) throw new ApiError("not_found", "No such checkpoint.");
    const row = r.rows[0] as unknown as { id: string; project_id: string; state: string; upload_deadline: Date | null };
    if (row.state !== "pending_upload") {
      return { status: row.state === "failed" ? 202 : 201, checkpoint: await this.checkpointBody(checkpointId) };
    }
    const files = await this.pool.query(
      `SELECT file_id, path, sha256, size, content FROM checkpoint_files WHERE checkpoint_id = $1 ORDER BY path`,
      [checkpointId],
    );
    const fileList = files.rows as unknown as StoredCheckpointFile[];
    let complete = false;
    try {
      for (const f of fileList) {
        await this.storage.putBlobConfirmed(row.project_id, f.sha256, Buffer.from(f.content, "utf8"));
      }
      const cpRow = await this.pool.query(
        `SELECT c.name, c.created_at FROM checkpoints c WHERE c.id = $1`,
        [checkpointId],
      );
      const meta = cpRow.rows[0] as unknown as { name: string; created_at: Date };
      const manifest = {
        checkpoint_id: checkpointId,
        project_id: row.project_id,
        name: meta.name,
        created_at: meta.created_at.toISOString(),
        files: fileList.map((f) => ({ file_id: f.file_id, path: f.path, sha256: f.sha256, size: f.size })),
      };
      await this.storage.putObject(this.storage.manifestKey(row.project_id, checkpointId), Buffer.from(JSON.stringify(manifest), "utf8"));
      complete = true;
    } catch {
      complete = false;
    }
    if (complete) {
      await this.setCheckpointState(checkpointId, row.project_id, "saved");
      return { status: 201, checkpoint: await this.checkpointBody(checkpointId) };
    }
    const pastDeadline = row.upload_deadline !== null && row.upload_deadline.getTime() <= Date.now();
    if (pastDeadline) {
      await this.setCheckpointState(checkpointId, row.project_id, "failed");
    }
    return { status: 202, checkpoint: await this.checkpointBody(checkpointId) };
  }

  private async setCheckpointState(checkpointId: string, projectId: string, state: "saved" | "failed"): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE checkpoints SET state = $1 WHERE id = $2`, [state, checkpointId]);
      if (state === "saved") {
        await client.query(`UPDATE checkpoint_files SET content = '' WHERE checkpoint_id = $1`, [checkpointId]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    this.bus.publish(projectId, { type: "checkpoint", checkpoint: await this.checkpointBody(checkpointId) });
  }

  async checkpointBody(checkpointId: string): Promise<Record<string, unknown>> {
    const r = await this.pool.query(
      `SELECT c.id, c.project_id, c.name, c.state, c.created_by, c.created_at, c.file_count, u.name AS author_name
       FROM checkpoints c JOIN users u ON u.id = c.created_by
       WHERE c.id = $1`,
      [checkpointId],
    );
    if (r.rowCount === 0) throw new ApiError("not_found", "No such checkpoint.");
    const row = r.rows[0] as unknown as {
      id: string; project_id: string; name: string; state: string;
      created_by: string; created_at: Date; file_count: number; author_name: string;
    };
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      state: row.state,
      created_by: { id: row.created_by, name: row.author_name },
      created_at: row.created_at.toISOString(),
      file_count: row.file_count,
    };
  }

  /** The single place the damage check is decided. Reads every blob and hashes it. */
  async damageCheck(projectId: string, checkpointId: string): Promise<StoredCheckpointFile[]> {
    const files = await this.pool.query(
      `SELECT file_id, path, sha256, size FROM checkpoint_files WHERE checkpoint_id = $1 ORDER BY path`,
      [checkpointId],
    );
    const fileList = files.rows as unknown as { file_id: string; path: string; sha256: string; size: number }[];
    const damaged: string[] = [];
    const loaded: StoredCheckpointFile[] = [];
    let anyReadFailed = false;
    for (const f of fileList) {
      try {
        const bytes = await this.storage.getObject(this.storage.blobKey(projectId, f.sha256));
        if (sha256Hex(bytes) !== f.sha256) damaged.push(f.path);
        else loaded.push({ ...f, content: bytes.toString("utf8") });
      } catch {
        anyReadFailed = true;
      }
    }
    if (anyReadFailed) {
      const reachable = await this.probeStorage();
      if (!reachable) throw new ApiError("storage_unavailable", "Storage is unreachable.");
      for (const f of fileList) {
        if (!loaded.some((l) => l.file_id === f.file_id)) damaged.push(f.path);
      }
    }
    if (damaged.length > 0) {
      throw new ApiError("checkpoint_damaged", "This checkpoint's stored files don't match its record.", {
        paths: [...damaged].sort(),
      });
    }
    return loaded;
  }

  private async probeStorage(): Promise<boolean> {
    const key = "healthcheck/probe";
    try {
      await this.storage.putObject(key, Buffer.from("ping"));
      await this.storage.deleteObject(key);
      return true;
    } catch {
      return false;
    }
  }

  async restore(projectId: string, checkpointId: string, user: User): Promise<{ files: Record<string, unknown>[]; restoreId: string }> {
    const client = await this.pool.connect();
    let restoreId = "";
    try {
      await client.query("BEGIN");
      await requireAllowedWrite(await checkWrite(client, projectId, user.id));
      const cp = await client.query(
        `SELECT id, state FROM checkpoints WHERE id = $1 AND project_id = $2`,
        [checkpointId, projectId],
      );
      if (cp.rowCount === 0) throw new ApiError("not_found", "No such checkpoint.");
      const state = cp.rows[0]["state"] as string;
      if (state !== "saved") {
        throw new ApiError("checkpoint_not_saved", "This checkpoint hasn't finished uploading yet.", { state });
      }
      const current = await client.query(
        `SELECT id, path, revision, sha256, size, content FROM files WHERE project_id = $1 ORDER BY path`,
        [projectId],
      );
      const undoState = (current.rows as unknown as { id: string; path: string; revision: number; sha256: string; size: number; content: string }[])
        .map((f) => ({ id: f.id, path: f.path, revision: f.revision, sha256: f.sha256, size: f.size, content: f.content }));
      const stored = await this.damageCheck(projectId, checkpointId);
      restoreId = crypto.randomUUID();
      await client.query(
        `INSERT INTO restores (id, checkpoint_id, project_id, state, undo_state, created_by)
         VALUES ($1,$2,$3,'applied',$4,$5)`,
        [restoreId, checkpointId, projectId, JSON.stringify(undoState), user.id],
      );
      await client.query(`DELETE FROM files WHERE project_id = $1`, [projectId]);
      for (const f of stored) {
        const prior = undoState.find((u) => u.id === f.file_id);
        const revision = prior ? (prior.sha256 === f.sha256 ? prior.revision : prior.revision + 1) : 1;
        await client.query(
          `INSERT INTO files (id, project_id, path, revision, sha256, size, content)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [f.file_id, projectId, f.path, revision, f.sha256, f.size, f.content],
        );
      }
      await audit(client, projectId, "checkpoint_restored", user, JSON.stringify({ checkpoint_id: checkpointId }));
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const files = await this.pool.query(
      `SELECT id, path, revision, sha256, size FROM files WHERE project_id = $1 ORDER BY path`,
      [projectId],
    );
    const out = files.rows as unknown as Record<string, unknown>[];
    for (const f of out) this.bus.publish(projectId, { type: "file", file: f });
    return { files: out, restoreId };
  }

  async undoRestore(projectId: string, restoreId: string, user: User): Promise<{ files: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await requireAllowedWrite(await checkWrite(client, projectId, user.id));
      const r = await client.query(
        `SELECT id, checkpoint_id, state, undo_state FROM restores WHERE id = $1 AND project_id = $2 FOR UPDATE`,
        [restoreId, projectId],
      );
      if (r.rowCount === 0) throw new ApiError("not_found", "No such restore.");
      const restore = r.rows[0] as unknown as { id: string; checkpoint_id: string; state: string; undo_state: unknown };
      if (restore.state === "undone") {
        throw new ApiError("restore_already_undone", "This restore was already undone.");
      }
      const latest = await client.query(
        `SELECT id FROM restores WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [projectId],
      );
      const latestRow = latest.rows[0] as unknown as { id: string } | undefined;
      if (!latestRow || latestRow.id !== restoreId) {
        throw new ApiError("restore_superseded", "A later restore happened.");
      }
      const fileState = await client.query(
        `SELECT id, path, revision, sha256 FROM files WHERE project_id = $1 ORDER BY path`,
        [projectId],
      );
      const undo = restore.undo_state as { id: string; path: string; revision: number; sha256: string; size: number; content: string }[];
      const current = fileState.rows as unknown as { id: string; path: string; revision: number; sha256: string }[];
      if (!sameFiles(undo, current)) {
        throw new ApiError("restore_superseded", "This restore can't be undone because files changed after it.");
      }
      await client.query(`DELETE FROM files WHERE project_id = $1`, [projectId]);
      for (const f of undo) {
        await client.query(
          `INSERT INTO files (id, project_id, path, revision, sha256, size, content)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [f.id, projectId, f.path, f.revision, f.sha256, f.size, f.content],
        );
      }
      await client.query(`UPDATE restores SET state = 'undone' WHERE id = $1`, [restoreId]);
      await audit(client, projectId, "restore_undone", user, JSON.stringify({ checkpoint_id: restore.checkpoint_id }));
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const files = await this.pool.query(
      `SELECT id, path, revision, sha256, size FROM files WHERE project_id = $1 ORDER BY path`,
      [projectId],
    );
    const out = files.rows as unknown as Record<string, unknown>[];
    for (const f of out) this.bus.publish(projectId, { type: "file", file: f });
    return { files: out };
  }
}

function sameFiles(
  undo: { id: string; path: string; revision: number; sha256: string }[],
  current: { id: string; path: string; revision: number; sha256: string }[],
): boolean {
  if (undo.length !== current.length) return false;
  const byId = new Map(current.map((c) => [c.id, c]));
  for (const u of undo) {
    const c = byId.get(u.id);
    if (!c) return false;
    if (c.path !== u.path || c.revision !== u.revision || c.sha256 !== u.sha256) return false;
  }
  return true;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
