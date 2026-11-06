// The mail queue in PostgreSQL and its sender. Messages are written in the same transaction as the
// change that caused them, claimed before sending and marked sent afterwards, so each is delivered
// exactly once whichever app process sends it.
import { randomBytes } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { config } from './config';
import { now } from './clock';
import { tx, type Db } from './db';

const LEASE_MS = 60000;
// A failed or stalled attempt (SMTP_TIMEOUT_MS) plus the pause and the 2 s sender tick stays under
// the brief's 10 s retry bound.
const SMTP_TIMEOUT_MS = 4000;
const PAUSE_AFTER_FAILURE_MS = 3000;
const state = { up: true, pausedUntil: 0 };

export function mailUp(): boolean {
  return state.up;
}

export async function queueMail(db: Db, recipient: string, subject: string, body: string): Promise<void> {
  await db.query('INSERT INTO mail_queue (recipient, subject, body, created_at) VALUES ($1, $2, $3, $4)', [recipient, subject, body, now()]);
}

export async function queuedMailCount(db: Db): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::bigint AS n FROM mail_queue WHERE sent_at IS NULL');
  return (rows[0] as { n: number }).n;
}

const envelopeFrom = config.mailFrom.includes('<') ? config.mailFrom.slice(config.mailFrom.indexOf('<') + 1, config.mailFrom.indexOf('>')) : config.mailFrom;

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function compose(recipient: string, subject: string, body: string): string {
  const encoded = Buffer.from(body, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${config.mailFrom}`,
    `To: <${recipient}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date(now()).toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@saltreach.lowtide.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
  ].join('\r\n');
}

/** A minimal SMTP conversation (no authentication, no TLS), as Mailpit accepts. */
class SmtpConversation {
  private buffer = '';
  private waiting: ((reply: string) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => this.failed?.(error));
    socket.on('close', () => this.failed?.(new Error('smtp closed')));
  }

  static open(): Promise<SmtpConversation> {
    return new Promise((resolve, reject) => {
      const socket = netConnect({ host: config.smtpHost, port: config.smtpPort });
      socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error('smtp timeout')));
      socket.once('connect', () => resolve(new SmtpConversation(socket)));
      socket.once('error', reject);
    });
  }

  private flush(): void {
    // Only whole lines count: the last element is an unterminated remainder.
    const lines = this.buffer.split('\r\n');
    const end = lines.slice(0, -1).findIndex((line) => /^\d{3}( |$)/.test(line));
    if (end === -1 || !this.waiting) return;
    const reply = lines.slice(0, end + 1).join('\n');
    this.buffer = lines.slice(end + 1).join('\r\n');
    const done = this.waiting;
    this.waiting = null;
    this.failed = null;
    done(reply);
  }

  expect(code: string, line?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = (reply) => ((reply.split('\n').at(-1) ?? '').startsWith(code) ? resolve() : reject(new Error('smtp refused')));
      this.failed = reject;
      if (line !== undefined) this.socket.write(line + '\r\n');
      this.flush();
    });
  }

  close(): void {
    this.socket.end('QUIT\r\n');
    this.socket.destroy();
  }
}

async function deliver(recipient: string, subject: string, body: string): Promise<void> {
  const smtp = await SmtpConversation.open();
  try {
    await smtp.expect('220');
    await smtp.expect('250', 'EHLO saltreach.lowtide.test');
    await smtp.expect('250', `MAIL FROM:<${envelopeFrom}>`);
    await smtp.expect('250', `RCPT TO:<${recipient}>`);
    await smtp.expect('354', 'DATA');
    const message = compose(recipient, subject, body).replace(/^\./gm, '..');
    await smtp.expect('250', `${message}\r\n.`);
  } finally {
    smtp.close();
  }
}

async function probe(): Promise<void> {
  try {
    const smtp = await SmtpConversation.open();
    try {
      await smtp.expect('220');
    } finally {
      smtp.close();
    }
    state.up = true;
  } catch {
    state.up = false;
  }
}

interface QueuedMail {
  id: number;
  recipient: string;
  subject: string;
  body: string;
}

async function sendWaiting(): Promise<void> {
  if (now() < state.pausedUntil) return;
  let batch: QueuedMail[];
  try {
    batch = await tx(async (db) => {
      const at = now();
      const { rows } = await db.query<QueuedMail>(
        `UPDATE mail_queue SET lease_until = $1, attempts = attempts + 1
          WHERE id IN (SELECT id FROM mail_queue
                        WHERE sent_at IS NULL AND (lease_until IS NULL OR lease_until < $2)
                        ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
          RETURNING id, recipient, subject, body`,
        [at + LEASE_MS, at],
      );
      return rows.sort((a, b) => a.id - b.id);
    });
  } catch {
    return;
  }
  for (const [i, message] of batch.entries()) {
    try {
      await deliver(message.recipient, message.subject, message.body);
      state.up = true;
    } catch {
      state.up = false;
      state.pausedUntil = now() + PAUSE_AFTER_FAILURE_MS;
      const unsent = batch.slice(i).map((m) => m.id);
      await tx((db) => db.query('UPDATE mail_queue SET lease_until = NULL WHERE id = ANY($1::bigint[])', [unsent])).catch(() => undefined);
      return;
    }
    await tx((db) => db.query('UPDATE mail_queue SET sent_at = $2 WHERE id = $1', [message.id, now()])).catch(() => undefined);
  }
}

export function startMailSender(): void {
  let sending = false;
  setInterval(() => {
    if (sending) return;
    sending = true;
    void sendWaiting().finally(() => {
      sending = false;
    });
  }, 2000).unref();
  void probe();
  setInterval(() => void probe(), 5000).unref();
}

const link = (path: string): string => `${config.publicUrl}${path}`;

export const MAIL = {
  confirmSubject: 'Confirm your Saltreach email',
  resetSubject: 'Reset your Saltreach password',
  confirmLink: (token: string): string =>
    `Welcome to Saltreach.\n\nConfirm your email to raid and join clans:\n${link(`/verify?token=${token}`)}\n\nIf you did not create an island, ignore this message.\n`,
  alreadyVerified: (): string =>
    `This address already has a Saltreach account.\n\nSign in: ${link('/signin')}\nForgot your password? ${link('/forgot')}\n`,
  noAccountForResend: (): string =>
    `No Saltreach account uses this address yet.\n\nMake your island: ${link('/signup')}\n`,
  resetLink: (token: string): string =>
    `Set a new Saltreach password with this link. It works once and expires soon:\n${link(`/reset?token=${token}`)}\n\nIf you did not ask for this, ignore this message.\n`,
  noAccountForReset: (): string =>
    `Someone asked to reset a Saltreach password for this address, but no account uses it.\n\nMake your island: ${link('/signup')}\n`,
  invitationSubject: (inviter: string, clan: string): string => `${inviter} invited you to ${clan} on Saltreach`,
  invitation: (inviter: string, clan: string, hasAccount: boolean): string =>
    `${inviter} invited you to join ${clan} on Saltreach.\n\nSign in and open the Clan panel to accept the invitation: ${link('/signin')}\n` +
    (hasAccount ? '' : `\nNo account uses this address yet. Make your island first: ${link('/signup')}\n`),
};
