import net from 'node:net';
import { db } from './db.js';

/**
 * Mail delivery: emails are recorded in a shared PostgreSQL outbox. A request
 * that records an email tries to send it within a 5-second limit; otherwise
 * every process retries queued emails at least every 30 seconds. Each recorded
 * email is delivered exactly once.
 */

const RETRY_INTERVAL_MS = 30_000;


export type OutboxEmail = {
  id: string;
  kind: 'review_link' | 'decision_summary';
  toEmail: string;
  subject: string;
  body: string;
};

export async function recordEmail(
  kind: OutboxEmail['kind'],
  refId: string,
  toEmail: string,
  subject: string,
  body: string
): Promise<string> {
  const pool = db();
  const res = await pool.query(
    `INSERT INTO email_outbox (kind, ref_id, to_email, subject, body, state)
     VALUES ($1,$2,$3,$4,$5,'queued') RETURNING id`,
    [kind, refId, toEmail, subject, body]
  );
  return String(res.rows[0].id);
}

/** Attempt SMTP delivery within the request's time limit. Returns sent or queued. */
export async function trySendWithinLimit(emailId: string): Promise<'sent' | 'queued'> {
  const claimed = await claim(emailId);
  if (!claimed) return 'queued';
  const ok = await smtpSend(claimed.toEmail, claimed.subject, claimed.body);
  if (ok) {
    await markSent(emailId);
    return 'sent';
  }
  await release(emailId);
  return 'queued';
}

async function claim(emailId: string): Promise<OutboxEmail | null> {
  const pool = db();
  const res = await pool.query(
    `UPDATE email_outbox SET state='sending', attempt_started_at=now(), attempts=attempts+1
     WHERE id=$1 AND state='queued' RETURNING id, kind, ref_id, to_email, subject, body`,
    [emailId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: String(r.id),
    kind: r.kind as OutboxEmail['kind'],
    toEmail: r.to_email as string,
    subject: r.subject as string,
    body: r.body as string,
  };
}

async function release(emailId: string): Promise<void> {
  const pool = db();
  await pool.query(`UPDATE email_outbox SET state='queued', attempt_started_at=NULL WHERE id=$1`, [emailId]);
}

async function markSent(emailId: string): Promise<void> {
  const pool = db();
  await pool.query(`UPDATE email_outbox SET state='sent', sent_at=now() WHERE id=$1`, [emailId]);
}

/** The SMTP dialogue, with the whole attempt under the caller's limit. */
async function smtpSend(to: string, subject: string, body: string): Promise<boolean> {
  const host = process.env.SMTP_HOST ?? '';
  const port = Number(process.env.SMTP_PORT ?? '1025');
  const from = process.env.MAIL_FROM ?? 'Spanwise <reviews@larchline.example>';
  if (!host) return false;
  return new Promise((resolve) => {
    let socket: net.Socket | null = null;
    const timer = setTimeout(() => {
      socket?.destroy();
      resolve(false);
    }, 4500);
    try {
      socket = net.createConnection({ host, port }, () => {
        const message =
          `EHLO spanwise\r\n` +
          `MAIL FROM:<${extractAddress(from)}>\r\n` +
          `RCPT TO:<${to}>\r\n` +
          `DATA\r\n` +
          `From: ${from}\r\n` +
          `To: ${to}\r\n` +
          `Subject: ${subject}\r\n` +
          `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
          body.replace(/\r?\n/g, '\r\n') + `\r\n.\r\nQUIT\r\n`;
        socket!.write(message, () => {
          socket!.end();
        });
      });
      socket.on('data', () => { /* drain responses */ });
      socket.on('end', () => {
        clearTimeout(timer);
        resolve(true);
      });
      socket.on('close', (hadError) => {
        clearTimeout(timer);
        resolve(!hadError);
      });
      socket.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    } catch {
      clearTimeout(timer);
      socket?.destroy();
      resolve(false);
    }
  });
}

function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
}

let mailReachable = false;
let lastProbeAt = 0;

export async function probeMail(): Promise<boolean> {
  const host = process.env.SMTP_HOST ?? '';
  const port = Number(process.env.SMTP_PORT ?? '1025');
  if (!host) {
    mailReachable = false;
    lastProbeAt = Date.now();
    return false;
  }
  const ok = await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (v: boolean) => { socket.destroy(); resolve(v); };
    socket.setTimeout(3000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
  mailReachable = ok;
  lastProbeAt = Date.now();
  return ok;
}

export function mailLastProbe(): { ok: boolean; at: number } {
  return { ok: mailReachable, at: lastProbeAt };
}

/** Retry loop: every process that can reach mail drains the shared outbox. */
export function startOutboxLoop(): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await drainOutbox();
    } finally {
      running = false;
    }
  }, RETRY_INTERVAL_MS).unref();
}

async function drainOutbox(): Promise<void> {
  const pool = db();
  const reachable = await probeMail();
  if (!reachable) return;
  // Claim queued rows whose claim has gone stale, and freshly queued rows.
  const res = await pool.query(
    `SELECT id FROM email_outbox
     WHERE state='queued' OR (state='sending' AND attempt_started_at < now() - interval '15 seconds')
     ORDER BY id LIMIT 20`
  );
  for (const row of res.rows) {
    const id = String(row.id);
    const claimed = await reclaim(id);
    if (!claimed) continue;
    const ok = await smtpSend(claimed.toEmail, claimed.subject, claimed.body);
    if (ok) await markSent(id);
    else await release(id);
  }
}

async function reclaim(emailId: string): Promise<OutboxEmail | null> {
  const pool = db();
  const res = await pool.query(
    `UPDATE email_outbox SET state='sending', attempt_started_at=now(), attempts=attempts+1
     WHERE id=$1 AND (state='queued' OR (state='sending' AND attempt_started_at < now() - interval '15 seconds'))
     RETURNING id, kind, ref_id, to_email, subject, body`,
    [emailId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: String(r.id),
    kind: r.kind as OutboxEmail['kind'],
    toEmail: r.to_email as string,
    subject: r.subject as string,
    body: r.body as string,
  };
}

