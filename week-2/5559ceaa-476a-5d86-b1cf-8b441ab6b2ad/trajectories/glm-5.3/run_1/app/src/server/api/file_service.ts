import type { PoolClient } from "pg";
import type { Bus } from "./ctx.js";
import { ApiError } from "../errors.js";
import { checkWrite, requireAllowedWrite } from "./rules.js";
import { checkContent, checkPath, allowedExtension, normalizePath, unsafeSvg } from "../paths.js";
import { listFiles } from "./helpers.js";
import type { User } from "../../shared/types.js";

export interface FileOut { id: string; path: string; revision: number; sha256: string; size: number }

export class FileService {
  constructor(
    private pool: { connect(): Promise<PoolClient> },
    private bus: Bus,
  ) {}

  async createFile(projectId: string, user: User, rawPath: string, content: string): Promise<{ file: FileOut; extra?: Record<string, string> }> {
    const pc = checkPath(rawPath);
    if (!pc.ok) throw validation({ path: pc.code });
    if (!allowedExtension(pc.path)) throw validation({ path: "disallowed_type" });
    const bytes = Buffer.from(content, "utf8");
    const cc = checkContent(bytes);
    if (!cc.ok) throw validation({ content: cc.code });
    if (unsafeSvg(pc.path, bytes)) throw validation({ content: "unsafe_svg" });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await requireAllowedWrite(await checkWrite(client, projectId, user.id));
      const existing = await client.query(
        `SELECT id FROM files WHERE project_id = $1 AND path = $2`,
        [projectId, pc.path],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ApiError("path_taken", "A file already exists at that path.", { path: pc.path });
      }
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO files (id, project_id, path, revision, sha256, size, content)
         VALUES ($1,$2,$3,1,$4,$5,$6)`,
        [id, projectId, pc.path, cc.sha256, cc.size, content],
      );
      await this.logEdit(client, projectId, id, user, 1, cc.sha256);
      await client.query("COMMIT");
      const file = { id, path: pc.path, revision: 1, sha256: cc.sha256, size: cc.size };
      this.bus.publish(projectId, { type: "file", file });
      return { file };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async saveFile(projectId: string, user: User, fileId: string, content: string, baseRevision: number): Promise<{ file: FileOut }> {
    const bytes = Buffer.from(content, "utf8");
    const cc = checkContent(bytes);
    if (!cc.ok) throw validation({ content: cc.code });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const file = await this.lockedFile(client, projectId, fileId);
      await requireAllowedWrite(await checkWrite(client, projectId, user.id));
      // The single place the revision check is decided.
      if (file.revision !== baseRevision) {
        throw new ApiError("stale_revision", "A newer version was saved.", {
          current_revision: file.revision,
        });
      }
      const revision = file.revision + 1;
      await client.query(
        `UPDATE files SET revision = $1, sha256 = $2, size = $3, content = $4, updated_at = now() WHERE id = $5`,
        [revision, cc.sha256, cc.size, content, fileId],
      );
      await this.logEdit(client, projectId, fileId, user, revision, cc.sha256);
      await client.query("COMMIT");
      const out = { id: fileId, path: file.path, revision, sha256: cc.sha256, size: cc.size };
      this.bus.publish(projectId, { type: "file", file: out });
      return { file: out };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async renameFile(projectId: string, user: User, fileId: string, rawPath: string): Promise<{ file: FileOut }> {
    const pc = checkPath(rawPath);
    if (!pc.ok) throw validation({ path: pc.code });
    if (!allowedExtension(pc.path)) throw validation({ path: "disallowed_type" });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const file = await this.lockedFile(client, projectId, fileId);
      const clash = await client.query(
        `SELECT id FROM files WHERE project_id = $1 AND path = $2 AND id <> $3`,
        [projectId, pc.path, fileId],
      );
      if (clash.rowCount && clash.rowCount > 0) {
        throw new ApiError("path_taken", "A file already exists at that path.", { path: pc.path });
      }
      await client.query(`UPDATE files SET path = $1 WHERE id = $2`, [pc.path, fileId]);
      await client.query(
        `INSERT INTO audit_events (id, project_id, type, actor_id, actor_name, subject, at)
         VALUES ($1,$2,'file_renamed',$3,$4,$5,now())`,
        [crypto.randomUUID(), projectId, user.id, user.name, JSON.stringify({ file_id: fileId, from: file.path, to: pc.path })],
      );
      await client.query("COMMIT");
      const out = { id: fileId, path: pc.path, revision: file.revision, sha256: file.sha256, size: file.size };
      this.bus.publish(projectId, { type: "file", file: out });
      return { file: out };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async renameFolder(projectId: string, user: User, from: string, to: string): Promise<{ files: FileOut[] }> {
    const fromN = normalizePath(from).replace(/\/$/, "");
    const toN = normalizePath(to).replace(/\/$/, "");
    const fc = checkPath(toN);
    if (!fc.ok) throw validation({ to: fc.code });
    if (fromN === "") throw validation({ from: "is required" });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const under = await listFiles(client, projectId);
      const moving = under.filter((f) => f.path === fromN || f.path.startsWith(fromN + "/"));
      if (moving.length === 0) throw validation({ from: "no file sits under this folder" });
      for (const m of moving) {
        const target = m.path === fromN ? toN : toN + m.path.slice(fromN.length);
        if (!allowedExtension(target)) throw validation({ to: "disallowed_type" });
        const clash = await client.query(
          `SELECT id FROM files WHERE project_id = $1 AND path = $2 AND id <> $3`,
          [projectId, target, m.id],
        );
        if (clash.rowCount && clash.rowCount > 0) {
          throw new ApiError("path_taken", "A file already exists at that path.", { path: target });
        }
      }
      const out: FileOut[] = [];
      for (const m of moving) {
        const target = m.path === fromN ? toN : toN + m.path.slice(fromN.length);
        await client.query(`UPDATE files SET path = $1 WHERE id = $2`, [target, m.id]);
        await client.query(
          `INSERT INTO audit_events (id, project_id, type, actor_id, actor_name, subject, at)
           VALUES ($1,$2,'file_renamed',$3,$4,$5,now())`,
          [crypto.randomUUID(), projectId, user.id, user.name, JSON.stringify({ file_id: m.id, from: m.path, to: target })],
        );
        out.push({ id: m.id, path: target, revision: m.revision, sha256: m.sha256, size: m.size });
      }
      await client.query("COMMIT");
      for (const f of out) this.bus.publish(projectId, { type: "file", file: f });
      return { files: out };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteFile(projectId: string, user: User, fileId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const file = await this.lockedFile(client, projectId, fileId);
      await requireAllowedWrite(await checkWrite(client, projectId, user.id));
      await client.query(`DELETE FROM files WHERE id = $1`, [fileId]);
      await client.query(
        `INSERT INTO audit_events (id, project_id, type, actor_id, actor_name, subject, at)
         VALUES ($1,$2,'file_deleted',$3,$4,$5,now())`,
        [crypto.randomUUID(), projectId, user.id, user.name, JSON.stringify({ file_id: fileId, path: file.path })],
      );
      await client.query("COMMIT");
      this.bus.publish(projectId, { type: "file_deleted", file_id: fileId });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  private async lockedFile(client: PoolClient, projectId: string, fileId: string): Promise<{ id: string; path: string; revision: number; sha256: string; size: number }> {
    const r = await client.query(
      `SELECT id, path, revision, sha256, size FROM files WHERE project_id = $1 AND id = $2 FOR UPDATE`,
      [projectId, fileId],
    );
    if (r.rowCount === 0) throw new ApiError("not_found", "No such file.");
    return r.rows[0] as { id: string; path: string; revision: number; sha256: string; size: number };
  }

  private async logEdit(client: PoolClient, projectId: string, fileId: string, user: User, revision: number, sha: string): Promise<void> {
    await client.query(
      `INSERT INTO edit_log (project_id, file_id, user_id, user_name, revision, sha256)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [projectId, fileId, user.id, user.name, revision, sha],
    );
  }
}

function validation(fields: Record<string, string>): ApiError {
  return new ApiError("validation", "Invalid input.", { fields });
}
