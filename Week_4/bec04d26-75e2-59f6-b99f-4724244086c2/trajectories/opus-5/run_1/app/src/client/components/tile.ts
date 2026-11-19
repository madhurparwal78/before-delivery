import { ReturnRecord } from '../../shared/types';
import { foldedReturnSvg, tileColour, TileColour } from '../../shared/specimen';
import { el, svg } from '../dom';

export function colourOf(record: ReturnRecord): TileColour {
  return tileColour(record.state_index);
}

function periodStamp(record: ReturnRecord): string {
  return record.frequency === 'yearly' ? record.period : record.period.replace('-', ' ');
}

/** Every return shown anywhere carries the published data attributes. */
export function returnData(record: ReturnRecord): Record<string, string> {
  return {
    'data-return-id': record.id,
    'data-status': record.status,
    'data-overdue': record.overdue ? 'true' : 'false',
    'data-due-at': record.due_at,
    'data-state': record.state,
    'data-version': String(record.version),
    'data-rate': record.edition.rate,
    'data-edition': record.edition.effective_date,
  };
}

export function tile(record: ReturnRecord, extraClass = ''): HTMLElement {
  const colour = colourOf(record);
  return el(
    'div',
    { class: `tile tile-${colour} ${extraClass}`.trim() },
    svg(foldedReturnSvg(record.state, periodStamp(record), colour)),
  );
}

export function statusChip(record: ReturnRecord): HTMLElement {
  const label = record.overdue
    ? `${record.state} · ${record.status_label} · Overdue`
    : `${record.state} · ${record.status_label}`;
  return el(
    'a',
    {
      class: `chip chip-${colourOf(record)}`,
      href: `/returns/${record.id}`,
      'data-link': 'true',
      ...returnData(record),
    },
    label,
  );
}

export function emptyState(sentence: string): HTMLElement {
  return el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-tile', 'aria-hidden': 'true' }),
    el('p', {}, sentence),
  );
}
