import { createConnection } from 'node:net';
import { config } from './config.js';
import { db, type Db } from './db.js';
import { serverNow } from './clock.js';

interface Mail {
  to: string;
  subject: string;
  body: string;
  changeHeader: string | null;
}

async function sendSmtp(mail: Mail): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(5000);
    const fromAddress = config.mailFrom.includes('<')
      ? config.mailFrom.slice(config.mailFrom.indexOf('<') + 1, config.mailFrom.indexOf('>'))
      : config.mailFrom;
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      ...(mail.changeHeader ? [`X-Change-Id: ${mail.changeHeader}`] : []),
    ];
    const data = `${headers.join('\r\n')}\r\n\r\n${mail.body.replace(/\n/g, '\r\n')}\r\n.\r\n`;
    const steps = [
      `EHLO ridgestack\r\n`,
      `MAIL FROM:<${fromAddress}>\r\n`,
      `RCPT TO:<${mail.to}>\r\n`,
      `DATA\r\n`,
      data,
      `QUIT\r\n`,
    ];
    let step = -1;
    let buffer = '';
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!/\r\n$/.test(buffer)) return;
      const lines = buffer.trimEnd().split('\r\n');
      const last = lines[lines.length - 1];
      if (/^[45]/.test(last)) {
        fail(new Error(`smtp refused: ${last}`));
        return;
      }
      buffer = '';
      step += 1;
      if (step >= steps.length) {
        socket.end();
        resolve();
        return;
      }
      socket.write(steps[step]);
      if (steps[step].startsWith('QUIT')) {
        socket.end();
        resolve();
      }
    });
  });
}

export async function enqueueMail(tx: Db, mail: Mail): Promise<void> {
  await tx.query(
    'INSERT INTO rs_mail_outbox (to_address, subject, body, change_header, created_at) VALUES ($1, $2, $3, $4, $5)',
    [mail.to, mail.subject, mail.body, mail.changeHeader, serverNow()],
  );
}

let flushing = false;

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const rows = await db.query<{ id: string; to_address: string; subject: string; body: string; change_header: string | null }>(
      "SELECT id, to_address, subject, body, change_header FROM rs_mail_outbox WHERE state = 'pending' ORDER BY id LIMIT 20",
    );
    for (const row of rows) {
      try {
        await sendSmtp({ to: row.to_address, subject: row.subject, body: row.body, changeHeader: row.change_header });
        await db.query("UPDATE rs_mail_outbox SET state = 'sent', sent_at = $2 WHERE id = $1", [row.id, serverNow()]);
      } catch {
        await db.query('UPDATE rs_mail_outbox SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      }
    }
  } catch {
    // the outbox is retried on the next tick
  } finally {
    flushing = false;
  }
}

export function startOutboxWorker(): void {
  setInterval(() => {
    void flushOutbox();
  }, 2000).unref();
}

export function changeMailBody(lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

export function changeUrl(org: string, repo: string, number: number): string {
  return `${config.appPublicUrl}/${org}/${repo}/changes/${number}`;
}
