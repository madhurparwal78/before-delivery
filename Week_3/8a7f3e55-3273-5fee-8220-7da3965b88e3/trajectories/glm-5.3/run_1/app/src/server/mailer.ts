// Minimal SMTP client for the Mailpit sink: plain SMTP with no authentication. Mail is
// queued in Postgres and delivered here; a down server delays messages, never loses them.
import net from 'node:net';
import type { Db } from './db.js';

export interface QueuedEmail {
  to: string;
  subject: string;
  body: string;
}

export interface Mailer {
  send(email: QueuedEmail): Promise<boolean>;
}

function encodeHeader(text: string): string {
  // RFC 2047 encoded-word for any non-ASCII header value.
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

export class SmtpMailer implements Mailer {
  private host: string;
  private port: number;
  private from: string;
  private fromAddress: string;

  constructor(cfg: { host: string; port: number; from: string }) {
    this.host = cfg.host;
    this.port = cfg.port;
    this.from = cfg.from;
    const match = /<([^>]+)>\s*$/.exec(cfg.from);
    this.fromAddress = match ? match[1] : cfg.from;
  }

  async send(email: QueuedEmail): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setTimeout(10_000);
      let buffer = '';
      let step = 0;
      let finished = false;

      const done = (ok: boolean) => {
        if (finished) return;
        finished = true;
        socket.destroy();
        resolve(ok);
      };

      const fail = () => done(false);

      socket.on('error', fail);
      socket.on('timeout', fail);
      socket.on('close', () => {
        if (step === 6) done(true);
        else done(false);
      });

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\r\n');
        while (lines.length > 0) {
          const line = lines.shift() ?? '';
          if (line.length === 0) continue;
          const code = Number(line.slice(0, 3));
          const isFinal = line.length < 4 || line[3] !== '-';
          if (!isFinal) continue;
          if (Number.isNaN(code) || code < 200 || code >= 400) {
            fail();
            return;
          }
          step += 1;
          buffer = lines.join('\r\n');
          switch (step) {
            case 1:
              socket.write('EHLO relayline\r\n');
              break;
            case 2:
              socket.write(`MAIL FROM:<${this.fromAddress}>\r\n`);
              break;
            case 3:
              socket.write(`RCPT TO:<${email.to}>\r\n`);
              break;
            case 4:
              socket.write('DATA\r\n');
              break;
            case 5: {
              const headers = [
                `From: ${encodeHeader(this.from)}`,
                `To: <${email.to}>`,
                `Subject: ${encodeHeader(email.subject)}`,
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=utf-8',
                'Content-Transfer-Encoding: 8bit',
              ].join('\r\n');
              const body = email.body.replace(/^\./gm, '..').replace(/\r?\n/g, '\r\n');
              socket.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
              break;
            }
            case 6:
              socket.write('QUIT\r\n');
              done(true);
              break;
            default:
              done(true);
              break;
          }
        }
      });
    });
  }
}

export async function queueEmail(db: Db, email: QueuedEmail): Promise<void> {
  await db.query(
    'INSERT INTO email_queue (to_email, subject, body) VALUES ($1, $2, $3)',
    [email.to, email.subject, email.body],
  );
}
