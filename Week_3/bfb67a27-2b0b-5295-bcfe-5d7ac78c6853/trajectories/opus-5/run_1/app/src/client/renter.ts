import { addDays, daysBetween, isCalendarDate } from '../shared/dates.js';
import { apiGet } from './api.js';
import { el } from './dom.js';
import { createDayStrip, type DayStrip } from './strip.js';
import type { PriceQuote } from '../shared/types.js';

const PRICE_DEBOUNCE_MS = 120;

export interface DateSelection {
  pickupDate: string | null;
  returnDay: number;
}

export function readDateSelection(): DateSelection {
  const query = new URLSearchParams(window.location.search);
  const pickup = query.get('pickup');
  const returnDate = query.get('return');
  if (pickup === null || !isCalendarDate(pickup)) return { pickupDate: null, returnDay: 1 };
  if (returnDate === null || !isCalendarDate(returnDate)) {
    return { pickupDate: pickup, returnDay: 1 };
  }
  const days = daysBetween(pickup, returnDate);
  return { pickupDate: pickup, returnDay: days >= 1 && days <= 14 ? days : 1 };
}

/** The return day number N means N hire days, so the return date is pickup + N. */
export function returnDateOf(selection: DateSelection): string | null {
  if (selection.pickupDate === null) return null;
  return addDays(selection.pickupDate, selection.returnDay);
}

export function writeDateSelection(selection: DateSelection): void {
  const query = new URLSearchParams(window.location.search);
  const returnDate = returnDateOf(selection);
  if (selection.pickupDate === null || returnDate === null) {
    query.delete('pickup');
    query.delete('return');
  } else {
    query.set('pickup', selection.pickupDate);
    query.set('return', returnDate);
  }
  const search = query.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${search === '' ? '' : `?${search}`}`,
  );
}

export function dateQuery(selection: DateSelection): string {
  const returnDate = returnDateOf(selection);
  if (selection.pickupDate === null || returnDate === null) return '';
  return `?pickupDate=${selection.pickupDate}&returnDate=${returnDate}`;
}

export function pageDateQuery(selection: DateSelection): string {
  const returnDate = returnDateOf(selection);
  if (selection.pickupDate === null || returnDate === null) return '';
  return `?pickup=${selection.pickupDate}&return=${returnDate}`;
}

export interface DateControls {
  element: HTMLElement;
  strip: DayStrip;
  selection: () => DateSelection;
}

export interface DateControlsOptions {
  initial: DateSelection;
  onChange: (selection: DateSelection) => void;
}

export function createDateControls(options: DateControlsOptions): DateControls {
  let selection = { ...options.initial };

  const field = el('input', {
    type: 'text',
    id: 'pickup-date',
    class: 'date-field',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: 'YYYY-MM-DD',
    value: selection.pickupDate ?? '',
  });
  const label = el('label', { class: 'field', for: 'pickup-date' }, [
    el('span', { class: 'field-label' }, ['Pickup date']),
    field,
  ]);

  const strip = createDayStrip({
    pickupDate: () => selection.pickupDate ?? new Date().toISOString().slice(0, 10),
    onChange: (returnDay) => {
      selection = { ...selection, returnDay };
      options.onChange(selection);
    },
  });
  strip.setValue(selection.returnDay);

  field.addEventListener('input', () => {
    const value = field.value.trim();
    selection = { ...selection, pickupDate: isCalendarDate(value) ? value : null };
    options.onChange(selection);
  });

  return {
    element: el('div', { class: 'date-controls' }, [label, strip.element]),
    strip,
    selection: () => selection,
  };
}

export function createHireTotalStatus(): HTMLElement {
  return el('div', { role: 'status', 'aria-label': 'Hire total', class: 'hire-total' });
}

export interface PriceFetcher {
  request: (selection: DateSelection) => void;
}

export function createPriceFetcher(
  kitId: string,
  onQuote: (quote: PriceQuote) => void,
  onNoDates: () => void,
): PriceFetcher {
  let timer: number | null = null;
  let generation = 0;

  const request = (selection: DateSelection): void => {
    const returnDate = returnDateOf(selection);
    if (selection.pickupDate === null || returnDate === null) {
      onNoDates();
      return;
    }
    if (timer !== null) window.clearTimeout(timer);
    const mine = ++generation;
    timer = window.setTimeout(() => {
      void (async () => {
        try {
          const quote = await apiGet<PriceQuote>(
            `/api/price?kitId=${encodeURIComponent(kitId)}&pickupDate=${selection.pickupDate}&returnDate=${returnDate}`,
          );
          if (mine === generation) onQuote(quote);
        } catch {
          // The previous figure stays on screen until a new one arrives.
        }
      })();
    }, PRICE_DEBOUNCE_MS);
  };

  return { request };
}
