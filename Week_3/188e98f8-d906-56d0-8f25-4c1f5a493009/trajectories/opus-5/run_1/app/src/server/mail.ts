/** The SMTP mail sink that receives the ruling notes. */

import { createConnection, type Socket } from 'node:net';

const GIVE_UP_MS = 5000;

export interface Message {
  to: string;
  subject: string;
  body: string;
}

export class MailUnreachable extends Error {
  constructor(reason: string) {
    super(`mail server unreachable: ${reason}`);
    this.name = 'MailUnreachable';
  }
}

interface Conversation {
  expect(code: number): Promise<string>;
  send(line: string): void;
}

function conversation(socket: Socket): Conversation {
  let buffer = '';
  const waiting: { resolve: (reply: string) => void; reject: (reason: Error) => void; code: number }[] = [];
  const replies: string[] = [];

  const settle = (): void => {
    while (waiting.length > 0 && replies.length > 0) {
      const pending = waiting.shift();
      const reply = replies.shift();
      if (pending === undefined || reply === undefined) return;
      if (Number(reply.slice(0, 3)) === pending.code) pending.resolve(reply);
      else pending.reject(new MailUnreachable(`unexpected reply ${reply.trim()}`));
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let breakAt = buffer.indexOf('\r\n');
    while (breakAt >= 0) {
      const line = buffer.slice(0, breakAt);
      buffer = buffer.slice(breakAt + 2);
      // Lines of a multi-line reply carry a hyphen after the code.
      if (line.charAt(3) !== '-') replies.push(line);
      breakAt = buffer.indexOf('\r\n');
    }
    settle();
  });
  const fail = (reason: Error): void => {
    while (waiting.length > 0) waiting.shift()?.reject(new MailUnreachable(reason.message));
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('connection closed')));

  return {
    expect(code: number): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        waiting.push({ resolve, reject, code });
        settle();
      });
    },
    send(line: string): void {
      socket.write(`${line}\r\n`);
    },
  };
}

function envelopeAddress(mailFrom: string): string {
  const angled = /<([^>]+)>/.exec(mailFrom);
  return angled?.[1] ?? mailFrom.trim();
}

export class MailSink {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly mailFrom: string,
  ) {}

  /** Resolves only once the mail server has accepted the message. */
  async deliver(message: Message): Promise<void> {
    const socket = createConnection({ host: this.host, port: this.port });
    socket.setTimeout(GIVE_UP_MS, () => socket.destroy(new Error('timed out')));
    const talk = conversation(socket);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('error', (reason: Error) => reject(new MailUnreachable(reason.message)));
      });
      await talk.expect(220);
      talk.send('EHLO roundkeeper');
      await talk.expect(250);
      talk.send(`MAIL FROM:<${envelopeAddress(this.mailFrom)}>`);
      await talk.expect(250);
      talk.send(`RCPT TO:<${message.to}>`);
      await talk.expect(250);
      talk.send('DATA');
      await talk.expect(354);
      const headers = [
        `From: ${this.mailFrom}`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
      ];
      const lines = message.body.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line));
      talk.send([...headers, '', ...lines, '.'].join('\r\n'));
      await talk.expect(250);
      talk.send('QUIT');
    } catch (reason) {
      socket.destroy();
      throw reason instanceof MailUnreachable ? reason : new MailUnreachable(String(reason));
    }
    socket.end();
  }
}
