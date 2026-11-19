// Money and date formatting, and the one dollar-input format. Typed dollars
// become cents by exact digit arithmetic, never through a fractional number.

export const DOLLAR_FORMAT_MESSAGE = 'Enter an amount in dollars and cents, such as 12.50';
export const AMOUNT_MESSAGE = 'Enter an amount greater than $0.00';

const DOLLAR_PATTERN = /^\$?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

// Returns { ok: true, cents } or { ok: false, reason: 'format' | 'empty' }.
export function parseDollars(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };
  const match = DOLLAR_PATTERN.exec(text);
  if (!match) return { ok: false, reason: 'format' };
  const whole = match[1].replace(/,/g, '');
  const fraction = (match[2] || '').padEnd(2, '0');
  const cents = Number(`${whole}${fraction}`.replace(/^0+(?=\d)/, ''));
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: 'format' };
  return { ok: true, cents };
}

export function centsToDollars(cents) {
  const value = Number(cents);
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const fraction = abs - whole * 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(fraction).padStart(2, '0')}`;
}

export function money(cents) {
  return `$${centsToDollars(cents)}`;
}

export function signedMoney(cents, direction) {
  const sign = direction === 'credit' ? '+' : '\u2212';
  return `${sign}$${centsToDollars(Math.abs(Number(cents)))}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
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

// A server-issued YYYY-MM-DD, written out without reading the browser's clock
// or time zone.
export function effectiveDate(dateString) {
  if (!dateString) return '';
  const [year, month, day] = String(dateString).slice(0, 10).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${MONTHS[month - 1]} ${day}, ${year}`;
}

// A transaction's New York calendar date, such as "Oct 27", taken from the
// server's instant without the browser's time zone.
export function feedDate(isoInstant, nyDateString) {
  const source = nyDateString || newYorkDateOf(isoInstant);
  const [, month, day] = source.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

const NEW_YORK = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// The New York date of an instant. The zone is fixed, so the browser's own time
// zone never changes the answer.
export function newYorkDateOf(isoInstant) {
  return NEW_YORK.format(new Date(isoInstant)).replace(/\//g, '-');
}

export function monthLabel(month) {
  const [year, index] = month.split('-').map(Number);
  return `${MONTH_NAMES[index - 1]} ${year}`;
}

export function addMonths(month, delta) {
  const [year, index] = month.split('-').map(Number);
  const total = year * 12 + (index - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '??';
  const first = [...parts[0]][0] || '';
  const second = parts.length > 1 ? [...parts[parts.length - 1]][0] || '' : [...parts[0]][1] || '';
  return (first + second).toUpperCase();
}

export const METHOD_LABELS = {
  ach: 'ACH',
  wire: 'Wire',
  rtp: 'RTP',
  check: 'Check',
  card: 'Card',
  transfer: 'Transfer',
};

export const PAYMENT_STATUS_WORDS = {
  pending_approval: 'Awaiting approval',
  scheduled: 'Scheduled',
  posted: 'Posted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  failed: 'Failed',
  expired: 'Expired',
};

export function codePointLength(value) {
  let count = 0;
  for (const _ of String(value)) count += 1;
  return count;
}

// The counter on Contact counts the way the server does.
export function serverCount(value) {
  return codePointLength(String(value).trim().normalize('NFC'));
}
