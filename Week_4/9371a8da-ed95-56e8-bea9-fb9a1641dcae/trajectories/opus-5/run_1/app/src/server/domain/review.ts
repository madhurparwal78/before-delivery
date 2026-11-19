import { query } from '../db.js';
import {
  iso,
  Person,
  personView,
  SharePerson,
  Suggestion,
  SuggestionStatus,
  Thread,
  ThreadComment,
} from './shapes.js';

export type Audience = 'member' | 'share';

interface SuggestionRow {
  id: string;
  file_id: string;
  file_path: string;
  from_pos: number | null;
  to_pos: number | null;
  deleted_text: string;
  inserted: string;
  status: SuggestionStatus;
  created_at: Date;
  orphaned_at: Date | null;
  resolved_at: Date | null;
  author_id: string;
  author_display_name: string;
  author_handle: string;
  author_email: string;
  resolver_id: string | null;
  resolver_display_name: string | null;
  resolver_handle: string | null;
  resolver_email: string | null;
}

interface ThreadRow {
  id: string;
  file_id: string;
  file_path: string;
  from_pos: number | null;
  to_pos: number | null;
  quote: string;
  status: 'open' | 'resolved';
  orphaned_at: Date | null;
  created_at: Date;
  resolver_id: string | null;
  resolver_display_name: string | null;
  resolver_handle: string | null;
  resolver_email: string | null;
}

interface CommentRow {
  id: string;
  thread_id: string;
  body: string;
  created_at: Date;
  author_id: string;
  author_display_name: string;
  author_handle: string;
  author_email: string;
}

function person(
  audience: Audience,
  row: { id: string; display_name: string; handle: string; email: string },
): Person | SharePerson {
  return audience === 'share'
    ? personView.shared(row)
    : personView.person({
        id: row.id,
        display_name: row.display_name,
        handle: row.handle,
        email: row.email,
      });
}

function authorOf(audience: Audience, row: CommentRow | SuggestionRow): Person | SharePerson {
  return person(audience, {
    id: row.author_id,
    display_name: row.author_display_name,
    handle: row.author_handle,
    email: row.author_email,
  });
}

function resolverOf(
  audience: Audience,
  row: { resolver_id: string | null; resolver_display_name: string | null; resolver_handle: string | null; resolver_email: string | null },
): Person | SharePerson | null {
  if (row.resolver_id === null) return null;
  return person(audience, {
    id: row.resolver_id,
    display_name: row.resolver_display_name as string,
    handle: row.resolver_handle as string,
    email: row.resolver_email as string,
  });
}

function compareAnchored(
  left: { path: string; from: number; createdAt: number; id: string },
  right: { path: string; from: number; createdAt: number; id: string },
): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.from !== right.from) return left.from - right.from;
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  return left.id < right.id ? -1 : 1;
}

function compareOrphaned(
  left: { orphanedAt: number; id: string },
  right: { orphanedAt: number; id: string },
): number {
  if (left.orphanedAt !== right.orphanedAt) return left.orphanedAt - right.orphanedAt;
  return left.id < right.id ? -1 : 1;
}

export interface ReviewPayload {
  suggestions: Suggestion[];
  threads: Thread[];
  openSuggestions: number;
}

