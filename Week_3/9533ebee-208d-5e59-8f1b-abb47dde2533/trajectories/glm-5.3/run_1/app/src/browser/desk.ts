import { ASSET_DECIMALS, type AssetCode, type Role } from './types.js';
import { ROLE_LABELS } from './types.js';

const NBSP = '\u202F';
const MINUS = '\u2212';

export function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function deskAmount(value: bigint, decimals: number, signed: boolean): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = abs.toString().padStart(decimals + 1, '0');
  const intPart = base.slice(0, base.length - decimals) || '0';
  const frac = base.slice(base.length - decimals);
  const body = `${groupDigits(intPart)},${frac}`;
  if (neg) return MINUS + body;
  if (signed && value > 0n) return '+' + body;
  return body;
}

export function deskAmountOf(value: string, asset: AssetCode, signed = false): string {
  return deskAmount(BigInt(value), ASSET_DECIMALS[asset], signed);
}

/** Parse an API decimal string (e.g. "1.00000000") into scaled integer units. */
export function scaledFromDecimal(value: string, decimals: number): bigint {
  const [intPart, fracPart = ''] = value.split('.');
  const frac = fracPart.slice(0, decimals).padEnd(decimals, '0');
  const sign = intPart.startsWith('-') ? -1n : 1n;
  const digits = intPart.replace('-', '') + frac;
  return sign * BigInt(digits);
}

export function deskPriceOf(value: string): string {
  return '$' + deskAmount(scaledFromDecimal(value, 8), 8, false);
}

export function deskSharePriceOf(value: string): string {
  return deskAmount(scaledFromDecimal(value, 12), 12, false);
}

export function deskPercent(bps: number): string {
  const neg = bps < 0;
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, '0');
  return (neg ? MINUS : '') + whole + ',' + frac + '%';
}

export function deskPercentField(bps: number): string {
  return deskPercent(bps).replace(/%$/, '');
}

export function deskHealthFactor(hf: string | null): string {
  return hf === null ? 'No debt' : hf.replace('.', ',');
}

export function deskShock(shockTenths: number): string {
  const neg = shockTenths < 0;
  const abs = Math.abs(shockTenths);
  const whole = Math.floor(abs / 10);
  const frac = (abs % 10).toString();
  const sign = neg ? MINUS : shockTenths > 0 ? '+' : '';
  return `${sign}${whole},${frac}`;
}

export function deskDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(s / 60);
  const rest = (s % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

let deskTimeZone = 'America/St_Johns';

export function setDeskTimeZone(zone: string): void {
  deskTimeZone = zone;
}

export function deskTimeZoneName(): string {
  return deskTimeZone;
}

export function zoneAbbr(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: deskTimeZone, hour12: false, timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const offsetPart = parts.find((p): boolean => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetPart);
  if (match === null) return offsetPart;
  const sign = match[1];
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3], 10);
  const offsetMinutes = (sign === '-' ? -1 : 1) * (hours * 60 + minutes);
  const known: Record<number, string> = {
    [-210]: 'NST', [-150]: 'NDT',
    [-300]: 'EST', [-240]: 'EDT',
    [-60]: 'BST', [0]: 'GMT',
    [60]: 'CET', [120]: 'CEST',
    [-480]: 'PST', [-420]: 'PDT',
  };
  const named = known[offsetMinutes];
  if (named !== undefined) return named;
  const abs = Math.abs(offsetMinutes);
  return `UTC${offsetMinutes < 0 ? '-' : '+'}${Math.floor(abs / 60)}:${(abs % 60).toString().padStart(2, '0')}`;
}

export function deskWallTime(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: deskTimeZone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p): boolean => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')}:${get('second')} ${zoneAbbr(instant)}`;
}

