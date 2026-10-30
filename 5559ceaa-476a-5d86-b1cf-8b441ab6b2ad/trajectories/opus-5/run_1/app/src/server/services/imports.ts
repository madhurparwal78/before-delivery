import { randomUUID } from 'node:crypto';
import type { EntryStatus, FileMeta, ImportDecision, User } from '../../shared/api.js';
import { pool, tx, type Queryable } from '../db.js';
import { quarantineKey } from '../domain/blobs.js';
import { hasPassed, importPlanExpiry } from '../domain/expiry.js';
import { readZip } from '../domain/zip.js';
import {
  importAlreadyApplied,
  importPlanExpired,
  importPlanStale,
  importRejected,
  notFound,
  sessionInProgress,
  validation,
} from '../http/errors.js';
import {
  blockingSession,
  bumpFileSeq,
  fileView,
  logEdit,
  soleRow,
  writeAudit,
  type FileRow,
} from '../repository.js';
import { publish } from './bus.js';
import { listFiles } from './fileWrites.js';
import {
  deleteObject,
  getObject,
  putObject,
  sha256Hex,
  StorageUnreachable,
} from './storage.js';

/** Drops a quarantined zip, leaving it for the sweep when storage is unreachable. */
async function dropQuarantine(importId: string): Promise<void> {
  try {
    await deleteObject(quarantineKey(importId));
  } catch (cause) {
    if (cause instanceof StorageUnreachable) return;
    throw cause;
  }
  await pool.query('update import_plans set quarantine_deleted = true where id = $1', [importId]);
}

interface PlannedEntry {
  path: string;
  status: EntryStatus;
  file_id: string | null;
  sha256: string;
  revision: number | null;
}

interface PlanRow {
  id: string;
  project_id: string;
  state: 'planned' | 'applied' | 'superseded' | 'expired';
  entries: PlannedEntry[];
  only_in_project: string[];
  ignored: string[];
  expires_at: Date;
}

export async function loadPlan(client: Queryable, importId: string): Promise<PlanRow> {
  if (!/^[0-9a-f-]{36}$/i.test(importId)) throw notFound();
  const { rows } = await client.query<PlanRow>(
    `select id, project_id, state, entries, only_in_project, ignored, expires_at
       from import_plans where id = $1`,
    [importId],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return row;
}

async function supersede(client: Queryable, projectId: string): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `update import_plans set state = 'superseded'
      where project_id = $1 and state = 'planned' returning id`,
    [projectId],
  );
  return rows.map((row) => row.id);
}

export async function planImport(
  projectId: string,
  archive: Buffer,
): Promise<{
  id: string;
  state: 'planned';
  expires_at: string;
  entries: { path: string; status: EntryStatus; file_id: string | null }[];
  only_in_project: string[];
  ignored: string[];
}> {
  const importId = randomUUID();
  await putObject(quarantineKey(importId), archive, { contentType: 'application/zip' });

  const reading = readZip(archive);
  if (!reading.accepted) {
    await deleteObject(quarantineKey(importId));
    throw importRejected(reading.problems);
  }


  const current = await listFiles(pool, projectId);
  const entries: PlannedEntry[] = reading.files.map((file) => {
    const match = current.find((row) => row.path === file.path);
    const sha256 = sha256Hex(file.bytes);
    if (match === undefined) {
      return { path: file.path, status: 'new', file_id: null, sha256, revision: null };
    }
    return {
      path: file.path,
      status: match.sha256 === sha256 ? 'unchanged' : 'changed',
      file_id: match.id,
      sha256,
      revision: match.revision,
    };
  });
  const onlyInProject = current
    .filter((row) => !reading.files.some((file) => file.path === row.path))
    .map((row) => row.path);

  const plannedAt = new Date();
  const expiresAt = importPlanExpiry(plannedAt);
  const superseded = await tx(async (client) => {
    const ids = await supersede(client, projectId);
    await client.query(
      `insert into import_plans (id, project_id, state, entries, only_in_project, ignored,
                                 expires_at, created_at)
       values ($1, $2, 'planned', $3, $4, $5, $6, $7)`,
      [
        importId,
        projectId,
        JSON.stringify(entries),
        JSON.stringify(onlyInProject),
        JSON.stringify(reading.ignored),
        expiresAt,
        plannedAt,
      ],
    );
    return ids;
  });
  for (const id of superseded) {
    await dropQuarantine(id);
  }

  return {
    id: importId,
    state: 'planned',
    expires_at: expiresAt.toISOString(),
    entries: entries.map((entry) => ({
      path: entry.path,
      status: entry.status,
      file_id: entry.file_id,
    })),
    only_in_project: onlyInProject,
    ignored: reading.ignored,
  };
}

const DECISIONS_MESSAGE = 'Send a keep or replace decision for each changed file.';

