import nodemailer from 'nodemailer';
import type { AppConfig } from '../config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachment?: { filename: string; content: Buffer; contentType: string };
}

export class Mail {
  private transport: nodemailer.Transporter | null = null;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  private transporter(): nodemailer.Transporter {
    if (this.transport === null) {
      this.transport = nodemailer.createTransport({
        host: this.config.mail.smtpHost,
        port: this.config.mail.smtpPort,
        secure: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 5_000,
        socketTimeout: 5_000,
      });
    }
    return this.transport;
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.mail.mailpitUrl}/api/v1/health`, { signal: AbortSignal.timeout(3_000) });
      return response.ok || response.status === 404 || response.status === 200;
    } catch {
      try {
        await this.transporter().verify();
        return true;
      } catch {
        return false;
      }
    }
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter().sendMail({
      from: this.config.mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachment ? [{
        filename: message.attachment.filename,
        content: message.attachment.content,
        contentType: message.attachment.contentType,
      }] : undefined,
    });
  }
}
