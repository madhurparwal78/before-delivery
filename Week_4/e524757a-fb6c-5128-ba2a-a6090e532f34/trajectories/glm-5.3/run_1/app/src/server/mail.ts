import nodemailer from "nodemailer";
import { Config } from "../shared/config";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  healthy(): Promise<boolean>;
}

export function createMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    ignoreTLS: true,
    pool: false,
    connectionTimeout: 3000
  });

  return {
    async send(message) {
      await transport.sendMail({
        from: config.mailFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.attachments ? { attachments: message.attachments } : {})
      });
    },
    async healthy() {
      try {
        return await transport.verify();
      } catch {
        return false;
      }
    }
  };
}
