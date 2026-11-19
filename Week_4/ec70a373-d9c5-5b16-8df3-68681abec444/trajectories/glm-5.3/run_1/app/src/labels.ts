export const SITE_KINDS: Record<string, { name: string; legal: string }> = {
  copperline: { name: 'Copperline Kitchen Collective', legal: 'Copperline Kitchen Collective, Inc.' },
  fernhollow: { name: 'Fernhollow Food Works', legal: 'Fernhollow Food Works Cooperative' },
};

export const COI_TYPE_LABEL = 'Certificate of insurance';
export const FHC_TYPE_LABEL = 'Food handler certificate';
export const BL_TYPE_LABEL = 'Business licence';

export function documentTypeLabel(type: string): string {
  if (type === 'certificate_of_insurance') return COI_TYPE_LABEL;
  if (type === 'food_handler_certificate') return FHC_TYPE_LABEL;
  return BL_TYPE_LABEL;
}

export function movementLabel(kind: string): string {
  switch (kind) {
    case 'opening_balance': return 'Opening balance';
    case 'pack_purchase': return 'Pack purchase';
    case 'booking_debit': return 'Booking';
    case 'hold_release': return 'Hold released';
    case 'cancel_refund': return 'Cancellation refund';
    case 'forfeit': return 'Forfeit';
    case 'usage': return 'Station time used';
    case 'late_checkout': return 'Late check-out';
    case 'pack_expiry': return 'Pack hours expired';
    default: return '';
  }
}

export const SERVICE_LABELS: Record<string, string> = {
  potable_water: 'Potable water',
  grey_water: 'Grey water',
  grease: 'Grease',
  food_storage: 'Food storage',
  cleaning: 'Cleaning',
  restock: 'Restock',
};

export function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? service;
}

export const SERVICE_ORDER = ['potable_water', 'grey_water', 'grease', 'food_storage', 'cleaning', 'restock'];

export function formatHoursTwo(qh: number): string {
  return (qh / 4).toFixed(2);
}

export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  const whole = Math.floor(dollars);
  const frac = cents - whole * 100;
  return whole.toLocaleString('en-US') + '.' + String(frac).padStart(2, '0');
}

export function formatMinutesCountdown(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatMinutesWhole(ms: number): string {
  if (ms <= 0) return '0';
  return String(Math.ceil(ms / 60000));
}

export function zeroPad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}
