import { ApiFailure, DeliveryView, EndpointView, api } from '../api';
import { clear, el, num, openDialog, table } from '../dom';
import { shortDateTime } from '../format';
import { Shell, alertError, clearMessages, notice } from '../shell';
import { state } from '../state';

const STATE_WORDS: Record<EndpointView['state'], string> = {
  active: 'Active',
  failing: 'Failing',
  disabled: 'Disabled',
};

export function mountWebhooks(shell: Shell): () => void {
  const urlInput = el('input', { type: 'url', class: 'control', 'aria-label': 'Endpoint URL', id: 'endpoint-url' });
  const urlError = el('p', { class: 'field-error' });
  const addButton = el('button', { type: 'submit', class: 'primary', text: 'Add endpoint' });
  const form = el('form', { class: 'stack-form', 'aria-label': 'Add endpoint' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'endpoint-url', text: 'Endpoint URL' }),
      urlInput,
      urlError,
    ]),
    addButton,
  ]);
  const endpointsHolder = el('div', { class: 'table-holder' });
  const deliveriesHolder = el('div', { class: 'table-holder' });
  let openDeliveriesFor: string | null = null;
  const timers: number[] = [];

  function teamId(): string {
    return state.member!.role === 'member' ? state.member!.team_id! : state.selectedTeamId;
  }

  async function loadDeliveries(): Promise<void> {
    clear(deliveriesHolder);
    if (openDeliveriesFor === null) return;
    const response = await api.get<{ deliveries: DeliveryView[] }>(
      `/api/webhook-endpoints/${openDeliveriesFor}/deliveries`,
    );
    deliveriesHolder.append(
      el('h3', { class: 'section-heading', text: 'Deliveries' }),
      table(
        'Deliveries',
        ['Event', 'Type', 'Job', 'Attempt', 'Attempted', 'Status', 'Outcome', 'Next attempt'],
        response.deliveries.map((delivery) => ({
          cells: [
            num(delivery.event_id),
            delivery.event_type,
            num(delivery.job_id),
            num(String(delivery.attempt)),
            num(shortDateTime(delivery.attempted_at)),
            num(delivery.status_code === null ? '—' : String(delivery.status_code)),
            delivery.outcome,
            num(delivery.next_attempt_at === null ? '—' : shortDateTime(delivery.next_attempt_at)),
          ],
        })),
      ),
    );
  }

  async function load(): Promise<void> {
    const response = await api.get<{ endpoints: EndpointView[] }>(
      `/api/webhook-endpoints?team=${encodeURIComponent(teamId())}`,
    );
    clear(endpointsHolder);
    endpointsHolder.append(
      table(
        'Endpoints',
        ['URL', 'State', 'Consecutive failures', 'Added', 'Actions'],
        response.endpoints.map((endpoint) => {
          const deliveries = el('button', {
            type: 'button',
            class: 'secondary',
            text: 'Deliveries',
            'aria-label': `Deliveries for ${endpoint.url}`,
          });
          deliveries.addEventListener('click', () => {
            openDeliveriesFor = endpoint.id;
            void loadDeliveries();
          });
          const remove = el('button', {
            type: 'button',
            class: 'secondary',
            text: 'Remove',
            'aria-label': `Remove ${endpoint.url}`,
          });
          remove.addEventListener('click', () => {
            void api.del(`/api/webhook-endpoints/${endpoint.id}`).then(() => {
              if (openDeliveriesFor === endpoint.id) openDeliveriesFor = null;
              void load();
              void loadDeliveries();
            });
          });
          const actions: Node[] = [deliveries, remove];
          if (state.member!.role === 'admin' && endpoint.state === 'disabled') {
            const enable = el('button', {
              type: 'button',
              class: 'secondary',
              text: 'Re-enable',
              'aria-label': `Re-enable ${endpoint.url}`,
            });
            enable.addEventListener('click', () => {
              notice('Re-enabling…');
              void api
                .post(`/api/webhook-endpoints/${endpoint.id}/enable`)
                .then(() => {
                  notice('Endpoint re-enabled.');
                  void load();
                })
                .catch((error: unknown) => {
                  if (!(error instanceof ApiFailure)) throw error;
                  alertError(error.status === 409 ? 'That endpoint is not disabled.' : error.message);
                });
            });
            actions.push(enable);
          }
          return {
            cells: [
              endpoint.url,
              STATE_WORDS[endpoint.state],
              num(String(endpoint.consecutive_failures)),
              num(shortDateTime(endpoint.created_at)),
              el('div', { class: 'row-actions' }, actions),
            ],
          };
        }),
      ),
    );
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearMessages();
    urlError.textContent = '';
    addButton.disabled = true;
    addButton.textContent = 'Checking address…';
    void api
      .post<{ endpoint: EndpointView }>('/api/webhook-endpoints', { url: urlInput.value })
      .then((response) => {
        urlInput.value = '';
        openDialog({
          label: 'Signing secret',
          opener: addButton,
          content: (close) => {
            const copy = el('button', { type: 'button', class: 'secondary', text: 'Copy secret' });
            copy.addEventListener('click', () => {
              void navigator.clipboard?.writeText(response.endpoint.secret ?? '');
            });
            const done = el('button', { type: 'button', class: 'primary', text: 'Done' });
            done.addEventListener('click', close);
            return [
              el('h2', { class: 'dialog-title', text: 'Signing secret' }),
              el('p', { text: 'Endpoint added. Copy the signing secret now; it is shown once.' }),
              el('p', { class: 'secret' }, [num(response.endpoint.secret ?? '')]),
              el('div', { class: 'dialog-actions' }, [copy, done]),
            ];
          },
        });
        void load();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.status === 422) {
          urlError.textContent = error.fields['url'] ?? error.message;
          alertError('Fix the highlighted fields.');
        } else if (error.status === 409) {
          alertError('This team already has 5 endpoints.');
        } else {
          alertError(error.message);
        }
      })
      .finally(() => {
        addButton.disabled = false;
        addButton.textContent = 'Add endpoint';
      });
  });

  shell.main.append(
    el('h1', { class: 'screen-title', text: 'Webhooks' }),
    form,
    endpointsHolder,
    deliveriesHolder,
  );
  void load();
  timers.push(
    window.setInterval(() => {
      void load();
      void loadDeliveries();
    }, 2000),
  );
  return () => {
    for (const timer of timers) window.clearInterval(timer);
  };
}
