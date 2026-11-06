// The mail queue. Every message is first written to the queue in PostgreSQL, in the same
// transaction as the change that caused it; a sender delivers queued messages, retrying at least
// every 10 seconds, and each message is claimed before sending so it is delivered exactly once.
import net from 'node:net';
import { getApp } from './runtime.ts';

export interface QueuedMail {
  to: string;
  subject: string;
  body: string;
}

export async function enqueueMail(client: import('pg').PoolClient, mail: QueuedMail, now: number): Promise<void> {
  await client.query('INSERT INTO mail_queue (to_addr, subject, body, created_at) VALUES ($1, $2, $3, $4)', [
    mail.to,
    mail.subject,
    mail.body,
    now,
  ]);
}

interface SmtpResult {
  ok: boolean;
}

function readReply(socket: net.Socket, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('smtp timeout'));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      let text = chunk.toString('utf-8');
      while (text.includes('\r\n')) {
        const idx = text.indexOf('\r\n');
        const line = text.slice(0, idx);
        text = text.slice(idx + 2);
        lines.push(line);
        if (/^\d{3} /.test(line)) {
          cleanup();
          resolve(lines);
        }
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function writeLine(socket: net.Socket, line: string): void {
  socket.write(line + '\r\n');
}

// Sends one message over SMTP, without authentication or TLS.
async function sendSmtp(mail: QueuedMail): Promise<SmtpResult> {
  const { env } = getApp();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: env.smtpHost, port: env.smtpPort });
    socket.setTimeout(10000);
    const fail = (why: string) => {
      socket.destroy();
      resolve({ ok: false, ...{ why } });
    };
    socket.on('error', () => fail('error'));
    socket.on('timeout', () => fail('timeout'));
    const run = async () => {
      try {
        await readReply(socket, 10000); // greeting
        writeLine(socket, `EHLO ${env.appPublicUrl.replace(/^https?:\/\//, '').split('/')[0]}`);
        await readReply(socket, 10000);
        writeLine(socket, `MAIL FROM:<${extractAddress(env.mailFrom)}>`);
        await readReply(socket, 10000);
        writeLine(socket, `RCPT TO:<${mail.to}>`);
        await readReply(socket, 10000);
        writeLine(socket, 'DATA');
        await readReply(socket, 10000);
        const message = [
          `From: ${env.mailFrom}`,
          `To: ${mail.to}`,
          `Subject: ${mail.subject}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          mail.body.replace(/^\./gm, '..'),
          '.',
        ].join('\r\n');
        writeLine(socket, message);
        await readReply(socket, 10000);
        writeLine(socket, 'QUIT');
        socket.end();
        resolve({ ok: true });
      } catch {
        fail('protocol');
      }
    };
    socket.once('connect', run);
  });
}

function extractAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

// A cheap reachability probe: open the socket and read the greeting.
async function probeSmtp(): Promise<boolean> {
  const { env } = getApp();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: env.smtpHost, port: env.smtpPort });
    socket.setTimeout(4000);
    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.on('data', () => undefined);
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function deliverQueued(): Promise<void> {
  const app = getApp();
  const now = app.clock.now();
  const claimed = await app.pool
    .query<{ id: string; to_addr: string; subject: string; body: string }>(
      `UPDATE mail_queue SET claimed_at = $1
       WHERE id IN (SELECT id FROM mail_queue WHERE sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < $2) ORDER BY id LIMIT 10)
       RETURNING id, to_addr, subject, body`,
      [now, now - 60000]
    )
    .catch(() => null);
  if (!claimed || claimed.rows.length === 0) return;
  for (const row of claimed.rows) {
    const result = await sendSmtp({ to: row.to_addr, subject: row.subject, body: row.body });
    if (result.ok) {
      await app.pool.query('UPDATE mail_queue SET sent_at = $2 WHERE id = $1', [Number(row.id), app.clock.now()]).catch(() => undefined);
      app.mailUp = true;
    } else {
      app.mailUp = false;
      await app.pool.query('UPDATE mail_queue SET claimed_at = NULL WHERE id = $1', [Number(row.id)]).catch(() => undefined);
    }
  }
}

export function startMailLoops(): void {
  const app = getApp();
  const attempt = async () => {
    if (app.dbUp) await deliverQueued();
  };
  setInterval(() => void attempt(), 10000);
  setTimeout(() => void attempt(), 2000);
  setInterval(() => {
    void probeSmtp().then((up) => {
      if (up) {
        // mail stays "up" only if the most recent attempt or probe succeeded
        if (!app.mailUp) app.mailUp = true;
      } else {
        app.mailUp = false;
      }
    });
  }, 10000);
  void probeSmtp().then((up) => {
    app.mailUp = up;
  });
}
