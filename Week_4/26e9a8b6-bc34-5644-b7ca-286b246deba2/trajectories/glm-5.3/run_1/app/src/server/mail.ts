// SMTP client for the confirmation message: plain SMTP over TCP to Mailpit.

import { connect as netConnect, type Socket } from 'node:net';

export interface MailConfig {
  host: string;
  port: number;
  mailFrom: string;
}

interface MailAddress {
  email: string;
}

function parseAddress(raw: string): MailAddress {
  const match = raw.match(/<([^>]+)>/);
  return { email: match ? match[1] : raw };
}

export class Smtp {
  constructor(private config: MailConfig) {}

  /** Sends the confirmation message; resolves true when the server accepted it. */
  async send(to: string, subject: string, body: string): Promise<boolean> {
    const { host, port, mailFrom } = this.config;
    const from = parseAddress(mailFrom).email;
    const socket = await new Promise<Socket | null>((resolve) => {
      const socket = netConnect(port, host, () => resolve(socket));
      socket.on('error', () => resolve(null));
      socket.setTimeout(8000, () => {
        socket.destroy();
        resolve(null);
      });
    });
    if (!socket) return false;
    try {
      await this.expect(socket, 220);
      await this.command(socket, `EHLO pennywasher`, 250);
      await this.command(socket, `MAIL FROM:<${from}>`, 250);
      await this.command(socket, `RCPT TO:<${to}>`, 250);
      await this.command(socket, 'DATA', 354);
      const message = [
        `From: ${mailFrom}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        body.replace(/^\./gm, '..'),
        '.',
      ].join('\r\n');
      await this.rawSend(socket, message);
      await this.expect(socket, 250);
      await this.command(socket, 'QUIT', 221);
      return true;
    } catch {
      return false;
    } finally {
      socket.destroy();
    }
  }

  private rawSend(socket: Socket, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.write(data + '\r\n', 'utf8', (error) => (error ? reject(error) : resolve()));
    });
  }

  private command(socket: Socket, command: string, expected: number): Promise<void> {
    return this.rawSend(socket, command).then(() => this.expect(socket, expected));
  }

  private expect(socket: Socket, code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\r\n');
        let consumed = 0;
        for (let i = 0; i < lines.length - 1; i++) {
          consumed += lines[i].length + 2;
          const line = lines[i];
          if (line.length >= 4 && line[3] === '-') continue; // multiline reply continues
          if (line.length >= 3 && Number.parseInt(line.slice(0, 3), 10) === code) {
            socket.off('data', onData);
            resolve();
            return;
          }
          socket.off('data', onData);
          reject(new Error(`smtp_expected_${code}`));
          return;
        }
        buffer = buffer.slice(consumed);
      };
      socket.on('data', onData);
      socket.on('error', reject);
    });
  }
}
