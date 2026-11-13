import { createHash } from 'node:crypto';
import { lineDiff, splitLines } from './diff';
import { Sql } from './db';
import { ApiError, errors } from './errors';
import { Tx } from './live';
import { config } from './config';
import { getObject, putObject } from './storage';

export type TreeEntry = { name: string; mode: string; id: string; type: 'blob' | 'tree' };

export type CommitRow = {
  id: string;
  tree: string;
  parents: string[];
  author: string;
  authored_at: number;
  committer: string;
  committed_at: number;
  message: string;
};

export function shortId(id: string): string {
  return id.slice(0, 7);
}

export function hashBlob(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha256').update(`blob ${bytes.length}\n`).update(bytes).digest('hex');
}

export function hashTree(entries: TreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => (Buffer.from(a.name, 'utf8') < Buffer.from(b.name, 'utf8') ? -1 : 1));
  const text = sorted.map((entry) => `${entry.mode} ${entry.name} ${entry.id}\n`).join('');
  return createHash('sha256').update(`tree\n${text}`).digest('hex');
}

export function trimMessage(message: string): string {
  return message.replace(/\s+$/u, '');
}

export function hashCommit(input: {
  tree: string;
  parents: string[];
  author: string;
  authored_at: number;
  committer: string;
  committed_at: number;
  message: string;
}): string {
  const parents = input.parents.map((parent) => `parent ${parent}\n`).join('');
  const text =
    `commit\ntree ${input.tree}\n${parents}` +
    `author ${input.author} ${input.authored_at}\n` +
    `committer ${input.committer} ${input.committed_at}\n\n${trimMessage(input.message)}`;
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function writeBlob(t: Tx, projectId: number, content: string): Promise<string> {
  const id = hashBlob(content);
  const size = Buffer.byteLength(content, 'utf8');
  const existing = await t.sql.one<{ id: string }>('select id from blobs where project_id = $1 and id = $2', [
    projectId,
    id,
  ]);
  if (existing !== null) return id;
  if (size > config.inlineMaxBytes) {
    const key = `blobs/${id}`;
    await putObject(key, content);
    await t.sql.query('insert into blobs (project_id, id, size, content, object_key) values ($1, $2, $3, null, $4)', [
      projectId,
      id,
      size,
      key,
    ]);
    return id;
  }
  await t.sql.query('insert into blobs (project_id, id, size, content, object_key) values ($1, $2, $3, $4, null)', [
    projectId,
    id,
    size,
    content,
  ]);
  return id;
}

export async function readBlob(sql: Sql, projectId: number, id: string): Promise<string> {
  const row = await sql.one<{ content: string | null; object_key: string | null }>(
    'select content, object_key from blobs where project_id = $1 and id = $2',
    [projectId, id],
  );
  if (row === null) throw errors.notFound();
  if (row.content !== null) return row.content;
  const buffer = await getObject(row.object_key ?? '');
  if (buffer === null) throw errors.notFound();
  return buffer.toString('utf8');
}

export async function writeTree(t: Tx, projectId: number, files: Map<string, string>): Promise<string> {
  const blobIds = new Map<string, string>();
  for (const [path, content] of files) {
    blobIds.set(path, await writeBlob(t, projectId, content));
  }
  return writeTreeLevel(t, projectId, '', files, blobIds);
}

async function writeTreeLevel(
  t: Tx,
  projectId: number,
  prefix: string,
  files: Map<string, string>,
  blobIds: Map<string, string>,
): Promise<string> {
  const direct: TreeEntry[] = [];
  const folders = new Set<string>();
  for (const path of files.keys()) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      direct.push({ name: rest, mode: '100644', id: blobIds.get(path) ?? '', type: 'blob' });
    } else {
      folders.add(rest.slice(0, slash));
    }
  }
  for (const folder of folders) {
    const id = await writeTreeLevel(t, projectId, `${prefix}${folder}/`, files, blobIds);
    direct.push({ name: folder, mode: '040000', id, type: 'tree' });
  }
  const id = hashTree(direct);
  const sorted = [...direct].sort((a, b) => (Buffer.from(a.name, 'utf8') < Buffer.from(b.name, 'utf8') ? -1 : 1));
  await t.sql.query(
    `insert into trees (project_id, id, entries) values ($1, $2, $3)
     on conflict (project_id, id) do nothing`,
    [projectId, id, JSON.stringify(sorted)],
  );
  return id;
}

