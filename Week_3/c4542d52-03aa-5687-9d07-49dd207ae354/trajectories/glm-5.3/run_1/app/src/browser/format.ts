// Display formats. Dates and instants come from the server; only formatting happens here.

let serverNowRef: () => string = () => new Date().toISOString();
export function setServerNowRef(fn: () => string): void { serverNowRef = fn; }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

export function fmtInstant(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { timeZone: 'America/Los_Angeles', day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date}, ${time} PT`;
}

export function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtMoney(amount: string): string {
  const [whole, frac] = amount.split('.');
  return `${Number(whole).toLocaleString('en-US')}.${(frac ?? '00').padEnd(2, '0')}`;
}

export function fmtPrice(price: string): string {
  return price;
}

export function fmtCountdown(target: string | null, now?: string): string {
  if (!target) return '0d 00:00:00';
  const base = now ?? serverNowRef();
  const ms = new Date(target).getTime() - new Date(base).getTime();
  if (ms <= 0) return '0d 00:00:00';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86_400);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d}d ${pad(Math.floor((total % 86_400) / 3_600))}:${pad(Math.floor((total % 3_600) / 60))}:${pad(total % 60)}`;
}
