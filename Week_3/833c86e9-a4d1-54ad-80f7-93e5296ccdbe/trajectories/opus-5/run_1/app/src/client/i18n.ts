import { Cur, Lang } from '../shared/types';
import {
  CURRENCY_WORDS,
  CountedNoun,
  Params,
  counted,
  msg as sharedMsg,
  problemsHeading as sharedProblemsHeading,
  ui as sharedUi,
} from '../shared/strings';
import {
  fmtDayMonth,
  fmtDecimal1,
  fmtLongDate,
  fmtMoment,
  fmtMoney,
  fmtMonthYear,
  fmtWeekdayDayMonth,
  weekStart,
  weekdayNames,
} from '../shared/format';
import { state } from './state';

export function lang(): Lang {
  return state.lang;
}

export function cur(): Cur {
  return state.cur;
}

export function t(key: string, params: Params = {}): string {
  return sharedUi(lang(), key, params);
}

export function m(key: string, params: Params = {}): string {
  return sharedMsg(lang(), key, params);
}

export function problems(n: number): string {
  return sharedProblemsHeading(lang(), n);
}

export function count(noun: CountedNoun, n: number): string {
  return counted(lang(), noun, n);
}

export function amount(minor: number, currency: Cur = cur()): string {
  return fmtMoney(lang(), minor, currency);
}

export function decimal1(value: number): string {
  return fmtDecimal1(lang(), value);
}

export function longDate(date: string, zone: string): string {
  return fmtLongDate(lang(), date, zone);
}

export function dayMonth(date: string, zone: string): string {
  return fmtDayMonth(lang(), date, zone);
}

export function weekdayDayMonth(date: string, zone: string): string {
  return fmtWeekdayDayMonth(lang(), date, zone);
}

export function monthYear(date: string, zone: string): string {
  return fmtMonthYear(lang(), date, zone);
}

export function moment(instant: string, zone: string): string {
  return fmtMoment(lang(), instant, zone);
}

export function currencyWords(code: Cur = cur()): string {
  return CURRENCY_WORDS[code][lang()];
}

export function weekdays(): { iso: number; name: string }[] {
  return weekdayNames(lang());
}

export function firstWeekday(): number {
  return weekStart(lang());
}

export function isRtl(): boolean {
  return lang() === 'ar';
}

/** The whole major units of a minor amount, rounded half up, digits only. */
export function wholeMajor(minor: number, code: Cur = cur()): string {
  const decimals = { EUR: 2, USD: 2, JPY: 0, KWD: 3 }[code];
  const divisor = 10 ** decimals;
  return String(Math.floor(minor / divisor + 0.5));
}
