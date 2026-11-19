import { formatMoney } from '../shared/money';
import { el } from './dom';
import { regionNames, valueRegion } from './regions';
import { Night } from './types';

export function nightlyBreakdown(nights: Night[]): HTMLElement {
  return el('table', { 'aria-label': 'Nightly breakdown', class: 'grid-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Date']),
        el('th', { scope: 'col' }, ['Room']),
        el('th', { scope: 'col' }, ['Tax']),
        el('th', { scope: 'col' }, ['City tax']),
        el('th', { scope: 'col' }, ['Night total']),
      ]),
    ]),
    el(
      'tbody',
      {},
      nights.map((night) =>
        el('tr', { 'data-night': night.date }, [
          el('td', {}, [night.date]),
          el('td', { class: 'amount' }, [formatMoney(night.roomCents)]),
          el('td', { class: 'amount' }, [formatMoney(night.taxCents)]),
          el('td', { class: 'amount' }, [formatMoney(night.cityTaxCents)]),
          el('td', { class: 'amount' }, [formatMoney(night.totalCents)]),
        ]),
      ),
    ),
  ]);
}

export function labelledValue(name: string, value: string, className = 'status amount'):
  HTMLElement {
  return el('div', { class: 'figure' }, [
    el('span', { class: 'figurelabel', text: name }),
    valueRegion(name, value, className),
  ]);
}

export function stayTotal(totalCents: number): HTMLElement {
  return labelledValue(regionNames.stayTotal, formatMoney(totalCents));
}

export interface FormError {
  field: string;
  label: string;
  message: string;
  focus: () => void;
}

/** `Form errors` lists one link per error, each moving focus to its field. */
export function formErrors(errors: FormError[]): HTMLElement | null {
  if (errors.length === 0) return null;
  const list = el('ul', { class: 'plain' });
  for (const error of errors) {
    const link = el('a', { href: '#', class: 'errorlink' }, [`${error.label}: ${error.message}`]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      error.focus();
    });
    list.append(el('li', {}, [link]));
  }
  return el('div', { role: 'alert', 'aria-label': 'Form errors', class: 'formerrors' }, [list]);
}

export function fieldNote(message: string): HTMLElement {
  return el('span', { class: 'fieldnote', text: message });
}
