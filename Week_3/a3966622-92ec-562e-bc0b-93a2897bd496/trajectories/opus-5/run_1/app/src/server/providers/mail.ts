import { createConnection, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { Config } from '../config.ts';

const SEND_TIMEOUT_MS = 8000;
const CHECK_TIMEOUT_MS = 3000;

export type MailAttachment = { filename: string; content: Buffer; contentType: string };

export type MailMessage = {
  to: string[];
  subject: string;
  text: string;
  attachments: MailAttachment[];
};

type Reply = { code: number; text: string };

/** One SMTP dialogue over a plain socket, which is all Mailpit needs. */
class SmtpDialogue {
  private readonly socket: Socket;
  private buffer = '';
  private readonly replies: Reply[] = [];
  private waiting: ((reply: Reply) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (cause: Error) => {
      this.failure = cause;
    });
  }

  private drain(): void {
    for (;;) {
      const match = /^(?:\d{3}-[^\n]*\n)*(\d{3})(?: [^\n]*)?\n/.exec(this.buffer);
      if (match === null) return;
      const text = this.buffer.slice(0, match[0].length);
      this.buffer = this.buffer.slice(match[0].length);
      const reply: Reply = { code: Number(match[1]), text };
      const waiting = this.waiting;
      if (waiting === null) {
        this.replies.push(reply);
      } else {
        this.waiting = null;
        waiting(reply);
      }
    }
  }

  read(expected: number): Promise<Reply> {
    return new Promise((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      const settle = (reply: Reply): void => {
        if (reply.code === expected) resolve(reply);
        else reject(new Error(`SMTP answered ${reply.text.trim()}`));
      };
      const ready = this.replies.shift();
      if (ready !== undefined) {
        settle(ready);
        return;
      }
      this.waiting = settle;
    });
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  writeData(payload: string): void {
    this.socket.write(payload);
  }

  close(): void {
    this.socket.destroy();
  }
}

function connect(host: string, port: number, timeout: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('SMTP connection timed out'));
    });
    socket.once('error', (cause) => reject(cause));
  });
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrapBase64(content: Buffer): string {
  const encoded = content.toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

function dotStuff(payload: string): string {
  return payload.replace(/\r?\n\./g, '\r\n..');
}

function buildMessage(from: string, message: MailMessage): string {
  const headers = [
    `From: ${from}`,
    `To: ${message.to.join(', ')}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ];
  const body = message.text.replace(/\r?\n/g, '\r\n');
  if (message.attachments.length === 0) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
    return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
  }
  const boundary = `slackwater-${randomBytes(12).toString('hex')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ];
  for (const attachment of message.attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      wrapBase64(attachment.content),
    );
  }
  parts.push(`--${boundary}--`, '');
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n`;
}

export class MailProvider {
  private readonly settings: Config['mail'];

  constructor(settings: Config['mail']) {
    this.settings = settings;
  }

  async check(): Promise<boolean> {
    try {
      const socket = await connect(this.settings.host, this.settings.port, CHECK_TIMEOUT_MS);
      const dialogue = new SmtpDialogue(socket);
      await dialogue.read(220);
      dialogue.write('QUIT');
      dialogue.close();
      return true;
    } catch {
      return false;
    }
  }

  async send(message: MailMessage): Promise<void> {
    const socket = await connect(this.settings.host, this.settings.port, SEND_TIMEOUT_MS);
    socket.setTimeout(SEND_TIMEOUT_MS);
    const dialogue = new SmtpDialogue(socket);
    try {
      await dialogue.read(220);
      dialogue.write('EHLO slackwater');
      await dialogue.read(250);
      dialogue.write(`MAIL FROM:<${this.settings.from}>`);
      await dialogue.read(250);
      for (const recipient of message.to) {
        dialogue.write(`RCPT TO:<${recipient}>`);
        await dialogue.read(250);
      }
      dialogue.write('DATA');
      await dialogue.read(354);
      dialogue.writeData(dotStuff(buildMessage(this.settings.from, message)));
      dialogue.write('.');
      await dialogue.read(250);
      dialogue.write('QUIT');
    } finally {
      dialogue.close();
    }
  }
}
