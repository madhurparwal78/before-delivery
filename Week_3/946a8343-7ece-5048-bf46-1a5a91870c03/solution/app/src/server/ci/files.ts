// The job workspace and everything a job keeps in file storage: artifacts, caches and reports (DP-26, DP-27).
// An object is recorded in Postgres only after file storage confirmed it.
import type { Queryable, Tx } from "../db.ts";
import { config } from "../config.ts";
import { now } from "../clock.ts";
import { storageUnavailableMessage } from "../errors.ts";
import { storage, StorageUnavailable } from "../s3.ts";
import { matchesGlob } from "../../shared/glob.ts";
import { expandVariables } from "./config/expand.ts";
import { parseReport } from "./report-data.ts";
import type { JobLog } from "./jobstore.ts";
import type { JobRow } from "./rows.ts";

type Origin = "write" | "cache" | "artifact";

export async function putWorkspaceFile(tx: Tx, jobId: number, path: string, content: string, origin: Origin): Promise<void> {
  await tx.q(
    `INSERT INTO ci_workspace (job_id, path, content, origin) VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id, path) DO UPDATE SET content = $3, origin = $4`,
    [jobId, path, content, origin],
  );
}

export async function workspaceFile(q: Queryable, jobId: number, path: string): Promise<string | null> {
  const row = await q.maybe<{ content: string }>("SELECT content FROM ci_workspace WHERE job_id = $1 AND path = $2", [jobId, path]);
  return row?.content ?? null;
}

interface WorkspaceRow {
  readonly path: string;
  readonly content: string;
}

async function matching(q: Queryable, jobId: number, patterns: readonly string[], origins: readonly Origin[]): Promise<WorkspaceRow[]> {
  const rows = await q.q<WorkspaceRow>(
    "SELECT path, content FROM ci_workspace WHERE job_id = $1 AND origin = ANY($2::text[]) ORDER BY path",
    [jobId, [...origins]],
  );
  return rows.filter((row) => patterns.some((pattern) => matchesGlob(pattern, row.path)));
}

export async function clearWorkspace(tx: Tx, jobId: number): Promise<void> {
  await tx.q("DELETE FROM ci_workspace WHERE job_id = $1", [jobId]);
}

function cacheFiles(text: string): Record<string, string> | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const files: Record<string, string> = {};
    for (const [path, content] of Object.entries(value)) {
      if (typeof content !== "string") return null;
      files[path] = content;
    }
    return files;
  } catch {
    return null;
  }
}

const cacheObject = (projectId: number, key: string): string => `caches/${projectId}/${key}`;
export const artifactObject = (jobId: number, path: string): string => `artifacts/${jobId}/${path}`;

export async function restoreCache(tx: Tx, job: JobRow, vars: Readonly<Record<string, string>>, log: JobLog): Promise<void> {
  const spec = job.spec.cache;
  if (spec === null || spec.policy === "push") return;
  const keys = [spec.key, ...spec.fallbackKeys].map((key) => expandVariables(key, vars));
  log.sys("section_start cache");
  try {
    let hitKey: string | null = null;
    let lastKey = keys[0] ?? "";
    for (const [index, key] of keys.entries()) {
      lastKey = key;
      const present = await storage.has(cacheObject(job.project_id, key));
      const saved = await tx.maybe<{ saved_at: number }>("SELECT saved_at FROM ci_caches WHERE project_id = $1 AND key = $2", [job.project_id, key]);
      if (!present || saved === undefined) continue;
      if (now() - saved.saved_at > config.cacheTtlMs) {
        log.sys(`Cache stale: ${key}`);
        continue;
      }
      const body = await storage.get(cacheObject(job.project_id, key));
      if (body === null) continue;
      const files = cacheFiles(body.toString("utf8"));
      if (files === null) continue;
      for (const [path, content] of Object.entries(files)) await putWorkspaceFile(tx, job.id, path, content, "cache");
      log.sys(index === 0 ? `Cache hit: ${key}` : `Cache hit from fallback: ${key}`);
      hitKey = key;
      break;
    }
    if (hitKey === null) log.sys(`Cache miss: ${lastKey}`);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    log.sys("Cache skipped: file storage is unavailable.");
  }
  log.sys("section_end cache");
}

export async function saveCache(tx: Tx, job: JobRow, vars: Readonly<Record<string, string>>, log: JobLog): Promise<void> {
  const spec = job.spec.cache;
  if (spec === null || spec.policy === "pull") return;
  const key = expandVariables(spec.key, vars);
  const patterns = spec.paths.map((path) => expandVariables(path, vars));
  const files = await matching(tx, job.id, patterns, ["write", "cache", "artifact"]);
  const map: Record<string, string> = {};
  for (const file of files) map[file.path] = file.content;
  try {
    await storage.put(cacheObject(job.project_id, key), JSON.stringify(map), "application/json");
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    log.sys("Cache skipped: file storage is unavailable.");
    return;
  }
  await tx.q(
    `INSERT INTO ci_caches (project_id, key, saved_at) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, key) DO UPDATE SET saved_at = $3`,
    [job.project_id, key, now()],
  );
  log.sys(`Cache saved: ${key}`);
}

