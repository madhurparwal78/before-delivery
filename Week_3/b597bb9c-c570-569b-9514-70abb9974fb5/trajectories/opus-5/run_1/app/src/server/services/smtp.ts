/** A plain SMTP sender: EHLO, MAIL FROM, RCPT TO, DATA. Mailpit catches the mail. */
import { createConnection, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';

export interface SmtpAddress {
  from: string;
  to: string;
  subject: string;
  text: string;
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: { expect: number; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.settle();
    });
    socket.on('error', (error) => this.waiting?.reject(error));
    socket.on('close', () => this.waiting?.reject(new Error('smtp closed')));
  }

  private settle(): void {
    const waiting = this.waiting;
    if (waiting === null) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index];
      if (line.length >= 4 && line[3] === '-') continue;
      const code = Number(line.slice(0, 3));
      this.buffer = lines.slice(index + 1).join('\r\n');
      this.waiting = null;
      if (code === waiting.expect) waiting.resolve();
      else waiting.reject(new Error(`smtp said ${line}`));
      return;
    }
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = { expect: code, resolve, reject };
      this.settle();
    });
  }

  async send(command: string, code: number): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(code);
  }

  write(text: string): void {
    this.socket.write(text);
  }

  end(): void {
    this.socket.end();
  }
}

function connect(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, timeout: 5000 });
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('smtp timeout'));
    });
    socket.once('error', reject);
  });
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return match === null ? mailbox.trim() : match[1];
}

function header(name: string, value: string): string {
  return `${name}: ${value}\r\n`;
}

export async function sendMail(host: string, port: number, message: SmtpAddress): Promise<void> {
  const socket = await connect(host, port);
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    await session.send(`EHLO gatecut`, 250);
    await session.send(`MAIL FROM:<${addressOf(message.from)}>`, 250);
    await session.send(`RCPT TO:<${addressOf(message.to)}>`, 250);
    await session.send('DATA', 354);
    const body = message.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    session.write(
      [
        header('From', message.from),
        header('To', message.to),
        header('Subject', message.subject),
        header('Date', new Date().toUTCString()),
        header('Message-ID', `<${randomBytes(12).toString('hex')}@gatecut>`),
        header('MIME-Version', '1.0'),
        header('Content-Type', 'text/plain; charset=utf-8'),
        '\r\n',
        body,
        '\r\n.\r\n',
      ].join(''),
    );
    await session.expect(250);
    await session.send('QUIT', 221);
  } finally {
    session.end();
  }
}

export async function probeSmtp(host: string, port: number): Promise<boolean> {
  try {
    const socket = await connect(host, port);
    const session = new SmtpSession(socket);
    await session.expect(220);
    await session.send('QUIT', 221);
    session.end();
    return true;
  } catch {
    return false;
  }
}
