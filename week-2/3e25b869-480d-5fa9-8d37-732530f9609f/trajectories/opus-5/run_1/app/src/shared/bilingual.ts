import type { Bilingual } from './catalog.js';
import { formatMoney } from './money.js';
import { formatDropTime, formatLongDate } from './toronto.js';
import type { Money } from './types.js';

export function longDateText(date: string): Bilingual {
  return { 'en-CA': formatLongDate(date, 'en-CA'), 'fr-CA': formatLongDate(date, 'fr-CA') };
}

export function moneyText(value: Money): Bilingual {
  return { 'en-CA': formatMoney(value, 'en-CA'), 'fr-CA': formatMoney(value, 'fr-CA') };
}

export function dropTimeText(instant: Date): Bilingual {
  return {
    'en-CA': formatDropTime(instant, 'en-CA'),
    'fr-CA': formatDropTime(instant, 'fr-CA'),
  };
}
