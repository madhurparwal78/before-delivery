import { createConnection, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';

export interface SmtpEnvelope {
  host: string;
  port: number;
  from: string;
  fromAddress: string;
  toAddress: string;
  headers: Record<string, string>;
  body: string;
}

class Session {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => {
      this.failure = error;
      this.waiting?.('421 socket error');
      this.waiting = null;
    });
  }

  private drain(): void {
    if (this.waiting === null) return;
    // A reply ends with a line whose fourth character is a space, not a hyphen.
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] as string;
      if (line.length >= 4 && line[3] === '-') continue;
      const reply = lines.slice(0, index + 1).join('\r\n');
      this.buffer = lines.slice(index + 1).join('\r\n');
      const resolve = this.waiting;
      this.waiting = null;
      resolve?.(reply);
      return;
    }
  }

  async expect(codes: readonly string[]): Promise<void> {
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
    if (this.failure !== null) throw this.failure;
    const last = reply.split('\r\n').filter((line) => line !== '').pop() ?? '';
    if (!codes.some((code) => last.startsWith(code))) {
      throw new Error(`smtp refused: ${last}`);
    }
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  writeRaw(value: string): void {
    this.socket.write(value);
  }

  end(): void {
    this.socket.end();
  }
}

/** Encodes a header value that is not plain ASCII, so names survive intact. */
export function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body
    .split(/\r\n|\n|\r/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

/** Sends one message over SMTP. Mailpit needs no authentication or TLS. */
export async function sendOverSmtp(envelope: SmtpEnvelope): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: envelope.host, port: envelope.port });
    candidate.setTimeout(10_000);
    candidate.once('connect', () => resolve(candidate));
    candidate.once('timeout', () => reject(new Error('smtp timeout')));
    candidate.once('error', reject);
  });

  const session = new Session(socket);
  try {
    await session.expect(['220']);
    session.write('EHLO hourline');
    await session.expect(['250']);
    session.write(`MAIL FROM:<${envelope.fromAddress}>`);
    await session.expect(['250']);
    session.write(`RCPT TO:<${envelope.toAddress}>`);
    await session.expect(['250', '251']);
    session.write('DATA');
    await session.expect(['354']);

    const headerLines = Object.entries(envelope.headers).map(([name, value]) => `${name}: ${value}`);
    const message = [
      ...headerLines,
      `Message-ID: <${randomBytes(12).toString('hex')}@hourline>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      dotStuff(envelope.body),
    ].join('\r\n');
    session.writeRaw(`${message}\r\n.\r\n`);
    await session.expect(['250']);
    session.write('QUIT');
  } finally {
    session.end();
  }
}
