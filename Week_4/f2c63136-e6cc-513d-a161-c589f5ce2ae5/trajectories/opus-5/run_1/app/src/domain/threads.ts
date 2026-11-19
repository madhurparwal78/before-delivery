import type { Db } from '../server/db.js';
import { serverNow } from '../server/clock.js';
import { conflict, invalid } from '../server/errors.js';
import { diffHunks, lineMapping, splitLines } from './diff.js';
import { combinedFiles } from './combined.js';
import { getSnapshot, readFileText, type Contents } from './revisions.js';
import type { ChangeRow, RepoRow } from './model.js';

export interface SuggestionView {
  lines: string[];
  state: 'open' | 'applied';
  line: number;
  endLine: number;
  revision: string;
}

export interface CommentView {
  id: number;
  authorUserId: number;
  authorUsername: string;
  authorName: string;
  body: string;
  createdAt: Date;
  suggestion: SuggestionView | null;
}

export interface ThreadView {
  id: number;
  changeId: number;
  path: string;
  side: 'old' | 'new';
  line: number;
  endLine: number;
  state: 'unresolved' | 'resolved';
  outdated: boolean;
  revisionId: string;
  comments: CommentView[];
}

export async function loadThreads(tx: Db, changeId: number): Promise<ThreadView[]> {
  const threadRows = await tx.query<{
    id: string;
    change_id: string;
    path: string;
    side: 'old' | 'new';
    line: number;
    end_line: number;
    state: 'unresolved' | 'resolved';
    outdated: boolean;
    revision_id: string;
  }>(
    `SELECT id, change_id, path, side, line, end_line, state, outdated, revision_id
     FROM rs_threads WHERE change_id = $1 ORDER BY id`,
    [changeId],
  );
  if (threadRows.length === 0) return [];
  const commentRows = await tx.query<{
    id: string;
    thread_id: string;
    author_user_id: string;
    username: string;
    name: string;
    body: string;
    created_at: Date;
    suggestion_lines: string[] | null;
    suggestion_state: 'open' | 'applied' | null;
    suggestion_line: number | null;
    suggestion_end_line: number | null;
    suggestion_revision: string | null;
  }>(
    `SELECT c.id, c.thread_id, c.author_user_id, u.username, u.name, c.body, c.created_at,
            c.suggestion_lines, c.suggestion_state, c.suggestion_line, c.suggestion_end_line, c.suggestion_revision
     FROM rs_comments c JOIN rs_users u ON u.id = c.author_user_id
     WHERE c.thread_id = ANY($1::bigint[]) ORDER BY c.id`,
    [threadRows.map((row) => Number(row.id))],
  );

  return threadRows.map((row) => ({
    id: Number(row.id),
    changeId: Number(row.change_id),
    path: row.path,
    side: row.side,
    line: Number(row.line),
    endLine: Number(row.end_line),
    state: row.state,
    outdated: row.outdated,
    revisionId: row.revision_id,
    comments: commentRows
      .filter((comment) => comment.thread_id === row.id)
      .map((comment) => ({
        id: Number(comment.id),
        authorUserId: Number(comment.author_user_id),
        authorUsername: comment.username,
        authorName: comment.name,
        body: comment.body,
        createdAt: comment.created_at,
        suggestion:
          comment.suggestion_lines === null
            ? null
            : {
                lines: comment.suggestion_lines,
                state: comment.suggestion_state!,
                line: Number(comment.suggestion_line),
                endLine: Number(comment.suggestion_end_line),
                revision: comment.suggestion_revision!,
              },
      })),
  }));
}

export function threadObject(thread: ThreadView): Record<string, unknown> {
  return {
    id: thread.id,
    path: thread.path,
    side: thread.side,
    line: thread.line,
    end_line: thread.endLine,
    state: thread.state,
    outdated: thread.outdated,
    revision: thread.revisionId,
    comments: thread.comments.map((comment) => ({
      id: comment.id,
      author: comment.authorUsername,
      body: comment.body,
      created_at: `${comment.createdAt.toISOString().slice(0, 19)}Z`,
      suggestion: comment.suggestion
        ? { lines: comment.suggestion.lines, state: comment.suggestion.state }
        : null,
    })),
  };
}

export async function lineIsInDiff(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  headRevision: string,
  path: string,
  side: 'old' | 'new',
  line: number,
): Promise<boolean> {
  const baseText = (await readFileText(tx, repo.id, change.baseRevision, path)) ?? '';
  const headText = (await readFileText(tx, repo.id, headRevision, path)) ?? '';
  for (const hunk of diffHunks(baseText, headText)) {
    for (const row of hunk.rows) {
      if (side === 'new' && row.new_line === line) return true;
      if (side === 'old' && row.old_line === line) return true;
    }
  }
  return false;
}

