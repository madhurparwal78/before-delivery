import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { requireMember, person } from './session-routes.js';
import { ApiError, staleRevision, invalid, suggestionClosed, threadResolved } from '../errors.js';
import { readJson, hasUnstorable } from '../validation.js';
import { newId } from '../ids.js';
import { currentText, applyAnchorRules, saveFileText, appendLedger, spanOfChange } from '../domain.js';
import type { Suggestion, SuggestionStatus, Thread, PersonShape } from '../../shared/types.js';
import type { FileRow } from '../domain.js';
import type { Queryable } from '../db.js';

const MAX_COMMENT = 4_000;
const MAX_INSERTED = 10_000;

interface SuggestionRow {
  id: string; project_id: string; file_id: string;
  from_pos: number | null; to_pos: number | null;
  deleted: string; inserted: string; status: string;
  author_id: string; author_name: string; author_handle: string; created_at: Date;
  resolved_by_id: string | null; resolved_by_name: string | null; resolved_by_handle: string | null;
  resolved_at: Date | null; orphaned_at: Date | null;
}

interface ThreadRow {
  id: string; project_id: string; file_id: string;
  from_pos: number | null; to_pos: number | null;
  quote: string; status: string; orphaned: boolean;
  resolved_by_id: string | null; resolved_by_name: string | null; resolved_by_handle: string | null;
  orphaned_at: Date | null; created_at: Date;
}

function param(req: { params: Record<string, unknown> }, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}

function mentionHandles(body: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\s)@([a-z0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push(m[1]);
  }
  return out;
}

