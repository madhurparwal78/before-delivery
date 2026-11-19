import { createConnection, type Socket } from 'node:net';

const TIMEOUT_MS = 6000;

export interface Letter {
  to: string;
  subject: string;
  text: string;
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.setTimeout(TIMEOUT_MS);
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('timeout', () => this.fail(new Error('The mail server timed out')));
    socket.on('close', () => this.fail(new Error('The mail server closed the connection')));
  }

  private fail(error: Error): void {
    this.failure = error;
    this.drain();
  }

  /** An SMTP reply ends with a line whose fourth character is a space, as in "250 Ok". */
  private drain(): void {
    if (!this.waiting) return;
    if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(`000 ${this.failure.message}`);
      return;
    }
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.length >= 4 && line[3] === ' ') {
        const resolve = this.waiting;
        this.waiting = null;
        this.buffer = lines.slice(index + 1).join('\r\n');
        resolve(line);
        return;
      }
    }
  }

  private reply(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
  }

  async expect(prefix: string): Promise<void> {
    const line = await this.reply();
    if (!line.startsWith(prefix)) throw new Error(`The mail server answered ${line}`);
  }

  async command(text: string, prefix: string): Promise<void> {
    this.socket.write(`${text}\r\n`);
    await this.expect(prefix);
  }

  writeData(text: string): void {
    this.socket.write(text);
  }

  close(): void {
    this.socket.removeAllListeners('close');
    this.socket.destroy();
  }
}

const connect = (host: string, port: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, timeout: TIMEOUT_MS });
    socket.once('connect', () => resolve(socket));
    socket.once('error', (error) => reject(error));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('The mail server timed out'));
    });
  });

const addressOf = (from: string): string => {
  const angled = /<([^>]+)>/.exec(from);
  return angled ? angled[1]! : from;
};

const header = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const dotStuff = (text: string): string =>
  text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');

/** A plain SMTP submission, which is all Mailpit needs: no authentication and no TLS. */
export const sendLetter = async (
  options: { host: string; port: number; from: string },
  letter: Letter,
): Promise<void> => {
  const session = new SmtpSession(await connect(options.host, options.port));
  try {
    await session.expect('220');
    await session.command('EHLO ashlar', '250');
    await session.command(`MAIL FROM:<${addressOf(options.from)}> BODY=8BITMIME`, '250');
    await session.command(`RCPT TO:<${letter.to}>`, '250');
    await session.command('DATA', '354');
    session.writeData(
      [
        `From: ${options.from}`,
        `To: ${letter.to}`,
        `Subject: ${header(letter.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        dotStuff(letter.text),
        '.',
        '',
      ].join('\r\n'),
    );
    await session.expect('250');
    await session.command('QUIT', '221');
  } finally {
    session.close();
  }
};

export const smtpReachable = async (host: string, port: number): Promise<boolean> => {
  try {
    const session = new SmtpSession(await connect(host, port));
    try {
      await session.expect('220');
      await session.command('QUIT', '221');
      return true;
    } finally {
      session.close();
    }
  } catch {
    return false;
  }
};
