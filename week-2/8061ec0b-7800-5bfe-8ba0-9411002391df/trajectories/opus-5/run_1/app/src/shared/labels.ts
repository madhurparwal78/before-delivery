import type { DeliveryStatus, EquityEntry, HistoryEntry, InstrumentType, ReversalReason, Size } from './types';
import { formatStoreDateTime } from './time';

export function instrumentName(type: InstrumentType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function isStringed(type: InstrumentType): boolean {
  return type === 'violin' || type === 'cello';
}

/** Size as it reads in visible copy. */
export function sizeLabel(type: InstrumentType, size: Size): string {
  return isStringed(type) ? size : 'Full size';
}

/** The instrument label: size then name for strings, the name alone otherwise. */
export function instrumentLabel(type: InstrumentType, size: Size): string {
  return isStringed(type) ? `${size} ${instrumentName(type)}` : instrumentName(type);
}

export function tierLabel(name: string, percent: number): string {
  return `${name}, ${percent}% off remaining`;
}

const DELIVERY_STATUS_WORDS: Record<DeliveryStatus, string> = {
  no_instrument: 'No instrument',
  awaiting_agreement: 'Awaiting agreement',
  scheduled: 'Scheduled for delivery',
  delivered: 'Delivered',
  owned: 'Owned',
};

export function deliveryStatusWord(status: DeliveryStatus): string {
  return DELIVERY_STATUS_WORDS[status];
}

const REVERSAL_REASON_WORDS: Record<ReversalReason, string> = {
  returned_check: 'Returned check',
  chargeback: 'Chargeback',
  entered_in_error: 'Entered in error',
};

export function reversalReasonWord(reason: ReversalReason): string {
  return REVERSAL_REASON_WORDS[reason];
}

export function equityEntryText(entry: EquityEntry, successorId: string | null, predecessorId: string | null): string {
  switch (entry.kind) {
    case 'opening':
      return 'Opening balance';
    case 'payment':
      return `Payment ${entry.payment_id ?? ''}`.trim();
    case 'reversal':
      return `Reversal of ${entry.payment_id ?? ''}`.trim();
    case 'exchange_out':
      return `Exchange out to ${successorId ?? ''}`.trim();
    case 'exchange_in':
      return `Exchange in from ${predecessorId ?? ''}`.trim();
    case 'buyout':
      return 'Buyout';
  }
}

export function historyLine(entry: HistoryEntry): string {
  const actor = entry.actor === 'system' ? 'System' : entry.actor_name ?? 'Keel & Bell';
  return `${formatStoreDateTime(entry.at)} · ${entry.from ?? 'new'} → ${entry.to} · ${actor}`;
}
