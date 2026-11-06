/** The published placeholder formats from API › Formats. */

export type BookingStatus =
  | 'held'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'no_show'
  | 'cancelled_free'
  | 'cancelled_late'
  | 'expired';

export type DocumentStatus = 'submitted' | 'approved' | 'expiring' | 'expired' | 'superseded';

export type DocumentType = 'insurance_certificate' | 'food_handler_card';

const bookingStatusWords: Record<BookingStatus, string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled_free: 'Cancelled',
  cancelled_late: 'Late cancel',
  expired: 'Expired',
};

const documentStatusWords: Record<DocumentStatus, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  expiring: 'Expiring',
  expired: 'Expired',
  superseded: 'Superseded',
};

export function bookingStatusWord(status: BookingStatus): string {
  return bookingStatusWords[status];
}

export function documentStatusWord(status: DocumentStatus): string {
  return documentStatusWords[status];
}

export function documentTypeLabel(type: DocumentType): string {
  return type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card';
}

/** Dollars with comma thousands separators and two decimals; negatives as -$x. */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const whole = Math.floor(Math.abs(cents) / 100);
  const fraction = (Math.abs(cents) % 100).toString().padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-$' : '$'}${grouped}.${fraction}`;
}

/** Dollars with two decimals and no symbol or separator, for the usage CSV. */
export function moneyPlain(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
}

/** A decimal with up to two places and no trailing zeros. */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, '');
}

export type BlockShape =
  | { kind: 'hourly'; stationName: string; localDate: string; localStart: string; localEnd: string }
  | { kind: 'shelf'; stationName: string; localDate: string; days: number };

/** "<station> <date> <start>–<end>" or "<station> <date> for <n> days". */
export function blockLabel(block: BlockShape): string {
  if (block.kind === 'shelf') {
    const unit = block.days === 1 ? 'day' : 'days';
    return `${block.stationName} ${block.localDate} for ${block.days} ${unit}`;
  }
  return `${block.stationName} ${block.localDate} ${block.localStart}\u2013${block.localEnd}`;
}

export function blockLabelOf(booking: {
  kind: 'hourly' | 'shelf';
  stationName: string;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
}): string {
  if (booking.kind === 'shelf') {
    return blockLabel({
      kind: 'shelf',
      stationName: booking.stationName,
      localDate: booking.localDate,
      days: booking.days ?? 1,
    });
  }
  return blockLabel({
    kind: 'hourly',
    stationName: booking.stationName,
    localDate: booking.localDate,
    localStart: booking.localStart ?? '00:00',
    localEnd: booking.localEnd ?? '00:00',
  });
}
