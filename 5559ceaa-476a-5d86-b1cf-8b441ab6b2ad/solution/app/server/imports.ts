import { randomUUID } from "node:crypto";
import { sha256Hex } from "./storage.js";
import { config } from "./config.js";
import { many, one, pool, tx } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { audit, bumpEpoch } from "./files.js";
import { broadcast } from "./hub.js";
import { expired, lockProject } from "./rules.js";
import { deleteObject, getObject, putObject, StorageUnavailable } from "./storage.js";
import { checkZip } from "./zip.js";
import { FILE_COLUMNS, type FileRow, fileView, iso, mentorOnly } from "./views.js";

const quarantineKey = (id: string): string => `quarantine/${id}.zip`;

type EntryStatus = "new" | "changed" | "unchanged";

interface PlanEntry {
  path: string;
  status: EntryStatus;
  file_id: string | null;
  revision: number | null;
  sha256: string;
}

interface Plan {
  entries: PlanEntry[];
  only_in_project: string[];
  ignored: string[];
}

interface ImportRow {
  id: string;
  project_id: string;
  state: "planned" | "applied" | "superseded" | "expired";
  plan: Plan;
  expires_at: Date;
}

export async function planImport(projectId: string, userId: string, zip: Buffer): Promise<Record<string, unknown>> {
  await mentorOnly(pool, projectId, userId);
  const id = randomUUID();
  let stored = true;
  try {
    await putObject(quarantineKey(id), zip, "application/zip");
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    stored = false;
  }
  const check = checkZip(zip);
  if (check.problems.length) {
    if (stored) await deleteObject(quarantineKey(id)).catch(() => undefined);
    throw new ApiError("import_rejected", { entries: check.problems });
  }
  if (!stored) throw new ApiError("storage_unavailable");
  const expiresAt = new Date(Date.now() + config.importPlanTtlSeconds * 1000);
  const plan = await tx(async (db) => {
    await lockProject(db, projectId);
    await db.query("UPDATE imports SET state = 'superseded' WHERE project_id = $1 AND state = 'planned'", [projectId]);
    const current = await many<FileRow>(
      db,
      `SELECT ${FILE_COLUMNS} FROM files WHERE project_id = $1 AND deleted_at IS NULL ORDER BY path COLLATE "C"`,
      [projectId],
    );
    const byPath = new Map(current.map((f) => [f.path, f]));
    const entries: PlanEntry[] = check.files.map((file) => {
      const sha = sha256Hex(file.content);
      const match = byPath.get(file.path);
      if (!match) return { path: file.path, status: "new", file_id: null, revision: null, sha256: sha };
      return {
        path: file.path,
        status: match.sha256 === sha ? "unchanged" : "changed",
        file_id: match.id,
        revision: match.revision,
        sha256: sha,
      };
    });
    const inZip = new Set(check.files.map((f) => f.path));
    const result: Plan = {
      entries,
      only_in_project: current.filter((f) => !inZip.has(f.path)).map((f) => f.path),
      ignored: check.ignored,
    };
    await db.query("INSERT INTO imports (id, project_id, state, plan, expires_at) VALUES ($1, $2, 'planned', $3, $4)", [
      id,
      projectId,
      JSON.stringify(result),
      expiresAt,
    ]);
    return result;
  });
  void sweepQuarantine();
  return {
    import: {
      id,
      state: "planned",
      expires_at: iso(expiresAt),
      entries: plan.entries.map((e) => ({ path: e.path, status: e.status, file_id: e.file_id })),
      only_in_project: plan.only_in_project,
      ignored: plan.ignored,
    },
  };
}

function decisionsOf(body: Record<string, unknown>, plan: Plan): Map<string, "keep" | "replace"> {
  const raw = body.decisions;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid({ decisions: "Send a decision for each changed file." });
  const changed = new Set(plan.entries.filter((e) => e.status === "changed").map((e) => e.path));
  const decisions = new Map<string, "keep" | "replace">();
  for (const [path, value] of Object.entries(raw)) {
    if (!changed.has(path) || (value !== "keep" && value !== "replace")) {
      throw invalid({ decisions: "Decide keep or replace for exactly the changed files." });
    }
    decisions.set(path, value);
  }
  if (decisions.size !== changed.size) throw invalid({ decisions: "Decide keep or replace for exactly the changed files." });
  return decisions;
}

