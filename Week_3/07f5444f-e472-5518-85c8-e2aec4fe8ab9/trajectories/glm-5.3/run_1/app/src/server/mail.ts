// Mail: SMTP through nodemailer, with acceptance before `sent`.

import nodemailer, { type Transporter } from "nodemailer";

export interface MailConfig {
  host: string;
  port: number;
  from: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

/** The bare address of a From value like `Quirewell Library <library@quirewell.test>`. */
export function mailAddress(from: string): string {
  const match = /<([^>]+)>\s*$/.exec(from.trim());
  return match ? match[1] : from.trim();
}

export class MailService {
  private transporter: Transporter;
  readonly fromAddress: string;

  constructor(config: MailConfig) {
    this.fromAddress = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      connectionTimeout: 2000,
      socketTimeout: 2000,
      greetingTimeout: 2000,
      disableFileAccess: true,
    });
  }

  /** Send one message. Resolves true only when the SMTP server accepts it. */
  async send(message: MailMessage): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        envelope: { from: mailAddress(this.fromAddress), to: [message.to] },
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
      return true;
    } catch {
      return false;
    }
  }

  probe(): Promise<boolean> {
    return new Promise((resolve) => {
      this.transporter.verify((error) => resolve(!error));
    });
  }
}
