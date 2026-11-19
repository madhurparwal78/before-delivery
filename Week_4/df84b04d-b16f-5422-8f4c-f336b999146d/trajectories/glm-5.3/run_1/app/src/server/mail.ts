import { createConnection, type Socket } from 'node:net';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  body: string;
}

export class SmtpClient {
  constructor(private host: string, private port: number) {}

  async send(message: MailMessage): Promise<void> {
    const socket = await this.connect(5000);
    try {
      await this.expect(socket, [220]);
      await this.command(socket, `HELO twigline`, 250);
      await this.command(socket, `MAIL FROM:<${this.extractAddress(message.from)}>`, 250);
      await this.command(socket, `RCPT TO:<${message.to}>`, 250);
      await this.command(socket, `DATA`, 354);
      const body = this.prepareBody(message);
      socket.write(body);
      socket.write('\r\n.\r\n');
      await this.expect(socket, [250]);
      await this.command(socket, `QUIT`, 221);
    } finally {
      socket.destroy();
    }
  }

  private extractAddress(from: string): string {
    const match = /<([^>]+)>/.exec(from);
    return match ? (match[1] as string) : from;
  }

  private prepareBody(message: MailMessage): string {
    const headers = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      `MIME-Version: 1.0`,
    ];
    const encodedSubject = this.encodeHeader(message.subject);
    headers[2] = `Subject: ${encodedSubject}`;
    const lines = message.body.split('\n').map((line) => (line.startsWith('.') ? '.' + line : line));
    return headers.join('\r\n') + '\r\n\r\n' + lines.join('\r\n');
  }

  private encodeHeader(value: string): string {
    const ascii = /^[\x20-\x7E]*$/.test(value);
    return ascii ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }

  private connect(timeout: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      const onError = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('smtp timeout'));
      }, timeout);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.off('error', onError);
        resolve(socket);
      });
      socket.once('error', onError);
    });
  }

  private command(socket: Socket, command: string, expected: number): Promise<void> {
    socket.write(command + '\r\n');
    return this.expect(socket, [expected]);
  }

  private expect(socket: Socket, codes: number[]): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\r\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] as string;
          if (line.length >= 4 && line[3] === '-') continue;
          if (/^\d{2,3} /.test(line) || (line.length > 0 && /^\d{3}$/.test(line))) {
            const code = Number(line.slice(0, 3));
            socket.off('data', onData);
            if (codes.includes(code)) resolve();
            else reject(new Error(`smtp unexpected ${code}`));
            return;
          }
        }
      };
      socket.on('data', onData);
      socket.once('error', (err) => {
        socket.off('data', onData);
        reject(err);
      });
    });
  }
}
