import type { Db } from './db.js';
import { id } from './util.js';
import { logger } from './logger.js';

export interface MailMessage {
  playerId: string;
  to: string;
  subject: string;
  body: string;
  kind: 'verification' | 'receipt';
}

export type SendResult = 'sent' | 'failed';

export interface SmtpSettings {
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
}

export interface MailPort {
  send(message: MailMessage): Promise<SendResult>;
  deliverPending(): Promise<number>;
}

export async function createMailPort(config: SmtpSettings, db: Db): Promise<MailPort> {
  let nodemailer: typeof import('nodemailer') | null = null;
  try {
    nodemailer = await import('nodemailer');
  } catch {
    nodemailer = null;
    logger.warn('nodemailer is not installed; mail delivery is unavailable');
  }

  const transport = nodemailer?.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 5_000,
    tls: { rejectUnauthorized: false },
  });

  async function attempt(message: MailMessage): Promise<SendResult> {
    if (!transport || !config.smtpHost) return 'failed';
    try {
      await transport.sendMail({
        from: config.mailFrom,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
      return 'sent';
    } catch (err) {
      logger.warn(`mail send failed to ${message.to}: ${(err as Error).message}`);
      return 'failed';
    }
  }

  async function deliver(message: MailMessage): Promise<SendResult> {
    const result = await attempt(message);
    const rowId = id('mail');
    await db.pool.query(
      `INSERT INTO mail_outbox (id, player_id, to_email, subject, body, kind, status, attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1)
       ON CONFLICT (id) DO NOTHING`,
      [rowId, message.playerId, message.to, message.subject, message.body, message.kind, result === 'sent' ? 'sent' : 'pending']
    );
    if (result === 'sent') {
      await db.pool.query(`UPDATE mail_outbox SET sent_at = now() WHERE id = $1`, [rowId]);
    }
    return result;
  }

  async function deliverPending(): Promise<number> {
    const res = await db.pool.query<{ id: string; to_email: string; subject: string; body: string; kind: 'verification' | 'receipt' }>(
      `SELECT id, to_email, subject, body, kind FROM mail_outbox WHERE status = 'pending' AND attempts < 20 LIMIT 50`
    );
    let sent = 0;
    for (const row of res.rows) {
      const result = await attempt({ playerId: '', to: row.to_email, subject: row.subject, body: row.body, kind: row.kind });
      if (result === 'sent') {
        await db.pool.query(`UPDATE mail_outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [row.id]);
        sent++;
      } else {
        await db.pool.query(`UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      }
    }
    return sent;
  }

  return { send: deliver, deliverPending };
}

export async function playerHasPendingMail(db: Db, playerId: string): Promise<boolean> {
  const res = await db.pool.query(
    `SELECT 1 FROM mail_outbox WHERE player_id = $1 AND status = 'pending' AND kind = 'verification' LIMIT 1`,
    [playerId]
  );
  return (res.rowCount ?? 0) > 0;
}
