// Shared client helpers: money and date formats match the server's rules.

export function formatPaise(paise: number): string {
  const neg = paise < 0;
  const whole = Math.floor(Math.abs(paise) / 100);
  const frac = String(Math.abs(paise) % 100).padStart(2, '0');
  const s = String(whole).replace(/(\d)(?=(\d\d)+\d$)/g, '$1,');
  return `${neg ? '-' : ''}₹${s}.${frac}`;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse `YYYY-MM-DDTHH:MM:SS+05:30` to a business Date (shifted so local getUTC* helpers work). */
export function parseStamp(s: string): Date {
  return new Date(s.replace('+05:30', 'Z'));
}

export function istParts(s: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const d = parseStamp(s);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(),
  };
}

/** `Wed 2 Dec 2026` */
export function stampWords(s: string): string {
  const p = istParts(s);
  const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  return `${WD[wd]} ${p.d} ${MON[p.mo - 1]} ${p.y}`;
}

/** `HH:MM` in IST */
export function stampHHMM(s: string): string {
  const p = istParts(s);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

/** `HH:MM+1` — times past midnight show with a day marker */
export function stampHHMMDay(s: string): string {
  const p = istParts(s);
  const t = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  return t;
}

export function dateWords(date: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${WD[wd]} ${d} ${MON[mo - 1]} ${y}`;
}

export function travelTime(dep: string, arr: string): string {
  const a = parseStamp(dep).getTime();
  const b = parseStamp(arr).getTime();
  const mins = Math.round((b - a) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export const QUOTA_LABEL: Record<string, string> = {
  GN: 'General', TQ: 'Tatkal', LD: 'Ladies', SS: 'Senior', RAC: 'RAC',
};

export const TICKET_KIND_LABEL: Record<string, string> = {
  booked: 'as booked', cancellation: 'after cancellation', chart: 'after chart',
};

export const BAND_LABEL: Record<string, string> = {
  flat: 'Flat charge',
  quarter: '25% deduction',
  half: '50% deduction',
  tatkal_confirmed: 'Confirmed Tatkal, no refund',
  clerkage: 'Clerkage',
  party_clerkage: 'Part-confirmed party, clerkage',
  rac_after_chart: 'RAC after chart, clerkage',
  after_chart: 'After chart, no refund',
  chart_full: 'Not confirmed at chart',
  no_fare: 'Child, no fare',
};

export const BERTH_POS: Record<string, string> = {
  LB: 'lower', MB: 'middle', UB: 'upper', SL: 'side lower', SU: 'side upper',
};

export function chipClass(status: string): string {
  if (status === 'CNF') return 'cnf';
  if (status === 'RAC') return 'rac';
  if (status === 'CAN') return 'can';
  if (status === 'CHART_NOT_CONFIRMED') return 'noscnf';
  if (status === 'NOSB') return 'can';
  return 'wl';
}
