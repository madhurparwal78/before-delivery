/**
 * Reading the server's New York instants. The literal fields of the ISO string
 * are used as sent, so the device clock is never consulted.
 */
import { parseDecimal } from '../shared/decimal';
import { DisplayFormat, formatDisplay } from '../shared/display';

export interface NewYorkFields {
  date: string;
  time: string;
  shortTime: string;
}

export function newYorkFields(iso: string): NewYorkFields {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  return { date, time, shortTime: time.slice(0, 5) };
}

export function displayOf(value: string, format: DisplayFormat): string {
  const parsed = parseDecimal(value);
  return parsed === null ? value : formatDisplay(parsed, format);
}
