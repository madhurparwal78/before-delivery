import { displayMoney, displayPercent } from '../domain/money.js';
import type { EssayState, LicenceView } from './api.js';

export { displayMoney, displayPercent };

const ESSAY_STATE_LABELS: Record<EssayState, string> = {
  draft: 'Draft',
  in_review: 'In review',
  embargoed: 'Embargoed',
  live: 'Live',
  withdrawn: 'Withdrawn',
  taken_down: 'Taken down',
};

export function essayStateLabel(state: EssayState): string {
  return ESSAY_STATE_LABELS[state];
}

const LICENCE_STATE_LABELS: Record<LicenceView['state'], string> = {
  pending_invoice: 'Pending invoice',
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

export function licenceStateLabel(state: LicenceView['state']): string {
  return LICENCE_STATE_LABELS[state];
}

export function invoiceLabel(state: LicenceView['invoice_state']): string {
  return state === 'raised' ? 'Raised' : 'Pending';
}

export function receiptLabel(state: LicenceView['receipt_state']): string {
  if (state === 'sent') return 'Sent';
  if (state === 'queued') return 'Queued';
  if (state === 'cancelled') return 'Cancelled';
  return '';
}

/** `EMBARGOED · lifts <co-op time>` or `LIVE · since <co-op time>` */
export function essayStamp(state: EssayState, liftDisplay: string): string {
  if (state === 'embargoed') return `EMBARGOED · lifts ${liftDisplay}`;
  if (state === 'live') return `LIVE · since ${liftDisplay}`;
  return essayStateLabel(state);
}

export function monthLabel(month: string): string {
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const [year, index] = month.split('-');
  return `${names[Number(index) - 1] ?? month} ${year}`;
}
