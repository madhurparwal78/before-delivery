import net from 'node:net';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Minimal SMTP client for Mailpit. */
export class Mailer {
  constructor(private cfg: Config) {}

  async available(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.cfg.smtpHost, port: this.cfg.smtpPort });
      socket.setTimeout(3000);
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  async send(message: MailMessage): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.cfg.smtpHost, port: this.cfg.smtpPort });
      socket.setTimeout(15_000);
      let step = 0;
      let buffer = '';
      const fail = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      const advance = () => {
        try {
          switch (step) {
            case 0:
              socket.write(`HELO spindrift\r\n`);
              step = 1;
              break;
            case 1:
              socket.write(`MAIL FROM:<${this.senderAddress()}>\r\n`);
              step = 2;
              break;
            case 2:
              socket.write(`RCPT TO:<${message.to}>\r\n`);
              step = 3;
              break;
            case 3:
              socket.write(`DATA\r\n`);
              step = 4;
              break;
            case 4: {
              const body = this.buildBody(message);
              socket.write(body);
              socket.write('.\r\n');
              step = 5;
              break;
            }
            case 5:
              socket.write('QUIT\r\n');
              step = 6;
              break;
            case 6:
              socket.end();
              resolve();
              break;
          }
        } catch (e) {
          fail(e instanceof Error ? e : new Error('smtp write failed'));
        }
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        while (true) {
          const idx = buffer.indexOf('\r\n');
          if (idx === -1) break;
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const code = Number(line.slice(0, 3));
          if (code >= 400) {
            socket.removeListener('data', onData);
            fail(new Error(`smtp ${code}: ${line}`));
            return;
          }
          if (line[3] === '-') continue; // multiline reply
          advance();
          if (step === 5 && code === 250) {
            // DATA accepted; wait for final 250 after the terminating dot.
          }
        }
      };
      socket.on('data', onData);
      socket.once('error', (err) => fail(err));
      socket.once('timeout', () => fail(new Error('smtp timeout')));
    });
  }

  private senderAddress(): string {
    const match = this.cfg.mailFrom.match(/<(.+)>/);
    return match?.[1] ?? this.cfg.mailFrom;
  }

  private buildBody(message: MailMessage): string {
    const headers = [
      `From: ${this.cfg.mailFrom}`,
      `To: <${message.to}>`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
    ].join('\r\n');
    // Dot-stuff bare leading dots.
    const text = message.text.replace(/^\./gm, '..');
    return `${headers}\r\n${text}\r\n`;
  }
}
