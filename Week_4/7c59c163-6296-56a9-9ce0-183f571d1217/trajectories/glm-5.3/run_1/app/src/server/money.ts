// Money formatting and integer helpers. All money is integer cents.

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString();
  const centsPart = (abs % 100).toString().padStart(2, '0');
  const withCommas = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${withCommas}.${centsPart}`;
}

export function formatCentsPrice(cents: number): string {
  return `${cents}¢`;
}

export function formatPrice(kind: 'pair' | 'event', cents: number): string {
  return kind === 'event' ? formatCentsPrice(cents) : formatMoney(cents);
}

export function feeForFill(notionalCents: number, bps: number): number {
  return Math.floor((notionalCents * bps + 5000) / 10000);
}

export function holdForOrder(input: {
  price: number;
  quantity: number;
  takerFeeBps: number;
  kind: 'event' | 'pair';
  mode: 'spot' | 'margin' | null;
  side: 'buy' | 'sell';
  reducesPosition: boolean;
}): number {
  const notional = input.price * input.quantity;
  if (input.mode === 'margin') {
    const fee = feeForFill(notional, input.takerFeeBps);
    if (input.reducesPosition) return fee;
    return Math.ceil(notional / 2) + fee;
  }
  if (input.side === 'sell') {
    return feeForFill(notional, input.takerFeeBps);
  }
  return notional + feeForFill(notional, input.takerFeeBps);
}

export function formatMonth(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', timeZone });
  const parts = fmt.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

export function monthName(month: string): string {
  const [year, mon] = month.split('-');
  const date = new Date(Date.UTC(Number(year), Number(mon) - 1, 1));
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
}

export function monthStart(month: string, timeZone: string): Date {
  const [year, mon] = month.split('-').map(Number);
  // Find the UTC instant of local midnight on the 1st
  const guess = new Date(Date.UTC(year!, mon! - 1, 1));
  for (let offset = -14; offset <= 14; offset += 1) {
    const candidate = new Date(guess.getTime() - offset * 3600000);
    const label = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: 'numeric' }).format(candidate);
    if (label === `${year}-${String(mon).padStart(2, '0')}-01`) {
      // ensure it's midnight local
      const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(candidate);
      if (time === '00:00') return candidate;
    }
  }
  return guess;
}

export function nextMonthStart(month: string, timeZone: string): Date {
  const [year, mon] = month.split('-').map(Number);
  const next = mon === 12 ? `${year! + 1}-01` : `${year}-${String(mon! + 1).padStart(2, '0')}`;
  return monthStart(next, timeZone);
}

export function formatThousands(n: number): string {
  return n.toLocaleString('en-US');
}
