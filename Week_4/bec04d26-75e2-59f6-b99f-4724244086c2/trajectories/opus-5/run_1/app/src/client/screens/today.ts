import { ReturnRecord, ReturnStatus } from '../../shared/types';
import { longDateString } from '../../shared/dates';
import type { App } from '../app';
import { el } from '../dom';
import { emptyState, returnData, tile } from '../components/tile';
import { countsRow } from './form';

const NEXT_STEP: Record<ReturnStatus, string> = {
  not_started: 'Prepare return',
  prepared: 'Check approval',
  client_approved: 'File return',
  filed: 'Check packet',
  packeted: 'Open return',
  amended: 'Open return',
};

export const HERO_SENTENCE = "Every return, due in its own state's time.";

function weekName(record: ReturnRecord): string {
  return `${record.client.name} · ${record.state_name} ${record.period_label}`;
}

export function renderToday(app: App): HTMLElement {
  const week = app.weekReturns();
  const selected =
    week.find((record) => record.id === app.state.selectedReturnId) ?? week[0] ?? null;

  const header = el(
    'div',
    { class: 'hero-top' },
    el('h1', { class: 'hero-wordmark' }, 'Duefield'),
    el('p', { class: 'hero-sentence' }, HERO_SENTENCE),
  );

  const counts = countsRow(
    app.state.practiceCounts.overdue,
    app.state.practiceCounts.awaiting_approval,
  );

  if (week.length === 0 || !selected) {
    return el(
      'main',
      { class: 'screen' },
      header,
      counts,
      el('ul', { class: 'week-list', 'aria-label': 'This week' }),
      emptyState('No returns due this week.'),
    );
  }

  const names = el(
    'ul',
    {
      class: 'week-list',
      'aria-label': 'This week',
      onKeydown: (event: KeyboardEvent) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const index = week.findIndex((record) => record.id === selected.id);
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        const target = week[Math.min(Math.max(next, 0), week.length - 1)];
        app.state.selectedReturnId = target.id;
        app.render();
        document
          .querySelector<HTMLElement>(`[data-focus-key="week:${target.id}"]`)
          ?.focus();
      },
    },
    ...week.map((record) =>
      el(
        'li',
        {},
        el(
          'button',
          {
            type: 'button',
            'aria-pressed': record.id === selected.id ? 'true' : 'false',
            'data-focus-key': `week:${record.id}`,
            ...returnData(record),
            onClick: () => {
              app.state.selectedReturnId = record.id;
              app.render();
            },
          },
          weekName(record),
        ),
      ),
    ),
  );

  const centre = el(
    'div',
    { class: 'hero-centre', ...returnData(selected) },
    el('p', { class: 'hero-deadline' }, `${selected.state} ${longDateString(selected.due_date)}`),
    tile(selected, 'hero-tile'),
    el('p', {}, selected.due_line),
    el(
      'a',
      {
        class: 'hero-action',
        href: `/returns/${selected.id}`,
        'data-link': 'true',
        'data-focus-key': 'today-next-step',
      },
      NEXT_STEP[selected.status],
    ),
  );

  return el(
    'main',
    { class: 'screen' },
    header,
    counts,
    el('div', { class: 'hero' }, names, centre, el('div', {})),
  );
}
