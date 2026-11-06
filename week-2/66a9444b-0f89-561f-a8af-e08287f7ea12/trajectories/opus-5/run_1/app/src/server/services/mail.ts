import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';
import { many, one, pool, type Queryable } from '../db/pool.js';
import { getObject } from './storage.js';

export interface MailAttachment {
  filename: string;
  key: string;
}

export interface QueuedMail {
  eventKey: string;
  to: string;
  subject: string;
  body: string;
  attachments?: readonly MailAttachment[];
}

/** Queued in the same transaction as the change that caused it, so each event sends one message. */
export async function queueMail(db: Queryable, mail: QueuedMail): Promise<void> {
  const inserted = await one<{ id: number }>(
    db,
    `INSERT INTO outbox (event_key, message_id, to_email, subject, body_text, attachments)
     VALUES ($1, '', $2, $3, $4, $5::jsonb)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING id`,
    [
      mail.eventKey,
      mail.to,
      mail.subject,
      mail.body,
      JSON.stringify(mail.attachments ?? []),
    ],
  );
  if (inserted === null) return;
  await db.query(`UPDATE outbox SET message_id = $2 WHERE id = $1`, [
    String(inserted.id),
    `<kerf-${inserted.id}@kerf.example>`,
  ]);
}

interface OutboxRow {
  id: number;
  message_id: string;
  to_email: string;
  subject: string;
  body_text: string;
  attachments: MailAttachment[];
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
    });
  }

  static connect(host: string, port: number): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port, timeout: 8000 });
      socket.once('error', reject);
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('smtp timeout'));
      });
      socket.once('connect', () => {
        socket.setTimeout(0);
        resolve(new SmtpSession(socket));
      });
    });
  }

  private drain(): void {
    while (this.pending !== null) {
      const match = /^(\d{3})(?:[ -][^\n]*\n)/.exec(this.buffer);
      if (match === null) return;
      const code = match[1] as string;
      const lines = this.buffer.split('\n');
      let consumed = 0;
      let complete = false;
      for (const line of lines) {
        consumed += line.length + 1;
        if (line.startsWith(`${code} `)) {
          complete = true;
          break;
        }
      }
      if (!complete) return;
      const reply = this.buffer.slice(0, consumed);
      this.buffer = this.buffer.slice(consumed);
      const resolve = this.pending;
      this.pending = null;
      resolve(reply);
    }
  }

  private expect(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      const timer = setTimeout(() => reject(new Error('smtp reply timeout')), 8000);
      this.pending = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.drain();
    });
  }

  async command(text: string, expected: string): Promise<void> {
    this.socket.write(`${text}\r\n`);
    const reply = await this.expect();
    if (!reply.startsWith(expected)) throw new Error(`smtp refused ${text}: ${reply.trim()}`);
  }

  async greeting(): Promise<void> {
    const reply = await this.expect();
    if (!reply.startsWith('220')) throw new Error(`smtp greeting failed: ${reply.trim()}`);
  }

  async data(message: string): Promise<void> {
    this.socket.write('DATA\r\n');
    const ready = await this.expect();
    if (!ready.startsWith('354')) throw new Error(`smtp DATA refused: ${ready.trim()}`);
    const dotStuffed = message.replace(/\r\n\./g, '\r\n..');
    this.socket.write(`${dotStuffed}\r\n.\r\n`);
    const accepted = await this.expect();
    if (!accepted.startsWith('250')) throw new Error(`smtp message refused: ${accepted.trim()}`);
  }

  close(): void {
    this.socket.write('QUIT\r\n');
    this.socket.end();
  }
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match?.[1] ?? config.mail.from;
}

function foldBase64(bytes: Buffer): string {
  const encoded = bytes.toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(
  row: OutboxRow,
  attachments: ReadonlyArray<{ filename: string; bytes: Buffer }>,
): string {
  const headerLines = [
    `From: ${config.mail.from}`,
    `To: ${row.to_email}`,
    `Subject: ${encodeHeaderValue(row.subject)}`,
    `Message-ID: ${row.message_id}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ];

  if (attachments.length === 0) {
    return [
      ...headerLines,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      foldBase64(Buffer.from(row.body_text, 'utf8')),
    ].join('\r\n');
  }

  const boundary = `kerf-${row.id}-boundary`;
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(row.body_text, 'utf8')),
  ];
  for (const attachment of attachments) {
    parts.push(
      `--${boundary}`,
      'Content-Type: application/pdf',
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      foldBase64(attachment.bytes),
    );
  }
  parts.push(`--${boundary}--`);

  return [
    ...headerLines,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts,
  ].join('\r\n');
}

/** Claims queued messages without taking one another instance is already delivering. */
async function claimBatch(): Promise<OutboxRow[]> {
  const claimed = await many<OutboxRow>(
    pool,
    `UPDATE outbox SET status = 'sending', claimed_at = now()
     WHERE id IN (
       SELECT id FROM outbox
       WHERE status = 'queued' OR (status = 'sending' AND claimed_at < now() - interval '60 seconds')
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 10
     )
     RETURNING id, message_id, to_email, subject, body_text, attachments`,
  );
  return claimed;
}

export async function deliverOutbox(): Promise<number> {
  const rows = await claimBatch();
  if (rows.length === 0) return 0;

  let session: SmtpSession;
  try {
    session = await SmtpSession.connect(config.mail.host, config.mail.port);
    await session.greeting();
    await session.command('EHLO kerf.example', '250');
  } catch {
    await pool.query(
      `UPDATE outbox SET status = 'queued', claimed_at = NULL WHERE id = ANY($1::bigint[])`,
      [rows.map((row) => String(row.id))],
    );
    return 0;
  }

  let sent = 0;
  for (const row of rows) {
    try {
      const attachments: Array<{ filename: string; bytes: Buffer }> = [];
      for (const attachment of row.attachments) {
        const stored = await getObject(attachment.key);
        if (stored === null) throw new Error(`attachment ${attachment.key} missing`);
        attachments.push({ filename: attachment.filename, bytes: stored.body });
      }
      await session.command(`MAIL FROM:<${senderAddress()}>`, '250');
      await session.command(`RCPT TO:<${row.to_email}>`, '250');
      await session.data(buildMessage(row, attachments));
      await pool.query(`UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [
        String(row.id),
      ]);
      sent += 1;
    } catch {
      await pool.query(
        `UPDATE outbox SET status = 'queued', claimed_at = NULL WHERE id = $1 AND status = 'sending'`,
        [String(row.id)],
      );
    }
  }
  session.close();
  return sent;
}

export async function mailUp(): Promise<boolean> {
  try {
    const session = await SmtpSession.connect(config.mail.host, config.mail.port);
    await session.greeting();
    session.close();
    return true;
  } catch {
    return false;
  }
}
