import { createHash } from 'node:crypto';
import type { DbClient } from '../db/db.js';

export interface TreeEntry {
  name: string;
  mode: '100644' | '040000';
  id: string;
  type: 'blob' | 'tree';
}

export interface CommitRow {
  id: string;
  tree: string;
  parents: string[];
  author: string;
  author_time: number;
  committer: string;
  commit_time: number;
  message: string;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export function blobId(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  const header = `blob ${bytes.length}\n`;
  return createHash('sha256').update(header).update(bytes).digest('hex');
}

export function treeIdOf(entries: TreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => Buffer.from(a.name, 'utf8').compare(Buffer.from(b.name, 'utf8')));
  let text = 'tree\n';
  for (const e of sorted) text += `${e.mode} ${e.name} ${e.id}\n`;
  return createHash('sha256').update(text).digest('hex');
}

export function emptyTreeId(): string {
  return createHash('sha256').update('tree\n').digest('hex');
}

export function commitIdOf(tree: string, parents: string[], author: string, authorTime: number, committer: string, commitTime: number, message: string): string {
  const trimmed = message.replace(/[\t\n\v\f\r ]+$/, '');
  let text = `commit\ntree ${tree}\n`;
  for (const p of parents) text += `parent ${p}\n`;
  text += `author ${author} ${authorTime}\ncommitter ${committer} ${commitTime}\n\n${trimmed}`;
  return createHash('sha256').update(text).digest('hex');
}

// ---- object access ----

export async function storeBlob(c: DbClient, content: string, inlineMaxBytes: number, inlineOnly: boolean): Promise<string> {
  const id = blobId(content);
  const bytes = Buffer.from(content, 'utf8').length;
  const inline = bytes <= inlineMaxBytes;
  await c.query(
    `INSERT INTO blobs (id, size, content, inline_exceeded) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [id, bytes, inline ? content : null, !inline],
  );
  return id;
}

export async function storeTree(c: DbClient, entries: TreeEntry[]): Promise<string> {
  const id = treeIdOf(entries);
  await c.query(`INSERT INTO trees (id, entries) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, JSON.stringify(entries)]);
  return id;
}

export async function storeCommit(c: DbClient, row: Omit<CommitRow, 'id'>): Promise<string> {
  const id = commitIdOf(row.tree, row.parents, row.author, row.author_time, row.committer, row.commit_time, row.message);
  await c.query(
    `INSERT INTO commits (id, tree, parents, author, author_time, committer, commit_time, message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING`,
    [id, row.tree, row.parents, row.author, row.author_time, row.committer, row.commit_time, row.message],
  );
  return id;
}

export async function getCommit(c: DbClient, id: string): Promise<CommitRow | null> {
  const r = await c.query<CommitRow>(`SELECT id, tree, parents, author, author_time, committer, commit_time, message FROM commits WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function getBlobContent(c: DbClient, id: string, large: (key: string) => Promise<string | null>): Promise<string | null> {
  const r = await c.query<{ content: string | null; inline_exceeded: boolean }>(`SELECT content, inline_exceeded FROM blobs WHERE id = $1`, [id]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.inline_exceeded) return large(`blobs/${id}`);
  return row.content;
}

export async function getTreeEntries(c: DbClient, id: string): Promise<TreeEntry[] | null> {
  const r = await c.query<{ entries: TreeEntry[] | string }>(`SELECT entries FROM trees WHERE id = $1`, [id]);
  const row = r.rows[0];
  if (!row) return null;
  const e = row.entries;
  return typeof e === 'string' ? (JSON.parse(e) as TreeEntry[]) : e;
}

// ---- tree walking ----

export interface FlatTree {
  [path: string]: { id: string; mode: string } | null;
}

export async function readTreeFlat(c: DbClient, treeId: string): Promise<Map<string, string>> {
  // returns path -> blob id for every file
  const out = new Map<string, string>();
  await walk(c, treeId, '', out);
  return out;
}

async function walk(c: DbClient, treeId: string, prefix: string, out: Map<string, string>): Promise<void> {
  const entries = await getTreeEntries(c, treeId);
  if (!entries) return;
  for (const e of entries) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.type === 'tree') {
      await walk(c, e.id, p, out);
    } else {
      out.set(p, e.id);
    }
  }
}

export async function readTreeFull(c: DbClient, treeId: string, large: (key: string) => Promise<string | null>): Promise<Map<string, string>> {
  const ids = await readTreeFlat(c, treeId);
  const out = new Map<string, string>();
  for (const [path, id] of ids) {
    const content = await getBlobContent(c, id, large);
    if (content !== null) out.set(path, content);
  }
  return out;
}

export async function buildTreeFromFiles(c: DbClient, files: Map<string, string>, inlineMax: number): Promise<string> {
  type Node = { dirs: Map<string, Node>; files: Map<string, string> };
  const root: Node = { dirs: new Map(), files: new Map() };
  for (const [path, content] of files) {
    const parts = path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: new Map() });
      node = node.dirs.get(seg)!;
    }
    node.files.set(parts[parts.length - 1], content);
  }
  const writeTree = async (node: Node): Promise<string> => {
    const entries: TreeEntry[] = [];
    for (const [name, content] of node.files) {
      const id = await storeBlob(c, content, inlineMax, true);
      entries.push({ name, mode: '100644', id, type: 'blob' });
    }
    for (const [name, child] of node.dirs) {
      const id = await writeTree(child);
      entries.push({ name, mode: '040000', id, type: 'tree' });
    }
    return storeTree(c, entries);
  };
  return writeTree(root);
}

// ---- walks ----

export async function mergeBase(c: DbClient, from: string, to: string): Promise<string | null> {
  // BFS from `to`, parents in order; first visited commit also reachable from `from`
  const fromReachable = await reachable(c, from);
  const visited = new Set<string>();
  const queue: string[] = [to];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (fromReachable.has(id)) return id;
    const commit = await getCommit(c, id);
    if (!commit) continue;
    for (const p of commit.parents) if (!visited.has(p)) queue.push(p);
  }
  return null;
}

async function reachable(c: DbClient, from: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const commit = await getCommit(c, id);
    if (!commit) continue;
    for (const p of commit.parents) queue.push(p);
  }
  return seen;
}

export async function firstParentChain(c: DbClient, from: string, limit = 100000): Promise<CommitRow[]> {
  const out: CommitRow[] = [];
  let cur: string | null = from;
  const seen = new Set<string>();
  while (cur && out.length < limit && !seen.has(cur)) {
    seen.add(cur);
    const commit = await getCommit(c, cur);
    if (!commit) break;
    out.push(commit);
    cur = commit.parents[0] ?? null;
  }
  return out;
}

export async function isAncestor(c: DbClient, ancestor: string, descendant: string): Promise<boolean> {
  if (ancestor === descendant) return true;
  const chain = await reachable(c, descendant);
  return chain.has(ancestor);
}