export async function applyImport(importId: string, userId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await tx(async (db) => {
    const row = await one<ImportRow>(db, "SELECT id, project_id, state, plan, expires_at FROM imports WHERE id = $1", [importId]);
    if (!row) throw new ApiError("not_found");
    await mentorOnly(db, row.project_id, userId);
    await lockProject(db, row.project_id);
    const locked = (await one<ImportRow>(db, "SELECT id, project_id, state, plan, expires_at FROM imports WHERE id = $1 FOR UPDATE", [importId]))!;
    const running = await one<{ id: string }>(db, "SELECT id FROM sessions WHERE project_id = $1 AND state IN ('live', 'paused')", [
      locked.project_id,
    ]);
    if (running) throw new ApiError("session_in_progress", { session_id: running.id });
    if (locked.state === "applied") throw new ApiError("import_already_applied");
    if (locked.state === "expired" || (locked.state === "planned" && expired(locked.expires_at))) {
      throw new ApiError("import_plan_expired", { expires_at: iso(locked.expires_at) });
    }
    if (locked.state === "superseded") throw new ApiError("import_plan_stale");
    const current = new Map(
      (await many<FileRow>(db, `SELECT ${FILE_COLUMNS} FROM files WHERE project_id = $1 AND deleted_at IS NULL`, [locked.project_id])).map(
        (f) => [f.id, f],
      ),
    );
    const taken = new Set([...current.values()].map((f) => f.path));
    for (const entry of locked.plan.entries) {
      const now = entry.file_id ? current.get(entry.file_id) : undefined;
      const stale = entry.file_id ? !now || now.revision !== entry.revision || now.path !== entry.path : taken.has(entry.path);
      if (stale) throw new ApiError("import_plan_stale");
    }
    const decisions = decisionsOf(body, locked.plan);
    const zip = await getObject(quarantineKey(importId));
    if (zip === null) throw new ApiError("storage_unavailable");
    const contents = new Map(checkZip(zip).files.map((f) => [f.path, f.content]));
    const touched: FileRow[] = [];
    let added = 0;
    let replaced = 0;
    for (const entry of locked.plan.entries) {
      const bytes = contents.get(entry.path);
      if (!bytes || sha256Hex(bytes) !== entry.sha256) throw new ApiError("import_plan_stale");
      if (entry.status === "new") {
        const file = await one<FileRow>(
          db,
          `INSERT INTO files (id, project_id, path, content, sha256, size) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${FILE_COLUMNS}`,
          [randomUUID(), locked.project_id, entry.path, bytes, entry.sha256, bytes.length],
        );
        touched.push(fileView(file!));
        added += 1;
      } else if (entry.status === "changed" && decisions.get(entry.path) === "replace") {
        const file = await one<FileRow>(
          db,
          `UPDATE files SET content = $2, sha256 = $3, size = $4, revision = revision + 1 WHERE id = $1 RETURNING ${FILE_COLUMNS}`,
          [entry.file_id, bytes, entry.sha256, bytes.length],
        );
        touched.push(fileView(file!));
        replaced += 1;
      }
    }
    for (const file of touched) {
      await db.query(
        "INSERT INTO edit_log (project_id, file_id, user_id, action, revision, sha256) VALUES ($1, $2, $3, 'import', $4, $5)",
        [locked.project_id, file.id, userId, file.revision, file.sha256],
      );
    }
    if (touched.length) await bumpEpoch(db, locked.project_id);
    const counts = {
      added,
      replaced,
      kept: locked.plan.entries.filter((e) => e.status === "changed").length - replaced,
      unchanged: locked.plan.entries.filter((e) => e.status === "unchanged").length,
    };
    await db.query("UPDATE imports SET state = 'applied' WHERE id = $1", [importId]);
    await audit(db, locked.project_id, userId, "import_applied", { import_id: importId, ...counts });
    const files = await many<FileRow>(
      db,
      `SELECT ${FILE_COLUMNS} FROM files WHERE project_id = $1 AND deleted_at IS NULL ORDER BY path COLLATE "C"`,
      [locked.project_id],
    );
    return { projectId: locked.project_id, touched, counts, files: files.map(fileView) };
  });
  for (const file of result.touched) broadcast(result.projectId, { type: "file", file });
  void sweepQuarantine();
  return { import: { id: importId, state: "applied", ...result.counts }, files: result.files };
}

/** Marks plans expired from their expiry instant and deletes every quarantine object no plan needs. */
export async function sweepQuarantine(): Promise<void> {
  const planned = await many<{ id: string; expires_at: Date }>(pool, "SELECT id, expires_at FROM imports WHERE state = 'planned'");
  const lapsed = planned.filter((plan) => expired(plan.expires_at)).map((plan) => plan.id);
  if (lapsed.length) await pool.query("UPDATE imports SET state = 'expired' WHERE id = ANY($1::uuid[]) AND state = 'planned'", [lapsed]);
  await tx(async (db) => {
    const done = await many<{ id: string }>(
      db,
      "SELECT id FROM imports WHERE state <> 'planned' AND NOT quarantine_deleted LIMIT 50 FOR UPDATE SKIP LOCKED",
    );
    for (const row of done) {
      try {
        await deleteObject(quarantineKey(row.id));
      } catch (error) {
        if (error instanceof StorageUnavailable) return;
        throw error;
      }
      await db.query("UPDATE imports SET quarantine_deleted = true WHERE id = $1", [row.id]);
    }
  });
}
