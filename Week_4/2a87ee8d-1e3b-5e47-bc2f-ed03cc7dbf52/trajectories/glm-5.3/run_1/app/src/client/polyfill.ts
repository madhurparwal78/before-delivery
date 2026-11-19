/** Small browser polyfills: no external dependencies. */
export function randomUUID(): string {
  const webcrypto = globalThis.crypto;
  if (webcrypto && 'randomUUID' in webcrypto && typeof webcrypto.randomUUID === 'function') {
    return webcrypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  (webcrypto as Crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Date formatting in a zone, without loading Intl formatters per call. */
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(opts)}`;
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, ...opts });
    dtfCache.set(key, f);
  }
  return f;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function longDate(d: Date, timeZone: string): string {
  const parts = dtf(timeZone, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const day = Number(get('day'));
  const month = Number(get('month'));
  return `${day} ${MONTHS[month - 1]} ${get('year')}`;
}

export function hhmm(d: Date, timeZone: string): string {
  return dtf(timeZone, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export function amountFmt(amount: string): string {
  const neg = amount.startsWith('-');
  const a = neg ? amount.slice(1) : amount;
  const [int, dec] = a.split('.');
  const padded = (dec ?? '00').padEnd(2, '0').slice(0, 2);
  return `${neg ? '-' : ''}${(int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${padded}`;
}
