import { randomBytes } from 'node:crypto';
import { query } from './db.js';
import { broadcast, isoString } from './livedoc.js';
import { personObject } from './people.js';
import type { Notice, NoticeKind, Role } from '../shared/types.js';

export function newId(): string {
  return randomBytes(16).toString('base64url');
}

export function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export async function noticesFor(personId: string): Promise<{ unread: number; notices: Notice[] }> {
  const result = await query<{
    id: string;
    kind: NoticeKind;
    document_id: string;
    title: string;
    actor_id: string;
    role: Role | null;
    comment_id: string | null;
    text: string;
    read: boolean;
    created_at: Date;
  }>(
    `select n.id, n.kind, n.document_id, d.title, n.actor_id, n.role, n.comment_id, n.text, n.read, n.created_at
     from notices n
     join documents d on d.id = n.document_id
     left join shares s
       on s.document_id = n.document_id and s.person_id = n.person_id and s.status = 'active'
       and (s.ends_at is null or s.ends_at > now())
     where n.person_id = $1 and (d.owner_id = $1 or s.id is not null)
     order by n.created_at desc, n.id desc
     limit 50`,
    [personId],
  );
  const notices = result.rows.map((row) => {
    const notice: Notice = {
      id: row.id,
      kind: row.kind,
      documentId: row.document_id,
      documentTitle: row.title,
      actor: personObject(row.actor_id),
      text: row.text,
      read: row.read,
      createdAt: isoString(row.created_at),
    };
    if (row.role) notice.role = row.role;
    if (row.comment_id) notice.commentId = row.comment_id;
    return notice;
  });
  return { unread: notices.filter((notice) => !notice.read).length, notices };
}

export async function noticeById(personId: string, noticeId: string): Promise<Notice | null> {
  const { notices } = await noticesFor(personId);
  return notices.find((notice) => notice.id === noticeId) ?? null;
}

interface NewNotice {
  personId: string;
  kind: NoticeKind;
  documentId: string;
  documentTitle: string;
  actorId: string;
  role?: Role;
  commentId?: string;
}

function noticeText(input: NewNotice): string {
  const actor = personObject(input.actorId).displayName;
  if (input.kind === 'mention') return `${actor} mentioned you in ${input.documentTitle}`;
  if (input.kind === 'shared') {
    return `${actor} shared ${input.documentTitle} with you as ${roleLabel(input.role as Role)}`;
  }
  return `Your access to ${input.documentTitle} changed to ${roleLabel(input.role as Role)}`;
}

export async function createNotice(input: NewNotice): Promise<void> {
  const id = newId();
  const text = noticeText(input);
  const result = await query<{ created_at: Date }>(
    `insert into notices (id, person_id, kind, document_id, actor_id, role, comment_id, text)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning created_at`,
    [id, input.personId, input.kind, input.documentId, input.actorId, input.role ?? null, input.commentId ?? null, text],
  );
  const row = result.rows[0];
  if (!row) return;
  const notice: Notice = {
    id,
    kind: input.kind,
    documentId: input.documentId,
    documentTitle: input.documentTitle,
    actor: personObject(input.actorId),
    text,
    read: false,
    createdAt: isoString(row.created_at),
  };
  if (input.role) notice.role = input.role;
  if (input.commentId) notice.commentId = input.commentId;
  broadcast().toPerson(input.personId, { type: 'notice', notice });
}

export async function markNoticeRead(noticeId: string): Promise<void> {
  await query('update notices set read = true where id = $1', [noticeId]);
}
