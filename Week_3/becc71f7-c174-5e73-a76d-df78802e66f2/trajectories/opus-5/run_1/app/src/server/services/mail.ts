/**
 * Mailpit receives every mail the shop sends. No mail carries shopper names or emails
 * (apart from the address it is sent to), other consignors, commission or VAT, or more of
 * an IBAN than its last four characters. While Mailpit is unreachable the action that
 * would have sent the mail is refused, so no mail is ever left waiting.
 */

import type { Config } from '../config.js';
import { SmtpFailure, sendMail } from './smtp.js';
import { formatDateTime, formatMonth, formatTime, type BrusselsMonth } from '../../shared/brussels.js';
import { formatMoney } from '../../shared/money.js';
import { shop } from '../../shared/shop.js';
import { copy } from '../../shared/copy.js';
import { sizeLabel } from '../../shared/options.js';

export class MailUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Mailpit is unreachable');
    this.name = 'MailUnavailable';
    this.cause = cause;
  }
}

export interface HoldMail {
  to: string;
  tagCode: string;
  description: string;
  brand: string;
  size: string;
  priceCents: number;
  endsAt: number;
  holdPageUrl: string;
}

export interface SlotMail {
  to: string;
  startsAt: number;
  cancelUrl: string;
}

export interface PortalMail {
  to: string;
  pageUrl: string;
  pageEndsAt: number;
}

export interface StatementLine {
  tagCode: string;
  description: string;
  soldAt: number;
  shareCents: number;
}

export interface StatementMail {
  to: string;
  month: BrusselsMonth;
  lines: readonly StatementLine[];
  totalCents: number;
  ibanLast4: string | null;
}

export class Mailer {
  constructor(private readonly config: Config) {}

  private async send(to: string, subject: string, text: string): Promise<void> {
    try {
      await sendMail(this.config.smtp.host, this.config.smtp.port, {
        from: this.config.mailFrom,
        to,
        subject,
        text,
      });
    } catch (error) {
      if (error instanceof SmtpFailure) throw new MailUnavailable(error);
      throw error;
    }
  }

  async sendHold(mail: HoldMail): Promise<void> {
    const text = [
      `${mail.tagCode}`,
      `${mail.description}`,
      `${mail.brand} · ${sizeLabel(mail.size)} · ${formatMoney(mail.priceCents)}`,
      ``,
      `Held until ${formatDateTime(mail.endsAt)}.`,
      ``,
      `Come and try it on at ${shop.address}.`,
      ``,
      `Your hold page: ${mail.holdPageUrl}`,
    ].join('\n');
    await this.send(
      mail.to,
      `Your hold at ${shop.name} until ${formatTime(mail.endsAt)}`,
      text,
    );
  }

  async sendSlotConfirmation(mail: SlotMail): Promise<void> {
    const text = [
      `Your intake appointment is booked for ${formatDateTime(mail.startsAt)}.`,
      ``,
      `${shop.address}`,
      ``,
      `Can't make it? Cancel here: ${mail.cancelUrl}`,
    ].join('\n');
    await this.send(
      mail.to,
      `Your intake appointment on ${formatDateTime(mail.startsAt)}`,
      text,
    );
  }

  async sendPortalLink(mail: PortalMail): Promise<void> {
    const text = [
      `Your consignor page: ${mail.pageUrl}`,
      ``,
      `This address works until ${formatDateTime(mail.pageEndsAt)}.`,
    ].join('\n');
    await this.send(mail.to, `Your ${shop.name} consignor page`, text);
  }

  async sendStatement(mail: StatementMail): Promise<void> {
    const lines = mail.lines.map(
      (line) =>
        `${line.tagCode}  ${line.description}  ${formatDateTime(line.soldAt)}  ${formatMoney(line.shareCents)}`,
    );
    const text = [
      ...lines,
      ``,
      `Total ${formatMoney(mail.totalCents)}`,
      ``,
      mail.ibanLast4 === null ? copy.payoutHeldBack : copy.paidToAccount(mail.ibanLast4),
    ].join('\n');
    await this.send(
      mail.to,
      `Your ${shop.name} statement for ${formatMonth(mail.month)}`,
      text,
    );
  }
}
