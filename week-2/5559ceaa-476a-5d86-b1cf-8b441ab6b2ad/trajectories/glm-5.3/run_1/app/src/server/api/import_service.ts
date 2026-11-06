import type { PoolClient } from "pg";
import { ApiError } from "../errors.js";
import type { Storage } from "../storage.js";
import type { Config } from "../config.js";
import type { Bus } from "./ctx.js";
import type { User } from "../../shared/types.js";
import { audit } from "./helpers.js";
import { sha256 } from "../paths.js";

interface PoolLike {
  connect(): Promise<PoolClient>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

interface PlanEntry {
  path: string;
  status: "new" | "changed" | "unchanged";
  file_id: string | null;
}

export class ImportService {
  constructor(
    private pool: PoolLike,
    private storage: Storage,
    private bus: Bus,
    private cfg: Config,
  ) {}

  async planImport(
    projectId: string,
    user: User,
    rawZip: Buffer,
    entries: { path: string; bytes: Buffer }[],
    ignored: string[],
  ): Promise<Record<string, unknown>> {
    const importId = crypto.randomUUID();
    const zipKey = this.storage.quarantineKey(importId);
    // The zip is written to quarantine first; unreachable storage stops the import.
    try {
      await this.storage.putObject(zipKey, rawZip);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("storage_unavailable", "Storage is unreachable, so zips can't be imported right now.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const files = await client.query(
        `SELECT id, path, sha256, revision FROM files WHERE project_id = $1`,
        [projectId],
      );
      const byPath = new Map(files.rows.map((f) => [f.path as string, f]));
      const planEntries: PlanEntry[] = [];
      const currentRevisions: Record<string, number> = {};
      for (const f of files.rows as unknown as { path: string; revision: number }[]) {
        currentRevisions[f.path] = f.revision;
      }
      for (const e of entries) {
        const existing = byPath.get(e.path);
        const hash = sha256(e.bytes);
        if (!existing) {
          planEntries.push({ path: e.path, status: "new", file_id: null });
        } else if (existing["sha256"] === hash) {
          planEntries.push({ path: e.path, status: "unchanged", file_id: existing["id"] as string });
        } else {
          planEntries.push({ path: e.path, status: "changed", file_id: existing["id"] as string });
        }
      }
      const onlyInProject = files.rows
        .map((f) => f.path as string)
        .filter((p) => !entries.some((e) => e.path === p));
      await client.query(
        `UPDATE import_plans SET state = 'superseded' WHERE project_id = $1 AND state = 'planned'`,
        [projectId],
      );
      const expiresAt = new Date(Date.now() + this.cfg.importPlanTtlSeconds * 1000);
      await client.query(
        `INSERT INTO import_plans (id, project_id, state, expires_at, zip_key, entries, only_in_project, ignored, file_revisions, created_by)
         VALUES ($1,$2,'planned',$3,$4,$5,$6,$7,$8,$9)`,
        [
          importId, projectId, expiresAt, this.storage.quarantineKey(importId),
          JSON.stringify({
            entries: planEntries,
            zipped: entries.map((e) => ({ path: e.path, content: e.bytes.toString("utf8") })),
          }),
          JSON.stringify(onlyInProject), JSON.stringify(ignored),
          JSON.stringify(currentRevisions), user.id,
        ],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      // The plan row never landed, so the quarantined zip goes too.
      await this.storage.deleteObject(zipKey).catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return await this.planRow(importId);
  }

  private async planRow(importId: string): Promise<Record<string, unknown>> {
    const r = await this.pool.query(
      `SELECT id, state, expires_at, entries, only_in_project, ignored FROM import_plans WHERE id = $1`,
      [importId],
    );
    const row = r.rows[0];
    if (!row) throw new ApiError("not_found", "No such import.");
    const stored = row["entries"] as { entries: PlanEntry[] };
    return {
      id: row["id"],
      state: row["state"],
      expires_at: (row["expires_at"] as Date).toISOString(),
      entries: stored.entries,
      only_in_project: row["only_in_project"],
      ignored: row["ignored"],
    };
  }

  async applyImport(
    projectId: string,
    importId: string,
    user: User,
    decisions: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    let added = 0;
    let replaced = 0;
    let kept = 0;
    let unchanged = 0;
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT id, project_id, state, expires_at, entries, file_revisions FROM import_plans WHERE id = $1 FOR UPDATE`,
        [importId],
      );
      if (r.rowCount === 0) throw new ApiError("not_found", "No such import.");
      const plan = r.rows[0];
      if (plan["project_id"] !== projectId) throw new ApiError("not_found", "No such import.");
      const stored = plan["entries"] as { entries: PlanEntry[]; zipped: { path: string; content: string }[] };
      const live = await client.query(
        `SELECT id FROM sessions WHERE project_id = $1 AND state IN ('live','paused')`,
        [projectId],
      );
      if (live.rowCount && (live.rowCount as number) > 0) {
        throw new ApiError("session_in_progress", "Imports are applied between sessions.", {
          session_id: (live.rows[0] as Record<string, unknown>)["id"],
        });
      }
      if (plan["state"] === "applied") {
        throw new ApiError("import_already_applied", "This import was already applied.");
      }
      const expiresAt = plan["expires_at"] as Date;
      if (expiresAt.getTime() <= Date.now()) {
        throw new ApiError("import_plan_expired", "This zip check has expired.", {
          expires_at: expiresAt.toISOString(),
        });
      }
      if (plan["state"] === "superseded") {
        throw new ApiError("import_plan_stale", "Files changed since this zip was checked.");
      }
      // Stale check: revisions and path availability must match planning.
      const plannedRevisions = plan["file_revisions"] as Record<string, number>;
      const files = await client.query(
        `SELECT id, path, revision, sha256 FROM files WHERE project_id = $1`,
        [projectId],
      );
      const byPath = new Map(files.rows.map((f) => [f["path"] as string, f]));
      for (const entry of stored.entries) {
        if (entry.status === "new") {
          if (byPath.has(entry.path)) {
            throw new ApiError("import_plan_stale", "Files changed since this zip was checked.");
          }
        } else {
          const f = byPath.get(entry.path);
          if (!f) {
            throw new ApiError("import_plan_stale", "Files changed since this zip was checked.");
          }
          if (plannedRevisions[entry.path] !== undefined && plannedRevisions[entry.path] !== f["revision"]) {
            throw new ApiError("import_plan_stale", "Files changed since this zip was checked.");
          }
        }
      }
      const changedPaths = stored.entries.filter((e) => e.status === "changed").map((e) => e.path);
      const decisionPaths = Object.keys(decisions);
      const missing = changedPaths.filter((p) => !decisionPaths.includes(p));
      const extra = decisionPaths.filter((p) => !changedPaths.includes(p));
      if (missing.length > 0 || extra.length > 0 || decisionPaths.some((p) => decisions[p] !== "keep" && decisions[p] !== "replace")) {
        throw new ApiError("validation", "Decisions must cover exactly the changed paths.", {
          fields: { decisions: "must name exactly the changed paths with keep or replace" },
        });
      }
      const contentByPath = new Map(stored.zipped.map((z) => [z.path, z.content]));
      const results: Record<string, unknown>[] = [];
      for (const entry of stored.entries) {
        const content = contentByPath.get(entry.path);
        if (content === undefined) continue;
        const bytes = Buffer.from(content, "utf8");
        if (entry.status === "new") {
          const id = crypto.randomUUID();
          const hash = sha256(bytes);
          await client.query(
            `INSERT INTO files (id, project_id, path, revision, sha256, size, content)
             VALUES ($1,$2,$3,1,$4,$5,$6)`,
            [id, projectId, entry.path, hash, bytes.length, content],
          );
          added++;
          results.push({ id, path: entry.path, revision: 1, sha256: hash, size: bytes.length });
        } else if (entry.status === "changed") {
          const decision = decisions[entry.path];
          const existing = byPath.get(entry.path);
          if (decision === "replace" && existing) {
            const newRevision = (existing["revision"] as number) + 1;
            const hash = sha256(bytes);
            await client.query(
              `UPDATE files SET revision = $1, sha256 = $2, size = $3, content = $4, updated_at = now() WHERE id = $5`,
              [newRevision, hash, bytes.length, content, existing["id"]],
            );
            replaced++;
            results.push({ id: existing["id"], path: entry.path, revision: newRevision, sha256: hash, size: bytes.length });
          } else if (decision === "keep" && existing) {
            kept++;
            results.push({ id: existing["id"], path: entry.path, revision: existing["revision"], sha256: existing["sha256"], size: existing["size"] });
          } else if (decision === "replace" && !existing) {
            throw new ApiError("import_plan_stale", "Files changed since this zip was checked.");
          }
        } else {
          unchanged++;
          const existing = byPath.get(entry.path);
          if (existing) {
            results.push({ id: existing["id"], path: entry.path, revision: existing["revision"], sha256: existing["sha256"], size: existing["size"] });
          }
        }
      }
      await client.query(`UPDATE import_plans SET state = 'applied' WHERE id = $1`, [importId]);
      await audit(client, projectId, "import_applied", user, JSON.stringify({ import_id: importId }));
      await client.query("COMMIT");
      try {
        await this.storage.deleteObject(this.storage.quarantineKey(importId));
      } catch {
        // the sweep also deletes quarantine objects
      }
      for (const f of results) this.bus.publish(projectId, { type: "file", file: f });
      return {
        import: { id: importId, state: "applied", added, replaced, kept, unchanged },
        files: results,
      };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Sweep expired plans and delete their quarantine objects. */
  async sweepExpired(): Promise<void> {
    const r = await this.pool.query(
      `UPDATE import_plans SET state = 'expired', sweep_claimed_at = now()
       WHERE state = 'planned' AND expires_at <= now()
       RETURNING id, zip_key`,
    );
    for (const row of r.rows as unknown as { id: string; zip_key: string }[]) {
      try {
        await this.storage.deleteObject(row.zip_key);
      } catch {
        // retry on the next sweep
      }
    }
  }
}