export async function readTree(sql: Sql, projectId: number, id: string): Promise<TreeEntry[]> {
  const row = await sql.one<{ entries: TreeEntry[] }>('select entries from trees where project_id = $1 and id = $2', [
    projectId,
    id,
  ]);
  if (row === null) throw errors.notFound();
  return row.entries;
}

export async function filesOfTree(sql: Sql, projectId: number, treeId: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (id: string, prefix: string): Promise<void> => {
    const entries = await readTree(sql, projectId, id);
    for (const entry of entries) {
      if (entry.type === 'tree') {
        await walk(entry.id, `${prefix}${entry.name}/`);
      } else {
        files.set(`${prefix}${entry.name}`, await readBlob(sql, projectId, entry.id));
      }
    }
  };
  await walk(treeId, '');
  return new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export async function filesOfCommit(sql: Sql, projectId: number, commitId: string | null): Promise<Map<string, string>> {
  if (commitId === null) return new Map();
  const commit = await loadCommit(sql, projectId, commitId);
  return filesOfTree(sql, projectId, commit.tree);
}

export async function loadCommit(sql: Sql, projectId: number, id: string): Promise<CommitRow> {
  const row = await sql.one<CommitRow>(
    `select id, tree, parents, author, authored_at, committer, committed_at, message
     from commits where project_id = $1 and id = $2`,
    [projectId, id],
  );
  if (row === null) throw errors.notFound();
  return { ...row, authored_at: Number(row.authored_at), committed_at: Number(row.committed_at) };
}

export async function findCommit(sql: Sql, projectId: number, id: string): Promise<CommitRow | null> {
  const row = await sql.one<CommitRow>(
    `select id, tree, parents, author, authored_at, committer, committed_at, message
     from commits where project_id = $1 and id = $2`,
    [projectId, id],
  );
  return row === null ? null : { ...row, authored_at: Number(row.authored_at), committed_at: Number(row.committed_at) };
}

export async function storeCommit(
  t: Tx,
  projectId: number,
  input: {
    tree: string;
    parents: string[];
    author: string;
    authored_at: number;
    committer: string;
    committed_at: number;
    message: string;
  },
): Promise<string> {
  const message = trimMessage(input.message);
  const id = hashCommit({ ...input, message });
  await t.sql.query(
    `insert into commits (project_id, id, tree, parents, author, authored_at, committer, committed_at, message)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (project_id, id) do nothing`,
    [
      projectId,
      id,
      input.tree,
      JSON.stringify(input.parents),
      input.author,
      input.authored_at,
      input.committer,
      input.committed_at,
      message,
    ],
  );
  return id;
}

export async function branchHead(sql: Sql, projectId: number, name: string): Promise<string | null> {
  const row = await sql.one<{ commit_id: string }>(
    "select commit_id from refs where project_id = $1 and kind = 'branch' and name = $2",
    [projectId, name],
  );
  return row === null ? null : row.commit_id;
}

export async function setBranch(t: Tx, projectId: number, name: string, commitId: string): Promise<void> {
  await t.sql.query(
    `insert into refs (project_id, kind, name, commit_id) values ($1, 'branch', $2, $3)
     on conflict (project_id, kind, name) do update set commit_id = $3`,
    [projectId, name, commitId],
  );
}

export async function deleteBranch(t: Tx, projectId: number, name: string): Promise<void> {
  await t.sql.query("delete from refs where project_id = $1 and kind = 'branch' and name = $2", [projectId, name]);
}

export async function resolveRef(sql: Sql, projectId: number, ref: string): Promise<string | null> {
  const row = await sql.one<{ commit_id: string }>(
    'select commit_id from refs where project_id = $1 and name = $2 order by kind limit 1',
    [projectId, ref],
  );
  if (row !== null) return row.commit_id;
  if (/^[0-9a-f]{7,64}$/.test(ref)) {
    const commit = await sql.one<{ id: string }>(
      'select id from commits where project_id = $1 and id like $2 limit 1',
      [projectId, `${ref}%`],
    );
    if (commit !== null) return commit.id;
  }
  return null;
}

export async function ancestors(sql: Sql, projectId: number, head: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [head];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const commit = await findCommit(sql, projectId, id);
    if (commit === null) continue;
    queue.push(...commit.parents);
  }
  return seen;
}

