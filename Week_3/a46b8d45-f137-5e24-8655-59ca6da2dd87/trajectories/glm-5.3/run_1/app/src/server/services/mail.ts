// Mailpit receives every email. Notices that cannot be sent wait in the
// shared queue in Postgres; this client only sends.
import nodemailer from 'nodemailer';
import type { DeskConfig } from '../config.js';

export class MailUnavailable extends Error {
  constructor() { super('mail_unavailable'); this.name = 'MailUnavailable'; }
}

export interface OutgoingMessage {
  to: string;
  subject: string;
  text: string;
}

export class MailClient {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: DeskConfig) {}

  private transport(): nodemailer.Transporter {
    if (this.transporter === null) {
      this.transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: false,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10_000,
        tls: { rejectUnauthorized: false },
      });
    }
    return this.transporter;
  }

  /** Sends one message. Throws MailUnavailable when Mailpit cannot be reached. */
  async send(message: OutgoingMessage): Promise<void> {
    try {
      await this.transport().sendMail({
        from: this.config.mailFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch {
      throw new MailUnavailable();
    }
  }

  /** Deletes every message whose recipient address equals the given email,
   * compared in any letter case, and no other message. */
  async eraseMail(email: string): Promise<void> {
    const base = this.config.mailpitUrl.replace(/\/$/, '');
    let list: { messages: ReadonlyArray<{ ID: string; To: ReadonlyArray<{ Address: string }> }> };
    try {
      const res = await fetch(`${base}/api/v1/messages?limit=10000`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('mailpit list failed');
      list = (await res.json()) as { messages: ReadonlyArray<{ ID: string; To: ReadonlyArray<{ Address: string }> }> };
    } catch {
      throw new MailUnavailable();
    }
    const wanted = email.toLowerCase();
    const ids = list.messages
      .filter((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === wanted))
      .map((m) => m.ID);
    if (ids.length === 0) return;
    try {
      const res = await fetch(`${base}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ IDs: ids }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error('mailpit delete failed');
    } catch {
      throw new MailUnavailable();
    }
  }

  /** Used at claim start to confirm Mailpit is accepting mail before storing anything. */
  async ping(): Promise<void> {
    const base = this.config.mailpitUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/v1/messages?limit=1`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('ping failed');
    } catch {
      throw new MailUnavailable();
    }
  }
}
