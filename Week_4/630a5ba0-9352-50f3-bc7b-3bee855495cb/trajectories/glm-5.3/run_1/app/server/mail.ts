import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from './config.js';

export class MailError extends Error {}

export type MailMessage =
  | { readonly kind: 'invite'; readonly to: string; readonly ownerName: string; readonly workspaceName: string; readonly joinUrl: string }
  | { readonly kind: 'digest'; readonly to: string; readonly dayLabel: string; readonly doneTitles: readonly string[]; readonly carryTitles: readonly string[]; tomorrowLabel: string; readonly tomorrowFirst: { title: string; startTime: string } | null }
  | { readonly kind: 'trial_notice'; readonly to: string; readonly workspaceName: string; readonly trialEndLabel: string; readonly trialEndTime: string; readonly timeZone: string };

export const SMTP_TIMEOUT_MS = 5_000;

/** Sends SMTP mail. Unreachable servers throw MailError. */
export class Mailer {
  private readonly from: string;
  private readonly host: string;
  private readonly port: number;
  private transport: Transporter | null = null;

  constructor(cfg: Config['smtp']) {
    this.from = cfg.from;
    this.host = cfg.host;
    this.port = cfg.port;
  }

  private ensureTransport(): Transporter {
    if (this.transport === null) {
      this.transport = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: false,
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS,
        tls: { rejectUnauthorized: false },
      });
    }
    return this.transport;
  }

  async send(queueItemId: string, message: MailMessage): Promise<void> {
    const transport = this.ensureTransport();
    const { subject, text } = render(message);
    try {
      await transport.sendMail({
        from: this.from,
        to: message.to,
        subject,
        text,
        messageId: `<outbox-${queueItemId}@tidemark.test>`,
      });
    } catch {
      throw new MailError('Mail is unreachable');
    }
  }
}

function render(message: MailMessage): { subject: string; text: string } {
  switch (message.kind) {
    case 'invite':
      return {
        subject: `${message.ownerName} invited you to ${message.workspaceName} on Tidemark Daybook`,
        text: `${message.ownerName} has invited you to join ${message.workspaceName} on Tidemark Daybook.\n\nOpen this link to join:\n${message.joinUrl}\n`,
      };
    case 'digest': {
      const lines: string[] = [];
      lines.push(`Done: ${message.doneTitles.length}`);
      for (const t of message.doneTitles) lines.push(`- ${t}`);
      lines.push(`Carried over to ${message.tomorrowLabel}: ${message.carryTitles.length}`);
      for (const t of message.carryTitles) lines.push(`- ${t}`);
      lines.push(message.tomorrowFirst === null ? 'Tomorrow starts with: nothing scheduled' : `Tomorrow starts with: ${message.tomorrowFirst.title} at ${message.tomorrowFirst.startTime}`);
      return { subject: `Shutdown for ${message.dayLabel}`, text: lines.join('\n') + '\n' };
    }
    case 'trial_notice':
      return {
        subject: 'Your Tidemark Daybook trial ends soon',
        text: `Your trial for ${message.workspaceName} ends on ${message.trialEndLabel} at ${message.trialEndTime} (${message.timeZone}).\n`,
      };
  }
}
