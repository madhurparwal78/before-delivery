/**
 * Money figures.
 *
 * Every money figure carries its status word beside it, and the final value is
 * in `data-cents` at once while the numerals count.
 */

import { formatAmount } from '../../shared/format.js';
import { countTo, el, setTextIfChanged } from '../dom.js';

export type FigureStatus =
  | 'quoted'
  | 'checking'
  | 'not current'
  | 'scheduled'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'overdue'
  | 'returned'
  | 'partly returned'
  | 'corrected';

export interface Figure {
  element: HTMLElement;
  set(cents: number, status: FigureStatus): void;
}

export function figure(cents: number, status: FigureStatus, extraClass = ''): Figure {
  const amount = el('span', { class: 'amount' });
  amount.dataset.shown = String(cents);
  amount.dataset.cents = String(cents);
  amount.textContent = formatAmount(cents);

  const word = el('span', { class: 'status-word' }, [status]);
  const element = el('span', { class: `figure ${extraClass}`.trim() }, [amount, word]);

  return {
    element,
    set(nextCents: number, nextStatus: FigureStatus): void {
      countTo(amount, nextCents, formatAmount);
      setTextIfChanged(word, nextStatus);
    },
  };
}

/** The status word a stage's figure carries. */
export function stageStatusWord(status: string): FigureStatus {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'overdue':
      return 'overdue';
    default:
      return 'scheduled';
  }
}
