// A minimal SMTP client: plain-text email over node:net, no third-party code.

import net from 'node:net';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
}

interface Reply {
  code: number;
  lines: string[];
}

export class SmtpClient {
  private readonly cfg: SmtpConfig;

  constructor(cfg: SmtpConfig) {
    this.cfg = cfg;
  }

  private connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.cfg.host, port: this.cfg.port });
      socket.setTimeout(8000);
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('smtp timeout'));
      });
    });
  }

  private static readReply(socket: net.Socket): Promise<Reply> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        // A reply ends with a line like "250 " (space, not dash).
        if (/^\d{3} .*\r\n$/m.test(buffer)) {
          socket.off('data', onData);
          socket.off('error', onErr);
          const lines = buffer.split(/\r?\n/).filter(Boolean);
          const code = Number(lines.at(-1)?.slice(0, 3) ?? '0');
          resolve({ code, lines });
        }
      };
      const onErr = (e: Error): void => {
        socket.off('data', onData);
        reject(e);
      };
      socket.on('data', onData);
      socket.on('error', onErr);
    });
  }

  private static async command(socket: net.Socket, cmd: string | null, expect: number[]): Promise<Reply> {
    if (cmd !== null) {
      await new Promise<void>((resolve) => socket.write(`${cmd}\r\n`, () => resolve()));
    }
    const reply = await SmtpClient.readReply(socket);
    if (!expect.includes(reply.code)) {
      throw new Error(`smtp ${cmd ?? 'greeting'} failed: ${reply.lines.join(' ')}`);
    }
    return reply;
  }

  private static encodeHeader(value: string): string {
    // Headers are UTF-8; quote words when needed.
    return value.replace(/[\r\n]+/g, ' ');
  }

  private static encodeBody(text: string): string {
    // SMTP bodies are dot-stuffed: a line starting with a dot gets another.
    // The DATA block adds its own line endings, so a trailing CRLF is dropped.
    const trimmed = text.replace(/\r\n$/, '');
    return trimmed.split('\r\n').map((l) => (l.startsWith('.') ? `.${l}` : l)).join('\r\n');
  }

  async send(message: MailMessage): Promise<void> {
    const socket = await this.connect();
    try {
      await SmtpClient.command(socket, null, [220]);
      await SmtpClient.command(socket, `EHLO rushes.local`, [250]);
      await SmtpClient.command(socket, `MAIL FROM:<${this.fromAddress()}>`, [250]);
      await SmtpClient.command(socket, `RCPT TO:<${message.to}>`, [250, 251]);
      await SmtpClient.command(socket, `DATA`, [354]);
      const body = [
        `From: ${this.cfg.from}`,
        `To: ${message.to}`,
        `Subject: ${SmtpClient.encodeHeader(message.subject)}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        SmtpClient.encodeBody(message.text),
        `.`,
      ].join('\r\n');
      await new Promise<void>((resolve) => socket.write(`${body}\r\n`, () => resolve()));
      const reply = await SmtpClient.readReply(socket);
      if (reply.code !== 250) {
        throw new Error(`smtp data failed: ${reply.lines.join(' ')}`);
      }
      await SmtpClient.command(socket, `QUIT`, [221]);
    } finally {
      socket.end();
      socket.destroy();
    }
  }

  private fromAddress(): string {
    const m = /<([^>]+)>/.exec(this.cfg.from);
    if (m?.[1]) return m[1];
    return this.cfg.from;
  }

  async verify(): Promise<boolean> {
    try {
      const socket = await this.connect();
      socket.destroy();
      return true;
    } catch {
      return false;
    }
  }
}
