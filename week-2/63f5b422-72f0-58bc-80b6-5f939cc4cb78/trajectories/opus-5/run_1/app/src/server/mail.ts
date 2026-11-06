import { createConnection, type Socket } from 'node:net';
import { config } from './config.js';

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from;
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | undefined;
  private failure: Error | undefined;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => {
      this.failure = error;
      this.waiting?.('');
    });
  }

  private flush(): void {
    for (;;) {
      const end = this.buffer.indexOf('\r\n');
      if (end === -1) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      if (/^\d{3}-/.test(line)) continue;
      const waiting = this.waiting;
      this.waiting = undefined;
      if (waiting) waiting(line);
      else return;
    }
  }

  async expect(code: number): Promise<void> {
    const line = await new Promise<string>((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      this.waiting = resolve;
      setTimeout(() => {
        if (this.waiting === resolve) {
          this.waiting = undefined;
          reject(new Error('The mail server did not answer.'));
        }
      }, 5000).unref();
    });
    if (this.failure) throw this.failure;
    if (!line.startsWith(String(code))) throw new Error(`The mail server said: ${line}`);
  }

  write(text: string): void {
    this.socket.write(text);
  }

  end(): void {
    this.socket.destroy();
  }
}

/** Sends one mail and resolves only once the SMTP server has accepted it. */
export async function sendMail(mail: Mail): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host: config.smtp.host, port: config.smtp.port });
    connection.setTimeout(5000);
    connection.once('connect', () => resolve(connection));
    connection.once('timeout', () => {
      connection.destroy();
      reject(new Error('The mail server did not answer.'));
    });
    connection.once('error', reject);
  });
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    session.write('EHLO plinth\r\n');
    await session.expect(250);
    session.write(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>\r\n`);
    await session.expect(250);
    session.write(`RCPT TO:<${mail.to}>\r\n`);
    await session.expect(250);
    session.write('DATA\r\n');
    await session.expect(354);
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    const body = mail.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    session.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    await session.expect(250);
    session.write('QUIT\r\n');
  } finally {
    session.end();
  }
}
