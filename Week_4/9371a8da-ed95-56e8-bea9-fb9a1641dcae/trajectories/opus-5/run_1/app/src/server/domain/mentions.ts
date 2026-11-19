import { config } from '../config.js';
import { one, query, Tx } from '../db.js';
import { openMailConnection, sendMail } from '../infra/mail.js';
import { mentionEmail } from './emails.js';
import { newId } from './ids.js';

const CLAIM_DELAY_SECONDS = 10;

/** `@handle` at the start of a comment or after whitespace. */
export function mentionedHandles(body: string): string[] {
  const handles: string[] = [];
  const pattern = /(^|\s)@([a-z0-9]+)/g;
  let match = pattern.exec(body);
  while (match !== null) {
    if (!handles.includes(match[2])) handles.push(match[2]);
    match = pattern.exec(body);
  }
  return handles;
}

/** Each mention email is written in the same transaction as its comment. */
export async function recordMentionEmails(
  tx: Tx,
  input: {
    projectId: string;
    threadId: string;
    commentId: string;
    authorId: string;
    body: string;
  },
): Promise<string[]> {
  const handles = mentionedHandles(input.body);
  if (handles.length === 0) return [];
  const recipients = await tx.query<{ id: string }>(
    `select u.id from users u
       join memberships m on m.user_id = u.id and m.project_id = $1
      where u.handle = any($2::text[]) and u.id <> $3`,
    [input.projectId, handles, input.authorId],
  );
  const ids: string[] = [];
  for (const recipient of recipients) {
    const id = newId('me');
    ids.push(id);
    await tx.query(
      `insert into mention_emails
         (id, comment_id, project_id, thread_id, recipient_id, status, created_at, due_at)
       values ($1, $2, $3, $4, $5, 'pending', now(), now() + make_interval(secs => $6))`,
      [id, input.commentId, input.projectId, input.threadId, recipient.id, CLAIM_DELAY_SECONDS],
    );
  }
  return ids;
}

interface ClaimedRow {
  id: string;
  project_id: string;
  thread_id: string;
  recipient_id: string;
  recipient_email: string;
  project_title: string;
  author_name: string;
  comment_body: string;
  quote: string;
}

async function claimed(id: string): Promise<ClaimedRow | null> {
  return one<ClaimedRow>(
    `select m.id, m.project_id, m.thread_id, m.recipient_id,
            r.email as recipient_email, p.title as project_title,
            a.display_name as author_name, c.body as comment_body, t.quote
       from mention_emails m
       join users r on r.id = m.recipient_id
       join projects p on p.id = m.project_id
       join comments c on c.id = m.comment_id
       join users a on a.id = c.author_id
       join threads t on t.id = m.thread_id
      where m.id = $1`,
    [id],
  );
}

async function claim(id: string | null): Promise<ClaimedRow | null> {
  const rows =
    id === null
      ? await query<{ id: string }>(
          `update mention_emails set claimed_at = now(),
                  due_at = now() + make_interval(secs => $1)
            where id = (
              select id from mention_emails
               where status = 'pending' and due_at <= now()
               order by due_at limit 1 for update skip locked)
            returning id`,
          [CLAIM_DELAY_SECONDS],
        )
      : await query<{ id: string }>(
          `update mention_emails set claimed_at = now(),
                  due_at = now() + make_interval(secs => $2)
            where id = $1 and status = 'pending'
            returning id`,
          [id, CLAIM_DELAY_SECONDS],
        );
  if (rows.length === 0) return null;
  return claimed(rows[0].id);
}

async function stillMember(projectId: string, userId: string): Promise<boolean> {
  const row = await one(
    `select 1 from memberships where project_id = $1 and user_id = $2`,
    [projectId, userId],
  );
  return row !== null;
}

/** Drops every record that has been pending for the configured retry period. */
async function dropExpired(): Promise<void> {
  await query(
    `update mention_emails set status = 'dropped'
      where status = 'pending' and created_at <= now() - make_interval(secs => $1)`,
    [config.mentionRetrySeconds],
  );
}

async function attempt(id: string | null): Promise<boolean> {
  let close: (() => void) | null = null;
  try {
    close = await openMailConnection();
  } catch {
    return false;
  }
  try {
    const record = await claim(id);
    if (record === null) return false;
    if (!(await stillMember(record.project_id, record.recipient_id))) {
      await query(`update mention_emails set status = 'dropped' where id = $1`, [record.id]);
      return true;
    }
    await sendMail(
      mentionEmail({
        to: record.recipient_email,
        authorName: record.author_name,
        projectTitle: record.project_title,
        commentBody: record.comment_body,
        quote: record.quote,
        projectId: record.project_id,
        threadId: record.thread_id,
      }),
    );
    await query(`update mention_emails set status = 'sent' where id = $1`, [record.id]);
    return true;
  } catch {
    return false;
  } finally {
    if (close !== null) close();
  }
}

/** The posting instance's first attempt, made right after the comment answers. */
export function attemptNow(ids: readonly string[]): void {
  for (const id of ids) {
    void dropExpired()
      .then(() => attempt(id))
      .catch(() => false);
  }
}

async function anythingDue(): Promise<boolean> {
  const row = await one(
    `select 1 from mention_emails where status = 'pending' and due_at <= now() limit 1`,
  );
  return row !== null;
}

export async function sweepMentionEmails(): Promise<void> {
  await dropExpired().catch(() => undefined);
  for (let index = 0; index < 20; index += 1) {
    if (!(await anythingDue())) return;
    const sent = await attempt(null);
    if (!sent) return;
  }
}