export function deskDateTime(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: deskTimeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p): boolean => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${zoneAbbr(instant)}`;
}

/** Parse a desk amount input into API minor units, or null when invalid. */
export function parseDeskAmount(input: string, decimals: number): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const simplified = trimmed.replace(new RegExp(NBSP, 'g'), '').replace(/\u00a0/g, '');
  const match = new RegExp(`^([0-9]+)(?:,([0-9]{1,${decimals}}))?$`).exec(simplified);
  if (match === null) return null;
  const intPart = match[1];
  const fracPart = match[2] ?? '';
  if (intPart !== '0' && intPart.startsWith('0')) return null;
  if (intPart === '0' && fracPart !== '' && /^0+$/.test(fracPart)) return null;
  if (intPart === '0' && fracPart === '') return null;
  const combined = intPart + fracPart.padEnd(decimals, '0');
  if (BigInt(combined) <= 0n) return null;
  return combined.replace(/^0+(?=\d)/, '');
}

export function deskAmountFieldError(input: string, decimals: number): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const simplified = trimmed.replace(new RegExp(NBSP, 'g'), '').replace(/\u00a0/g, '');
  if (!/^[0-9\u202F,]*$/.test(trimmed) && !/^[0-9,]*$/.test(simplified)) {
    return 'Enter digits with a comma before the decimals.';
  }
  const match = /^([0-9]+)(?:,([0-9]*))?$/.exec(simplified);
  if (match === null) return 'Enter digits with a comma before the decimals.';
  const intPart = match[1];
  const fracPart = match[2] ?? '';
  if (intPart !== '0' && intPart.startsWith('0')) return 'Enter digits with a comma before the decimals.';
  if (simplified.includes(',') && fracPart === '') return 'Enter digits with a comma before the decimals.';
  if (fracPart.length > decimals) return `Enter at most ${decimals} digits after the comma.`;
  if (intPart === '0' && fracPart === '') return 'Enter an amount above zero.';
  if (BigInt(intPart + fracPart.padEnd(decimals, '0')) <= 0n) return 'Enter an amount above zero.';
  return null;
}

export function parseDeskPrice(input: string): string | null {
  const trimmed = input.trim().replace(/^\$/, '');
  const match = /^([0-9]+)(?:,([0-9]{0,8}))?$/.exec(trimmed.replace(new RegExp(NBSP, 'g'), ''));
  if (match === null) return null;
  const intPart = match[1];
  if (intPart !== '0' && intPart.startsWith('0')) return null;
  const fracPart = (match[2] ?? '').padEnd(8, '0');
  if (BigInt(intPart + fracPart) <= 0n) return null;
  if (match[2] === undefined || match[2] === '') return intPart;
  return `${intPart}.${match[2]}`;
}

export function deskPriceFieldError(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const simplified = trimmed.replace(/^\$/, '').replace(new RegExp(NBSP, 'g'), '');
  if (!/^[0-9,]*$/.test(simplified)) return 'Enter a price above zero with at most 8 decimals.';
  const match = /^([0-9]+)(?:,([0-9]*))?$/.exec(simplified);
  if (match === null) return 'Enter a price above zero with at most 8 decimals.';
  if (match[2] !== undefined && match[2].length > 8) return 'Enter a price above zero with at most 8 decimals.';
  return null;
}

export function parseDeskPercent(input: string): number | null {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number.parseFloat(trimmed);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

export function deskPercentFieldError(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^[0-9]+(,[0-9]{0,2})?$/.test(trimmed)) return 'Enter a percentage with at most two decimals, for example 80,00.';
  return null;
}

/** Desk-time input `YYYY-MM-DD HH:MM`, resolving folds to the earlier (daylight) instant. Returns null in a gap. */
export function parseDeskTime(input: string): { instant: Date | null; error: string | null } {
  const trimmed = input.trim();
  if (trimmed === '') return { instant: null, error: null };
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) {
    return { instant: null, error: 'Enter a desk time like 2026-11-01 01:30.' };
  }
  const [datePart, timePart] = trimmed.split(' ');
  const [year, month, day] = datePart.split('-').map((piece): number => Number.parseInt(piece, 10));
  const [hour, minute] = timePart.split(':').map((piece): number => Number.parseInt(piece, 10));
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(naive)) {
    return { instant: null, error: 'Enter a desk time like 2026-11-01 01:30.' };
  }
  const wallOf = (instant: number): string => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: deskTimeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(instant));
    const get = (t: string): string => parts.find((p): boolean => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
  };
  // The wall time can sit at offsets up to ±14 hours from the naive reading.
  const matches: number[] = [];
  for (let shiftMinutes = -14 * 60; shiftMinutes <= 14 * 60; shiftMinutes += 30) {
    const candidate = naive - shiftMinutes * 60_000;
    if (wallOf(candidate) === trimmed) matches.push(candidate);
  }
  if (matches.length === 0) {
    return { instant: null, error: 'That time doesn\u2019t exist in the desk time zone \u2013 the clocks skip it.' };
  }
  // A fold resolves to the earlier of its two instants, the daylight-time reading.
  const earliest = Math.min(...matches);
  return { instant: new Date(Math.floor(earliest / 1000) * 1000), error: null };
}

export function actorLabel(name: string, role: Role): string {
  return `${name} (${ROLE_LABELS[role]})`;
}