export function registerReviewRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql } = svc;

  app.get('/api/projects/:pid/review', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, "pid"));
    void role;
    const data = await loadReview(sql, param(req, "pid"), false);
    res.json(data);
  }));

  // ---- Suggest ----
  app.post('/api/projects/:pid/files/:fid/suggestions', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role === 'viewer') throw new ApiError(403, 'forbidden');
    const body = await readJson(req, ['baseRevision', 'from', 'to', 'inserted']);
    const frows = await sql<FileRow>`
      SELECT * FROM files WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "fid")} AND deleted_at IS NULL FOR UPDATE`;
    if (!frows[0]) throw new ApiError(404, 'not_found');
    const f = frows[0];
    if (f.kind !== 'text') throw invalid({ from: 'not a text file' });
    const baseRevision = typeof body.baseRevision === 'number' ? body.baseRevision : NaN;
    const from = typeof body.from === 'number' ? body.from : NaN;
    const to = typeof body.to === 'number' ? body.to : NaN;
    const inserted = typeof body.inserted === 'string' ? body.inserted : '';
    const errors: Record<string, string> = {};
    if (!Number.isInteger(baseRevision) || baseRevision < 1) errors.baseRevision = 'required';
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) errors.from = 'range';
    if (inserted.length > MAX_INSERTED || hasUnstorable(inserted)) errors.inserted = 'length';
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const text = await currentText(sql, f);
    if (to > text.length) throw invalid({ to: 'range' });
    if (from === to && inserted.length === 0) throw invalid({ inserted: 'changes nothing' });
    if (f.revision !== baseRevision) {
      const current = { file: { id: f.id, path: f.path, kind: 'text' as const, revision: f.revision, size: f.size, content: text } };
      throw staleRevision(current);
    }
    const deleted = text.slice(from, to);
    const id = newId('s');
    await sql`
      INSERT INTO suggestions (id, project_id, file_id, from_pos, to_pos, deleted, inserted, status, author_id, author_name, author_handle)
      VALUES (${id}, ${param(req, "pid")}, ${f.id}, ${from}, ${to}, ${deleted}, ${inserted}, 'open', ${user.id}, ${user.displayName}, ${user.handle})`;
    res.status(201).json({ suggestion: await loadSuggestion(sql, id) });
  }));

  // ---- Accept ----
  app.post('/api/projects/:pid/suggestions/:sid/accept', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    await readJson(req, []);
    const outcome = await resolveSuggestion(svc, param(req, "pid"), param(req, "sid"), user, 'accepted');
    if (!outcome) throw suggestionClosed(await loadSuggestion(sql, param(req, "sid")));
    res.json(outcome);
  }));

  app.post('/api/projects/:pid/suggestions/:sid/reject', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    await readJson(req, []);
    const outcome = await resolveSuggestion(svc, param(req, "pid"), param(req, "sid"), user, 'rejected');
    if (!outcome) {
      const current = await loadSuggestion(sql, param(req, "sid"));
      if (!current) throw new ApiError(404, 'not_found');
      throw suggestionClosed(current);
    }
    res.json(outcome);
  }));

  // ---- Threads ----
  app.post('/api/projects/:pid/files/:fid/threads', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role === 'viewer') throw new ApiError(403, 'forbidden');
    const body = await readJson(req, ['baseRevision', 'from', 'to', 'body']);
    const frows = await sql<FileRow>`
      SELECT * FROM files WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "fid")} AND deleted_at IS NULL FOR UPDATE`;
    if (!frows[0]) throw new ApiError(404, 'not_found');
    const f = frows[0];
    if (f.kind !== 'text') throw invalid({ from: 'not a text file' });
    const baseRevision = typeof body.baseRevision === 'number' ? body.baseRevision : NaN;
    const from = typeof body.from === 'number' ? body.from : NaN;
    const to = typeof body.to === 'number' ? body.to : NaN;
    const commentBody = typeof body.body === 'string' ? body.body : '';
    const errors: Record<string, string> = {};
    if (!Number.isInteger(baseRevision)) errors.baseRevision = 'required';
    if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to || from < 0) errors.from = 'range';
    if (commentBody.length < 1 || commentBody.length > MAX_COMMENT || hasUnstorable(commentBody)) errors.body = 'length';
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const text = await currentText(sql, f);
    if (to > text.length) throw invalid({ to: 'range' });
    if (f.revision !== baseRevision) {
      throw staleRevision({ file: { id: f.id, path: f.path, kind: 'text' as const, revision: f.revision, size: f.size, content: text } });
    }
    const quote = text.slice(from, to);
    const tid = newId('t');
    const cid = newId('c');
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO threads (id, project_id, file_id, from_pos, to_pos, quote, status, orphaned)
        VALUES (${tid}, ${param(req, "pid")}, ${f.id}, ${from}, ${to}, ${quote}, 'open', false)`;
      await tx`
        INSERT INTO comments (id, thread_id, author_id, author_name, author_handle, body)
        VALUES (${cid}, ${tid}, ${user.id}, ${user.displayName}, ${user.handle}, ${commentBody})`;
      await recordMentionEmails(tx, param(req, "pid"), tid, cid, user, commentBody, quote);
    });
    await attemptPendingMentions(svc, tid);
    res.status(201).json({ thread: await loadThread(sql, tid, false) });
  }));

  app.post('/api/projects/:pid/threads/:tid/comments', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role === 'viewer') throw new ApiError(403, 'forbidden');
    const body = await readJson(req, ['body']);
    const commentBody = typeof body.body === 'string' ? body.body : '';
    if (commentBody.length < 1 || commentBody.length > MAX_COMMENT || hasUnstorable(commentBody)) {
      throw invalid({ body: 'length' });
    }
    const trows = await sql<ThreadRow>`
      SELECT t.*, f.path AS file_path FROM threads t JOIN files f ON f.id = t.file_id
      WHERE t.project_id = ${param(req, "pid")} AND t.id = ${param(req, "tid")} FOR UPDATE OF t`;
    if (!trows[0]) throw new ApiError(404, 'not_found');
    const t = trows[0];
    if (t.status !== 'open') throw threadResolved();
    const cid = newId('c');
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO comments (id, thread_id, author_id, author_name, author_handle, body)
        VALUES (${cid}, ${t.id}, ${user.id}, ${user.displayName}, ${user.handle}, ${commentBody})`;
      await recordMentionEmails(tx, param(req, "pid"), t.id, cid, user, commentBody, t.quote);
    });
    await attemptPendingMentions(svc, t.id);
    res.status(201).json({
      comment: {
        id: cid,
        author: { id: user.id, displayName: user.displayName, handle: user.handle },
        body: commentBody,
        createdAt: new Date().toISOString(),
      },
    });
  }));

  app.post('/api/projects/:pid/threads/:tid/resolve', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    await readJson(req, []);
    const trows = await sql`
      SELECT * FROM threads WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "tid")} FOR UPDATE`;
    if (!trows[0]) throw new ApiError(404, 'not_found');
    if (trows[0].status !== 'open') throw threadResolved();
    await sql`
      UPDATE threads SET status = 'resolved', resolved_by_id = ${user.id},
        resolved_by_name = ${user.displayName}, resolved_by_handle = ${user.handle}
      WHERE id = ${param(req, "tid")}`;
    res.json({ thread: await loadThread(sql, param(req, "tid"), false) });
  }));
}