export async function isAncestor(sql: Sql, projectId: number, candidate: string, head: string): Promise<boolean> {
  if (candidate === head) return true;
  const reachable = await ancestors(sql, projectId, head);
  return reachable.has(candidate);
}

export async function mergeBase(sql: Sql, projectId: number, from: string, to: string): Promise<string | null> {
  const fromReachable = await ancestors(sql, projectId, from);
  const queue: string[] = [to];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    if (fromReachable.has(id)) return id;
    const commit = await findCommit(sql, projectId, id);
    if (commit === null) continue;
    queue.push(...commit.parents);
  }
  return null;
}

export async function firstParentHistory(sql: Sql, projectId: number, head: string): Promise<CommitRow[]> {
  const out: CommitRow[] = [];
  let current: string | null = head;
  while (current !== null) {
    const commit = await findCommit(sql, projectId, current);
    if (commit === null) break;
    out.push(commit);
    current = commit.parents.length > 0 ? commit.parents[0] : null;
  }
  return out;
}

export async function blobAtPath(
  sql: Sql,
  projectId: number,
  commit: CommitRow,
  path: string,
): Promise<string | null> {
  const files = await filesOfTree(sql, projectId, commit.tree);
  return files.get(path) ?? null;
}

export async function historyFor(
  sql: Sql,
  projectId: number,
  head: string,
  path: string | null,
): Promise<CommitRow[]> {
  const chain = await firstParentHistory(sql, projectId, head);
  if (path === null) return chain;
  const out: CommitRow[] = [];
  for (let index = 0; index < chain.length; index += 1) {
    const commit = chain[index];
    const parent = commit.parents.length > 0 ? await findCommit(sql, projectId, commit.parents[0]) : null;
    const current = await blobAtPath(sql, projectId, commit, path);
    const before = parent === null ? null : await blobAtPath(sql, projectId, parent, path);
    if (current !== before) out.push(commit);
  }
  return out;
}

export type BlameLine = { line: number; commit: string; author: string; text: string };

export async function blame(sql: Sql, projectId: number, head: string, path: string): Promise<BlameLine[]> {
  const chain = await firstParentHistory(sql, projectId, head);
  const headCommit = chain[0];
  if (headCommit === undefined) return [];
  const headText = await blobAtPath(sql, projectId, headCommit, path);
  if (headText === null) return [];
  const headLines = splitLines(headText);
  const owners: (CommitRow | null)[] = headLines.map(() => null);
  let tracked = headLines.map((_, index) => index);
  let currentLines = headLines;
  for (const commit of chain) {
    const parent = commit.parents.length > 0 ? await findCommit(sql, projectId, commit.parents[0]) : null;
    const parentText = parent === null ? null : await blobAtPath(sql, projectId, parent, path);
    if (parentText === null) {
      tracked.forEach((position, headIndex) => {
        if (position !== -1 && owners[headIndex] === null) owners[headIndex] = commit;
      });
      break;
    }
    const parentLines = splitLines(parentText);
    const mapToParent = new Map<number, number>();
    for (const line of lineDiff(parentLines, currentLines)) {
      if (line.type === 'context' && line.new !== null && line.old !== null) {
        mapToParent.set(line.new - 1, line.old - 1);
      }
    }
    tracked = tracked.map((position, headIndex) => {
      if (position === -1) return -1;
      const mapped = mapToParent.get(position);
      if (mapped === undefined) {
        if (owners[headIndex] === null) owners[headIndex] = commit;
        return -1;
      }
      return mapped;
    });
    currentLines = parentLines;
  }
  const oldest = chain[chain.length - 1];
  return headLines.map((text, index) => {
    const owner = owners[index] ?? oldest;
    return { line: index + 1, commit: owner.id, author: owner.author, text };
  });
}

export function assertUtf8(path: string, content: string): void {
  if (content.includes('\u0000')) {
    throw errors.validation('content', `File ${path} is not UTF-8 text.`);
  }
}

export function assertFileSize(path: string, content: string): void {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > config.fileMaxBytes) {
    throw new ApiError(
      413,
      'payload_too_large',
      `File ${path} is too large (${config.fileMaxBytes} bytes at most).`,
    );
  }
}
