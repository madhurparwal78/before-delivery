import net from 'node:net';

const TIMEOUT_MS = 10_000;
const REPLY_PATTERN = /^(?:\d{3}-[^\r\n]*\r\n)*\d{3} [^\r\n]*\r\n/;

export class SmtpError extends Error {}

class SmtpConnection {
  private readonly socket: net.Socket;
  private buffer = '';
  private readonly replies: string[] = [];
  private resolveNext: ((reply: string) => void) | null = null;
  private rejectNext: ((error: Error) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.take(chunk);
    });
    socket.on('error', (error: Error) => {
      this.fail(new SmtpError(error.message));
    });
    socket.on('timeout', () => {
      this.fail(new SmtpError('The mail server did not answer in time'));
    });
    socket.on('close', () => {
      this.fail(new SmtpError('The mail server closed the connection'));
    });
    socket.resume();
  }

  private take(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const match = REPLY_PATTERN.exec(this.buffer);
      if (match === null) return;
      const reply = match[0];
      this.buffer = this.buffer.slice(reply.length);
      const resolve = this.resolveNext;
      if (resolve === null) {
        this.replies.push(reply);
        continue;
      }
      this.resolveNext = null;
      this.rejectNext = null;
      resolve(reply);
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    const reject = this.rejectNext;
    this.resolveNext = null;
    this.rejectNext = null;
    reject?.(error);
  }

  private reply(): Promise<string> {
    const queued = this.replies.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.failure !== null) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      this.resolveNext = resolve;
      this.rejectNext = reject;
    });
  }

  async expect(code: number): Promise<void> {
    const reply = await this.reply();
    if (Number(reply.slice(0, 3)) !== code) {
      throw new SmtpError(`The mail server answered ${reply.trim()}`);
    }
  }

  write(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.removeAllListeners('close');
    this.socket.removeAllListeners('error');
    this.socket.end();
  }
}

async function open(host: string, port: number): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(TIMEOUT_MS);
    socket.pause();
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('error', (error: Error) => {
      reject(new SmtpError(error.message));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new SmtpError('The mail server did not answer in time'));
    });
  });
}

export async function deliver(
  host: string,
  port: number,
  envelopeFrom: string,
  recipient: string,
  data: string,
): Promise<void> {
  const connection = new SmtpConnection(await open(host, port));
  try {
    await connection.expect(220);
    connection.write('EHLO lanternfish\r\n');
    await connection.expect(250);
    connection.write(`MAIL FROM:<${envelopeFrom}>\r\n`);
    await connection.expect(250);
    connection.write(`RCPT TO:<${recipient}>\r\n`);
    await connection.expect(250);
    connection.write('DATA\r\n');
    await connection.expect(354);
    connection.write(`${data}\r\n.\r\n`);
    await connection.expect(250);
    connection.write('QUIT\r\n');
  } finally {
    connection.close();
  }
}
