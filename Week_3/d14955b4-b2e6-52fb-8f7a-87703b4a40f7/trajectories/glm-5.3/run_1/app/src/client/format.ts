// The one amount-formatting decision, mirrored from the server rules.
const EXPONENTS: Record<string, number> = {
  JPY: 0, KRW: 0, CLP: 0,
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, BRL: 2,
  KWD: 3, BHD: 3, JOD: 3,
};

export function formatAmount(minor: number, code: string): string {
  const exponent = EXPONENTS[code] ?? 2;
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / 10 ** exponent).toString();
  const text = exponent === 0 ? whole : `${whole}.${String(absolute % 10 ** exponent).padStart(exponent, '0')}`;
  return `${minor < 0 ? '-' : ''}${text} ${code}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${hours}:${minutes}`;
}

export function refundWords(purchase: { status: string; refunded_minor: number; currency: string }): string {
  if (purchase.status === 'paid') return 'paid';
  if (purchase.status === 'refunded') return 'refunded';
  return `partly refunded: ${formatAmount(purchase.refunded_minor, purchase.currency)}`;
}

export function receiptStatusWords(status: string): string {
  if (status === 'paid') return 'paid';
  if (status === 'refunded') return 'refunded';
  return 'partly refunded';
}

export function comparisonWords(entry: { on_game_server: boolean | null; differences: string[] } | null): string {
  if (!entry || entry.on_game_server === null) return '';
  if (!entry.on_game_server) return 'not on the game server';
  if (entry.differences.length === 0) return 'on the game server';
  return `on the game server, differs: ${entry.differences.join(', ')}`;
}
