// The content-addressed store: blobs (inline in Postgres or in file storage), trees and commits of one project.
import { config } from "../config.ts";
import { Tx, type Queryable } from "../db.ts";
import { storageUnavailable } from "../errors.ts";
import { storage, StorageUnavailable } from "../s3.ts";
import { blobId, commitId, compareUtf8, normalizeMessage, type TreeEntry } from "../lib/objects.ts";
import { Lru } from "./lru.ts";
import { buildTrees, splitPath, type Entries } from "./trees.ts";
import type { CommitRow } from "./types.ts";

const NOTHING_COMMITTED = "File storage is unavailable. Nothing was committed. Try again in a moment.";

const OBJECT_ID = /^[0-9a-f]{64}$/;
const COMMIT_COLUMNS = "id, project_id, tree, parents, author, authored_at, committer, committed_at, message";

const commitCache = new Lru<CommitRow>(4000);
const treeCache = new Lru<readonly TreeEntry[]>(4000);
const entriesCache = new Lru<Entries>(48);

// Rows read inside a transaction may still roll back, so they enter the cache only once it commits.
function remember<V>(q: Queryable, cache: Lru<V>, key: string, value: V): void {
  if (q instanceof Tx) q.afterCommit(() => cache.set(key, value));
  else cache.set(key, value);
}

export function isObjectId(value: string): boolean {
  return OBJECT_ID.test(value);
}

export async function getCommit(q: Queryable, projectId: number, id: string): Promise<CommitRow | undefined> {
  if (!isObjectId(id)) return undefined;
  const key = `${projectId}:${id}`;
  const cached = commitCache.get(key);
  if (cached !== undefined) return cached;
  const row = await q.maybe<CommitRow>(`SELECT ${COMMIT_COLUMNS} FROM commits WHERE project_id = $1 AND id = $2`, [projectId, id]);
  if (row !== undefined) remember(q, commitCache, key, row);
  return row;
}

export async function requireCommit(q: Queryable, projectId: number, id: string): Promise<CommitRow> {
  const commit = await getCommit(q, projectId, id);
  if (commit === undefined) throw new Error(`Commit ${id} is missing from project ${projectId}`);
  return commit;
}

export async function loadCommits(q: Queryable, projectId: number, ids: Iterable<string>): Promise<Map<string, CommitRow>> {
  const found = new Map<string, CommitRow>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const cached = commitCache.get(`${projectId}:${id}`);
    if (cached === undefined) missing.push(id);
    else found.set(id, cached);
  }
  if (missing.length > 0) {
    const rows = await q.q<CommitRow>(`SELECT ${COMMIT_COLUMNS} FROM commits WHERE project_id = $1 AND id = ANY($2)`, [projectId, missing]);
    for (const row of rows) {
      found.set(row.id, row);
      remember(q, commitCache, `${projectId}:${row.id}`, row);
    }
  }
  return found;
}

async function loadTrees(q: Queryable, projectId: number, ids: readonly string[]): Promise<Map<string, readonly TreeEntry[]>> {
  const found = new Map<string, readonly TreeEntry[]>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const cached = treeCache.get(`${projectId}:${id}`);
    if (cached === undefined) missing.push(id);
    else found.set(id, cached);
  }
  if (missing.length > 0) {
    const rows = await q.q<{ id: string; entries: TreeEntry[] }>("SELECT id, entries FROM trees WHERE project_id = $1 AND id = ANY($2)", [projectId, missing]);
    for (const row of rows) {
      found.set(row.id, row.entries);
      remember(q, treeCache, `${projectId}:${row.id}`, row.entries);
    }
  }
  return found;
}

export async function treeEntries(q: Queryable, projectId: number, id: string): Promise<readonly TreeEntry[]> {
  const entries = (await loadTrees(q, projectId, [id])).get(id);
  if (entries === undefined) throw new Error(`Tree ${id} is missing from project ${projectId}`);
  return entries;
}

// Every file of a tree: path to blob id. The result is shared; callers copy before changing it.
async function entriesOfTree(q: Queryable, projectId: number, root: string): Promise<Entries> {
  const key = `${projectId}:${root}`;
  const cached = entriesCache.get(key);
  if (cached !== undefined) return cached;
  const files = new Map<string, string>();
  let level: Array<{ id: string; prefix: string }> = [{ id: root, prefix: "" }];
  while (level.length > 0) {
    const trees = await loadTrees(q, projectId, level.map((item) => item.id));
    const next: Array<{ id: string; prefix: string }> = [];
    for (const { id, prefix } of level) {
      const entries = trees.get(id);
      if (entries === undefined) throw new Error(`Tree ${id} is missing from project ${projectId}`);
      for (const entry of entries) {
        if (entry.mode === "040000") next.push({ id: entry.id, prefix: `${prefix}${entry.name}/` });
        else files.set(`${prefix}${entry.name}`, entry.id);
      }
    }
    level = next;
  }
  remember(q, entriesCache, key, files);
  return files;
}

export async function entriesOfCommit(q: Queryable, projectId: number, commit: string | null): Promise<Entries> {
  if (commit === null) return new Map();
  return entriesOfTree(q, projectId, (await requireCommit(q, projectId, commit)).tree);
}

