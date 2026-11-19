import { copy } from '../shared/copy.js';
import { findShape, pageOfShape, shapeLabel } from '../shared/document.js';
import type { User } from './auth.js';
import { query, queryOne } from './db.js';
import { requireMembership } from './diagrams.js';
import { config } from './env.js';
import { conflict, forbiddenRole, notFound } from './errors.js';
import { broadcast } from './hub.js';
import { newId } from './ids.js';
import { sendMail } from './mail.js';

export interface CommentView {
  id: string;
  shape: string;
  page: string;
  author: { id: string; name: string };
  text: string;
  resolved: boolean;
  anchored: boolean;
  parent: string | null;
  createdAt: string;
}

interface CommentRow extends Record<string, unknown> {
  id: string;
  shape_id: string;
  page_id: string;
  author_id: string;
  author_name: string;
  body: string;
  resolved: boolean;
  anchored: boolean;
  parent_id: string | null;
  created_at: Date;
}

function viewOf(row: CommentRow): CommentView {
  return {
    id: row.id,
    shape: row.shape_id,
    page: row.page_id,
    author: { id: row.author_id, name: row.author_name },
    text: row.body,
    resolved: row.resolved,
    anchored: row.anchored,
    parent: row.parent_id,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COMMENTS = `
  SELECT c.id, c.shape_id, c.page_id, c.author_id, u.name AS author_name, c.body,
         c.resolved, c.anchored, c.parent_id, c.created_at
    FROM comments c JOIN users u ON u.id = c.author_id`;

export async function listComments(diagramId: string): Promise<CommentView[]> {
  const rows = await query<CommentRow>(
    `${SELECT_COMMENTS} WHERE c.diagram_id = $1 ORDER BY c.created_at ASC`,
    [diagramId],
  );
  return rows.map(viewOf);
}

/**
 * A mention is `@` followed by the longest run of letters, digits and the characters
 * `.`, `_`, `%`, `+`, `-` and `@`, with a trailing `.` dropped.
 */
export function mentionedAddresses(text: string): string[] {
  const found: string[] = [];
  const pattern = /@[A-Za-z0-9._%+\-@]+/g;
  for (const match of text.matchAll(pattern)) {
    const run = match[0].slice(1).replace(/\.$/, '');
    if (run.length > 0) found.push(run.toLowerCase());
  }
  return [...new Set(found)];
}

function mentionBody(
  authorName: string,
  title: string,
  label: string,
  text: string,
  diagramId: string,
): string {
  return [
    `${authorName} mentioned you in a comment on "${title}".`,
    `Shape: ${label}`,
    '',
    text,
    '',
    `Open it here: ${config.publicUrl}/d/${diagramId}`,
  ].join('\n');
}

export async function createComment(
  diagramId: string,
  author: User,
  shapeId: string,
  text: string,
  parentId: string | null,
): Promise<CommentView> {
  const { diagram } = await requireMembership(diagramId, author.id);
  const page = pageOfShape(diagram.document, shapeId);
  const shape = page ? findShape(page, shapeId) : undefined;
  if (!page || !shape) throw conflict('shape_deleted', 'That shape was deleted.');
  if (parentId !== null) {
    const parent = await queryOne<{ id: string }>(
      'SELECT id FROM comments WHERE diagram_id = $1 AND id = $2',
      [diagramId, parentId],
    );
    if (!parent) throw notFound();
  }

  const id = newId('m');
  const rows = await query<CommentRow>(
    `WITH inserted AS (
       INSERT INTO comments (id, diagram_id, page_id, shape_id, author_id, body, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
     )
     SELECT i.id, i.shape_id, i.page_id, i.author_id, u.name AS author_name, i.body,
            i.resolved, i.anchored, i.parent_id, i.created_at
       FROM inserted i JOIN users u ON u.id = i.author_id`,
    [id, diagramId, page.id, shapeId, author.id, text, parentId],
  );
  const row = rows[0];
  if (!row) throw notFound();
  await query('INSERT INTO object_ids (diagram_id, id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
    diagramId,
    id,
    'comment',
  ]);

  await notifyMentions(diagramId, diagram.title, author, shapeLabel(shape), text);
  broadcast(diagramId, { t: 'comments' });
  return viewOf(row);
}

/**
 * Each mentioned member other than the author gets exactly one message per comment. A
 * mention counts only when it equals a current member's email, compared without case.
 */
async function notifyMentions(
  diagramId: string,
  title: string,
  author: User,
  label: string,
  text: string,
): Promise<void> {
  const addresses = mentionedAddresses(text);
  if (addresses.length === 0) return;
  const members = await query<{ email: string; name: string; id: string }>(
    `SELECT u.id, u.email, u.name FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.diagram_id = $1 AND lower(u.email) = ANY($2)`,
    [diagramId, addresses],
  );
  for (const member of members) {
    if (member.id === author.id) continue;
    try {
      await sendMail({
        to: member.email,
        subject: copy.mentionSubject(author.name, title),
        body: mentionBody(author.name, title, label, text, diagramId),
      });
    } catch {
      // Mail is unreachable: the mention email is skipped and the comment still posted.
    }
  }
}

export async function resolveComment(
  diagramId: string,
  commentId: string,
  user: User,
  canModerate: boolean,
): Promise<CommentView> {
  const existing = await queryOne<{ author_id: string; resolved: boolean }>(
    'SELECT author_id, resolved FROM comments WHERE diagram_id = $1 AND id = $2',
    [diagramId, commentId],
  );
  if (!existing) throw notFound();
  if (!canModerate && existing.author_id !== user.id) {
    throw forbiddenRole();
  }
  if (existing.resolved) throw conflict('already_resolved', 'That thread is already resolved.');
  const rows = await query<CommentRow>(
    `WITH updated AS (
       UPDATE comments SET resolved = true WHERE diagram_id = $1 AND id = $2 RETURNING *
     )
     SELECT c.id, c.shape_id, c.page_id, c.author_id, u.name AS author_name, c.body,
            c.resolved, c.anchored, c.parent_id, c.created_at
       FROM updated c JOIN users u ON u.id = c.author_id`,
    [diagramId, commentId],
  );
  const row = rows[0];
  if (!row) throw notFound();
  broadcast(diagramId, { t: 'comments' });
  return viewOf(row);
}
