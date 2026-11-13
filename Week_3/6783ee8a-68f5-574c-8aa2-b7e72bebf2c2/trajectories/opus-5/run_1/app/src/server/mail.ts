import { createConnection, type Socket } from 'node:net';
import { config } from './config.js';

/** Raised when Mailpit refuses or cannot be reached. */
export class MailFailure extends Error {}

const TIMEOUT_MS = 5000;

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private pending: { resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on('error', (error: Error) => this.pending?.reject(new MailFailure(error.message)));
    socket.on('close', () => this.pending?.reject(new MailFailure('SMTP closed the connection')));
  }

  private deliver(): void {
    const pending = this.pending;
    if (!pending) return;
    const lines = this.buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d{3} /.test(lines[i])) {
        this.buffer = lines.slice(i + 1).join('\r\n');
        this.pending = null;
        pending.resolve(lines[i]);
        return;
      }
    }
  }

  private readReply(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new MailFailure('SMTP timed out')), TIMEOUT_MS);
      this.pending = {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.deliver();
    });
  }

  /** Sends a command (when given) and checks the reply's status code. */
  async expect(code: string, command?: string): Promise<void> {
    const reply = this.readReply();
    if (command !== undefined) this.socket.write(`${command}\r\n`);
    const line = await reply;
    if (!line.startsWith(code)) throw new MailFailure(`SMTP answered ${line}`);
  }

  write(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.destroy();
  }
}

export interface Message {
  to: string;
  subject: string;
  body: string;
}

/** Sends one message through Mailpit, or raises MailFailure. */
export async function sendMail(message: Message): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.mail.host, port: config.mail.port });
    const timer = setTimeout(() => {
      candidate.destroy();
      reject(new MailFailure('SMTP connection timed out'));
    }, TIMEOUT_MS);
    candidate.once('connect', () => {
      clearTimeout(timer);
      resolve(candidate);
    });
    candidate.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(new MailFailure(error.message));
    });
  });

  const session = new SmtpSession(socket);
  try {
    await session.expect('220');
    await session.expect('250', 'EHLO brackenpad');
    await session.expect('250', `MAIL FROM:<${envelopeAddress(config.mail.from)}>`);
    await session.expect('250', `RCPT TO:<${message.to}>`);
    await session.expect('354', 'DATA');
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n');
    const encoded = Buffer.from(message.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    session.write(`${headers}\r\n\r\n${encoded}\r\n.\r\n`);
    await session.expect('250');
    await session.expect('221', 'QUIT');
  } finally {
    session.end();
  }
}

export function verificationMessage(to: string, token: string): Message {
  return {
    to,
    subject: 'Verify your Brackenpad email',
    body: [
      'Welcome to Brackenpad.',
      '',
      'Confirm this address to sign in:',
      `${config.publicUrl}/verify/${token}`,
      '',
      'Wrenmoor Software',
    ].join('\n'),
  };
}

export function invitationMessage(
  to: string,
  ownerDisplayName: string,
  title: string,
  role: 'editor' | 'viewer',
  token: string,
): Message {
  const roleWord = role === 'editor' ? 'Editor' : 'Viewer';
  return {
    to,
    subject: `${ownerDisplayName} shared “${title}” with you`,
    body: [
      `${ownerDisplayName} shared the notebook “${title}” with you.`,
      '',
      `Role: ${roleWord}`,
      '',
      'Open the invitation:',
      `${config.publicUrl}/invite/${token}`,
      '',
      'Wrenmoor Software',
    ].join('\n'),
  };
}
