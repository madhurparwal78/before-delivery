import type { Config } from './config.js';
import { smtpSend } from './smtp.js';

/** Mail client that opens a fresh connection for each send. */

export class Mailer {
  constructor(private cfg: Config['smtp']) {}

  /** Returns true when SMTP accepted the message. */
  async send(to: string, subject: string, body: string): Promise<boolean> {
    return smtpSend(this.cfg, to, subject, body);
  }

  /** Probe whether a fresh SMTP connection can be opened. */
  async probe(): Promise<boolean> {
    const net = await import('node:net');
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: this.cfg.host, port: this.cfg.port });
      socket.setTimeout(3000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
  }
}

/** The header-safe rule: runs of line breaks, tabs and control characters become one space. */
export function headerSafe(s: string): string {
  return s.replace(/[\r\n\t\f\v\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}
