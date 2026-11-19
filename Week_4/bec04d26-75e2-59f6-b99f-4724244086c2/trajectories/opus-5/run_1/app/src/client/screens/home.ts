import { ReturnRecord } from '../../shared/types';
import { longDateString } from '../../shared/dates';
import type { App } from '../app';
import { el } from '../dom';
import { emptyState, returnData, statusChip, tile } from '../components/tile';

function allReturnsRegion(records: readonly ReturnRecord[]): HTMLElement {
  return el(
    'section',
    { role: 'region', 'aria-label': 'All your returns', class: 'quiet-card' },
    el('h2', {}, 'All your returns'),
    el(
      'ul',
      { class: 'stack' },
      ...records.map((record) =>
        el(
          'li',
          { ...returnData(record) },
          el(
            'a',
            { href: `/returns/${record.id}`, 'data-link': 'true' },
            `${record.state} ${record.period_label}`,
          ),
          el('span', { style: 'margin-left:0.5rem' }, statusChip(record)),
        ),
      ),
    ),
  );
}

export function renderHome(app: App): HTMLElement {
  const waiting = app.state.returns.filter((record) => record.awaiting_approval);
  const selected =
    waiting.find((record) => record.id === app.state.selectedReturnId) ?? waiting[0] ?? null;

  const heading = el('h1', {}, 'Awaiting your approval');

  if (!selected) {
    return el(
      'main',
      { class: 'screen owner-home' },
      heading,
      el('ul', { class: 'name-row', 'aria-label': 'Your returns' }),
      emptyState('Nothing is waiting for your approval.'),
      allReturnsRegion(app.state.returns),
    );
  }

  const name = `${selected.state} ${selected.period_label}`;

  return el(
    'main',
    { class: 'screen owner-home' },
    heading,
    el(
      'ul',
      { class: 'name-row', 'aria-label': 'Your returns' },
      ...waiting.map((record) =>
        el(
          'li',
          { ...returnData(record) },
          el(
            'button',
            {
              type: 'button',
              'aria-pressed': record.id === selected.id ? 'true' : 'false',
              'data-focus-key': `home:${record.id}`,
              onClick: () => {
                app.state.selectedReturnId = record.id;
                app.render();
              },
            },
            `${record.state} ${record.period_label}`,
          ),
        ),
      ),
    ),
    el(
      'div',
      { ...returnData(selected) },
      tile(selected, 'owner-tile'),
      el('p', { class: 'specimen-name', style: 'margin-top:0.5rem' }, selected.client.name),
      el('p', {}, selected.due_line),
      selected.carried_from
        ? el('p', { class: 'carried-line' }, `Carried from ${longDateString(selected.carried_from)}`)
        : null,
      el(
        'p',
        { class: 'hint' },
        `Gross sales ${selected.gross_sales ?? '—'} · Tax due ${selected.tax_due ?? '—'}`,
      ),
      el(
        'p',
        { style: 'margin-top:0.5rem' },
        el('a', { href: `/returns/${selected.id}`, 'data-link': 'true' }, 'Open return'),
      ),
    ),
    allReturnsRegion(app.state.returns),
    el(
      'div',
      { class: 'pinned-actions' },
      el(
        'button',
        {
          type: 'button',
          'data-focus-key': 'send-back',
          onClick: () => app.openSendBack(selected),
        },
        `Send back ${name}`,
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'primary',
          'data-focus-key': 'approve',
          onClick: () => {
            void app.approve(selected);
          },
        },
        app.isBusy('approve') ? 'Saving' : `Approve ${name}`,
      ),
    ),
  );
}
