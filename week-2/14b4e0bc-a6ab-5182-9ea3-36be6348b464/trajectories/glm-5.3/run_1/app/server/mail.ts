import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailConfig {
  host: string;
  port: number;
  from: string;
}

export interface OutgoingNotice {
  messageId: string;
  toName: string;
  toEmail: string;
  subject: string;
  body: string;
}

export class MailRelay {
  private transporter: Transporter;
  readonly from: string;
  available = true;

  constructor(cfg: MailConfig) {
    this.from = cfg.from;
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }

  async probe(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  async send(notice: OutgoingNotice): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: [rfc5322Recipient(notice.toName, notice.toEmail)],
      subject: notice.subject,
      text: notice.body,
      messageId: notice.messageId,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/** RFC 5322 display-name encoding (DP-64), with RFC 2047 encoded-words for non-ASCII. */
export function rfc5322Recipient(name: string, email: string): string {
  if (/^[\x20-\x7E]*$/.test(name)) {
    // ASCII: quoted when it holds anything but letters, digits and spaces
    if (/^[A-Za-z0-9 ]*$/.test(name)) return `${name} <${email}>`;
    const quoted = name.replace(/(["\\])/g, '\\$1');
    return `"${quoted}" <${email}>`;
  }
  return `${rfc2047Encode(name)} <${email}>`;
}

function rfc2047Encode(name: string): string {
  const words: string[] = [];
  let current = '';
  for (const ch of name) {
    if (/^[\x20-\x7E]$/.test(ch)) {
      current += ch;
    } else {
      if (current) {
        words.push(current);
        current = '';
      }
      words.push(`=?UTF-8?B?${Buffer.from(ch, 'utf-8').toString('base64')}?=`);
    }
  }
  if (current) words.push(current);
  return words.join(' ');
}
