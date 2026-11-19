import { createConnection } from 'node:net';
import { config } from './config.js';
import { now } from './clock.js';
import { query } from './db.js';
import { publishSprite } from './live.js';

interface OutboxRow {
  id: number;
  to_email: string;
  subject: string;
  body: string;
  mention_id: number | null;
}

export async function enqueueMail(
  to: string,
  subject: string,
  lines: string[],
  mentionId: number | null = null,
): Promise<void> {
  await query(
    'INSERT INTO mail_outbox (to_email, subject, body, mention_id, created_at) VALUES ($1, $2, $3, $4, $5)',
    [to, subject, lines.join('\n'), mentionId, await now()],
  );
}

function talk(host: string, port: number, lines: string[], data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let step = -1;
    let buffer = '';
    let finished = false;
    const fail = (error: Error): void => {
      if (finished) return;
      finished = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(5000, () => fail(new Error('smtp timeout')));
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!buffer.endsWith('\n')) return;
      const replies = buffer.trim().split('\r\n');
      const last = replies[replies.length - 1];
      buffer = '';
      if (last.startsWith('4') || last.startsWith('5')) {
        fail(new Error(`smtp refused: ${last}`));
        return;
      }
      step += 1;
      if (step < lines.length) {
        socket.write(`${lines[step]}\r\n`);
        return;
      }
      if (step === lines.length) {
        socket.write(data.replace(/\r?\n\.\r?\n/g, '\n..\n'));
        socket.write('\r\n.\r\n');
        return;
      }
      if (step === lines.length + 1) {
        socket.write('QUIT\r\n');
        finished = true;
        socket.end();
        resolve();
      }
    });
  });
}

async function send(row: OutboxRow): Promise<void> {
  const fromAddress = config.mail.from.replace(/^.*</, '').replace(/>.*$/, '');
  const data = [
    `From: ${config.mail.from}`,
    `To: ${row.to_email}`,
    `Subject: ${row.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    row.body,
    '',
  ].join('\r\n');
  await talk(
    config.mail.host,
    config.mail.port,
    ['HELO celmate', `MAIL FROM:<${fromAddress}>`, `RCPT TO:<${row.to_email}>`, 'DATA'],
    data,
  );
}

/** One message goes once: the outbox row only leaves pending once the server accepts it. */
export async function drainOutbox(): Promise<void> {
  const pending = await query<OutboxRow>(
    "SELECT id, to_email, subject, body, mention_id FROM mail_outbox WHERE state = 'pending' ORDER BY id LIMIT 20",
  );
  for (const row of pending) {
    try {
      await send(row);
      await query("UPDATE mail_outbox SET state = 'sent', sent_at = $2 WHERE id = $1", [
        row.id,
        await now(),
      ]);
      if (row.mention_id !== null) {
        await query("UPDATE comment_mentions SET state = 'delivered' WHERE id = $1", [row.mention_id]);
        const sprite = await query<{ sprite_id: number }>(
          `SELECT c.sprite_id FROM comment_mentions m JOIN comments c ON c.id = m.comment_id
            WHERE m.id = $1`,
          [row.mention_id],
        );
        if (sprite[0] !== undefined) publishSprite(sprite[0].sprite_id, { type: 'comments' });
      }
    } catch {
      await query('UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    }
  }
}

export function startMailWorker(): void {
  const tick = async (): Promise<void> => {
    try {
      await drainOutbox();
    } catch {
      /* the outbox waits while a service is away */
    }
    setTimeout(() => void tick(), 500);
  };
  setTimeout(() => void tick(), 300);
}
