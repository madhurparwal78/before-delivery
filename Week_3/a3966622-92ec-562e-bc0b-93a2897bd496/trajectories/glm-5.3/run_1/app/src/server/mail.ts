// Mailpit SMTP client with MIME attachment support. Mail goes through
// SMTP_HOST and SMTP_PORT, from MAIL_FROM.

import net from 'node:net';

export interface MailConfig {
  host: string;
  port: number;
  from: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  attachments: Attachment[];
}

export class MailClient {
  constructor(private readonly config: MailConfig) {}

  async send(message: MailMessage): Promise<void> {
    const envelope = this.render(message);
    await this.transmit(envelope, message.to);
  }

  async reachable(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.config.host, port: this.config.port });
      const fail = () => { socket.destroy(); resolve(false); };
      socket.setTimeout(4000, fail);
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.once('data', () => {
          socket.end();
          resolve(true);
        });
      });
    });
  }

  private render(message: MailMessage): string {
    const boundary = `slackwater-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const headers = [
      `From: ${this.config.from}`,
      `To: ${message.to}`,
      `Subject: ${mimeEncode(message.subject)}`,
      'MIME-Version: 1.0',
      message.attachments.length > 0
        ? `Content-Type: multipart/mixed; boundary="${boundary}"`
        : 'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    if (message.attachments.length === 0) {
      return `${headers}\r\n\r\n${message.body}\r\n`;
    }
    const parts: string[] = [];
    parts.push(
      `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message.body}\r\n`,
    );
    for (const att of message.attachments) {
      parts.push(
        `--${boundary}\r\nContent-Type: ${att.contentType}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${mimeEncode(att.filename)}"\r\n\r\n${base64Lines(att.bytes)}\r\n`,
      );
    }
    parts.push(`--${boundary}--\r\n`);
    return `${headers}\r\n\r\n${parts.join('')}`;
  }

  private transmit(message: string, to: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.config.host, port: this.config.port });
      let buffer = '';
      let stage = 0;
      const fail = (err: Error) => { socket.destroy(); reject(err); };
      socket.setTimeout(15_000, () => fail(new Error('mail timeout')));
      socket.once('error', fail);
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const last = lastReply(buffer);
        if (last === undefined) return;
        if (last.startsWith('2')) {
          if (last.startsWith('220')) {
            socket.write('EHLO slackwater\r\n');
          } else if (last.startsWith('250')) {
            if (stage === 0) { socket.write(`MAIL FROM:<${this.config.from}>\r\n`); stage = 1; }
            else if (stage === 1) { socket.write(`RCPT TO:<${to}>\r\n`); stage = 2; }
            else if (stage === 2) { socket.write('DATA\r\n'); stage = 3; }
            else if (stage === 3) { socket.write('QUIT\r\n'); stage = 4; }
          }
        } else if (last.startsWith('3')) {
          if (last.startsWith('354')) {
            socket.write(`${message.replace(/\r?\n\./g, '\r\n..')}\r\n.\r\n`);
          }
        } else {
          fail(new Error(`mail refused: ${last}`));
        }
      });
      socket.on('close', () => {
        if (stage === 4) resolve();
        else reject(new Error('mail connection closed early'));
      });
    });
  }
}

function lastReply(buffer: string): string | undefined {
  const lines = buffer.split('\r\n').filter((l) => l.length > 0);
  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined) return undefined;
  // A reply ends when its final line carries no continuation dash.
  if (/^\d{3}-/.test(lastLine)) return undefined;
  return lastLine.slice(0, 3) === '' ? undefined : lastLine;
}

function mimeEncode(text: string): string {
  // Straight ASCII stays as-is; other bytes render as encoded words.
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function base64Lines(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i += 76) lines.push(raw.slice(i, i + 76));
  return lines.join('\r\n');
}
