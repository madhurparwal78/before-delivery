import * as net from 'node:net';
import type { AppConfig } from './config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export class Mailer {
  constructor(private readonly config: AppConfig) {}

  async send(message: EmailMessage): Promise<void> {
    const { host, port } = this.config.smtp;
    const socket = net.createConnection({ host, port });
    socket.setTimeout(5000);
    await new Promise<void>((resolve, reject) => {
      let step = 0;
      let buffer = '';
      const lines = [
        `EHLO plumtide\r\n`,
        `MAIL FROM:<${this.extractAddress(this.config.smtp.from)}>\r\n`,
        `RCPT TO:<${message.to}>\r\n`,
        `DATA\r\n`,
      ];
      const writeData = () => {
        const body = [
          `From: ${this.config.smtp.from}`,
          `To: ${message.to}`,
          `Subject: ${message.subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          '',
          message.text.replace(/^\./gm, '..'),
          '.',
        ].join('\r\n');
        socket.write(body + '\r\n');
      };
      const proceed = () => {
        if (step < lines.length) {
          socket.write(lines[step]!);
          step += 1;
        } else if (step === lines.length) {
          writeData();
          step += 1;
        }
      };
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (buffer.endsWith('\n') || buffer.includes('\r\n')) {
          const code = Number.parseInt(buffer.trim().split(' ')[0] ?? '250', 10);
          buffer = '';
          if (code >= 400 && code < 500) {
            reject(new Error(`smtp rejected ${code}`));
            socket.end();
            return;
          }
          if (code >= 500) {
            reject(new Error(`smtp error ${code}`));
            socket.end();
            return;
          }
          if (step > lines.length) {
            resolve();
            socket.end();
            return;
          }
          proceed();
        }
      });
      socket.on('error', reject);
      socket.on('timeout', () => {
        reject(new Error('smtp timeout'));
        socket.destroy();
      });
    });
  }

  private extractAddress(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return match?.[1] ?? from;
  }
}
