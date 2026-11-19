// Invitation and mention emails. Mention emails are PostgreSQL records that any instance on the database may send.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { InviteRole } from "../shared/api.ts";
import { config } from "./config.ts";
import { databaseReady, pool } from "./db.ts";
import { fail } from "./http.ts";
import { headerSafe, MailConnection, sendMail } from "./smtp.ts";

/** A failed attempt, or a record still owed its posting instance's first attempt, is due to anyone 10 seconds later. */
const RETRY_SECONDS = 10;

/** This running instance, as the owner of its records' first attempts and of its claims. */
const INSTANCE = randomUUID();

export async function sendInvite(invite: {
  to: string;
  inviterName: string;
  projectTitle: string;
  role: InviteRole;
  token: string;
  expiresAt: string;
}): Promise<void> {
  const inviter = headerSafe(invite.inviterName);
  const title = headerSafe(invite.projectTitle);
  const text = [
    `${inviter} invited you to ${title} on Marginalia as ${headerSafe(invite.role)}.`,
    "",
    `Accept the invitation: ${config.appBaseUrl}/invite/${invite.token}`,
    `This link expires on ${invite.expiresAt}.`,
  ].join("\n");
  try {
    await sendMail({ to: invite.to, subject: `${inviter} invited you to ${title} on Marginalia`, text });
  } catch {
    throw fail.mail();
  }
}

/** A mention is `@handle` at the start or after whitespace, ending before any character other than a–z and 0–9. */
function mentionedHandles(body: string): Set<string> {
  const handles = new Set<string>();
  for (const match of body.matchAll(/(?:^|\s)@([a-z0-9]+)/g)) if (match[1]) handles.add(match[1]);
  return handles;
}

/** Record one mention email per mentioned current member other than the author, inside the comment's transaction. */
export async function queueMentions(
  client: pg.PoolClient,
  mention: { projectId: string; projectTitle: string; threadId: string; quote: string; body: string; author: { id: string; display_name: string } },
): Promise<void> {
  const handles = [...mentionedHandles(mention.body)];
  if (handles.length === 0) return;
  await client.query(
    `INSERT INTO mention_emails (id, project_id, thread_id, recipient_id, subject, comment_body, quote, state, created_at, due_at, posted_by)
     SELECT gen_random_uuid()::text, $1, $2, u.id, $3, $4, $5, 'pending', now(), now() + make_interval(secs => $6), $7
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = $1 AND u.handle = ANY($8) AND u.id <> $9`,
    [mention.projectId, mention.threadId, `${headerSafe(mention.author.display_name)} mentioned you on ${headerSafe(mention.projectTitle)}`, mention.body, mention.quote,
      RETRY_SECONDS, INSTANCE, handles, mention.author.id],
  );
}

interface DueMention {
  id: string;
  project_id: string;
  thread_id: string;
  recipient_id: string;
  subject: string;
  comment_body: string;
  quote: string;
}

/** Records this instance may claim now: due to anyone, or still owed their first attempt by their posting instance. */
const CLAIMABLE = `state = 'pending' AND claimed_by IS NULL AND created_at > now() - make_interval(secs => $1)
  AND (due_at <= now() OR (posted_by = $2 AND NOT first_attempted))`;

/** The subject is already "<author> mentioned you on <project title>", made header-safe when recorded; SMTP ends the body with one line break. */
function mentionText(mail: DueMention): string {
  const asWritten = (text: string) => text.replace(/\r\n/g, "\n");
  return [
    `${mail.subject}:`,
    "",
    asWritten(mail.comment_body),
    "",
    `On the passage: "${asWritten(mail.quote)}"`,
    `Open the thread: ${config.appBaseUrl}/p/${mail.project_id}?thread=${mail.thread_id}`,
  ].join("\n");
}

let draining = false;

/**
 * The mention email state machine: pending → sent once SMTP accepts it, pending → dropped when the recipient left the
 * project or MENTION_RETRY_SECONDS passed. A record is claimed only after a fresh SMTP connection has opened.
 */
export async function deliverMentions(): Promise<void> {
  if (draining || !databaseReady()) return;
  draining = true;
  try {
    await pool.query(
      `UPDATE mention_emails SET state = 'dropped'
        WHERE state = 'pending' AND created_at <= now() - make_interval(secs => $1)
          AND (claimed_by IS NULL OR claimed_by = $2)`,
      [config.mentionRetrySeconds, INSTANCE],
    );
    const due = await pool.query<DueMention>(
      `SELECT id, project_id, thread_id, recipient_id, subject, comment_body, quote FROM mention_emails
        WHERE ${CLAIMABLE} ORDER BY created_at, id LIMIT 20`,
      [config.mentionRetrySeconds, INSTANCE],
    );
    if (due.rowCount === 0) return;
    let connection: MailConnection;
    try {
      connection = await MailConnection.open();
    } catch {
      // Nothing is claimed; this instance's own first attempts are spent and the records wait for anyone.
      await pool.query("UPDATE mention_emails SET first_attempted = true WHERE posted_by = $1 AND NOT first_attempted AND id = ANY($2)", [
        INSTANCE,
        due.rows.map((row) => row.id),
      ]);
      return;
    }
    try {
      for (const mail of due.rows) {
        const claimed = await pool.query<{ email: string | null }>(
          `UPDATE mention_emails SET claimed_by = $2, first_attempted = true
            WHERE id = $3 AND ${CLAIMABLE}
            RETURNING (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
                        WHERE m.project_id = mention_emails.project_id AND m.user_id = mention_emails.recipient_id) AS email`,
          [config.mentionRetrySeconds, INSTANCE, mail.id],
        );
        const row = claimed.rows[0];
        if (!row) continue;
        if (row.email === null) {
          await pool.query("UPDATE mention_emails SET state = 'dropped' WHERE id = $1 AND state = 'pending' AND claimed_by = $2", [mail.id, INSTANCE]);
          continue;
        }
        try {
          await connection.send({ to: row.email, subject: mail.subject, text: mentionText(mail) });
        } catch {
          await pool.query("UPDATE mention_emails SET claimed_by = NULL, due_at = now() + make_interval(secs => $2) WHERE id = $1", [
            mail.id,
            RETRY_SECONDS,
          ]);
          return;
        }
        await pool.query("UPDATE mention_emails SET state = 'sent', sent_at = now() WHERE id = $1 AND state = 'pending' AND claimed_by = $2", [mail.id, INSTANCE]);
      }
    } finally {
      connection.close();
    }
  } catch (error) {
    console.error("mention delivery:", error instanceof Error ? error.message : error);
  } finally {
    draining = false;
  }
}

/** Every instance looks for due mention emails well within every 10 seconds. */
export function startMentionDelivery(): void {
  setInterval(() => void deliverMentions(), 2000).unref();
}
