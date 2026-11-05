import { createConnection, type Socket } from 'node:net';
import { config } from '../config';

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
  }

  private flush(): void {
    while (this.waiting !== null) {
      const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(this.buffer);
      if (match === null) return;
      const reply = match[0];
      this.buffer = this.buffer.slice(reply.length);
      const resolve = this.waiting;
      this.waiting = null;
      resolve(reply);
    }
  }

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('smtp timeout')), 10000);
      this.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.flush();
    });
  }

  async command(text: string, expected: string): Promise<void> {
    this.socket.write(`${text}\r\n`);
    const reply = await this.read();
    if (!reply.startsWith(expected)) throw new Error(`smtp refused ${text}: ${reply.trim()}`);
  }

  write(text: string): void {
    this.socket.write(text);
  }

  end(): void {
    this.socket.end();
  }
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export async function sendMail(message: {
  recipient: string;
  subject: string;
  body: string;
  at: Date;
}): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.smtp.host, port: config.smtp.port });
    candidate.setTimeout(10000);
    candidate.once('connect', () => resolve(candidate));
    candidate.once('error', reject);
    candidate.once('timeout', () => reject(new Error('smtp connect timeout')));
  });
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.read();
    if (!greeting.startsWith('220')) throw new Error(`smtp greeting ${greeting}`);
    await session.command('EHLO bellroll', '250');
    await session.command(`MAIL FROM:<${envelopeAddress(config.smtp.from)}>`, '250');
    await session.command(`RCPT TO:<${message.recipient}>`, '250');
    await session.command('DATA', '354');
    const headers = [
      `From: ${config.smtp.from}`,
      `To: ${message.recipient}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${message.at.toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    session.write(`${headers}\r\n\r\n${dotStuff(message.body)}\r\n.\r\n`);
    const accepted = await session.read();
    if (!accepted.startsWith('250')) throw new Error(`smtp rejected message: ${accepted.trim()}`);
    await session.command('QUIT', '221');
  } finally {
    session.end();
  }
}
