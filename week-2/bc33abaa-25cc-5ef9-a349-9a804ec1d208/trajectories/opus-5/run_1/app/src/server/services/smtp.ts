import { createConnection } from 'node:net';

export interface SmtpMessage {
  host: string;
  port: number;
  fromAddress: string;
  fromName: string;
  to: string[];
  subject: string;
  body: string;
}

/** Removes control characters so no header can be split. */
function headerSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

function needsEncoding(value: string): boolean {
  return /[^\x20-\x7e]/.test(value);
}

/** RFC 2047 encoded word for non-ASCII header text. */
function encodeHeaderText(value: string): string {
  if (!needsEncoding(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function quoteDisplayName(value: string): string {
  const safe = headerSafe(value);
  if (safe.length === 0) return '';
  const encoded = encodeHeaderText(safe);
  if (encoded !== safe) return encoded;
  return /[()<>@,;:\\".[\]]/.test(safe) ? `"${safe.replace(/(["\\])/g, '\\$1')}"` : safe;
}

function addressHeader(name: string, address: string): string {
  const display = quoteDisplayName(name);
  return display.length > 0 ? `${display} <${address}>` : address;
}

class SmtpSession {
  private buffer = '';
  private pending: { expect: number; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: import('node:net').Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.consume();
    });
  }

  private consume(): void {
    if (!this.pending) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (line.length < 4) continue;
      if (line[3] === '-') continue;
      const code = Number(line.slice(0, 3));
      const pending = this.pending;
      this.buffer = lines.slice(index + 1).join('\r\n');
      this.pending = null;
      if (Number.isNaN(code) || Math.floor(code / 100) !== Math.floor(pending.expect / 100)) {
        pending.reject(new Error(`SMTP answered ${line}`));
      } else {
        pending.resolve();
      }
      return;
    }
  }

  async expect(code: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.pending = { expect: code, resolve, reject };
      this.consume();
    });
  }

  async send(command: string, code: number): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(code);
  }

  write(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.end();
  }
}

export async function sendMail(message: SmtpMessage): Promise<void> {
  const socket = await new Promise<import('node:net').Socket>((resolve, reject) => {
    const connection = createConnection({ host: message.host, port: message.port });
    connection.setTimeout(10_000);
    connection.once('connect', () => resolve(connection));
    connection.once('timeout', () => {
      connection.destroy();
      reject(new Error('SMTP connection timed out'));
    });
    connection.once('error', reject);
  });

  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    await session.send('EHLO orrery-studio', 250);
    await session.send(`MAIL FROM:<${message.fromAddress}>`, 250);
    for (const recipient of message.to) {
      await session.send(`RCPT TO:<${recipient}>`, 250);
    }
    await session.send('DATA', 354);
    const headers = [
      `From: ${addressHeader(message.fromName, message.fromAddress)}`,
      `To: ${message.to.join(', ')}`,
      `Subject: ${encodeHeaderText(headerSafe(message.subject))}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n');
    const encoded = Buffer.from(message.body, 'utf8')
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');
    session.write(`${headers}\r\n\r\n${encoded}\r\n.\r\n`);
    await session.expect(250);
    await session.send('QUIT', 221);
  } finally {
    session.end();
  }
}