/** After a new head or base revision every thread anchor follows the line diff of its side. */
export async function remapThreads(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  previous: { head: string; base: string },
  next: { head: string; base: string },
): Promise<void> {
  const threads = await loadThreads(tx, change.id);
  const live = threads.filter((thread) => !thread.outdated);
  if (live.length === 0) return;

  const nextFiles = new Set(
    combinedFiles(await getSnapshot(tx, repo.id, next.base), await getSnapshot(tx, repo.id, next.head)).map(
      (file) => file.path,
    ),
  );

  for (const thread of live) {
    const previousRevision = thread.side === 'new' ? previous.head : previous.base;
    const nextRevision = thread.side === 'new' ? next.head : next.base;
    const previousText = await readFileText(tx, repo.id, previousRevision, thread.path);
    const nextText = await readFileText(tx, repo.id, nextRevision, thread.path);

    if (!nextFiles.has(thread.path) || nextText === null) {
      await tx.query('UPDATE rs_threads SET outdated = true WHERE id = $1', [thread.id]);
      continue;
    }
    if (previousText === nextText) continue;

    const map = lineMapping(previousText ?? '', nextText);
    const mappedLine = map.get(thread.line);
    if (mappedLine === undefined) {
      await tx.query('UPDATE rs_threads SET outdated = true WHERE id = $1', [thread.id]);
      continue;
    }
    const mappedEnd = map.get(thread.endLine) ?? mappedLine;
    await tx.query('UPDATE rs_threads SET line = $2, end_line = $3, revision_id = $4 WHERE id = $1', [
      thread.id,
      mappedLine,
      mappedEnd,
      nextRevision,
    ]);
  }
}

export interface SuggestionApplication {
  contents: Contents;
  commentIds: number[];
  message: string;
}

/** Builds the file contents of one applied suggestion or batch, or refuses it. */
export async function buildSuggestionApplication(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  headRevision: string,
  commentIds: number[],
): Promise<SuggestionApplication> {
  const threads = await loadThreads(tx, change.id);
  interface Target {
    path: string;
    start: number;
    end: number;
    lines: string[];
  }
  const targets: Target[] = [];

  for (const commentId of commentIds) {
    const thread = threads.find((item) => item.comments.some((comment) => comment.id === commentId));
    const comment = thread?.comments.find((item) => item.id === commentId);
    if (!thread || !comment) throw invalid('comments', `Comment ${commentId} has no suggestion`);
    if (!comment.suggestion) throw invalid('comments', `Comment ${commentId} has no suggestion`);
    if (comment.suggestion.state === 'applied') throw conflict('This suggestion was already applied');

    const madeOn = comment.suggestion.revision;
    const previousText = (await readFileText(tx, repo.id, madeOn, thread.path)) ?? '';
    const currentText = (await readFileText(tx, repo.id, headRevision, thread.path)) ?? '';
    const map = previousText === currentText ? null : lineMapping(previousText, currentText);

    let start = comment.suggestion.line;
    let end = comment.suggestion.endLine;
    if (map !== null) {
      for (let line = comment.suggestion.line; line <= comment.suggestion.endLine; line += 1) {
        if (map.get(line) === undefined) {
          throw conflict(`This suggestion can no longer be applied: line ${line} changed since it was made.`);
        }
      }
      start = map.get(comment.suggestion.line)!;
      end = map.get(comment.suggestion.endLine)!;
    }
    targets.push({ path: thread.path, start, end, lines: comment.suggestion.lines });
  }

  const contents: Contents = new Map();
  const byPath = new Map<string, Target[]>();
  for (const target of targets) {
    const list = byPath.get(target.path) ?? [];
    list.push(target);
    byPath.set(target.path, list);
  }

  for (const [path, list] of byPath) {
    const text = (await readFileText(tx, repo.id, headRevision, path)) ?? '';
    const endsWithNewline = text.endsWith('\n');
    let lines = splitLines(text);
    for (const target of [...list].sort((a, b) => b.start - a.start)) {
      lines = [...lines.slice(0, target.start - 1), ...target.lines, ...lines.slice(target.end)];
    }
    const rebuilt = lines.length === 0 ? '' : `${lines.join('\n')}${endsWithNewline ? '\n' : ''}`;
    contents.set(path, Buffer.from(rebuilt, 'utf8'));
  }

  const message = commentIds.length === 1 ? 'Apply 1 suggestion' : `Apply ${commentIds.length} suggestions`;
  return { contents, commentIds, message };
}

export async function markSuggestionsApplied(tx: Db, commentIds: number[]): Promise<void> {
  if (commentIds.length === 0) return;
  await tx.query("UPDATE rs_comments SET suggestion_state = 'applied' WHERE id = ANY($1::bigint[])", [commentIds]);
}

export async function createThread(
  tx: Db,
  change: ChangeRow,
  input: {
    path: string;
    side: 'old' | 'new';
    line: number;
    endLine: number;
    body: string;
    authorUserId: number;
    revisionId: string;
    suggestion: string[] | null;
  },
): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO rs_threads (change_id, path, side, line, end_line, revision_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [change.id, input.path, input.side, input.line, input.endLine, input.revisionId, serverNow()],
  );
  const threadId = Number(rows[0].id);
  await tx.query(
    `INSERT INTO rs_comments (thread_id, author_user_id, body, created_at, suggestion_lines, suggestion_state,
       suggestion_line, suggestion_end_line, suggestion_revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      threadId,
      input.authorUserId,
      input.body,
      serverNow(),
      input.suggestion === null ? null : JSON.stringify(input.suggestion),
      input.suggestion === null ? null : 'open',
      input.suggestion === null ? null : input.line,
      input.suggestion === null ? null : input.endLine,
      input.suggestion === null ? null : input.revisionId,
    ],
  );
  return threadId;
}
