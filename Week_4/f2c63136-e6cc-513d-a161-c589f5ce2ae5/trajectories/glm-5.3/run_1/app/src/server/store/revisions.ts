import type pg from 'pg';
import { revisionId } from '../../shared/revision.js';
import { byteOrder } from '../../shared/bytes.js';
import type { CombinedFile } from '../../shared/rules.js';
import { combinedDiff } from '../../shared/rules.js';

export type Tx = pg.PoolClient;

export interface RepoRow {
  id: number;
  org_id: number;
  org: string;
  name: string;
  visibility: 'public' | 'private';
  required_approvals: number;
  required_checks: string[];
  queue: boolean;
}

export interface RevisionRow {
  id: string;
  message: string;
  author_username: string;
  author_name: string;
  parent1: string | null;
  parent2: string | null;
  created_at_ms: number;
}

export async function getRepoByPath(tx: Tx, org: string, name: string): Promise<RepoRow | null> {
  const r = await tx.query(
    `SELECT r.id, r.org_id, o.slug AS org, r.name, r.visibility, r.required_approvals, r.required_checks, r.queue
     FROM repos r JOIN orgs o ON o.id = r.org_id WHERE o.slug = $1 AND r.name = $2`,
    [org, name],
  );
  return r.rows[0] ?? null;
}

export async function getRepoById(tx: Tx, repoId: number): Promise<RepoRow | null> {
  const r = await tx.query(
    `SELECT r.id, r.org_id, o.slug AS org, r.name, r.visibility, r.required_approvals, r.required_checks, r.queue
     FROM repos r JOIN orgs o ON o.id = r.org_id WHERE r.id = $1`,
    [repoId],
  );
  return r.rows[0] ?? null;
}

export async function getRevision(tx: Tx, repoId: number, id: string): Promise<RevisionRow | null> {
  const r = await tx.query(
    'SELECT id, message, author_username, author_name, parent1, parent2, created_at_ms FROM revisions WHERE repo_id = $1 AND id = $2',
    [repoId, id],
  );
  return r.rows[0] ?? null;
}

export async function getBranch(tx: Tx, repoId: number, name: string): Promise<{ name: string; revision_id: string } | null> {
  const r = await tx.query('SELECT name, revision_id FROM branches WHERE repo_id = $1 AND name = $2', [repoId, name]);
  return r.rows[0] ?? null;
}

export interface RevisionFileRow { path: string; key: string; size: number }

export async function revisionFileRows(tx: Tx, repoId: number, revisionId: string): Promise<RevisionFileRow[]> {
  const r = await tx.query(
    'SELECT path, key, size FROM revision_files WHERE repo_id = $1 AND revision_id = $2',
    [repoId, revisionId],
  );
  return r.rows;
}

/**
 * Inserts a revision row (idempotently; an identical revision already present
 * is reused without change).
 */
export async function insertRevision(
  tx: Tx,
  repoId: number,
  id: string,
  message: string,
  author: { username: string; name: string },
  parents: [string | null, string | null],
  files: Map<string, { key: string; size: number }>,
  createdAtMs: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO revisions (repo_id, id, message, author_username, author_name, parent1, parent2, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (repo_id, id) DO NOTHING`,
    [repoId, id, message, author.username, author.name, parents[0], parents[1], createdAtMs],
  );
  for (const path of byteOrder([...files.keys()])) {
    const f = files.get(path)!;
    await tx.query(
      'INSERT INTO revision_files (repo_id, revision_id, path, key, size) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (repo_id, revision_id, path) DO NOTHING',
      [repoId, id, path, f.key, f.size],
    );
  }
}

export interface ChangeRow {
  repo_id: number;
  number: number;
  title: string;
  description: string;
  head_branch: string;
  base_branch: string;
  base_revision: string;
  state: 'draft' | 'open' | 'queued' | 'merged' | 'removed';
  draft: boolean;
  author_id: number;
  created_at_ms: number;
  removal_reason: string | null;
  merged_revision: string | null;
  restack_result: string | null;
  restack_dismissed: number | null;
  restack_notice: string | null;
  restack_notice_type: string | null;
  queue_revision_count: number;
}

export async function getChange(tx: Tx, repoId: number, number: number): Promise<ChangeRow | null> {
  const r = await tx.query('SELECT * FROM changes WHERE repo_id = $1 AND number = $2', [repoId, number]);
  return r.rows[0] ?? null;
}

/** The text of every file in a revision snapshot. */
export async function revisionFileTexts(
  tx: Tx,
  store: { get(key: string): Promise<string> },
  repoId: number,
  revisionId: string,
): Promise<Map<string, string>> {
  const rows = await revisionFileRows(tx, repoId, revisionId);
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.path, await store.get(row.key));
  return out;
}

/** The head revision of a change's head branch. */
export async function changeHeadRevision(tx: Tx, change: ChangeRow): Promise<string> {
  const b = await getBranch(tx, change.repo_id, change.head_branch);
  return b ? b.revision_id : change.base_revision;
}

/** The combined diff of a change, decided in one place. */
export async function changeCombinedDiff(
  tx: Tx,
  store: { get(key: string): Promise<string> },
  change: ChangeRow,
): Promise<CombinedFile[]> {
  const base = await revisionFileTexts(tx, store, change.repo_id, change.base_revision);
  const headRev = await changeHeadRevision(tx, change);
  const head = await revisionFileTexts(tx, store, change.repo_id, headRev);
  return combinedDiff(new Map(base), new Map(head));
}

export function computeRevisionId(
  parents: string[],
  message: string,
  files: Map<string, string>,
): string {
  return revisionId({
    parents,
    message,
    files: [...files.entries()].map(([path, content]) => ({ path, content })),
  });
}
