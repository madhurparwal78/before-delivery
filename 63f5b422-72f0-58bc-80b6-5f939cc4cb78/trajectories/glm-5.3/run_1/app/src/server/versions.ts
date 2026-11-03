// Versions and comments.
import { db } from './db.js';
import { notFound, conflictError, invalid } from './errors.js';
import { newId } from './ids.js';
import type { WorkspaceDocument } from '../shared/domain.js';
import type { Role } from '../shared/domain.js';

export interface VersionSummary { id: string; name: string; author: { id: string; name: string }; createdAt: string; seq: number }

export async function cutVersion(workspaceId: string, doc: WorkspaceDocument, name: string | undefined, author: { id: string; name: string }): Promise<VersionSummary> {
  const countRes = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM versions WHERE workspace_id = $1', [workspaceId]);
  const position = Number(countRes.rows[0].n) + 1;
  const finalName = name ?? `Version ${position}`;
  const id = newId('v');
  await db.query(
    'INSERT INTO versions (id, workspace_id, name, author_id, author_name, document, seq) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, workspaceId, finalName, author.id, author.name, JSON.stringify(doc), doc.seq]);
  return { id, name: finalName, author, createdAt: new Date().toISOString(), seq: doc.seq };
}

export async function listVersions(workspaceId: string): Promise<VersionSummary[]> {
  const res = await db.query<{ id: string; name: string; author_id: string; author_name: string; created_at: Date; seq: string }>(
    'SELECT id, name, author_id, author_name, created_at, seq FROM versions WHERE workspace_id = $1 ORDER BY created_at DESC, seq DESC', [workspaceId]);
  return res.rows.map((r) => ({
    id: r.id, name: r.name, author: { id: r.author_id, name: r.author_name },
    createdAt: r.created_at.toISOString(), seq: Number(r.seq),
  }));
}

export interface VersionFull extends VersionSummary { document: WorkspaceDocument }

export async function getVersion(versionId: string): Promise<VersionFull | null> {
  const res = await db.query<{ id: string; workspace_id: string; name: string; author_id: string; author_name: string; created_at: Date; seq: string; document: WorkspaceDocument }>(
    'SELECT id, workspace_id, name, author_id, author_name, created_at, seq, document FROM versions WHERE id = $1', [versionId]);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id, name: r.name, author: { id: r.author_id, name: r.author_name },
    createdAt: r.created_at.toISOString(), seq: Number(r.seq), document: r.document,
  };
}

// ---- comments ------------------------------------------------------------

export interface ReplyRow { id: string; author: { id: string; name: string }; body: string; createdAt: string }
export interface ThreadRow {
  id: string; pageId: string; nodeId: string; nodeName: string;
  author: { id: string; name: string }; body: string; createdAt: string;
  status: 'open' | 'resolved'; replies: ReplyRow[];
}

export async function listThreads(workspaceId: string, pageId: string | undefined): Promise<ThreadRow[]> {
  const res = await db.query<{ id: string; page_id: string; node_id: string; node_name: string; author_id: string; author_name: string; body: string; created_at: Date; status: string }>(
    'SELECT id, page_id, node_id, node_name, author_id, author_name, body, created_at, status FROM comments WHERE workspace_id = $1 AND ($2::text IS NULL OR page_id = $2) ORDER BY created_at ASC',
    [workspaceId, pageId ?? null]);
  const threads: ThreadRow[] = [];
  for (const r of res.rows) {
    const repliesRes = await db.query<{ id: string; author_id: string; author_name: string; body: string; created_at: Date }>(
      'SELECT id, author_id, author_name, body, created_at FROM comment_replies WHERE thread_id = $1 ORDER BY created_at ASC', [r.id]);
    threads.push({
      id: r.id, pageId: r.page_id, nodeId: r.node_id, nodeName: r.node_name,
      author: { id: r.author_id, name: r.author_name }, body: r.body,
      createdAt: r.created_at.toISOString(), status: r.status === 'resolved' ? 'resolved' : 'open',
      replies: repliesRes.rows.map((x) => ({ id: x.id, author: { id: x.author_id, name: x.author_name }, body: x.body, createdAt: x.created_at.toISOString() })),
    });
  }
  return threads;
}

export async function createThread(workspaceId: string, pageId: string, nodeId: string, nodeName: string, author: { id: string; name: string }, body: string): Promise<ThreadRow> {
  const id = newId('m');
  const createdAt = new Date().toISOString();
  await db.query(
    'INSERT INTO comments (id, workspace_id, page_id, node_id, node_name, author_id, author_name, body, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'open\')',
    [id, workspaceId, pageId, nodeId, nodeName, author.id, author.name, body]);
  return { id, pageId, nodeId, nodeName, author, body, createdAt, status: 'open', replies: [] };
}

export async function getThread(commentId: string): Promise<ThreadRow | null> {
  const res = await db.query<{ id: string; workspace_id: string; page_id: string; node_id: string; node_name: string; author_id: string; author_name: string; body: string; created_at: Date; status: string }>(
    'SELECT id, workspace_id, page_id, node_id, node_name, author_id, author_name, body, created_at, status FROM comments WHERE id = $1', [commentId]);
  const r = res.rows[0];
  if (!r) return null;
  const repliesRes = await db.query<{ id: string; author_id: string; author_name: string; body: string; created_at: Date }>(
    'SELECT id, author_id, author_name, body, created_at FROM comment_replies WHERE thread_id = $1 ORDER BY created_at ASC', [r.id]);
  return {
    id: r.id, pageId: r.page_id, nodeId: r.node_id, nodeName: r.node_name,
    author: { id: r.author_id, name: r.author_name }, body: r.body,
    createdAt: r.created_at.toISOString(), status: r.status === 'resolved' ? 'resolved' : 'open',
    replies: repliesRes.rows.map((x) => ({ id: x.id, author: { id: x.author_id, name: x.author_name }, body: x.body, createdAt: x.created_at.toISOString() })),
  };
}

export async function addReply(commentId: string, author: { id: string; name: string }, body: string): Promise<ReplyRow> {
  const id = newId('m');
  await db.query('INSERT INTO comment_replies (id, thread_id, author_id, author_name, body) VALUES ($1,$2,$3,$4,$5)',
    [id, commentId, author.id, author.name, body]);
  return { id, author, body, createdAt: new Date().toISOString() };
}

export async function setThreadStatus(commentId: string, status: 'open' | 'resolved'): Promise<void> {
  await db.query('UPDATE comments SET status = $1 WHERE id = $2', [status, commentId]);
}
