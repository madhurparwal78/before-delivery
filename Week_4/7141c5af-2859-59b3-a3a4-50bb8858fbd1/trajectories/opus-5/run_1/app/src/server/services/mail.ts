/**
 * Mailpit over SMTP. Each copy delivers its own pending mail.
 */
import { createTransport, type Transporter } from 'nodemailer';
import type { Config } from '../config.ts';

export interface Letter {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

export class Mail {
  private readonly transport: Transporter;

  constructor(private readonly config: Config) {
    this.transport = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      ignoreTLS: true,
      tls: { rejectUnauthorized: false },
    });
  }

  async send(letter: Letter): Promise<void> {
    await this.transport.sendMail({
      from: this.config.smtp.from,
      to: letter.to,
      subject: letter.subject,
      text: letter.body,
      replyTo: letter.replyTo,
    });
  }
}

/** Each run of line breaks in a name reads as one space in a header. */
export function headerSafe(name: string): string {
  return name.replace(/[\r\n]+/g, ' ');
}