// The tree entry (file or folder) at a path below a root tree, without flattening the whole tree.
export async function entryAt(q: Queryable, projectId: number, root: string, path: string): Promise<TreeEntry | undefined> {
  const segments = splitPath(path);
  let treeId = root;
  for (let i = 0; i < segments.length; i++) {
    const entry = (await treeEntries(q, projectId, treeId)).find((candidate) => candidate.name === segments[i]);
    if (entry === undefined) return undefined;
    if (i === segments.length - 1) return entry;
    if (entry.mode !== "040000") return undefined;
    treeId = entry.id;
  }
  return undefined;
}

interface BlobRow {
  readonly id: string;
  readonly size: number;
  readonly inline: Buffer | null;
  readonly external: boolean;
}

async function readBlobs(q: Queryable, projectId: number, ids: Iterable<string>): Promise<Map<string, Buffer>> {
  const wanted = [...new Set(ids)];
  const bytes = new Map<string, Buffer>();
  if (wanted.length === 0) return bytes;
  const rows = await q.q<BlobRow>("SELECT id, size, inline, external FROM blobs WHERE project_id = $1 AND id = ANY($2)", [projectId, wanted]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of wanted) {
    const row = byId.get(id);
    if (row === undefined) throw new Error(`Blob ${id} is missing from project ${projectId}`);
    if (row.inline !== null) {
      bytes.set(id, row.inline);
      continue;
    }
    let stored: Buffer | null;
    try {
      stored = await storage.get(`blobs/${id}`);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable();
      throw error;
    }
    if (stored === null) throw new Error(`Blob ${id} is missing from file storage`);
    bytes.set(id, stored);
  }
  return bytes;
}

export async function readTexts(q: Queryable, projectId: number, ids: Iterable<string>): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const [id, bytes] of await readBlobs(q, projectId, ids)) texts.set(id, bytes.toString("utf8"));
  return texts;
}

async function storeBlobs(tx: Tx, projectId: number, blobs: ReadonlyMap<string, Buffer>): Promise<void> {
  if (blobs.size === 0) return;
  const known = new Set(
    (await tx.q<{ id: string }>("SELECT id FROM blobs WHERE project_id = $1 AND id = ANY($2)", [projectId, [...blobs.keys()]])).map((row) => row.id),
  );
  for (const [id, bytes] of blobs) {
    if (known.has(id)) continue;
    if (bytes.length <= config.inlineMaxBytes) {
      await tx.q("INSERT INTO blobs (project_id, id, size, inline, external) VALUES ($1, $2, $3, $4, false) ON CONFLICT DO NOTHING", [projectId, id, bytes.length, bytes]);
      continue;
    }
    try {
      await storage.put(`blobs/${id}`, bytes);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable(NOTHING_COMMITTED);
      throw error;
    }
    await tx.q("INSERT INTO blobs (project_id, id, size, inline, external) VALUES ($1, $2, $3, NULL, true) ON CONFLICT DO NOTHING", [projectId, id, bytes.length]);
  }
}

async function storeTrees(tx: Tx, projectId: number, trees: ReadonlyMap<string, readonly TreeEntry[]>): Promise<void> {
  const known = new Set(
    (await tx.q<{ id: string }>("SELECT id FROM trees WHERE project_id = $1 AND id = ANY($2)", [projectId, [...trees.keys()]])).map((row) => row.id),
  );
  const fresh = [...trees].filter(([id]) => !known.has(id)).map(([id, entries]) => ({ id, entries }));
  if (fresh.length === 0) return;
  await tx.q(
    `INSERT INTO trees (project_id, id, entries)
     SELECT $1, t.id, t.entries FROM jsonb_to_recordset($2::jsonb) AS t(id text, entries jsonb) ON CONFLICT DO NOTHING`,
    [projectId, JSON.stringify(fresh)],
  );
}

interface NewCommit {
  readonly projectId: number;
  readonly parents: readonly string[];
  readonly entries: Entries;
  // The bytes of blobs that may not be stored yet.
  readonly blobs: ReadonlyMap<string, Buffer>;
  readonly author: string;
  readonly authoredAt: number;
  readonly committer: string;
  readonly committedAt: number;
  readonly message: string;
}

// Stores the blobs (file storage first for the large ones), the trees and the commit. No ref moves.
export async function storeCommit(tx: Tx, input: NewCommit): Promise<CommitRow> {
  await storeBlobs(tx, input.projectId, input.blobs);
  const built = buildTrees(input.entries);
  await storeTrees(tx, input.projectId, built.trees);
  const message = normalizeMessage(input.message);
  const id = commitId({
    tree: built.root, parents: input.parents, author: input.author, authoredAt: input.authoredAt,
    committer: input.committer, committedAt: input.committedAt, message,
  });
  const parents = [...input.parents];
  await tx.q(
    `INSERT INTO commits (project_id, id, tree, parents, author, authored_at, committer, committed_at, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
    [input.projectId, id, built.root, parents, input.author, input.authoredAt, input.committer, input.committedAt, message],
  );
  return {
    id, project_id: input.projectId, tree: built.root, parents, author: input.author, authored_at: input.authoredAt,
    committer: input.committer, committed_at: input.committedAt, message,
  };
}

// Blobs and entries for a snapshot given as text.
export function entriesOfFiles(files: ReadonlyMap<string, string>): { entries: Map<string, string>; blobs: Map<string, Buffer> } {
  const entries = new Map<string, string>();
  const blobs = new Map<string, Buffer>();
  for (const path of [...files.keys()].sort(compareUtf8)) {
    const bytes = Buffer.from(files.get(path) ?? "", "utf8");
    const id = blobId(bytes);
    entries.set(path, id);
    blobs.set(id, bytes);
  }
  return { entries, blobs };
}
