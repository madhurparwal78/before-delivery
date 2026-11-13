export type Config = {
  reservation_ttl_seconds: number;
  return_window_days: number;
  trial_window_days: number;
  compare_max: number;
  page_size: number;
  cart_undo_seconds: number;
  toast_seconds: number;
  low_stock_threshold: number;
  free_shipping_minimum: number;
  tax_rate_percent: number;
  upload_max_bytes: number;
  warranty_years_luggage: number;
  warranty_years_bags: number;
  warranty_years_accessories: number;
};

export let CONFIG: Config = {
  reservation_ttl_seconds: 600,
  return_window_days: 30,
  trial_window_days: 30,
  compare_max: 3,
  page_size: 12,
  cart_undo_seconds: 6,
  toast_seconds: 5,
  low_stock_threshold: 3,
  free_shipping_minimum: 5000,
  tax_rate_percent: 18,
  upload_max_bytes: 5000000,
  warranty_years_luggage: 3,
  warranty_years_bags: 2,
  warranty_years_accessories: 1,
};

export async function loadConfig(): Promise<void> {
  const res = await fetch('/api/config');
  CONFIG = await res.json();
}

/** ₹ amounts use Indian digit grouping, for example ₹12,499. */
export function rupees(n: number): string {
  const neg = n < 0;
  const digits = Math.abs(Math.trunc(n)).toString();
  if (digits.length <= 3) return (neg ? '-₹' : '₹') + digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) parts.unshift(rest);
  return (neg ? '-₹' : '₹') + parts.join(',') + ',' + last3;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Dates are written like 4 November 2026 in India Standard Time. */
export function dateText(iso: string): string {
  const d = new Date(new Date(iso).getTime() + (5 * 60 + 30) * 60000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function dateTimeText(iso: string): string {
  const d = new Date(new Date(iso).getTime() + (5 * 60 + 30) * 60000);
  let hours = d.getUTCHours() % 12;
  if (hours === 0) hours = 12;
  return `${dateText(iso)}, ${hours}:${String(d.getUTCMinutes()).padStart(2, '0')} ${d.getUTCHours() >= 12 ? 'pm' : 'am'}`;
}

export function holdText(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}

export function yearsText(n: number): string {
  return n === 1 ? '1 year' : `${n} years`;
}

export function listText(n: number, singular: string, plural = singular): string {
  return n === 1 ? singular : plural;
}
