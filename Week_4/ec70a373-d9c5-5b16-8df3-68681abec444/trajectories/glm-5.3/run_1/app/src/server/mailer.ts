import nodemailer from 'nodemailer';
import type { Env } from '../env.js';

/** SMTP delivery for the outbox, retried by the sender loop. */
export class Mailer {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async send(message: { to: string; subject: string; body: string }): Promise<void> {
    const transport = nodemailer.createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
    await transport.sendMail({
      from: this.env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
  }
}