/** Record one pending mention email per mentioned current member, in the comment's transaction. */
async function recordMentionEmails(
  tx: Queryable,
  projectId: string,
  threadId: string,
  commentId: string,
  author: { id: string; displayName: string; handle: string },
  body: string,
  quote: string,
): Promise<void> {
  const handles = [...new Set(mentionHandles(body))];
  if (handles.length === 0) return;
  const members = await tx<{ id: string; email: string; display_name: string; handle: string }>`
    SELECT u.id, u.email, u.display_name, u.handle FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ${projectId}`;
  const now = new Date();
  for (const m of members) {
    if (m.id === author.id) continue;
    if (!handles.includes(m.handle)) continue;
    await tx`
      INSERT INTO mention_emails (id, project_id, thread_id, comment_id, recipient_id, subject, body, state, created_at, next_attempt_at)
      VALUES (${newId('me')}, ${projectId}, ${threadId}, ${commentId}, ${m.id}, 'mention', ${quote}, 'pending', ${now}, ${now})
      ON CONFLICT DO NOTHING`;
  }
}

/** The posting instance's first attempt, made right after answering the comment. */
async function attemptPendingMentions(svc: RouteCtx['svc'], threadId: string): Promise<void> {
  const rows = await svc.sql<{
    id: string; thread_id: string; recipient_email: string; recipient_name: string; quote: string;
    comment_body: string; author_name: string; project_title: string; project_id: string;
  }>`
    SELECT me.id, me.thread_id, u.email AS recipient_email, u.display_name AS recipient_name,
           t.quote AS quote, c.body AS comment_body,
           au.display_name AS author_name, p.title AS project_title, me.project_id
    FROM mention_emails me
    JOIN users u ON u.id = me.recipient_id
    JOIN threads t ON t.id = me.thread_id
    JOIN comments c ON c.id = me.comment_id
    JOIN users au ON au.id = c.author_id
    JOIN projects p ON p.id = me.project_id
    WHERE me.thread_id = ${threadId} AND me.state = 'pending'`;
  for (const r of rows) {
    try {
      const ok = await svc.mailer.send(
        r.recipient_email,
        `${r.author_name} mentioned you on ${r.project_title}`,
        mentionBody(r.author_name, r.project_title, r.comment_body, r.quote, svc.config.appBaseUrl, r.project_id, r.thread_id),
      );
      if (ok) {
        await svc.sql`UPDATE mention_emails SET state = 'sent', claimed_at = now() WHERE id = ${r.id}`;
      } else {
        await svc.sql`UPDATE mention_emails SET next_attempt_at = now() + interval '10 seconds' WHERE id = ${r.id}`;
      }
    } catch {
      await svc.sql`UPDATE mention_emails SET next_attempt_at = now() + interval '10 seconds' WHERE id = ${r.id}`;
    }
  }
}

export function mentionBody(
  author: string, projectTitle: string, comment: string, quote: string,
  baseUrl: string, projectId: string, threadId: string,
): string {
  const safe = (s: string) => s.replace(/[\r\n]+/g, (m) => (m.includes('\r\n') ? '\n' : '\n'));
  return `${headerSafeName(author)} mentioned you on ${headerSafeName(projectTitle)}:\n\n${safe(comment)}\n\nOn the passage: "${safe(quote)}"\nOpen the thread: ${baseUrl}/p/${projectId}?thread=${threadId}\n`;
}

