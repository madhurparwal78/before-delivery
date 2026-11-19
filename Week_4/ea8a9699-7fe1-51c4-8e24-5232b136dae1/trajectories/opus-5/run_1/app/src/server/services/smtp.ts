import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { errors } from '../errors.js';

const timeoutMs = 8000;

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
    });
    socket.on('close', () => {
      this.failure = this.failure ?? new Error('connection closed');
    });
  }

  private flush(): void {
    if (this.waiting === null) {
      return;
    }
    // A reply ends with a line whose fourth character is a space, as in "250 Ok".
    const match = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
    if (match === null) {
      return;
    }
    const end = match.index + match[0].length;
    const reply = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end);
    const settle = this.waiting;
    this.waiting = null;
    settle(reply);
  }

  async read(): Promise<string> {
    if (this.failure !== null) {
      throw this.failure;
    }
    return new Promise<string>((settle, fail) => {
      const timer = setTimeout(() => fail(new Error('smtp timeout')), timeoutMs);
      this.waiting = (reply) => {
        clearTimeout(timer);
        settle(reply);
      };
      this.flush();
      this.socket.once('error', (error: Error) => {
        clearTimeout(timer);
        fail(error);
      });
      this.socket.once('close', () => {
        clearTimeout(timer);
        fail(new Error('connection closed'));
      });
    });
  }

  write(data: string): void {
    this.socket.write(data);
  }

  async command(line: string, expected: number): Promise<string> {
    this.write(`${line}\r\n`);
    const reply = await this.read();
    const code = Number(reply.trimStart().slice(0, 3));
    if (code !== expected) {
      throw new Error(`smtp ${line.split(' ')[0]} answered ${reply.trim()}`);
    }
    return reply;
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<Socket> {
  return new Promise((settle, fail) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.setTimeout(0);
      settle(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      fail(new Error('smtp connect timeout'));
    });
    socket.once('error', fail);
  });
}

const hexDigits = '0123456789ABCDEF';

/** Quoted-printable, so the body arrives byte for byte however long its lines are. */
function quotedPrintable(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  const lines: string[] = [];
  let line = '';
  const pushLine = (): void => {
    lines.push(line);
    line = '';
  };
  const append = (token: string): void => {
    if (line.length + token.length > 75) {
      line += '=';
      pushLine();
    }
    line += token;
  };
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0x0d && bytes[index + 1] === 0x0a) {
      if (line.endsWith(' ') || line.endsWith('\t')) {
        const last = line.slice(-1);
        line = `${line.slice(0, -1)}=${hexDigits[last.charCodeAt(0) >> 4]}${hexDigits[last.charCodeAt(0) & 15]}`;
      }
      pushLine();
      index += 1;
      continue;
    }
    if (byte === 0x3d || byte < 32 || byte > 126) {
      append(`=${hexDigits[byte >> 4]}${hexDigits[byte & 15]}`);
      continue;
    }
    append(String.fromCharCode(byte));
  }
  pushLine();
  return lines.join('\r\n');
}

function headerValue(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) {
    return text;
  }
  return `=?utf-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return match === null ? mailbox.trim() : match[1].trim();
}

export interface Message {
  to: string;
  subject: string;
  text: string;
}

/** Sends one plain-text message. Any failure is reported as the mail service being unreachable. */
export async function deliver(message: Message): Promise<void> {
  let session: SmtpSession | null = null;
  try {
    session = new SmtpSession(await connect());
    await session.read();
    await session.command(`EHLO ${config.smtp.host}`, 250);
    await session.command(`MAIL FROM:<${addressOf(config.smtp.from)}>`, 250);
    await session.command(`RCPT TO:<${addressOf(message.to)}>`, 250);
    await session.command('DATA', 354);
    const headers = [
      `From: ${config.smtp.from}`,
      `To: ${message.to}`,
      `Subject: ${headerValue(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@rushes>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
    ].join('\r\n');
    const payload = quotedPrintable(message.text)
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    const terminated = payload.endsWith('\r\n') ? payload : `${payload}\r\n`;
    session.write(`${headers}\r\n\r\n${terminated}.\r\n`);
    const reply = await session.read();
    if (!reply.trimStart().startsWith('250')) {
      throw new Error(`smtp refused the message: ${reply.trim()}`);
    }
    session.write('QUIT\r\n');
  } catch {
    throw errors.mailUnavailable();
  } finally {
    session?.end();
  }
}
