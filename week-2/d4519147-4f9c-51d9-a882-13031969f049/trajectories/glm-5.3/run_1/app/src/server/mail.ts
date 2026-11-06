// Queued mail: invitation and access-changed notices. Every message is stored
// in the same transaction as its share transition, then delivered exactly once.

import net from 'node:net';
import type { PoolClient } from 'pg';
import crypto from 'node:crypto';
import { MAIL_FROM } from './mailHeaders.js';
import { publicUrlOrigin } from './security.js';
import { withClient } from './db.js';

export type MailKind = 'invite' | 'downgrade' | 'revoked';

export interface QueuedInviteMail {
  kind: 'invite';
  to: string;
  inviteeName: string | null;
  inviterName: string;
  diagramTitle: string;
  role: 'editor' | 'viewer';
  token: string;
  expiresAt: Date;
}

export interface QueuedNoticeMail {
  kind: 'downgrade' | 'revoked';
  to: string;
  diagramTitle: string;
}

export type QueuedMail = QueuedInviteMail | QueuedNoticeMail;

const INVITE_SUBJECT = 'You have been invited to a diagram on Scopewright';
const NOTICE_SUBJECT = 'Your access to a diagram on Scopewright changed';

// Bodies are quoted-printable, plain text, user text only in the body.
function inviteBody(m: QueuedInviteMail): string {
  const role = m.role;
  const accept = `${publicUrlOrigin()}/invite/${m.token}`;
  const exp = m.expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [
    `${m.inviterName} invited you to ${m.diagramTitle} as ${role}.`,
    `Accept: ${accept}`,
    `This link expires at ${exp} (UTC).`,
  ].join('\r\n');
}

function noticeBody(m: QueuedNoticeMail): string {
  return m.kind === 'downgrade'
    ? `Your role on ${m.diagramTitle} is now viewer.`
    : `You no longer have access to ${m.diagramTitle}.`;
}

export function mailSubject(kind: MailKind): string {
  return kind === 'invite' ? INVITE_SUBJECT : NOTICE_SUBJECT;
}

export function mailBody(mail: QueuedMail): string {
  return mail.kind === 'invite' ? inviteBody(mail) : noticeBody(mail);
}

// Queue a message inside the caller's transaction.
export async function queueMail(
  ctx: { client: PoolClient; now: Date },
  mail: QueuedMail,
  diagramId: string,
): Promise<void> {
  await ctx.client.query(
    `INSERT INTO mail_queue (id, to_email, subject, body, status, diagram_id, created_at)
     VALUES ($1, $2, $3, $4, 'queued', $5, $6)`,
    [
      crypto.randomUUID(),
      mail.to,
      mailSubject(mail.kind),
      mailBody(mail),
      diagramId,
      ctx.now,
    ],
  );
}

// Cancel every queued message for a diagram (diagram deletion).
export async function cancelDiagramMail(ctx: { client: PoolClient }, diagramId: string): Promise<void> {
  await ctx.client.query(
    `UPDATE mail_queue SET status = 'cancelled' WHERE diagram_id = $1 AND status IN ('queued', 'sending')`,
    [diagramId],
  );
}

// ---------------------------------------------------------------------------
// Delivery. Each running instance claims one message at a time; a message is
// marked sent only after the mail server accepts it.

// A minimal SMTP client: connect, EHLO, one message, QUIT. The message is
// text/plain with quoted-printable transfer encoding.
function smtpSend(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: process.env.SMTP_HOST ?? 'mailpit',
      port: Number(process.env.SMTP_PORT ?? 1025),
    });
    socket.setTimeout(5000);
    let buffer = '';
    let step = 0;
    const fail = (err: Error): void => {
      socket.destroy();
      reject(err);
    };
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // An SMTP reply is complete when its last line has a space, not a
      // dash, after the code.
      const lines = buffer.split('\r\n');
      let complete = false;
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (line.length >= 4 && line[3] !== '-') complete = true;
      }
      if (!complete) return;
      const lastLine = lines[lines.length - 2] ?? lines[lines.length - 1];
      const expectThen = (code: string, next: () => void): void => {
        if (!lastLine.startsWith(code)) {
          fail(new Error('smtp reply unexpected'));
          return;
        }
        buffer = '';
        next();
      };
      switch (step) {
        case 0:
          expectThen('220', () => {
            step = 1;
            socket.write('EHLO scopewright\r\n');
          });
          break;
        case 1:
          expectThen('250', () => {
            step = 2;
            socket.write(`MAIL FROM:<${envelopeAddress(MAIL_FROM)}>\r\n`);
          });
          break;
        case 2:
          expectThen('250', () => {
            step = 3;
            socket.write(`RCPT TO:<${to}>\r\n`);
          });
          break;
        case 3:
          expectThen('250', () => {
            step = 4;
            socket.write('DATA\r\n');
          });
          break;
        case 4:
          expectThen('354', () => {
            step = 5;
            socket.write(renderSmtpMessage(to, subject, body));
            socket.write('.\r\n');
          });
          break;
        case 5:
          expectThen('250', () => {
            step = 6;
            socket.write('QUIT\r\n');
          });
          break;
        default:
          socket.end();
          resolve();
      }
    });
    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('error', (err: Error) => fail(err));
  });
}

// The address inside the From line's angle brackets.
function envelopeAddress(from: string): string {
  const match = /<([^>]*)>/.exec(from);
  return match !== null ? match[1] : from;
}

// Message headers are fixed and single-line. No header carries user text
// beyond the validated recipient address.
function renderSmtpMessage(to: string, subject: string, body: string): string {
  const headers = [
    `From: ${MAIL_FROM}`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@scopewright.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + quotedPrintable(body) + '\r\n';
}

// Quoted-printable: bytes outside printable ASCII are encoded as =HH.
function quotedPrintable(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  const out: string[] = [];
  for (const b of bytes) {
    if (b === 13) out.push('\r');
    else if (b === 10) out.push('\n');
    else if (b === 61) out.push('=3D');
    else if (b >= 33 && b <= 126) out.push(String.fromCharCode(b));
    else out.push('=' + b.toString(16).toUpperCase().padStart(2, '0'));
  }
  return out.join('');
}

const INSTANCE_ID = crypto.randomUUID();

async function deliverOne(): Promise<boolean> {
  const claimed = await withClient(async (client) => {
    const rows = await client.query<{ id: string; to_email: string; subject: string; body: string }>(
      `UPDATE mail_queue SET status = 'sending', claimed_by = $1, claimed_at = now()
       WHERE id = (
         SELECT id FROM mail_queue
         WHERE status = 'queued'
           AND (claimed_at IS NULL OR claimed_at < now() - interval '60 seconds')
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, to_email, subject, body`,
      [INSTANCE_ID],
    );
    if (rows.rowCount === 0) return null;
    return rows.rows[0];
  });
  if (claimed === null) return false;
  try {
    await smtpSend(claimed.to_email, claimed.subject, claimed.body);
    await withClient(async (client) => {
      await client.query(`UPDATE mail_queue SET status = 'sent', sent_at = now() WHERE id = $1`, [claimed.id]);
    });
  } catch {
    await withClient(async (client) => {
      await client.query(
        `UPDATE mail_queue SET status = 'queued', claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
        [claimed.id],
      );
    });
  }
  return true;
}

export async function deliverQueued(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const delivered = await deliverOne();
    if (!delivered) break;
  }
}
