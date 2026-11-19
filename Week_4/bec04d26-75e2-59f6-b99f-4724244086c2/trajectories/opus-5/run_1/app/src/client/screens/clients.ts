import { ClientRecord } from '../../shared/types';
import type { App } from '../app';
import { el } from '../dom';

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

function clientRegion(app: App, client: ClientRecord): HTMLElement {
  return el(
    'section',
    { role: 'region', 'aria-label': client.name, class: 'card' },
    el('h2', {}, client.name),
    el(
      'div',
      { class: 'definition' },
      el('span', {}, 'Owner'),
      el('span', {}, `${client.owner.display_name} · ${client.owner.email}`),
    ),
    el('h3', { style: 'margin-top:1rem' }, 'Registrations'),
    client.registrations.length === 0
      ? el('p', { class: 'hint' }, 'No registrations yet.')
      : el(
          'ul',
          { class: 'stack', style: 'margin-top:0.5rem' },
          ...client.registrations.map((registration) =>
            el(
              'li',
              {},
              `${registration.state} · ${FREQUENCY_LABELS[registration.frequency]} from ${registration.first_period}`,
            ),
          ),
        ),
    el(
      'div',
      { class: 'row', style: 'margin-top:1rem' },
      el(
        'button',
        {
          type: 'button',
          'data-focus-key': `register:${client.id}`,
          onClick: () =>
            app.openDialog({
              kind: 'register',
              openerKey: `register:${client.id}`,
              clientId: client.id,
              clientName: client.name,
              stateCode: null,
              returnId: null,
              fields: { state: '', frequency: '', first_period: '' },
            }),
        },
        `Register ${client.name} in a state`,
      ),
    ),
  );
}

export function renderClients(app: App): HTMLElement {
  return el(
    'main',
    { class: 'screen' },
    el(
      'div',
      { class: 'section-head' },
      el('h1', {}, 'Clients'),
      el(
        'button',
        {
          type: 'button',
          class: 'primary',
          'data-focus-key': 'add-client',
          onClick: () =>
            app.openDialog({
              kind: 'add-client',
              openerKey: 'add-client',
              clientId: null,
              clientName: null,
              stateCode: null,
              returnId: null,
              fields: { name: '', display_name: '', email: '', password: '' },
            }),
        },
        'Add client',
      ),
    ),
    ...app.state.clients.map((client) => clientRegion(app, client)),
    app.state.clients.length === 0
      ? el('p', { class: 'hint' }, 'No clients yet. Add a client to start.')
      : null,
  );
}
