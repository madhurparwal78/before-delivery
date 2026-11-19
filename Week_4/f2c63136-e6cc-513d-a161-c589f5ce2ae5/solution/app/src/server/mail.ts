import { connect } from 'node:net';
import { afterCommit, transaction, type Tx } from './db.ts';
import { config } from './config.ts';

interface Mail {
  to: string;
  subject: string;
  body: string;
  changeId?: string;
}

/** Recorded in the same transaction as the event (brief: Mail goes through a durable outbox). */
export async function queueMail(tx: Tx, mail: Mail): Promise<void> {
  await tx.q('INSERT INTO outbox (recipient, subject, body, change_id) VALUES ($1, $2, $3, $4)', [mail.to, mail.subject, mail.body, mail.changeId ?? null]);
  tx.mailQueued = true;
}

const addressOf = (from: string): string => (from.includes('<') ? from.slice(from.indexOf('<') + 1, from.indexOf('>')) : from.trim());

const encodeWord = (text: string): string => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`);

function wrapBase64(text: string): string {
  return (Buffer.from(text).toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

function compose(mail: Mail, id: number): string {
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${mail.to}`,
    `Subject: ${encodeWord(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <outbox-${id}@${new URL(config.publicUrl).hostname}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  if (mail.changeId) headers.push(`X-Change-Id: ${mail.changeId}`);
  return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(mail.body)}\r\n`;
}

/** Minimal SMTP dialogue with Mailpit: one message per connection. */
function deliver(message: string, recipient: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8000, () => socket.destroy(new Error('smtp timeout')));
    const script = [
      { send: `EHLO ridgestack`, expect: 250 },
      { send: `MAIL FROM:<${addressOf(config.mailFrom)}>`, expect: 250 },
      { send: `RCPT TO:<${recipient}>`, expect: 250 },
      { send: 'DATA', expect: 354 },
      { send: `${message.replace(/^\./gm, '..')}\r\n.`, expect: 250 },
      { send: 'QUIT', expect: 221 },
    ];
    let step = -1;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('close', () => (step >= script.length - 1 ? resolve() : reject(new Error('smtp closed early'))));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number.parseInt(line.slice(0, 3), 10);
        const wanted = step < 0 ? 220 : script[step].expect;
        if (code !== wanted) return socket.destroy(new Error(`smtp ${line}`));
        step += 1;
        if (step >= script.length) return socket.end();
        socket.write(`${script[step].send}\r\n`);
      }
    });
  });
}

let sending = false;

/** Delivers unsent mail one row at a time; a row lock keeps two server processes from sending it twice. */
async function flush(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    for (let more = true; more; ) {
      more = await transaction(async (tx) => {
        const rows = await tx.q<{ id: number; recipient: string; subject: string; body: string; change_id: string | null }>(
          'SELECT id, recipient, subject, body, change_id FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED',
        );
        if (!rows.length) return false;
        const row = rows[0];
        await deliver(compose({ to: row.recipient, subject: row.subject, body: row.body, changeId: row.change_id ?? undefined }, row.id), row.recipient);
        await tx.q('UPDATE outbox SET sent_at = now() WHERE id = $1', [row.id]);
        return true;
      });
    }
  } catch {
    // Mailpit is down: the rows stay unsent and the next retry picks them up.
  } finally {
    sending = false;
  }
}

export function startOutbox(): void {
  afterCommit.mail = () => void flush();
  setInterval(() => void flush(), 2000).unref();
  void flush();
}

export async function mailpitReachable(): Promise<boolean> {
  try {
    return (await fetch(`${config.mailpitUrl}/readyz`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}
