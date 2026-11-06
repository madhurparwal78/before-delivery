import { createConnection, type Socket } from 'node:net';

export interface OutgoingMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

function envelopeAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return angled?.[1] ?? from.trim();
}

/** Encodes a header value that may hold non-ASCII text. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      socket.destroy();
    });
  }

  private drain(): void {
    for (;;) {
      const match = /^(\d{3})(?:[ -][^\r\n]*)?\r\n/.exec(this.buffer);
      if (match === null) return;
      const code = match[1] as string;
      const isFinal = this.buffer[3] !== '-';
      this.buffer = this.buffer.slice(match[0].length);
      if (isFinal && this.pending !== null) {
        const resolve = this.pending;
        this.pending = null;
        resolve(code);
      }
    }
  }

  async expect(prefix: string): Promise<void> {
    const code = await new Promise<string>((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      const timer = setTimeout(() => reject(new Error('smtp timeout')), 10_000);
      this.pending = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.socket.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.socket.once('close', () => {
        clearTimeout(timer);
        reject(new Error('smtp closed'));
      });
    });
    if (!code.startsWith(prefix)) throw new Error(`smtp refused with ${code}`);
  }

  write(line: string): void {
    this.socket.write(line);
  }

  end(): void {
    this.socket.destroy();
  }
}

/** Sends one plain-text message; the caller retries until it succeeds. */
export async function sendMail(
  host: string,
  port: number,
  from: string,
  message: OutgoingMessage,
): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host, port });
    const timer = setTimeout(() => {
      connection.destroy();
      reject(new Error('smtp connect timeout'));
    }, 10_000);
    connection.once('connect', () => {
      clearTimeout(timer);
      resolve(connection);
    });
    connection.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const session = new SmtpSession(socket);
  try {
    await session.expect('220');
    session.write('EHLO shedline\r\n');
    await session.expect('250');
    session.write(`MAIL FROM:<${envelopeAddress(from)}>\r\n`);
    await session.expect('250');
    session.write(`RCPT TO:<${message.to}>\r\n`);
    await session.expect('250');
    session.write('DATA\r\n');
    await session.expect('354');
    const headers = [
      `From: ${from}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    const body = message.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    session.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    await session.expect('250');
    session.write('QUIT\r\n');
  } finally {
    session.end();
  }
}