/** Uploads the files the job wrote that match `artifacts.paths`; false when file storage refused (nothing recorded). */
export async function uploadArtifacts(tx: Tx, job: JobRow, vars: Readonly<Record<string, string>>, log: JobLog): Promise<boolean> {
  const spec = job.spec.artifacts;
  if (spec === null) return true;
  const files = await matching(tx, job.id, spec.paths.map((path) => expandVariables(path, vars)), ["write"]);
  log.sys("section_start artifacts");
  const uploaded: string[] = [];
  try {
    for (const file of files) {
      await storage.put(artifactObject(job.id, file.path), file.content);
      uploaded.push(file.path);
    }
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    for (const path of uploaded) await storage.delete(artifactObject(job.id, path)).catch(() => undefined);
    log.sys("Artifact upload failed: file storage is unavailable.");
    log.sys("section_end artifacts");
    return false;
  }
  const expiresAt = spec.expireInMs === "never" ? null : now() + (spec.expireInMs ?? config.artifactTtlMs);
  for (const file of files) {
    await tx.q(
      `INSERT INTO ci_artifacts (job_id, path, size, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (job_id, path) DO UPDATE SET size = $3, expires_at = $4, expired = false`,
      [job.id, file.path, Buffer.byteLength(file.content, "utf8"), expiresAt],
    );
  }
  log.sys(`Uploaded ${files.length} artifact files`);
  log.sys("section_end artifacts");
  return true;
}

/** Stores the reports the job emitted; false when file storage refused. */
export async function storeReports(tx: Tx, job: JobRow): Promise<boolean> {
  const latest = new Map(job.emitted.map((report) => [report.kind, report] as const));
  for (const report of latest.values()) {
    const kind = report.kind;
    const data = parseReport(kind, report.content);
    if (data === null) continue;
    try {
      await storage.put(`reports/${job.id}/${kind}.json`, report.content, "application/json");
    } catch (error) {
      if (error instanceof StorageUnavailable) return false;
      throw error;
    }
    await tx.q(
      `INSERT INTO ci_reports (job_id, kind, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (job_id, kind) DO UPDATE SET data = $3::jsonb`,
      [job.id, kind, JSON.stringify(data)],
    );
  }
  return true;
}

interface DependencyResult {
  readonly ok: boolean;
  readonly downloadedFrom: number[];
}

interface ArtifactRow {
  readonly path: string;
  readonly expired: boolean;
  readonly expires_at: number | null;
}

export const isExpired = (row: { expired: boolean; expires_at: number | null }): boolean =>
  row.expired || (row.expires_at !== null && row.expires_at <= now());

/** The jobs whose artifacts this job downloads: those it needs, or earlier stages, limited by `dependencies`. */
export async function dependencyJobs(q: Queryable, job: JobRow): Promise<Pick<JobRow, "id" | "name" | "stage_index">[]> {
  const siblings = await q.q<Pick<JobRow, "id" | "name" | "stage_index">>(
    "SELECT id, name, stage_index FROM ci_jobs WHERE pipeline_id = $1 AND NOT retried ORDER BY config_order, id",
    [job.pipeline_id],
  );
  const needs = job.spec.needs;
  const candidates =
    needs === null
      ? siblings.filter((sibling) => sibling.stage_index < job.stage_index)
      : needs.flatMap((name) => siblings.filter((sibling) => sibling.name === name));
  const only = job.spec.dependencies;
  return only === null ? candidates : candidates.filter((candidate) => only.includes(candidate.name));
}

/** Downloads the artifacts of the jobs this one needs (or of earlier stages) into its workspace; logs each one. */
export async function downloadDependencies(tx: Tx, job: JobRow, log: JobLog): Promise<DependencyResult> {
  const candidates = await dependencyJobs(tx, job);
  const downloadedFrom: number[] = [];
  for (const dependency of candidates) {
    const rows = await tx.q<ArtifactRow>("SELECT path, expired, expires_at FROM ci_artifacts WHERE job_id = $1 ORDER BY path", [dependency.id]);
    if (rows.length === 0) continue;
    if (rows.some(isExpired)) {
      log.sys(`Artifacts of ${dependency.name} have expired.`);
      return { ok: false, downloadedFrom };
    }
    try {
      for (const row of rows) {
        const body = await storage.get(artifactObject(dependency.id, row.path));
        if (body === null) {
          log.sys(`Artifacts of ${dependency.name} have expired.`);
          return { ok: false, downloadedFrom };
        }
        await putWorkspaceFile(tx, job.id, row.path, body.toString("utf8"), "artifact");
      }
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      log.sys(storageUnavailableMessage);
      return { ok: false, downloadedFrom };
    }
    log.sys(`Downloaded artifacts of ${dependency.name}`);
    downloadedFrom.push(dependency.id);
  }
  return { ok: true, downloadedFrom };
}
