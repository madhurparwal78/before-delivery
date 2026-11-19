import net from 'node:net';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';
import type { Clock } from './clock.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  headers?: Record<string, string>;
}

/**
 * Durable outbox: mail is recorded in the same step as its event, then
 * delivered to Mailpit by SMTP and retried every 2 seconds while it is down.
 */
export class Mailer {
  constructor(private db: Database, private cfg: AppConfig, private clock: Clock) {}

  async record(mail: OutgoingMail): Promise<void> {
    const headers = JSON.stringify(mail.headers ?? {});
    await this.db.pool.query(
      'INSERT INTO outbox (to_addr, subject, body, headers, state, attempts, created_at_ms) VALUES ($1,$2,$3,$4,$5,0,$6)',
      [mail.to, mail.subject, mail.body, headers, 'pending', this.clock.nowMs()],
    );
  }

  /** Delivers pending mail; called by the outbox loop and after each record. */
  async flush(): Promise<void> {
    const rows = await this.db.pool.query("SELECT id, to_addr, subject, body, headers FROM outbox WHERE state = 'pending' ORDER BY id LIMIT 20");
    for (const r of rows.rows) {
      const headers: Record<string, string> = JSON.parse(r.headers);
      const ok = await this.sendSmtp(r.to_addr, r.subject, r.body, headers);
      if (ok) {
        await this.db.pool.query("UPDATE outbox SET state = 'sent' WHERE id = $1", [r.id]);
      } else {
        await this.db.pool.query("UPDATE outbox SET attempts = attempts + 1 WHERE id = $1", [r.id]);
      }
    }
  }

  private sendSmtp(to: string, subject: string, body: string, headers: Record<string, string>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: this.cfg.smtpHost, port: this.cfg.smtpPort });
      let buffer = '';
      let stage = 0;
      const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
      const fail = () => done(false);
      socket.setTimeout(4000, fail);
      socket.on('error', fail);

      const payloadLines = [
        `From: ${this.cfg.mailFrom}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        body,
      ];
      const data = payloadLines.join('\r\n').replace(/(^|\r\n)\./g, '$1..');

      const handleReply = (code: number): void => {
        switch (stage) {
          case 0: socket.write('EHLO ridgestack\r\n'); stage = 1; return;
          case 1: socket.write(`MAIL FROM:<${extractAddr(this.cfg.mailFrom)}>\r\n`); stage = 2; return;
          case 2: socket.write(`RCPT TO:<${to}>\r\n`); stage = 3; return;
          case 3: socket.write('DATA\r\n'); stage = 4; return;
          case 4:
            if (code !== 354) { fail(); return; }
            socket.write(`${data}\r\n.\r\n`);
            stage = 5;
            return;
          case 5: socket.write('QUIT\r\n'); socket.end(); done(true); return;
          default: fail();
        }
      };

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        // A reply is complete when a line ends with a space after the code;
        // multi-line replies continue with '-' until that final line.
        for (;;) {
          const idx = buffer.indexOf('\r\n');
          if (idx < 0) return;
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const code = Number(line.slice(0, 3));
          if (Number.isNaN(code) || code >= 400 || code < 200) {
            fail();
            return;
          }
          const isFinal = line.length < 4 || line[3] === ' ';
          if (isFinal) {
            handleReply(code);
            if (stage === 5 || socket.destroyed) return;
          }
        }
      });
    });
  }
}

function extractAddr(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
}
