import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

const TIMEOUT_MS = 10_000;

export interface Mail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export function addressOf(mailbox: string): string {
  const angled = /<([^>]+)>/.exec(mailbox);
  return (angled?.[1] ?? mailbox).trim();
}

function isAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value);
}

function encodedWord(value: string): string {
  return isAscii(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function messageLines(mail: Mail, messageId: string): string {
  const body = mail.text.endsWith('\n') ? mail.text : `${mail.text}\n`;
  const asciiBody = isAscii(body.replace(/\n/g, ''));
  const headers = [
    `From: ${isAscii(mail.from) ? mail.from : encodedWord(mail.from)}`,
    `To: ${mail.to}`,
    `Subject: ${encodedWord(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Transfer-Encoding: ${asciiBody ? '7bit' : 'base64'}`,
  ];
  const payload = asciiBody
    ? body
        .split('\n')
        .map((line) => (line.startsWith('.') ? `.${line}` : line))
        .join('\r\n')
    : `${(
        Buffer.from(body, 'utf8')
          .toString('base64')
          .match(/.{1,76}/g) ?? []
      ).join('\r\n')}\r\n`;
  return `${headers.join('\r\n')}\r\n\r\n${payload}`;
}

class Conversation {
  private buffer = '';
  private pending: ((reply: { code: number; text: string }) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => this.failure?.(error));
    socket.on('close', () => this.failure?.(new Error('the mail server closed the connection')));
  }

  private drain(): void {
    for (;;) {
      const end = this.buffer.indexOf('\r\n');
      if (end === -1) return;
      const line = this.buffer.slice(0, end);
      if (line.length > 3 && line[3] === '-') {
        this.buffer = this.buffer.slice(end + 2);
        continue;
      }
      this.buffer = this.buffer.slice(end + 2);
      const handler = this.pending;
      this.pending = null;
      handler?.({ code: Number(line.slice(0, 3)), text: line });
      return;
    }
  }

  async expect(accepted: number): Promise<void> {
    const reply = await new Promise<{ code: number; text: string }>((resolve, reject) => {
      this.pending = resolve;
      this.failure = reject;
      this.drain();
    });
    if (reply.code !== accepted) throw new Error(`the mail server answered ${reply.text}`);
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }
}

/** Hands one plain-text message to an SMTP server. Rejects if it cannot be delivered in time. */
export async function sendMail(host: string, port: number, mail: Mail): Promise<void> {
  const socket = createConnection({ host, port });
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('the mail server did not answer in time')));
  const conversation = new Conversation(socket);
  try {
    await conversation.expect(220);
    conversation.send(`EHLO ${addressOf(mail.from).split('@')[1] ?? 'localhost'}`);
    await conversation.expect(250);
    conversation.send(`MAIL FROM:<${addressOf(mail.from)}>`);
    await conversation.expect(250);
    conversation.send(`RCPT TO:<${addressOf(mail.to)}>`);
    await conversation.expect(250);
    conversation.send('DATA');
    await conversation.expect(354);
    socket.write(
      `${messageLines(mail, `${randomUUID()}@${addressOf(mail.from).split('@')[1] ?? 'localhost'}`)}\r\n.\r\n`,
    );
    await conversation.expect(250);
    conversation.send('QUIT');
  } finally {
    socket.destroy();
  }
}
