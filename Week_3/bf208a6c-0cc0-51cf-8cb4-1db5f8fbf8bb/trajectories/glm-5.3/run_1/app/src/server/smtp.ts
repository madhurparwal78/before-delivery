import { Socket } from 'node:net';

interface SmtpOptions {
  to: string;
  from: string;
  subject: string;
  text: string;
}

export class SmtpClient {
  constructor(
    private host: string,
    private port: number,
    private timeoutMs = 4000,
  ) {}

  async send(opts: SmtpOptions): Promise<boolean> {
    return this.session(async (socket, read) => {
      await read();
      socket.write('EHLO pinsheet\r\n');
      await read();
      socket.write(`MAIL FROM:<${extractAddress(opts.from)}>\r\n`);
      await read();
      socket.write(`RCPT TO:<${opts.to}>\r\n`);
      await read();
      socket.write('DATA\r\n');
      const dataReply = await read();
      if (!dataReply.startsWith('3')) throw new Error('smtp rejected data');
      socket.write(messageBody(opts));
      socket.write('\r\n.\r\n');
      await read();
      socket.write('QUIT\r\n');
    });
  }

  async verify(): Promise<boolean> {
    return this.session(async (socket, read) => {
      await read();
      socket.write('QUIT\r\n');
    });
  }

  private session(steps: (socket: Socket, read: () => Promise<string>) => Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let buffer = '';
      let pending: ((line: string) => void) | null = null;
      let settled = false;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(ok);
      };

      const timer = setTimeout(() => finish(false), this.timeoutMs);

      const read = (): Promise<string> =>
        new Promise((res) => {
          pending = res;
        });

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        for (;;) {
          const idx = buffer.indexOf('\r\n');
          if (idx === -1) break;
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (pending) {
            const waiter = pending;
            pending = null;
            waiter(line);
          }
        }
      });

      socket.once('error', () => finish(false));
      socket.once('close', () => finish(false));

      socket.connect(this.port, this.host, () => {
        steps(socket, read).then(
          () => finish(true),
          () => finish(false),
        );
      });
    });
  }
}

function extractAddress(from: string): string {
  const match = /<([^<>]+)>\s*$/.exec(from);
  return match?.[1] ?? from.trim();
}

function messageBody(opts: SmtpOptions): string {
  const headers = [
    `From: ${encodeHeader(opts.from)}`,
    `To: ${encodeHeader(opts.to)}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    'MIME-Version: 1.0',
  ].join('\r\n');
  return `${headers}\r\n\r\n${dotStuff(opts.text)}`;
}

function encodeHeader(value: string): string {
  return /[^\x00-\x7F]/.test(value) ? `=?utf-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=` : value;
}

function dotStuff(text: string): string {
  return text.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..');
}