function readDecisions(
  raw: unknown,
  entries: readonly PlannedEntry[],
): Record<string, ImportDecision> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw validation({ decisions: DECISIONS_MESSAGE });
  }
  const given = raw as Record<string, unknown>;
  const changedPaths = entries
    .filter((entry) => entry.status === 'changed')
    .map((entry) => entry.path);
  const decided = Object.keys(given);
  if (decided.length !== changedPaths.length) throw validation({ decisions: DECISIONS_MESSAGE });
  const decisions: Record<string, ImportDecision> = {};
  for (const path of changedPaths) {
    const choice = given[path];
    if (choice !== 'keep' && choice !== 'replace') {
      throw validation({ decisions: DECISIONS_MESSAGE });
    }
    decisions[path] = choice;
  }
  return decisions;
}

export async function applyImport(
  plan: PlanRow,
  user: User,
  rawDecisions: unknown,
): Promise<{
  summary: { added: number; replaced: number; kept: number; unchanged: number };
  files: FileMeta[];
}> {
  const session = await blockingSession(pool, plan.project_id);
  if (session !== null) throw sessionInProgress(session.id);
  if (plan.state === 'applied') throw importAlreadyApplied();
  if (hasPassed(plan.expires_at, new Date())) throw importPlanExpired(plan.expires_at.toISOString());
  if (plan.state !== 'planned') throw importPlanStale();

  const current = await listFiles(pool, plan.project_id);
  for (const entry of plan.entries) {
    if (entry.status === 'new') {
      if (current.some((row) => row.path === entry.path)) throw importPlanStale();
      continue;
    }
    const match = current.find((row) => row.id === entry.file_id);
    if (match === undefined || match.revision !== entry.revision) throw importPlanStale();
  }

  const decisions = readDecisions(rawDecisions, plan.entries);

  const stored = await getObject(quarantineKey(plan.id));
  if (stored === null) throw importPlanStale();
  const reading = readZip(stored.body);
  if (!reading.accepted) throw importPlanStale();
  const bytesByPath = new Map(reading.files.map((file) => [file.path, file.bytes]));

  const summary = { added: 0, replaced: 0, kept: 0, unchanged: 0 };
  const touched = await tx(async (client) => {
    const written: FileMeta[] = [];
    for (const entry of plan.entries) {
      const bytes = bytesByPath.get(entry.path);
      if (bytes === undefined) throw importPlanStale();
      if (entry.status === 'unchanged') {
        summary.unchanged += 1;
        continue;
      }
      if (entry.status === 'changed' && decisions[entry.path] === 'keep') {
        summary.kept += 1;
        continue;
      }
      if (entry.status === 'new') {
        const id = randomUUID();
        const { rows } = await client.query<FileRow>(
          `insert into files (id, project_id, path, content, revision, sha256, size)
           values ($1, $2, $3, $4, 1, $5, $6)
           returning id, project_id, path, content, revision, sha256, size`,
          [id, plan.project_id, entry.path, bytes, entry.sha256, bytes.length],
        );
        const row = soleRow(rows);
        summary.added += 1;
        await logEdit(client, {
          projectId: plan.project_id,
          fileId: row.id,
          userId: user.id,
          actorName: user.name,
          revision: row.revision,
          sha256: row.sha256,
        });
        written.push(fileView(row));
        continue;
      }
      const { rows } = await client.query<FileRow>(
        `update files set content = $3, revision = revision + 1, sha256 = $4, size = $5
          where project_id = $1 and id = $2
          returning id, project_id, path, content, revision, sha256, size`,
        [plan.project_id, entry.file_id, bytes, entry.sha256, bytes.length],
      );
      const row = soleRow(rows);
      summary.replaced += 1;
      await logEdit(client, {
        projectId: plan.project_id,
        fileId: row.id,
        userId: user.id,
        actorName: user.name,
        revision: row.revision,
        sha256: row.sha256,
      });
      written.push(fileView(row));
    }

    if (summary.added > 0 || summary.replaced > 0) {
      await bumpFileSeq(client, plan.project_id);
    }
    await client.query(`update import_plans set state = 'applied' where id = $1`, [plan.id]);
    await writeAudit(client, {
      projectId: plan.project_id,
      type: 'import_applied',
      actorId: user.id,
      actorName: user.name,
      subject: {
        import_id: plan.id,
        added: summary.added,
        replaced: summary.replaced,
        kept: summary.kept,
      },
    });
    return written;
  });

  await dropQuarantine(plan.id);
  for (const file of touched) {
    await publish({ project_id: plan.project_id, frame: { type: 'file', file } });
  }
  return { summary, files: (await listFiles(pool, plan.project_id)).map(fileView) };
}

/** Marks plans expired and deletes their quarantined zip without any request. */
export async function sweepExpiredPlans(): Promise<void> {
  await pool.query(
    `update import_plans set state = 'expired'
      where id in (
        select id from import_plans
         where state = 'planned' and expires_at <= now()
         for update skip locked
         limit 50
      )`,
  );
  const { rows } = await pool.query<{ id: string }>(
    `select id from import_plans
      where quarantine_deleted = false and state <> 'planned' limit 50`,
  );
  for (const row of rows) {
    await dropQuarantine(row.id);
  }
}
