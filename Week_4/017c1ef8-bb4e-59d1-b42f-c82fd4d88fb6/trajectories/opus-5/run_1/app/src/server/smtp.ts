import { createConnection, type Socket } from 'node:net';

/** A plain-text SMTP send against a server that needs no authentication. */
export type Mail = { from: string; to: string; subject: string; text: string };

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function message(mail: Mail): string {
  const body = mail.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [
    `From: ${encodeHeader(mail.from)}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  private drain(): void {
    for (;;) {
      const match = /^(\d{3})(?:[ -])[^\r\n]*\r\n/.exec(this.buffer);
      if (!match) return;
      const complete = this.buffer.startsWith(`${match[1]} `);
      const line = this.buffer.slice(0, match[0].length);
      this.buffer = this.buffer.slice(match[0].length);
      if (!complete) continue;
      const resolve = this.pending;
      this.pending = null;
      if (resolve) resolve(line);
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.drain();
    });
  }

  async send(command: string): Promise<string> {
    this.socket.write(`${command}\r\n`);
    return this.reply();
  }
}

function expect(line: string, code: string): void {
  if (!line.startsWith(code)) throw new Error(`smtp: expected ${code}, got ${line.trim()}`);
}

export function sendMail(host: string, port: number, mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(10000, () => socket.destroy(new Error('smtp: timeout')));
    socket.on('error', reject);
    socket.on('connect', () => {
      void (async () => {
        try {
          const session = new SmtpSession(socket);
          expect(await session.reply(), '220');
          expect(await session.send('EHLO plainwork'), '250');
          expect(await session.send(`MAIL FROM:<${addressOf(mail.from)}>`), '250');
          expect(await session.send(`RCPT TO:<${addressOf(mail.to)}>`), '250');
          expect(await session.send('DATA'), '354');
          socket.write(`${message(mail)}\r\n.\r\n`);
          expect(await session.reply(), '250');
          socket.write('QUIT\r\n');
          socket.end();
          resolve();
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      })();
    });
  });
}
