import { createConnection, type Socket } from 'node:net';
import { config } from './config.js';

const TIMEOUT_MS = 5000;

/** RFC 2047 encoded-words, folded so no header line passes 76 characters. */
export function encodeSubject(subject: string): string {
  if (!/[^\u0020-\u007e]/.test(subject)) return subject;
  const prefix = '=?UTF-8?B?';
  const suffix = '?=';
  // Short enough that "Subject: " plus one word, and " " plus one word, both
  // stay inside the 76-character line limit.
  const maxWord = 66;
  const maxBase64 = maxWord - prefix.length - suffix.length;
  const maxBytes = Math.floor(maxBase64 / 4) * 3;
  const words: string[] = [];
  let chunk: number[] = [];
  for (const character of Array.from(subject)) {
    const bytes = [...Buffer.from(character, 'utf8')];
    if (chunk.length + bytes.length > maxBytes) {
      words.push(`${prefix}${Buffer.from(chunk).toString('base64')}${suffix}`);
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length > 0) {
    words.push(`${prefix}${Buffer.from(chunk).toString('base64')}${suffix}`);
  }
  return words.join('\r\n ');
}

export type Invite = {
  to: string;
  sharerName: string;
  documentName: string;
  role: 'Editor' | 'Viewer';
  documentUrl: string;
};

function message(invite: Invite): string {
  const subject = encodeSubject(
    `${invite.sharerName} shared ${invite.documentName} with you`,
  );
  const body = [
    `${invite.sharerName} shared "${invite.documentName}" with you as ${invite.role}.`,
    `Open it here: ${invite.documentUrl}`,
  ].join('\r\n');
  return [
    `From: ${config.mailFrom}`,
    `To: ${invite.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
    '',
  ].join('\r\n');
}

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.mailFrom);
  return match?.[1] ?? config.mailFrom;
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.waiting?.('500 socket error');
      this.waiting = null;
    });
  }

  private flush(): void {
    if (this.waiting === null) return;
    const lines = this.buffer.split('\r\n');
    for (const [index, line] of lines.entries()) {
      if (line === '') continue;
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.slice(index + 1).join('\r\n');
        const resolve = this.waiting;
        this.waiting = null;
        resolve?.(line);
        return;
      }
    }
  }

  async expect(code: string): Promise<void> {
    const line = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
    if (this.failure !== null) throw this.failure;
    if (!line.startsWith(code)) throw new Error(`SMTP said ${line}`);
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }
}

/** Opens a fresh connection per invite and gives up after five seconds. */
export async function sendInvite(invite: Invite): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(accepted);
    };
    const socket = createConnection({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(TIMEOUT_MS, () => finish(false));
    socket.on('error', () => finish(false));
    const session = new SmtpSession(socket);
    socket.on('connect', () => {
      void (async () => {
        try {
          await session.expect('220');
          session.send('EHLO tallyframe');
          await session.expect('250');
          session.send(`MAIL FROM:<${fromAddress()}>`);
          await session.expect('250');
          session.send(`RCPT TO:<${invite.to}>`);
          await session.expect('250');
          session.send('DATA');
          await session.expect('354');
          const body = message(invite)
            .replace(/\r\n$/, '')
            .replace(/\r\n\./g, '\r\n..');
          session.send(`${body}\r\n.`);
          await session.expect('250');
          session.send('QUIT');
          finish(true);
        } catch {
          finish(false);
        }
      })();
    });
  });
}