export async function loadReview(
  projectId: string,
  audience: Audience,
): Promise<ReviewPayload> {
  const suggestionRows = await query<SuggestionRow>(
    `select s.id, s.file_id, f.path as file_path, s.from_pos, s.to_pos, s.deleted_text,
            s.inserted, s.status, s.created_at, s.orphaned_at, s.resolved_at,
            a.id as author_id, a.display_name as author_display_name, a.handle as author_handle,
            a.email as author_email,
            r.id as resolver_id, r.display_name as resolver_display_name,
            r.handle as resolver_handle, r.email as resolver_email
       from suggestions s
       join files f on f.id = s.file_id
       join users a on a.id = s.author_id
       left join users r on r.id = s.resolved_by
      where s.project_id = $1`,
    [projectId],
  );

  const threadRows = await query<ThreadRow>(
    `select t.id, t.file_id, f.path as file_path, t.from_pos, t.to_pos, t.quote, t.status,
            t.orphaned_at, t.created_at,
            r.id as resolver_id, r.display_name as resolver_display_name,
            r.handle as resolver_handle, r.email as resolver_email
       from threads t
       join files f on f.id = t.file_id
       left join users r on r.id = t.resolved_by
      where t.project_id = $1`,
    [projectId],
  );

  const commentRows = await query<CommentRow>(
    `select c.id, c.thread_id, c.body, c.created_at,
            a.id as author_id, a.display_name as author_display_name,
            a.handle as author_handle, a.email as author_email
       from comments c
       join threads t on t.id = c.thread_id
       join users a on a.id = c.author_id
      where t.project_id = $1
      order by c.created_at, c.id`,
    [projectId],
  );

  const commentsByThread = new Map<string, CommentRow[]>();
  for (const row of commentRows) {
    const list = commentsByThread.get(row.thread_id) ?? [];
    list.push(row);
    commentsByThread.set(row.thread_id, list);
  }

  const anchoredSuggestions = suggestionRows.filter((row) => row.orphaned_at === null);
  const orphanedSuggestions = suggestionRows.filter((row) => row.orphaned_at !== null);
  anchoredSuggestions.sort((left, right) =>
    compareAnchored(
      {
        path: left.file_path,
        from: left.from_pos ?? 0,
        createdAt: left.created_at.getTime(),
        id: left.id,
      },
      {
        path: right.file_path,
        from: right.from_pos ?? 0,
        createdAt: right.created_at.getTime(),
        id: right.id,
      },
    ),
  );
  orphanedSuggestions.sort((left, right) =>
    compareOrphaned(
      { orphanedAt: (left.orphaned_at as Date).getTime(), id: left.id },
      { orphanedAt: (right.orphaned_at as Date).getTime(), id: right.id },
    ),
  );

  const suggestions: Suggestion[] = [...anchoredSuggestions, ...orphanedSuggestions].map((row) => ({
    id: row.id,
    fileId: row.file_id,
    from: row.from_pos,
    to: row.to_pos,
    deleted: row.deleted_text,
    inserted: row.inserted,
    status: row.status,
    author: authorOf(audience, row),
    createdAt: iso(row.created_at),
    resolvedBy: resolverOf(audience, row),
    resolvedAt: row.resolved_at === null ? null : iso(row.resolved_at),
  }));

  const threadCreatedAt = (row: ThreadRow): number => {
    const comments = commentsByThread.get(row.id);
    return comments === undefined || comments.length === 0
      ? row.created_at.getTime()
      : comments[0].created_at.getTime();
  };

  const anchoredThreads = threadRows.filter((row) => row.orphaned_at === null);
  const orphanedThreads = threadRows.filter((row) => row.orphaned_at !== null);
  anchoredThreads.sort((left, right) =>
    compareAnchored(
      {
        path: left.file_path,
        from: left.from_pos ?? 0,
        createdAt: threadCreatedAt(left),
        id: left.id,
      },
      {
        path: right.file_path,
        from: right.from_pos ?? 0,
        createdAt: threadCreatedAt(right),
        id: right.id,
      },
    ),
  );
  orphanedThreads.sort((left, right) =>
    compareOrphaned(
      { orphanedAt: (left.orphaned_at as Date).getTime(), id: left.id },
      { orphanedAt: (right.orphaned_at as Date).getTime(), id: right.id },
    ),
  );

  const threads: Thread[] = [...anchoredThreads, ...orphanedThreads].map((row) => {
    const comments: ThreadComment[] = (commentsByThread.get(row.id) ?? []).map((comment) => ({
      id: comment.id,
      author: authorOf(audience, comment),
      body: comment.body,
      createdAt: iso(comment.created_at),
    }));
    return {
      id: row.id,
      fileId: row.file_id,
      from: row.from_pos,
      to: row.to_pos,
      quote: row.quote,
      status: row.status,
      orphaned: row.orphaned_at !== null,
      comments,
      resolvedBy: resolverOf(audience, row),
    };
  });

  const openSuggestions = suggestionRows.filter((row) => row.status === 'open').length;
  return { suggestions, threads, openSuggestions };
}

export async function countOpenSuggestions(projectId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from suggestions where project_id = $1 and status = 'open'`,
    [projectId],
  );
  return Number(rows[0].count);
}

export async function countOpenThreads(projectId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from threads where project_id = $1 and status = 'open'`,
    [projectId],
  );
  return Number(rows[0].count);
}
