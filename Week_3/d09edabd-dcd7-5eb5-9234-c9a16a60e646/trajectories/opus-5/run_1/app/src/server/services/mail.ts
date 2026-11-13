import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { config } from '../config.js';
import type { EmailStatus } from '../../shared/types.js';
import { query } from './db.js';

let reachable = false;

export function mailUp(): boolean {
  return reachable;
}

function fromAddress(): string {
  const match = config.mail.from.match(/<([^>]+)>/);
  return match ? match[1] : config.mail.from;
}

interface Conversation {
  send(line: string): Promise<string>;
  end(): void;
}

function connect(timeoutMs: number): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let pending: ((value: string) => void) | null = null;
    let failed: ((error: Error) => void) | null = null;

    const settle = (): void => {
      const lines = buffer.split('\r\n').filter((line) => line.length > 0);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      const reply = buffer;
      buffer = '';
      const resolvePending = pending;
      pending = null;
      failed = null;
      if (resolvePending) resolvePending(reply);
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      settle();
    });
    socket.on('error', (error) => {
      if (failed) failed(error);
      else reject(error);
    });
    socket.on('timeout', () => {
      socket.destroy();
      const error = new Error('smtp timeout');
      if (failed) failed(error);
      else reject(error);
    });

    const expect = (): Promise<string> =>
      new Promise((ok, bad) => {
        pending = ok;
        failed = bad;
        settle();
      });

    const conversation: Conversation = {
      async send(line: string) {
        socket.write(`${line}\r\n`);
        const reply = await expect();
        if (/^[45]/.test(reply)) throw new Error(`smtp refused: ${reply.trim()}`);
        return reply;
      },
      end() {
        socket.destroy();
      },
    };

    expect()
      .then((greeting) => {
        if (/^[45]/.test(greeting)) {
          socket.destroy();
          reject(new Error('smtp greeting refused'));
          return;
        }
        resolve(conversation);
      })
      .catch(reject);
  });
}

async function deliver(recipient: string, subject: string, body: string): Promise<void> {
  const conversation = await connect(5000);
  try {
    await conversation.send('EHLO keyway-bench');
    await conversation.send(`MAIL FROM:<${fromAddress()}>`);
    await conversation.send(`RCPT TO:<${recipient}>`);
    await conversation.send('DATA');
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${recipient}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    const dotted = body
      .split('\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    await conversation.send(`${headers}\r\n\r\n${dotted}\r\n.`);
    await conversation.send('QUIT');
    reachable = true;
  } finally {
    conversation.end();
  }
}

export interface MailRequest {
  kind: 'invite' | 'debrief';
  recipient: string;
  subject: string;
  body: string;
  inviteId?: string;
  sessionId?: string;
}

/** Sends at once; a refused message stays queued and is retried every 10 seconds. */
export async function sendMail(request: MailRequest): Promise<EmailStatus> {
  const id = randomUUID();
  await query(
    `insert into mail_messages (id, kind, recipient, subject, body, status, invite_id, session_id)
     values ($1,$2,$3,$4,$5,'queued',$6,$7)`,
    [
      id,
      request.kind,
      request.recipient,
      request.subject,
      request.body,
      request.inviteId ?? null,
      request.sessionId ?? null,
    ],
  );
  return attempt(id, request.recipient, request.subject, request.body, 0);
}

async function attempt(
  id: string,
  recipient: string,
  subject: string,
  body: string,
  attempts: number,
): Promise<EmailStatus> {
  try {
    await deliver(recipient, subject, body);
    await query(`update mail_messages set status = 'sent', attempts = $2 where id = $1`, [
      id,
      attempts + 1,
    ]);
    return 'sent';
  } catch {
    reachable = false;
    const total = attempts + 1;
    const status: EmailStatus = total >= 3 ? 'failed' : 'queued';
    await query(
      `update mail_messages set status = $2, attempts = $3,
         next_attempt_at = now() + interval '10 seconds' where id = $1`,
      [id, status, total],
    );
    return status;
  }
}

export async function resendMail(inviteId: string): Promise<EmailStatus> {
  const rows = await query<{
    id: string;
    recipient: string;
    subject: string;
    body: string;
  }>(
    `select id, recipient, subject, body from mail_messages
       where invite_id = $1 order by created_at desc limit 1`,
    [inviteId],
  );
  const message = rows[0];
  if (!message) return 'failed';
  await query(`update mail_messages set status = 'queued', attempts = 0 where id = $1`, [
    message.id,
  ]);
  return attempt(message.id, message.recipient, message.subject, message.body, 0);
}

export async function inviteStatus(inviteId: string): Promise<EmailStatus> {
  const rows = await query<{ status: EmailStatus }>(
    `select status from mail_messages where invite_id = $1 order by created_at desc limit 1`,
    [inviteId],
  );
  return rows[0]?.status ?? 'queued';
}

export async function debriefStatus(sessionId: string): Promise<EmailStatus> {
  const rows = await query<{ status: EmailStatus }>(
    `select status from mail_messages where session_id = $1 and kind = 'debrief'`,
    [sessionId],
  );
  if (rows.length === 0) return 'queued';
  if (rows.some((row) => row.status === 'failed')) return 'failed';
  if (rows.some((row) => row.status === 'queued')) return 'queued';
  return 'sent';
}

export async function drainQueue(): Promise<void> {
  const due = await query<{
    id: string;
    recipient: string;
    subject: string;
    body: string;
    attempts: number;
  }>(
    `update mail_messages set next_attempt_at = now() + interval '10 seconds'
       where id in (
         select id from mail_messages
           where status = 'queued' and attempts < 3 and next_attempt_at <= now()
           order by created_at limit 20
       )
     returning id, recipient, subject, body, attempts`,
  );
  for (const message of due) {
    await attempt(message.id, message.recipient, message.subject, message.body, message.attempts);
  }
}

export async function pingMail(): Promise<void> {
  try {
    const conversation = await connect(3000);
    await conversation.send('QUIT');
    conversation.end();
    reachable = true;
  } catch {
    reachable = false;
  }
}
