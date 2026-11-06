import { createConnection } from 'node:net';
import type { PoolClient } from 'pg';

// Mailpit receives every email. Mail is written to an outbox in the same change
// as its event, and sent from there; a queued mail is delivered exactly once.

const HOST = process.env.SMTP_HOST ?? 'localhost';
const PORT = Number(process.env.SMTP_PORT ?? 1025);

function parseFrom(from: string): { name: string; addr: string } {
  const m = /^(.*)<(.+)>$/.exec(from.trim());
  if (m) return { name: m[1].trim(), addr: m[2].trim() };
  return { name: '', addr: from.trim() };
}

function cmd(txt: string): Buffer {
  return Buffer.from(`${txt}\r\n`, 'utf8');
}

export async function smtpSend(to: string, subject: string, body: string): Promise<boolean> {
  const from = parseFrom(process.env.MAIL_FROM ?? 'tickets@pakka-rail.example');
  return new Promise<boolean>((resolve) => {
    const sock = createConnection({ host: HOST, port: PORT, timeout: 5000 });
    let stage = 0;
    let buffer = '';
  const done = (ok: boolean) => { try { sock.destroy(); } catch {} resolve(ok); };
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
    sock.on('close', () => resolve(false));
    sock.on('data', (d) => {
      buffer += d.toString('utf8');
      if (!buffer.endsWith('\r\n')) return;
      const lines = buffer.split('\r\n').filter(Boolean);
      buffer = '';
      const code = lines[lines.length - 1]?.slice(0, 3);
      if (!/^[23]\d\d$/.test(code ?? '')) { done(false); return; }
      stage += 1;
      switch (stage) {
        case 1: sock.write(cmd(`EHLO pakka-rail`)); break;
        case 2:
          sock.write(cmd(`MAIL FROM:<${from.addr}>`));
          break;
        case 3:
          sock.write(cmd(`RCPT TO:<${to}>`));
          break;
        case 4:
          sock.write(cmd('DATA'));
          break;
        case 5: {
          const headers = [
            `From: ${from.name ? `${from.name} ` : ''}<${from.addr}>`,
            `To: <${to}>`,
            `Subject: ${subject}`,
            'Content-Type: text/plain; charset=utf-8',
            'MIME-Version: 1.0',
          ].join('\r\n');
          const data = `${headers}\r\n\r\n${body}`.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
          sock.write(Buffer.from(`${data}\r\n.\r\n`, 'utf8'));
          break;
        }
        case 6:
          sock.write(cmd('QUIT'));
          done(true);
          break;
      }
    });
  });
}

/** Queue a mail in the outbox as part of an event's change. */
export async function queueMail(c: PoolClient, to: string, subject: string, body: string): Promise<void> {
  await c.query(
    'INSERT INTO mail_outbox (to_email, subject, body) VALUES ($1,$2,$3)',
    [to, subject, body],
  );
}
