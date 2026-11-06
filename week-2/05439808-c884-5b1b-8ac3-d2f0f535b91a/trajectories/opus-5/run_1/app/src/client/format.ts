import { RESOURCES, type ResourceAmounts } from '../shared/types.js';

let zone = 'UTC';

export function setDisplayZone(timeZone: string): void {
  zone = timeZone;
}

export function number(value: number): string {
  return value.toLocaleString('en-US');
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function partsOf(instant: Date): Record<string, string> {
  let formatter = timeFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
    timeFormatters.set(zone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  return parts;
}

export function localTime(iso: string): string {
  const parts = partsOf(new Date(iso));
  return `${parts.hour ?? '00'}:${parts.minute ?? '00'}`;
}

export function localDateTime(iso: string): string {
  const parts = partsOf(new Date(iso));
  return `${parts.weekday ?? ''} ${parts.day ?? ''} ${parts.month ?? ''}, ${parts.hour ?? '00'}:${parts.minute ?? '00'}`;
}

export function countdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function amounts(values: Partial<ResourceAmounts> | null | undefined): string {
  if (!values) return 'nothing';
  const parts: string[] = [];
  for (const resource of RESOURCES) {
    const amount = values[resource] ?? 0;
    if (amount !== 0) parts.push(`${number(amount)} ${resource}`);
  }
  return parts.length === 0 ? 'nothing' : parts.join(', ');
}

export function signed(value: number): string {
  return value > 0 ? `+${number(value)}` : number(value);
}
