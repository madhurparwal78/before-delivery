import { StateRecord } from '../../shared/types';
import { longDateString } from '../../shared/dates';
import type { App } from '../app';
import { el } from '../dom';

const CARRY_LABELS: Record<string, string> = {
  next_business: 'Next business day',
  fixed: 'Fixed date',
};

function stateRegion(app: App, state: StateRecord): HTMLElement {
  return el(
    'section',
    { role: 'region', 'aria-label': state.name, class: 'card' },
    el('h2', {}, state.name),
    el(
      'div',
      { class: 'definition' },
      el('span', {}, 'Code'),
      el('span', {}, state.code),
      el('span', {}, 'Time zone'),
      el('span', {}, `${state.zone_label} · ${state.zone}`),
    ),
    el('h3', { style: 'margin-top:1rem' }, 'Rule editions'),
    el(
      'ul',
      { class: 'stack', style: 'margin-top:0.5rem' },
      ...state.editions.map((edition) =>
        el(
          'li',
          {},
          `Effective ${edition.effective_date} · due day ${edition.due_day} · ${CARRY_LABELS[edition.carry]} · reference rate ${edition.rate}% · extension ${edition.extension_days} days`,
        ),
      ),
    ),
    el('h3', { style: 'margin-top:1rem' }, 'Holidays'),
    state.holidays.length === 0
      ? el('p', { class: 'hint' }, 'No holidays listed.')
      : el(
          'ul',
          { class: 'stack', style: 'margin-top:0.5rem' },
          ...state.holidays.map((day) => el('li', {}, `${day} · ${longDateString(day)}`)),
        ),
    el(
      'div',
      { class: 'row', style: 'margin-top:1rem' },
      el(
        'button',
        {
          type: 'button',
          'data-focus-key': `holidays:${state.code}`,
          onClick: () =>
            app.openDialog({
              kind: 'holidays',
              openerKey: `holidays:${state.code}`,
              clientId: null,
              clientName: null,
              stateCode: state.code,
              returnId: null,
              fields: { holidays: state.holidays.join('\n') },
            }),
        },
        `Edit holidays for ${state.code}`,
      ),
      el(
        'button',
        {
          type: 'button',
          'data-focus-key': `edition:${state.code}`,
          onClick: () =>
            app.openDialog({
              kind: 'edition',
              openerKey: `edition:${state.code}`,
              clientId: null,
              clientName: null,
              stateCode: state.code,
              returnId: null,
              fields: {
                effective_date: '',
                due_day: '',
                carry: '',
                rate: '',
                extension_days: '',
              },
            }),
        },
        `Publish rule change for ${state.code}`,
      ),
    ),
  );
}

export function renderStates(app: App): HTMLElement {
  return el(
    'main',
    { class: 'screen' },
    el('h1', {}, 'States'),
    ...app.state.states.map((state) => stateRegion(app, state)),
  );
}
