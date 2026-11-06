import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

export interface OutgoingEmail {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

const CONNECT_TIMEOUT_MS = 5000;

function addressOnly(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from.trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(from: string, email: OutgoingEmail): string {
  const boundary = `cairn-${randomUUID()}`;
  const lines = [
    `From: ${encodeHeader(from)}`,
    `To: ${email.to}`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@cairn.example>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(email.textBody, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(email.htmlBody, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

class SmtpSession {
  private buffer = '';
  private pending: { expect: number; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.consume();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('smtp connection closed')));
  }

  private fail(error: Error): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  private consume(): void {
    const pending = this.pending;
    if (!pending) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] ?? '';
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.slice(index + 1).join('\r\n');
        this.pending = null;
        const code = Number(line.slice(0, 3));
        if (code !== pending.expect) pending.reject(new Error(`smtp answered ${line}`));
        else pending.resolve();
        return;
      }
    }
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending = { expect: code, resolve, reject };
      this.consume();
    });
  }

  async send(command: string, code: number): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(code);
  }

  end(): void {
    this.socket.end();
  }
}

/** Delivers one message over SMTP. Rejects when the mail host cannot be reached. */
export async function sendEmail(host: string, port: number, from: string, email: OutgoingEmail): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host, port });
    connection.setTimeout(CONNECT_TIMEOUT_MS);
    connection.once('connect', () => {
      connection.setTimeout(0);
      resolve(connection);
    });
    connection.once('timeout', () => {
      connection.destroy();
      reject(new Error('smtp connect timed out'));
    });
    connection.once('error', reject);
  });

  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    await session.send('EHLO cairn', 250);
    await session.send(`MAIL FROM:<${addressOnly(from)}>`, 250);
    await session.send(`RCPT TO:<${email.to}>`, 250);
    await session.send('DATA', 354);
    const message = buildMessage(from, email).replace(/\r\n\./g, '\r\n..');
    socket.write(message);
    await session.send('.', 250);
    await session.send('QUIT', 221);
  } finally {
    session.end();
  }
}
