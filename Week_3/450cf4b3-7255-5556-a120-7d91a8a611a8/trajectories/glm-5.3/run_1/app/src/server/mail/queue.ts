import pg from 'pg';
import { Config } from '../config.js';
import { SmtpClient } from './smtp.js';

// The mail queue lives in Postgres with the action that caused each email, so
// an action succeeds while mail is unreachable and its email arrives once any
// process reaches the mail server.

export interface EmailTemplate {
  kind: string;
  recordId: string;
  toName: string;
  toEmail: string;
  subject: string;
  body: string;
}

// RFC 5322 display name, quoted, or RFC 2047-encoded for non-ASCII.
export function formatTo(name: string, email: string): string {
  if (/^[\x20-\x7E]*$/.test(name)) {
    const escaped = name.replace(/([\\"])/g, '\\$1');
    return `"${escaped}" <${email}>`;
  }
  const encoded = Buffer.from(name, 'utf8').toString('base64').replace(/(.{1,60})(=|$)/g, '$1=$2')
    .split('=').filter(Boolean).map((l) => `=?utf-8?B?${l}?=`).join('');
  return `${encoded} <${email}>`;
}

export async function queueEmail(tx: pg.PoolClient, tenantId: string, template: EmailTemplate, now: number): Promise<string> {
  const id = crypto.randomUUID();
  await tx.query(
    `INSERT INTO mail_queue (id, kind, record_id, tenant_id, to_name, to_email, subject, body, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9)`,
    [id, template.kind, template.recordId, tenantId, template.toName, template.toEmail, template.subject, template.body, now],
  );
  return id;
}

export interface MailFrom { name: string | null; address: string }

// The configured From value, split into its display name and address.
export function parseFrom(from: string): MailFrom {
  const m = /^(.*?)\s*<(.+)>$/.exec(from);
  if (!m) return { name: null, address: from };
  return { name: m[1].trim() || null, address: m[2] };
}

export class Mailer {
  private client: SmtpClient;

  constructor(config: Config) {
    const from = parseFrom(config.smtp.from);
    this.client = new SmtpClient(config.smtp.host, config.smtp.port, from.address, from.name);
  }

  // Delivered only when the mail server acknowledges the end of the message.
  async send(toName: string, toEmail: string, subject: string, body: string, messageId: string): Promise<void> {
    await this.client.send(formatTo(toName, toEmail), toEmail, subject, body, messageId);
  }
}

// One process at a time claims each queued email.
export async function deliverPending(db: pg.Pool, mailer: Mailer): Promise<void> {
  const client = await db.connect();
  try {
    for (let i = 0; i < 20; i++) {
      await client.query('BEGIN');
      const claim = await client.query(
        `UPDATE mail_queue SET status='claimed', claimed_by=$1, claimed_at=$2
         WHERE id IN (
           SELECT id FROM mail_queue WHERE status='queued'
           ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
         ) RETURNING id, to_name, to_email, subject, body`,
        [process.pid, Date.now()],
      );
      if (claim.rows.length === 0) {
        await client.query('COMMIT');
        break;
      }
      const email = claim.rows[0];
      let delivered = false;
      try {
        await mailer.send(email.to_name, email.to_email, email.subject, email.body, `<queue-${email.id}@stationhouse.test>`);
        delivered = true;
      } catch {
        delivered = false;
      }
      if (delivered) {
        await client.query(
          `UPDATE mail_queue SET status='sent', sent_at=$2 WHERE id=$1`,
          [email.id, Date.now()],
        );
      } else {
        await client.query(`UPDATE mail_queue SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`, [email.id]);
      }
      await client.query('COMMIT');
    }
  } catch {
    // nothing to do: the next pass retries
  } finally {
    client.release();
  }
}
