import type { Services } from './routes/services.js';
import type { Queryable } from './db.js';

/**
 * The mention email worker: every running instance looks for due records
 * at least once every 10 seconds.
 */
export function ensureMentionWorker(svc: Services): void {
  const tick = async () => {
    try {
      await processDueMentions(svc);
    } catch {
      // The next tick tries again; nothing is remembered.
    }
  };
  setInterval(() => { void tick(); }, 5000);
  void tick();
}

async function processDueMentions(svc: Services): Promise<void> {
  const { sql, mailer, config } = svc;
  const now = new Date();
  // Drop records past the retry period, even if never offered to another instance.
  await sql`
    UPDATE mention_emails SET state = 'dropped'
    WHERE state = 'pending' AND created_at < ${new Date(now.getTime() - config.mentionRetrySeconds * 1000)}`;

  const due = await sql<{
    id: string; project_id: string; thread_id: string; comment_id: string; recipient_id: string;
    recipient_email: string; quote: string; comment_body: string; author_name: string; project_title: string;
  }>`
    SELECT me.id, me.project_id, me.thread_id, me.comment_id, me.recipient_id,
           u.email AS recipient_email, t.quote AS quote, c.body AS comment_body,
           au.display_name AS author_name, p.title AS project_title
    FROM mention_emails me
    JOIN users u ON u.id = me.recipient_id
    JOIN threads t ON t.id = me.thread_id
    JOIN comments c ON c.id = me.comment_id
    JOIN users au ON au.id = c.author_id
    JOIN projects p ON p.id = me.project_id
    WHERE me.state = 'pending' AND me.next_attempt_at <= ${now}
    ORDER BY me.created_at
    LIMIT 20`;
  for (const row of due) {
    // An instance attempting a due record opens a fresh SMTP connection first,
    // and only claims the record when that connection opens.
    const probeOk = await mailer.probe();
    if (!probeOk) continue;
    const claimed = await claimRecord(sql, row.id, config.mentionRetrySeconds);
    if (!claimed) continue;
    // Membership recheck at each claim.
    const member = await sql`
      SELECT 1 FROM memberships WHERE project_id = ${row.project_id} AND user_id = ${row.recipient_id}`;
    if (!member[0]) {
      await sql`UPDATE mention_emails SET state = 'dropped' WHERE id = ${row.id}`;
      continue;
    }
    const subject = `${headerSafe(row.author_name)} mentioned you on ${headerSafe(row.project_title)}`;
    const body = `${headerSafe(row.author_name)} mentioned you on ${headerSafe(row.project_title)}:\n\n${normalise(row.comment_body)}\n\nOn the passage: "${normalise(row.quote)}"\nOpen the thread: ${config.appBaseUrl}/p/${row.project_id}?thread=${row.thread_id}\n`;
    const ok = await mailer.send(row.recipient_email, subject, body);
    if (ok) {
      await sql`UPDATE mention_emails SET state = 'sent', claimed_at = now() WHERE id = ${row.id}`;
    } else {
      await sql`UPDATE mention_emails SET next_attempt_at = now() + interval '10 seconds' WHERE id = ${row.id}`;
    }
  }
}

async function claimRecord(sql: Queryable, id: string, retrySeconds: number): Promise<boolean> {
  const rows = await sql`
    UPDATE mention_emails SET claimed_at = now(), attempts = attempts + 1
    WHERE id = ${id} AND state = 'pending' AND claimed_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

function headerSafe(s: string): string {
  return s.replace(/[\r\n\t\f\v\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

function normalise(s: string): string {
  return s.replace(/\r\n/g, '\n');
}
