// The mail outbox. Mail goes through SMTP to Mailpit, retried until the
// server accepts it, so a slow mail server never fails a request.
import net from 'net';
import { query } from './db';
import { config, opaqueId } from './config';
import { worldClock } from './world';

export async function queueMail(worldId: string, toEmail: string, subject: string, body: string): Promise<void> {
  await query(
    'INSERT INTO mail_outbox (id, world_id, to_email, subject, body) VALUES ($1,$2,$3,$4,$5)',
    [opaqueId(), worldId, toEmail, subject, body]
  );
}

export function smtpSend(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    let stage = 0;
    let buffer = '';
    const fail = (e: Error) => { s.destroy(); reject(e); };
    s.setTimeout(5000, () => fail(new Error('SMTP timeout')));
    s.on('error', fail);
    s.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const code = parseInt(line.slice(0, 3), 10);
        if (code >= 500) { fail(new Error('SMTP refused: ' + line)); return; }
        stage += 1;
        switch (stage) {
          case 1: s.write(`EHLO hearthtile\r\n`); break;
          case 2:
          case 3:
          case 4:
          case 5:
            s.write(`MAIL FROM:<${envelopeFrom(config.mailFrom)}>\r\n`);
            break;
          case 6: s.write(`RCPT TO:<${to}>\r\n`); break;
          case 7: s.write(`DATA\r\n`); break;
          case 8:
            s.write(
              `From: ${config.mailFrom}\r\nTo: ${to}\r\nSubject: ${subject}\r\n` +
              `Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.\r\n`
            );
            break;
          case 9: s.write(`QUIT\r\n`); resolve(); s.end(); break;
        }
      }
    });
  });
}

function envelopeFrom(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
}

// Retry loop for the outbox, run by the periodic worker and after queueing.
export async function flushOutbox(worldId: string): Promise<void> {
  const now = await worldClock(worldId);
  void now;
  const rows = await query<{ id: string; to_email: string; subject: string; body: string }>(
    'SELECT id, to_email, subject, body FROM mail_outbox WHERE NOT sent AND world_id = $1 LIMIT 20',
    [worldId]
  );
  for (const row of rows) {
    try {
      await smtpSend(row.to_email, row.subject, row.body);
      await query('UPDATE mail_outbox SET sent = true WHERE id = $1', [row.id]);
    } catch {
      // retried by the worker
    }
  }
}

export async function flushAllOutboxes(): Promise<void> {
  const rows = await query<{ id: string; to_email: string; subject: string; body: string }>(
    'SELECT id, to_email, subject, body FROM mail_outbox WHERE NOT sent LIMIT 50'
  );
  for (const row of rows) {
    try {
      await smtpSend(row.to_email, row.subject, row.body);
      await query('UPDATE mail_outbox SET sent = true WHERE id = $1', [row.id]);
    } catch {
      // retried later
    }
  }
}
