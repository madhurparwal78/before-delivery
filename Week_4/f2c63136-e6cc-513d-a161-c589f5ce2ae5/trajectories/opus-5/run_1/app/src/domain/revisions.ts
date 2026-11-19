import { createHash } from 'node:crypto';
import type { Db } from '../server/db.js';
import { serverNow } from '../server/clock.js';
import { getObject, putObject, sha256Hex } from '../server/storage.js';

export interface FileEntry {
  path: string;
  contentKey: string;
  size: number;
}

export type Snapshot = Map<string, FileEntry>;
export type Contents = Map<string, Buffer>;

export interface RevisionRecord {
  id: string;
  repoId: number;
  parents: string[];
  message: string;
  authorUsername: string;
  authorName: string;
  createdAt: Date;
}

export function byteOrder(a: string, b: string): number {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return Buffer.compare(left, right);
}

export function sortedPaths(paths: Iterable<string>): string[] {
  return [...paths].sort(byteOrder);
}

export function contentKey(content: Buffer): string {
  return `objects/${sha256Hex(content)}`;
}

export function computeRevisionId(parents: string[], message: string, contents: Contents): string {
  const parts: Buffer[] = [];
  for (const parent of parents) {
    parts.push(Buffer.from(`parent ${parent}\n`, 'utf8'));
  }
  const messageBytes = Buffer.from(message, 'utf8');
  parts.push(Buffer.from(`message ${messageBytes.length}\n`, 'utf8'), messageBytes, Buffer.from('\n', 'utf8'));
  for (const path of sortedPaths(contents.keys())) {
    const content = contents.get(path)!;
    parts.push(Buffer.from(`file ${content.length} ${path}\n`, 'utf8'), content, Buffer.from('\n', 'utf8'));
  }
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex').slice(0, 12);
}

export async function getSnapshot(tx: Db, repoId: number, revisionId: string): Promise<Snapshot> {
  const rows = await tx.query<{ path: string; content_key: string; size: number }>(
    'SELECT path, content_key, size FROM rs_revision_files WHERE repo_id = $1 AND revision_id = $2',
    [repoId, revisionId],
  );
  const snapshot: Snapshot = new Map();
  for (const row of rows) {
    snapshot.set(row.path, { path: row.path, contentKey: row.content_key, size: Number(row.size) });
  }
  return snapshot;
}

export async function loadContents(snapshot: Snapshot): Promise<Contents> {
  const contents: Contents = new Map();
  for (const path of sortedPaths(snapshot.keys())) {
    contents.set(path, await getObject(snapshot.get(path)!.contentKey));
  }
  return contents;
}

export async function readFileBytes(tx: Db, repoId: number, revisionId: string, path: string): Promise<Buffer | null> {
  const rows = await tx.query<{ content_key: string }>(
    'SELECT content_key FROM rs_revision_files WHERE repo_id = $1 AND revision_id = $2 AND path = $3',
    [repoId, revisionId, path],
  );
  if (rows.length === 0) return null;
  return getObject(rows[0].content_key);
}

export async function readFileText(tx: Db, repoId: number, revisionId: string, path: string): Promise<string | null> {
  const bytes = await readFileBytes(tx, repoId, revisionId, path);
  return bytes === null ? null : bytes.toString('utf8');
}

export async function getRevision(tx: Db, repoId: number, revisionId: string): Promise<RevisionRecord | null> {
  const rows = await tx.query<{
    id: string;
    parents: string[];
    message: string;
    author_username: string;
    author_name: string;
    created_at: Date;
  }>('SELECT id, parents, message, author_username, author_name, created_at FROM rs_revisions WHERE repo_id = $1 AND id = $2', [
    repoId,
    revisionId,
  ]);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    repoId,
    parents: row.parents,
    message: row.message,
    authorUsername: row.author_username,
    authorName: row.author_name,
    createdAt: row.created_at,
  };
}

export interface NewRevision {
  parents: string[];
  message: string;
  authorUsername: string;
  authorName: string;
  contents: Contents;
}

/** Stores every object, then records the revision. An existing revision with the same id is reused. */
export async function createRevision(tx: Db, repoId: number, revision: NewRevision): Promise<string> {
  for (const path of sortedPaths(revision.contents.keys())) {
    const content = revision.contents.get(path)!;
    await putObject(contentKey(content), content);
  }
  const id = computeRevisionId(revision.parents, revision.message, revision.contents);
  const existing = await tx.query('SELECT 1 FROM rs_revisions WHERE repo_id = $1 AND id = $2', [repoId, id]);
  if (existing.length > 0) return id;

  await tx.query(
    'INSERT INTO rs_revisions (repo_id, id, parents, message, author_username, author_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [repoId, id, revision.parents, revision.message, revision.authorUsername, revision.authorName, serverNow()],
  );
  for (const path of sortedPaths(revision.contents.keys())) {
    const content = revision.contents.get(path)!;
    const key = contentKey(content);
    await tx.query('INSERT INTO rs_objects (content_key, size) VALUES ($1, $2) ON CONFLICT (content_key) DO NOTHING', [
      key,
      content.length,
    ]);
    await tx.query(
      'INSERT INTO rs_revision_files (repo_id, revision_id, path, content_key, size) VALUES ($1, $2, $3, $4, $5)',
      [repoId, id, path, key, content.length],
    );
  }
  return id;
}

export async function getBranchRevision(tx: Db, repoId: number, branch: string): Promise<string | null> {
  const rows = await tx.query<{ revision_id: string }>(
    'SELECT revision_id FROM rs_branches WHERE repo_id = $1 AND name = $2',
    [repoId, branch],
  );
  return rows.length === 0 ? null : rows[0].revision_id;
}

export async function setBranchRevision(tx: Db, repoId: number, branch: string, revisionId: string): Promise<void> {
  await tx.query(
    'INSERT INTO rs_branches (repo_id, name, revision_id) VALUES ($1, $2, $3) ON CONFLICT (repo_id, name) DO UPDATE SET revision_id = $3',
    [repoId, branch, revisionId],
  );
}

export async function listBranches(tx: Db, repoId: number): Promise<Array<{ name: string; revision: string }>> {
  const rows = await tx.query<{ name: string; revision_id: string }>(
    'SELECT name, revision_id FROM rs_branches WHERE repo_id = $1 ORDER BY name',
    [repoId],
  );
  return rows.map((row) => ({ name: row.name, revision: row.revision_id }));
}