function headerSafeName(s: string): string {
  return s.replace(/[\r\n\t\f\v\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

/** Resolve a suggestion exactly once. Returns the answer body, or null on conflict. */
async function resolveSuggestion(
  svc: RouteCtx['svc'],
  projectId: string,
  suggestionId: string,
  user: { id: string; displayName: string; handle: string },
  outcome: 'accepted' | 'rejected',
): Promise<Record<string, unknown> | null> {
  const { sql } = svc;
  const result = await sql.begin(async (tx) => {
    const rows = await tx<SuggestionRow>`
      SELECT * FROM suggestions WHERE project_id = ${projectId} AND id = ${suggestionId} FOR UPDATE`;
    if (!rows[0]) return null;
    const s = rows[0];
    if (s.status !== 'open') return { conflict: true };
    const actor = person(user);
    if (outcome === 'rejected') {
      await tx`
        UPDATE suggestions SET status = 'rejected', resolved_by_id = ${user.id},
          resolved_by_name = ${user.displayName}, resolved_by_handle = ${user.handle}, resolved_at = now()
        WHERE id = ${suggestionId}`;
      const open = await tx<{ n: number }>`SELECT count(*)::int AS n FROM suggestions WHERE project_id = ${projectId} AND status = 'open'`;
      const rev = await tx<{ revision: number }>`SELECT revision FROM projects WHERE id = ${projectId}`;
      return {
        suggestion: await loadSuggestion(tx, suggestionId),
        projectRevision: rev[0].revision,
        openSuggestions: open[0].n,
      };
    }
    const frows = await tx<FileRow>`SELECT * FROM files WHERE id = ${s.file_id} FOR UPDATE`;
    if (!frows[0]) return { conflict: true };
    const f = frows[0];
    const text = await currentText(tx, f);
    const from = s.from_pos ?? 0;
    const to = s.to_pos ?? 0;
    if (to > text.length) return { conflict: true };
    const newText = text.slice(0, from) + s.inserted + text.slice(to);
    const span = { a: from, b: to, n: s.inserted.length };
    const saved = await saveFileText(tx, projectId, f, newText, actor, 'accept', `Accepted a suggestion in ${f.path}`);
    await applyAnchorRules(tx, projectId, { ...f, revision: saved.fileRevision }, span);
    await tx`
      UPDATE suggestions SET status = 'accepted', resolved_by_id = ${user.id},
        resolved_by_name = ${user.displayName}, resolved_by_handle = ${user.handle}, resolved_at = now()
      WHERE id = ${suggestionId}`;
    const open = await tx<{ n: number }>`SELECT count(*)::int AS n FROM suggestions WHERE project_id = ${projectId} AND status = 'open'`;
    return {
      suggestion: await loadSuggestion(tx, suggestionId),
      file: { id: f.id, path: f.path, kind: 'text' as const, revision: saved.fileRevision, size: Buffer.byteLength(newText, 'utf8'), content: newText },
      projectRevision: saved.revision,
      openSuggestions: open[0].n,
    };
  });
  if (result === null) return null;
  if ('conflict' in result && result.conflict) return null;
  return result as Record<string, unknown>;
}

export async function loadSuggestion(sql: Queryable, id: string): Promise<Suggestion> {
  const rows = await sql<SuggestionRow>`
    SELECT s.*, f.path AS file_path FROM suggestions s JOIN files f ON f.id = s.file_id WHERE s.id = ${id}`;
  const s = rows[0];
  return {
    id: s.id,
    fileId: s.file_id,
    from: s.from_pos,
    to: s.to_pos,
    deleted: s.deleted,
    inserted: s.inserted,
    status: s.status as SuggestionStatus,
    author: { id: s.author_id, displayName: s.author_name, handle: s.author_handle },
    createdAt: s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at),
    resolvedBy: s.resolved_by_id
      ? { id: s.resolved_by_id, displayName: s.resolved_by_name ?? '', handle: s.resolved_by_handle ?? '' }
      : null,
    resolvedAt: s.resolved_at instanceof Date ? s.resolved_at.toISOString() : s.resolved_at,
  };
}

export async function loadThread(
  sql: Queryable,
  id: string,
  shareMode: boolean,
): Promise<Thread> {
  const rows = await sql<ThreadRow>`SELECT * FROM threads WHERE id = ${id}`;
  const t = rows[0];
  const comments = await sql<{ id: string; author_id: string; author_name: string; author_handle: string; body: string; created_at: Date; fid: string }>`
    SELECT c.*, f.id AS fid FROM comments c JOIN threads t ON t.id = c.thread_id JOIN files f ON f.id = t.file_id
    WHERE c.thread_id = ${id} ORDER BY c.created_at, c.id`;
  const resolved = t.resolved_by_id
    ? (shareMode
      ? { displayName: t.resolved_by_name ?? '' }
      : { id: t.resolved_by_id, displayName: t.resolved_by_name ?? '', handle: t.resolved_by_handle ?? '' })
    : null;
  return {
    id: t.id,
    fileId: t.file_id,
    from: t.from_pos,
    to: t.to_pos,
    quote: t.quote,
    status: t.status as 'open' | 'resolved',
    orphaned: t.orphaned,
    comments: comments.map((c) => ({
      id: c.id,
      author: (shareMode
        ? { displayName: c.author_name }
        : { id: c.author_id, displayName: c.author_name, handle: c.author_handle }) as PersonShape,
      body: c.body,
      createdAt: c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at),
    })),
    resolvedBy: resolved as Thread['resolvedBy'],
  };
}

/** Load all suggestions and threads in the published review order. */
export async function loadReview(sql: Queryable, projectId: string, shareMode: boolean): Promise<{
  suggestions: Suggestion[]; threads: Thread[]; openSuggestions: number;
}> {
  const srows = await sql<SuggestionRow>`
    SELECT s.* FROM suggestions s WHERE s.project_id = ${projectId}
    ORDER BY (s.status = 'orphaned'), s.orphaned_at, s.created_at, s.id`;
  const trows = await sql<ThreadRow>`
    SELECT t.* FROM threads t WHERE t.project_id = ${projectId}`;
  const openCount = srows.filter((s) => s.status === 'open').length;

  const pathOf = async (fileId: string): Promise<string> => {
    const r = await sql<{ path: string }>`SELECT path FROM files WHERE id = ${fileId}`;
    return r[0]?.path ?? '';
  };
  const pathCache = new Map<string, string>();
  const pathFor = async (fileId: string): Promise<string> => {
    if (!pathCache.has(fileId)) pathCache.set(fileId, await pathOf(fileId));
    return pathCache.get(fileId) as string;
  };

  const suggestions: Suggestion[] = [];
  for (const s of srows) {
    suggestions.push({
      id: s.id,
      fileId: s.file_id,
      from: s.from_pos,
      to: s.to_pos,
      deleted: s.deleted,
      inserted: s.inserted,
      status: s.status as SuggestionStatus,
      author: shareMode
        ? { displayName: s.author_name } as unknown as PersonShape
        : { id: s.author_id, displayName: s.author_name, handle: s.author_handle },
      createdAt: s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at),
      resolvedBy: s.resolved_by_id
        ? (shareMode
          ? { displayName: s.resolved_by_name ?? '' } as unknown as PersonShape
          : { id: s.resolved_by_id, displayName: s.resolved_by_name ?? '', handle: s.resolved_by_handle ?? '' })
        : null,
      resolvedAt: s.resolved_at instanceof Date ? s.resolved_at.toISOString() : s.resolved_at,
    });
  }
  void pathFor;

  const threads: Thread[] = [];
  for (const t of trows) {
    threads.push(await loadThread(sql, t.id, shareMode));
  }
  // Review order: non-orphaned first by path, from, creation, id; orphaned after.
  const pathMap = new Map<string, string>();
  const fileRows = await sql<{ id: string; path: string }>`SELECT id, path FROM files WHERE project_id = ${projectId}`;
  for (const f of fileRows) pathMap.set(f.id, f.path);
  const pathOfT = (fileId: string) => pathMap.get(fileId) ?? '';

  const firstCommentTime = new Map<string, string>();
  for (const t of trows) {
    const c = await sql<{ created_at: Date }>`SELECT created_at FROM comments WHERE thread_id = ${t.id} ORDER BY created_at, id LIMIT 1`;
    void c;
    firstCommentTime.set(t.id, c[0] ? String(c[0].created_at) : String(t.created_at));
  }

  suggestions.sort((x, y) => {
    const xo = x.status === 'orphaned' ? 1 : 0;
    const yo = y.status === 'orphaned' ? 1 : 0;
    if (xo !== yo) return xo - yo;
    if (xo === 1) return 0;
    const px = pathOfT(x.fileId); const py = pathOfT(y.fileId);
    if (px !== py) return px < py ? -1 : 1;
    if ((x.from ?? 0) !== (y.from ?? 0)) return (x.from ?? 0) - (y.from ?? 0);
    if (x.createdAt !== y.createdAt) return x.createdAt < y.createdAt ? -1 : 1;
    return x.id < y.id ? -1 : 1;
  });
  threads.sort((x, y) => {
    const xo = x.orphaned ? 1 : 0;
    const yo = y.orphaned ? 1 : 0;
    if (xo !== yo) return xo - yo;
    if (xo === 1) return 0;
    const px = pathOfT(x.fileId); const py = pathOfT(y.fileId);
    if (px !== py) return px < py ? -1 : 1;
    if ((x.from ?? 0) !== (y.from ?? 0)) return (x.from ?? 0) - (y.from ?? 0);
    const cx = firstCommentTime.get(x.id) ?? ''; const cy = firstCommentTime.get(y.id) ?? '';
    if (cx !== cy) return cx < cy ? -1 : 1;
    return x.id < y.id ? -1 : 1;
  });
  return { suggestions, threads, openSuggestions: openCount };
}
