import type { Currency, Market } from '../../domain/markets.ts';
import { formatMoney } from '../../domain/money.ts';
import { formatCopenhagenDate, formatCopenhagenInstant, formatMarketTime } from '../../domain/time.ts';
import { absoluteLink, type Message } from './mail.ts';

export interface InvitationPayload {
  kind: 'invitation';
  email: string;
  workspaceName: string;
  token: string;
  expiresAtMs: number;
}

export interface PasswordResetPayload {
  kind: 'password_reset';
  email: string;
  name: string;
  token: string;
  expiresAtMs: number;
}

export interface OptInPayload {
  kind: 'waitlist_opt_in';
  email: string;
  name: string;
  dropName: string;
  market: Market;
  city: string;
  token: string;
  expiresAtMs: number;
}

export interface HoldPayload {
  kind: 'hold';
  email: string;
  name: string;
  dropName: string;
  market: Market;
  city: string;
  token: string;
  expiresAtMs: number;
}

export interface ConfirmationLine {
  styleNumber: string;
  styleName: string;
  quantity: number;
  unitPriceMinor: number;
  vatMinor: number;
  lineTotalMinor: number;
}

export interface ConfirmationPayload {
  kind: 'allocation_confirmation';
  email: string;
  name: string;
  dropName: string;
  stockistName: string;
  currency: Currency;
  lines: ConfirmationLine[];
  totalMinor: number;
  invoiceNumber: string;
  priceListEffectiveDate: string;
}

export interface PressPreviewPayload {
  kind: 'press_preview';
  email: string;
  name: string;
  dropName: string;
  embargoAtMs: number;
  token: string;
  expiresAtMs: number;
}

export type MailPayload =
  | InvitationPayload
  | PasswordResetPayload
  | OptInPayload
  | HoldPayload
  | ConfirmationPayload
  | PressPreviewPayload;

export function renderMessage(payload: MailPayload): Message {
  switch (payload.kind) {
    case 'invitation':
      return {
        toName: null,
        toAddress: payload.email,
        subject: `You're invited to ${payload.workspaceName} on Hourline`,
        body: [
          'Hello,',
          '',
          `You have been invited to join ${payload.workspaceName} on Hourline.`,
          '',
          `Accept your invitation: ${absoluteLink(`/invite/${payload.token}`)}`,
          `This invitation expires ${formatCopenhagenInstant(payload.expiresAtMs)}.`,
          '',
          'Hourline',
        ].join('\n'),
      };

    case 'password_reset':
      return {
        toName: payload.name === '' ? null : payload.name,
        toAddress: payload.email,
        subject: 'Reset your Hourline password',
        body: [
          `Hello ${payload.name},`,
          '',
          'Use the link below to choose a new Hourline password.',
          '',
          `Reset your password: ${absoluteLink(`/reset-password/${payload.token}`)}`,
          `This link expires ${formatCopenhagenInstant(payload.expiresAtMs)}.`,
          '',
          'Hourline',
        ].join('\n'),
      };

    case 'waitlist_opt_in':
      return {
        toName: payload.name,
        toAddress: payload.email,
        subject: `Confirm your place on the ${payload.dropName} waitlist`,
        body: [
          `Hello ${payload.name},`,
          '',
          `Confirm your place on the ${payload.dropName} waitlist in ${payload.city}.`,
          '',
          `Confirm your place: ${absoluteLink(`/waitlist/confirm/${payload.token}`)}`,
          `This link expires ${formatMarketTime(payload.expiresAtMs, payload.market)}.`,
          '',
          'Hourline',
        ].join('\n'),
      };

    case 'hold':
      return {
        toName: payload.name,
        toAddress: payload.email,
        subject: `A piece of ${payload.dropName} is held for you`,
        body: [
          `Hello ${payload.name},`,
          '',
          `A piece of ${payload.dropName} is held for you in ${payload.city}.`,
          '',
          `Claim your piece: ${absoluteLink(`/claim/${payload.token}`)}`,
          `This hold ends ${formatMarketTime(payload.expiresAtMs, payload.market)}.`,
          '',
          'Hourline',
        ].join('\n'),
      };

    case 'allocation_confirmation':
      return {
        toName: payload.name,
        toAddress: payload.email,
        subject: `Allocation confirmed: ${payload.dropName} for ${payload.stockistName}`,
        body: [
          `Hello ${payload.name},`,
          '',
          `The allocation of ${payload.dropName} for ${payload.stockistName} is confirmed.`,
          '',
          ...payload.lines.map(
            (line) =>
              `${line.styleNumber} ${line.styleName} × ${line.quantity} — unit ${formatMoney(line.unitPriceMinor, payload.currency)}, VAT ${formatMoney(line.vatMinor, payload.currency)}, line total ${formatMoney(line.lineTotalMinor, payload.currency)}`,
          ),
          '',
          `Total: ${formatMoney(payload.totalMinor, payload.currency)}`,
          `Invoice ${payload.invoiceNumber}`,
          `Prices from the list in force on ${formatCopenhagenDate(payload.priceListEffectiveDate)}`,
          '',
          'Hourline',
        ].join('\n'),
      };

    case 'press_preview':
      return {
        toName: payload.name,
        toAddress: payload.email,
        subject: `Preview: ${payload.dropName} (embargoed until ${formatCopenhagenInstant(payload.embargoAtMs)})`,
        body: [
          `Hello ${payload.name},`,
          '',
          `Here is your embargoed preview of ${payload.dropName}.`,
          `Embargoed until ${formatCopenhagenInstant(payload.embargoAtMs)}.`,
          '',
          `Open the preview: ${absoluteLink(`/press/${payload.token}`)}`,
          `This link expires ${formatCopenhagenInstant(payload.expiresAtMs)}.`,
          '',
          'Hourline',
        ].join('\n'),
      };
  }
}
