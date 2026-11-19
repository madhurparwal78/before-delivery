import { createConnection, Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

export interface SmtpTarget {
  host: string;
  port: number;
}

export interface Envelope {
  from: string;
  to: string;
  subject: string;
  body: string;
}

const CRLF = '\r\n';
const CONNECT_TIMEOUT_MS = 5000;
const REPLY_TIMEOUT_MS = 10000;

/** A reply is `NNN text`, or `NNN-text` while more lines follow. */
class Session {
  private buffer = '';

  private waiting: ((reply: { code: number; text: string }) => void) | null = null;

  private failed: ((error: Error) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    const fail = (error: Error): void => {
      const reject = this.failed;
      this.waiting = null;
      this.failed = null;
      if (reject) reject(error);
    };
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('smtp connection closed')));
  }

  private drain(): void {
    for (;;) {
      const end = this.buffer.indexOf(CRLF);
      if (end === -1) return;
      const lines: string[] = [];
      let cursor = 0;
      let complete = false;
      while (cursor < this.buffer.length) {
        const lineEnd = this.buffer.indexOf(CRLF, cursor);
        if (lineEnd === -1) break;
        const line = this.buffer.slice(cursor, lineEnd);
        lines.push(line);
        cursor = lineEnd + CRLF.length;
        if (line.length < 4 || line[3] !== '-') {
          complete = true;
          break;
        }
      }
      if (!complete) return;
      this.buffer = this.buffer.slice(cursor);
      const last = lines[lines.length - 1];
      const reply = { code: Number(last.slice(0, 3)), text: lines.join(' ') };
      const resolve = this.waiting;
      this.waiting = null;
      this.failed = null;
      if (resolve) resolve(reply);
    }
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      this.waiting = resolve;
      this.failed = reject;
      this.socket.setTimeout(REPLY_TIMEOUT_MS, () => reject(new Error('smtp reply timed out')));
    });
  }

  async expect(expected: number): Promise<void> {
    const reply = await this.reply();
    if (reply.code !== expected) {
      throw new Error(`smtp expected ${expected}, got ${reply.text}`);
    }
  }

  send(line: string): void {
    this.socket.write(line + CRLF);
  }

  sendRaw(payload: string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(target: SmtpTarget): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: target.host, port: target.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('smtp connect timed out'));
    });
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

/** `Duefield <reminders@duefield.test>` gives `reminders@duefield.test`. */
export function bareAddress(address: string): string {
  const angled = /<([^>]+)>/.exec(address);
  return (angled ? angled[1] : address).trim();
}

function needsEncoding(value: string): boolean {
  return /[^\t\x20-\x7e]/.test(value);
}

function encodeHeader(value: string): string {
  if (!needsEncoding(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Lines that begin with a dot are stuffed, so the body never ends the data. */
function stuff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join(CRLF);
}

function message(envelope: Envelope): string {
  const headers = [
    `From: ${envelope.from}`,
    `To: ${envelope.to}`,
    `Subject: ${encodeHeader(envelope.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@duefield.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${stuff(envelope.body)}${CRLF}.${CRLF}`;
}

/**
 * Hands one plain-text message to the SMTP server. It resolves only once the
 * server has accepted the message with a 250 after the final dot.
 */
export async function sendMessage(target: SmtpTarget, envelope: Envelope): Promise<void> {
  const socket = await connect(target);
  const session = new Session(socket);
  try {
    await session.expect(220);
    session.send('EHLO duefield');
    await session.expect(250);
    session.send(`MAIL FROM:<${bareAddress(envelope.from)}>`);
    await session.expect(250);
    session.send(`RCPT TO:<${bareAddress(envelope.to)}>`);
    await session.expect(250);
    session.send('DATA');
    await session.expect(354);
    session.sendRaw(message(envelope));
    await session.expect(250);
    session.send('QUIT');
  } finally {
    session.end();
  }
}

export async function reachable(target: SmtpTarget): Promise<boolean> {
  let socket: Socket | null = null;
  try {
    socket = await connect(target);
    const session = new Session(socket);
    await session.expect(220);
    session.send('QUIT');
    return true;
  } catch {
    return false;
  } finally {
    socket?.destroy();
  }
}
