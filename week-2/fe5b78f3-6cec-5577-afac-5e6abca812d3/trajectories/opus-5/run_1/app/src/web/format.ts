import type { BerthType, QuotaCode, StatusBody } from './api';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Times come from the API already in IST, so they are read straight off the timestamp. */
export function istFields(timestamp: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(timestamp);
  if (match === null) return { year: 0, month: 1, day: 1, hour: 0, minute: 0 };
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

function weekdayOf(year: number, month: number, day: number): string {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** `Wed 2 Dec 2026` */
export function longDate(timestampOrDate: string): string {
  const value = timestampOrDate.length === 10 ? `${timestampOrDate}T00:00` : timestampOrDate;
  const f = istFields(value);
  return `${weekdayOf(f.year, f.month, f.day)} ${f.day} ${MONTHS[f.month - 1]} ${f.year}`;
}

/** `09:05` */
export function hourMinute(timestamp: string): string {
  const f = istFields(timestamp);
  return `${String(f.hour).padStart(2, '0')}:${String(f.minute).padStart(2, '0')}`;
}

export function formatMoney(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const digits = String(rupees);
  let grouped = digits;
  if (digits.length > 3) {
    const last3 = digits.slice(-3);
    let rest = digits.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) parts.unshift(rest);
    grouped = `${parts.join(',')},${last3}`;
  }
  return `${sign}₹${grouped}.${fraction}`;
}

export const QUOTA_LABEL: Readonly<Record<QuotaCode, string>> = {
  GN: 'General',
  TQ: 'Tatkal',
  LD: 'Ladies',
  SS: 'Senior',
};

export const POOL_LABEL: Readonly<Record<string, string>> = {
  GN: 'General',
  TQ: 'Tatkal',
  LD: 'Ladies',
  SS: 'Senior',
  RAC: 'RAC',
};

export const POSITION_WORD: Readonly<Record<BerthType, string>> = {
  LB: 'lower',
  MB: 'middle',
  UB: 'upper',
  SL: 'side lower',
  SU: 'side upper',
};

export const BERTH_STATE_TAG: Readonly<Record<string, string>> = {
  free: 'free',
  taken: 'taken',
  rac_free: 'two RAC places free',
  rac_one_free: 'one RAC place free',
  rac_full: 'RAC full',
};

export const BAND_LABEL: Readonly<Record<string, string>> = {
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

export const TICKET_KIND_LABEL: Readonly<Record<string, string>> = {
  booked: 'as booked',
  cancellation: 'after cancellation',
  chart: 'after chart',
};

/** The spoken form used in the status announcements. */
export function spokenStatus(status: StatusBody): string {
  if (status.status === 'CNF' && status.berth_type !== null) {
    return `CNF, ${status.coach} berth ${status.berth}, ${POSITION_WORD[status.berth_type]}`;
  }
  if (status.status === 'RAC') return `RAC ${status.position}`;
  if (status.status === 'CAN') return 'cancelled';
  if (status.status === 'CHART_NOT_CONFIRMED') return 'not confirmed, refund pending';
  if (status.status === 'NOSB') return 'NOSB';
  return `${status.status} ${status.position}`;
}

export function announcementLine(
  passengerNumber: number,
  from: StatusBody,
  to: StatusBody,
): string {
  return `Passenger ${passengerNumber}: ${spokenStatus(from)} to ${spokenStatus(to)}`;
}

export type ChipKind = 'cnf' | 'rac' | 'wl' | 'out' | 'nosb';

export function chipKind(status: StatusBody): ChipKind {
  if (status.status === 'CNF') return 'cnf';
  if (status.status === 'RAC') return 'rac';
  if (status.status === 'CAN' || status.status === 'CHART_NOT_CONFIRMED') return 'out';
  if (status.status === 'NOSB') return 'nosb';
  return 'wl';
}
