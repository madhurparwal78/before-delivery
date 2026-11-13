import { api } from './api.ts';
import { copy } from './copy.ts';
import { countTo, el, setText } from './dom.ts';
import type { Allocation, TotalsChannel } from './types.ts';

/** The live megalitre counters each screen leads with. */

export interface Counter {
  element: HTMLElement;
  refresh: () => Promise<void>;
}

function sum(values: readonly string[]): number {
  return values.reduce((total, value) => total + Number(value), 0);
}

export function formatMlNumber(value: number): string {
  return value.toFixed(3);
}

export function bigFigure(label: string, value: string): { element: HTMLElement; figure: HTMLElement } {
  const figure = el('span', { class: 'counter-value tabular', text: value });
  const element = el('div', {
    class: 'counter',
    children: [el('span', { class: 'counter-label', text: label }), figure],
  });
  return { element, figure };
}

export function allocationCounter(): Counter & { apply: (allocation: Allocation) => void } {
  const value = el('span', { class: 'counter-value tabular' });
  const element = el('div', {
    class: 'counter counter-lead counter-sentence',
    attrs: { role: 'region', 'aria-label': 'Allocation' },
    children: [el('span', { class: 'counter-label', text: 'Allocation' }), value],
  });
  const apply = (allocation: Allocation): void => {
    setText(value, copy.allocation(allocation.remaining_ml, allocation.allocation_ml));
  };
  const refresh = async (): Promise<void> => {
    apply(await api.get<Allocation>('/api/me/allocation'));
  };
  return { element, refresh, apply };
}

/** The district's committed and delivered ML, summed over every channel. */
export function districtCounters(): Counter {
  const committed = bigFigure('Committed ML', '0.000');
  const delivered = bigFigure('Delivered ML', '0.000');
  const element = el('div', {
    class: 'counter-row counter-lead',
    children: [committed.element, delivered.element],
  });
  const refresh = async (): Promise<void> => {
    const totals = await api.get<{ channels: TotalsChannel[] }>('/api/totals');
    const nextCommitted = sum(totals.channels.map((channel) => channel.committed_ml));
    const nextDelivered = sum(totals.channels.map((channel) => channel.delivered_ml));
    countTo(committed.figure, Number(committed.figure.textContent), nextCommitted, formatMlNumber);
    countTo(delivered.figure, Number(delivered.figure.textContent), nextDelivered, formatMlNumber);
  };
  return { element, refresh };
}
