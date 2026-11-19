import net from 'node:net';
import { randomUUID } from 'node:crypto';

/** A minimal SMTP client for the local mail server: no auth, no TLS. */
export interface SmtpEnvelope {
  host: string;
  port: number;
  from: string;
  to: string;
  data: string;
}

class SmtpSession {
  private readonly socket: net.Socket;
  private buffer = '';
  private waiting: { codes: number[]; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.consume();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('smtp connection closed')));
  }

  private fail(error: Error): void {
    const pending = this.waiting;
    this.waiting = null;
    if (pending !== null) pending.reject(error);
  }

  private consume(): void {
    const pending = this.waiting;
    if (pending === null) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] as string;
      if (line.length >= 4 && line[3] === '-') continue;
      this.buffer = lines.slice(index + 1).join('\r\n');
      this.waiting = null;
      const code = Number(line.slice(0, 3));
      if (pending.codes.includes(code)) pending.resolve();
      else pending.reject(new Error(`smtp refused: ${line}`));
      return;
    }
  }

  expect(codes: number[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.waiting = { codes, resolve, reject };
      this.consume();
    });
  }

  async send(command: string, codes: number[]): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(codes);
  }

  writeData(payload: string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.write('QUIT\r\n');
    this.socket.end();
  }
}

export async function smtpSend(envelope: SmtpEnvelope): Promise<void> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const candidate = net.createConnection({ host: envelope.host, port: envelope.port });
    candidate.setTimeout(10_000);
    candidate.once('connect', () => {
      candidate.setTimeout(0);
      resolve(candidate);
    });
    candidate.once('timeout', () => {
      candidate.destroy();
      reject(new Error('smtp connect timeout'));
    });
    candidate.once('error', (error) => reject(error));
  });

  const session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    await session.send('EHLO rimewire', [250]);
    await session.send(`MAIL FROM:<${envelope.from}> BODY=8BITMIME`, [250]);
    await session.send(`RCPT TO:<${envelope.to}>`, [250, 251]);
    await session.send('DATA', [354]);
    session.writeData(dotStuff(envelope.data));
    await session.send('.', [250]);
    session.end();
  } finally {
    socket.destroy();
  }
}

function dotStuff(data: string): string {
  return data
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

const RFC_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RFC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function rfcDate(instant: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${RFC_DAYS[instant.getUTCDay()]}, ${instant.getUTCDate()} ${RFC_MONTHS[instant.getUTCMonth()]} ${instant.getUTCFullYear()} ${pad(
    instant.getUTCHours(),
  )}:${pad(instant.getUTCMinutes())}:${pad(instant.getUTCSeconds())} +0000`;
}

/** RFC 2047 encoding, so a non-ASCII name arrives exactly as typed. */
export function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function quoteDisplayName(name: string): string {
  const encoded = encodeHeaderText(name);
  if (encoded.startsWith('=?')) return encoded;
  return `"${encoded.replace(/(["\\])/g, '\\$1')}"`;
}

export function newMessageId(host: string): string {
  return `<${randomUUID()}@${host}>`;
}
