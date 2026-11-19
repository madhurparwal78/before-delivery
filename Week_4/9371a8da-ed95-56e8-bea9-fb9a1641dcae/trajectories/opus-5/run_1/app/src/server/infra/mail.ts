import { createConnection, Socket } from 'node:net';
import { config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

const CONNECT_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 5_000;

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.flush();
    });
    socket.on('close', () => {
      this.failure = this.failure ?? new Error('connection closed');
      this.flush();
    });
  }

  static open(host: string, port: number): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      const onError = (error: Error): void => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.once('timeout', () => onError(new Error('connect timeout')));
      socket.once('connect', () => {
        socket.setTimeout(0);
        socket.off('error', onError);
        resolve(new SmtpSession(socket));
      });
    });
  }

  private flush(): void {
    if (this.waiting === null) return;
    if (this.failure !== null) {
      const waiting = this.waiting;
      this.waiting = null;
      waiting('');
      return;
    }
    const complete = this.completeReply();
    if (complete !== null) {
      const waiting = this.waiting;
      this.waiting = null;
      waiting(complete);
    }
  }

  /** A full SMTP reply: the last line has a space after its code. */
  private completeReply(): string | null {
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index];
      if (line.length >= 4 && line.charAt(3) === ' ') {
        const reply = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        return reply;
      }
    }
    return null;
  }

  private read(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error('reply timeout'));
      }, COMMAND_TIMEOUT_MS);
      this.waiting = (line) => {
        clearTimeout(timer);
        if (this.failure !== null && line === '') {
          reject(this.failure);
          return;
        }
        resolve(line);
      };
      this.flush();
    });
  }

  async expect(prefix: string): Promise<void> {
    const reply = await this.read();
    const lines = reply.split('\r\n');
    const code = lines[lines.length - 1].slice(0, 3);
    if (!code.startsWith(prefix)) throw new Error(`unexpected reply ${code}`);
  }

  async send(command: string, prefix: string): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(prefix);
  }

  writeRaw(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
  }
}

function addressOf(mailFrom: string): string {
  const match = /<([^>]+)>/.exec(mailFrom);
  return match === null ? mailFrom.trim() : match[1].trim();
}

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Body(body: string): string {
  const encoded = Buffer.from(body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

function buildMessage(mail: Mail): string {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeaderValue(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${base64Body(mail.body)}\r\n`;
}

/**
 * Sends one message over a fresh connection. No failure is remembered, so the
 * next call tries the service afresh.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const session = await SmtpSession.open(config.mail.host, config.mail.port);
  try {
    await session.expect('2');
    await session.send('EHLO marginalia', '2');
    await session.send(`MAIL FROM:<${addressOf(config.mail.from)}>`, '2');
    await session.send(`RCPT TO:<${mail.to}>`, '2');
    await session.send('DATA', '3');
    session.writeRaw(buildMessage(mail));
    await session.send('.', '2');
    session.writeRaw('QUIT\r\n');
  } finally {
    session.close();
  }
}

/** Opens a connection without sending, used to claim a due mention email. */
export async function openMailConnection(): Promise<() => void> {
  const session = await SmtpSession.open(config.mail.host, config.mail.port);
  await session.expect('2');
  return () => session.close();
}
