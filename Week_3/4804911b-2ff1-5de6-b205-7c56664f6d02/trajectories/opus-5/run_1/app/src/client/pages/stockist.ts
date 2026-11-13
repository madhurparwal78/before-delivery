import { failureOf, LostRequest, ok, request } from '../api.js';
import { copy, deliveryChangeSentence, slides } from '../copy.js';
import { announce, focusWithoutScroll } from '../dom.js';
import type { SessionInfo } from '../types.js';

interface EndpointView {
  id: string;
  url: string;
  registered: boolean;
  createdAt: string;
}

interface Attempt {
  at: string;
  responseStatus: number | null;
  outcome: 'success' | 'pending' | 'failed';
}

interface DeliveryView {
  eventId: string;
  eventType: string;
  noticeNumber: string | null;
  noticeVersion: number | null;
  endpointId: string;
  endpointUrl: string;
  endpointRemoved: boolean;
  state: 'pending' | 'delivered' | 'failed' | 'redelivered' | 'cancelled';
  redeliveryRequested: boolean;
  attempts: Attempt[];
}

const LABELS: Record<DeliveryView['state'], string> = {
  pending: 'Pending',
  delivered: 'Delivered',
  failed: 'Failed',
  redelivered: 'Redelivered',
  cancelled: 'Cancelled',
};

const HELD_KEY = 'interval.stockist.held';

export function renderStockist(root: HTMLElement, session: SessionInfo): void {
  root.innerHTML = `
    <main class="stockist">
      <header class="desk-head">
        <h1>Price messages</h1>
        <p>${session.displayName}</p>
        <button type="button" data-sign-out>Sign out</button>
      </header>
      <div role="alert" aria-label="Message status" data-message-alert hidden></div>
      <div role="alert" aria-label="Work status" data-work-alert hidden></div>
      <div class="stockist-grid">
        <section class="panel">
          <h2>Message endpoint</h2>
          <form class="form-block" data-endpoint-form>
            <div class="field">
              <label for="endpoint-url">Endpoint URL</label>
              <input id="endpoint-url" type="text" aria-label="Endpoint URL" data-endpoint-url>
              <p class="field-error" data-endpoint-error></p>
            </div>
            <button type="submit" data-save-endpoint>Save endpoint</button>
          </form>
          <div role="status" aria-label="Endpoint status" data-endpoint-status></div>
          <div data-endpoints></div>
          <p><a href="/api/stockist/price-sheet.csv" data-price-sheet>Download price sheet</a></p>
        </section>
        <section class="panel">
          <h2>Delivery log</h2>
          <div role="status" aria-label="Delivery status" data-delivery-status></div>
          <div data-log></div>
        </section>
      </div>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Signing secret" data-secret-dialog hidden>
        <div class="modal-body">
          <h2>Signing secret</h2>
          <p>This is shown once. Save it in your price-master software now.</p>
          <p class="secret" data-secret></p>
          <button type="button" data-secret-done>I have saved it</button>
        </div>
      </div>
    </main>
  `;

  const pick = <T extends Element>(selector: string): T => root.querySelector(selector) as T;
  const urlBox = pick<HTMLInputElement>('[data-endpoint-url]');
  const endpointStatus = pick<HTMLElement>('[data-endpoint-status]');
  const endpointError = pick<HTMLElement>('[data-endpoint-error]');
  const endpointsHolder = pick<HTMLElement>('[data-endpoints]');
  const logHolder = pick<HTMLElement>('[data-log]');
  const deliveryStatus = pick<HTMLElement>('[data-delivery-status]');
  const messageAlert = pick<HTMLElement>('[data-message-alert]');
  const workAlert = pick<HTMLElement>('[data-work-alert]');
  const secretDialog = pick<HTMLElement>('[data-secret-dialog]');
  const secretValue = pick<HTMLElement>('[data-secret]');
  const secretDone = pick<HTMLButtonElement>('[data-secret-done]');
  const saveButton = pick<HTMLButtonElement>('[data-save-endpoint]');

  let endpoints: EndpointView[] = [];
  let deliveries: DeliveryView[] = [];
  const knownLabels = new Map<string, string>();
  const pendingButtons = new Set<string>();
  const pendingRemoval = new Set<string>();
  let secretReturnTarget: HTMLElement | null = saveButton;
  let firstLog = true;

  restoreHeldWork();

  pick<HTMLButtonElement>('[data-sign-out]').addEventListener('click', () => {
    window.sessionStorage.removeItem(HELD_KEY);
    void request('DELETE', '/api/session', { silentAuth: true }).then(() => {
      window.location.assign('/');
    });
  });

  window.addEventListener('beforeunload', () => {
    if (urlBox.value.trim() !== '') {
      window.sessionStorage.setItem(
        HELD_KEY,
        JSON.stringify({ accountId: session.accountId, url: urlBox.value }),
      );
    }
  });

  function restoreHeldWork(): void {
    const raw = window.sessionStorage.getItem(HELD_KEY);
    if (raw === null) return;
    window.sessionStorage.removeItem(HELD_KEY);
    try {
      const held = JSON.parse(raw) as { accountId: string; url: string };
      if (held.accountId !== session.accountId) return;
      urlBox.value = held.url;
      endpointStatus.textContent = copy.workKept;
    } catch {
      /* nothing was held */
    }
  }

  // ----- endpoints ----------------------------------------------------------

  pick<HTMLFormElement>('[data-endpoint-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    if (saveButton.getAttribute('aria-disabled') === 'true') return;
    saveButton.setAttribute('aria-disabled', 'true');
    announce(endpointStatus, 'Checking the address.');
    endpointError.textContent = '';
    void request<EndpointView & { signingSecret: string }>('POST', '/api/stockist/endpoints', {
      body: { url: urlBox.value.trim() },
    })
      .then((result) => {
        if (!ok(result)) {
          const failure = failureOf(result);
          announce(endpointStatus, failure.message);
          endpointError.textContent = failure.message;
          return;
        }
        announce(endpointStatus, 'Endpoint saved.');
        urlBox.value = '';
        secretReturnTarget = saveButton;
        showSecret(result.body.signingSecret);
        void refresh();
      })
      .catch(() => {
        announce(endpointStatus, 'That did not reach the server. Try again.');
      })
      .finally(() => {
        saveButton.removeAttribute('aria-disabled');
      });
  });

  function showSecret(secret: string): void {
    secretValue.textContent = secret;
    secretDialog.hidden = false;
    focusWithoutScroll(secretDone);
  }

  secretDone.addEventListener('click', () => {
    secretDialog.hidden = true;
    focusWithoutScroll(secretReturnTarget);
  });

  secretDialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    focusWithoutScroll(secretDone);
  });

  function rowButton(
    label: string,
    key: string,
    action: (button: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.focusKey = key;
    if (pendingButtons.has(key)) button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', () => {
      if (pendingButtons.has(key)) return;
      pendingButtons.add(key);
      button.setAttribute('aria-disabled', 'true');
      action(button);
    });
    return button;
  }

  function finish(key: string): void {
    pendingButtons.delete(key);
    const button = root.querySelector(`[data-focus-key="${key}"]`) as HTMLElement | null;
    button?.removeAttribute('aria-disabled');
  }

  function renderEndpoints(): void {
    if (endpoints.length === 0) {
      endpointsHolder.innerHTML = `<div class="slide"><p class="slide-line">${slides.noEndpoints.line}</p><p class="slide-note">${slides.noEndpoints.note}</p></div>`;
      return;
    }
    const list = document.createElement('ul');
    list.className = 'endpoint-list';
    for (const endpoint of endpoints) {
      const item = document.createElement('li');
      const address = document.createElement('p');
      address.className = 'endpoint-url';
      address.textContent = endpoint.url;
      const registered = document.createElement('p');
      registered.textContent = endpoint.registered ? 'Registered' : 'Registering';
      item.append(address, registered);

      item.append(
        rowButton(`Send test to ${endpoint.url}`, `test-${endpoint.id}`, () => {
          announce(endpointStatus, 'Checking the address.');
          void request<{ eventId: string }>('POST', `/api/stockist/endpoints/${endpoint.id}/test`, { body: {} })
            .then((result) => {
              announce(
                endpointStatus,
                ok(result)
                  ? 'Test message accepted. Check the delivery log for the result.'
                  : failureOf(result).message,
              );
              void refresh();
            })
            .catch(() => announce(endpointStatus, 'That did not reach the server. Try again.'))
            .finally(() => finish(`test-${endpoint.id}`));
        }),
      );

      item.append(
        rowButton(`Rotate secret for ${endpoint.url}`, `rotate-${endpoint.id}`, (button) => {
          announce(endpointStatus, 'Rotating the secret.');
          void request<{ signingSecret: string }>(
            'POST',
            `/api/stockist/endpoints/${endpoint.id}/rotate-secret`,
            { body: {} },
          )
            .then((result) => {
              if (!ok(result)) {
                announce(endpointStatus, failureOf(result).message);
                return;
              }
              announce(endpointStatus, 'Secret rotated.');
              secretReturnTarget = button;
              showSecret(result.body.signingSecret);
            })
            .catch(() => announce(endpointStatus, 'That did not reach the server. Try again.'))
            .finally(() => finish(`rotate-${endpoint.id}`));
        }),
      );

      item.append(
        rowButton(`Recover failed for ${endpoint.url}`, `recover-${endpoint.id}`, () => {
          announce(endpointStatus, 'Asking for recovery.');
          void request<{ requested: string[] }>('POST', `/api/stockist/endpoints/${endpoint.id}/recover`, {
            body: {},
          })
            .then((result) => {
              announce(
                endpointStatus,
                ok(result)
                  ? `Recovery requested: ${result.body.requested.length}. Check the delivery log for the result.`
                  : failureOf(result).message,
              );
              void refresh();
            })
            .catch(() => announce(endpointStatus, 'That did not reach the server. Try again.'))
            .finally(() => finish(`recover-${endpoint.id}`));
        }),
      );

      item.append(
        rowButton(`Remove ${endpoint.url}`, `remove-${endpoint.id}`, () => {
          pendingRemoval.add(endpoint.id);
          announce(endpointStatus, 'Removing the endpoint.');
          void request('DELETE', `/api/stockist/endpoints/${endpoint.id}`)
            .then((result) => {
              if (result.status === 204 || result.status === 404) {
                pendingRemoval.delete(endpoint.id);
                announce(endpointStatus, 'Endpoint removed.');
                void refresh().then(() => focusWithoutScroll(urlBox));
                return;
              }
              announce(endpointStatus, failureOf(result).message);
            })
            .catch((error: unknown) => {
              if (error instanceof LostRequest) announce(endpointStatus, copy.lostRemoval);
            })
            .finally(() => finish(`remove-${endpoint.id}`));
        }),
      );
      list.append(item);
    }
    endpointsHolder.replaceChildren(list);
  }

  // ----- delivery log -------------------------------------------------------

  function renderLog(): void {
    if (deliveries.length === 0) {
      logHolder.innerHTML = `<div class="slide"><p class="slide-line">${slides.noDeliveries.line}</p><p class="slide-note">${slides.noDeliveries.note}</p></div>`;
      return;
    }
    const wide = window.innerWidth >= 768;
    const headers = ['Message', 'Notice', 'Endpoint', 'State', 'Attempts', 'Action'];
    const holder = wide ? document.createElement('table') : document.createElement('ul');
    holder.setAttribute('aria-label', 'Delivery log');
    holder.setAttribute('tabindex', '-1');
    if (!wide) holder.className = 'stacked';
    if (wide) {
      const head = document.createElement('tr');
      for (const header of headers) {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = header;
        head.append(cell);
      }
      holder.append(head);
    }
    for (const delivery of deliveries) {
      const values = [
        `${delivery.eventId} (${delivery.eventType})`,
        delivery.noticeNumber === null ? 'Test' : `${delivery.noticeNumber} v${delivery.noticeVersion}`,
        delivery.endpointUrl + (delivery.endpointRemoved ? ' (removed)' : ''),
        LABELS[delivery.state],
        delivery.attempts
          .map((attempt) => `${attempt.outcome} ${attempt.responseStatus ?? '-'} ${attempt.at}`)
          .join(' | '),
      ];
      const action =
        delivery.state === 'failed' && !delivery.endpointRemoved
          ? rowButton(`Redeliver ${delivery.eventId}`, `redeliver-${delivery.eventId}`, () => {
              announce(deliveryStatus, 'Asking for a redelivery.');
              void request('POST', `/api/stockist/deliveries/${delivery.eventId}/redeliver`, { body: {} })
                .then((result) => {
                  announce(
                    deliveryStatus,
                    ok(result)
                      ? 'Redelivery requested. Check the delivery log for the result.'
                      : failureOf(result).message,
                  );
                })
                .catch(() => undefined)
                .finally(() => finish(`redeliver-${delivery.eventId}`));
            })
          : null;

      if (wide) {
        const line = document.createElement('tr');
        for (const value of values) {
          const cell = document.createElement('td');
          cell.textContent = value;
          line.append(cell);
        }
        const actionCell = document.createElement('td');
        if (action !== null) actionCell.append(action);
        line.append(actionCell);
        holder.append(line);
      } else {
        const item = document.createElement('li');
        values.forEach((value, index) => {
          const line = document.createElement('p');
          line.textContent = `${headers[index]}: ${value}`;
          item.append(line);
        });
        if (action !== null) item.append(action);
        holder.append(item);
      }
    }
    logHolder.replaceChildren(holder);
  }

  function announceChanges(): void {
    for (const delivery of deliveries) {
      const label = LABELS[delivery.state];
      const known = knownLabels.get(delivery.eventId);
      const isNew = known === undefined;
      if (!firstLog && ((isNew && label !== 'Pending') || (!isNew && known !== label))) {
        announce(deliveryStatus, deliveryChangeSentence(delivery.eventId, label));
      }
      knownLabels.set(delivery.eventId, label);
    }
    firstLog = false;
  }

  // ----- refreshing ---------------------------------------------------------

  async function refresh(): Promise<void> {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey ?? null;
    const [endpointResult, deliveryResult] = await Promise.all([
      request<{ endpoints: EndpointView[] }>('GET', '/api/stockist/endpoints').catch(() => null),
      request<{ messagesQueued: boolean; workQueued: boolean; deliveries: DeliveryView[] }>(
        'GET',
        '/api/stockist/deliveries',
      ).catch(() => null),
    ]);
    if (endpointResult !== null && ok(endpointResult)) {
      endpoints = endpointResult.body.endpoints.filter(
        (endpoint) => !pendingRemovalHides(endpoint.id),
      );
      renderEndpoints();
    }
    if (deliveryResult !== null && ok(deliveryResult)) {
      deliveries = deliveryResult.body.deliveries;
      renderLog();
      announceChanges();
      messageAlert.hidden = !deliveryResult.body.messagesQueued;
      messageAlert.textContent = deliveryResult.body.messagesQueued ? copy.messageOutage : '';
      workAlert.hidden = !deliveryResult.body.workQueued;
      workAlert.textContent = deliveryResult.body.workQueued ? copy.workOutage : '';
    }
    if (focusKey !== null) {
      const again = root.querySelector(`[data-focus-key="${focusKey}"]`) as HTMLElement | null;
      if (again !== null) focusWithoutScroll(again);
      else focusWithoutScroll(root.querySelector('[aria-label="Delivery log"]') as HTMLElement | null);
    }
  }

  function pendingRemovalHides(id: string): boolean {
    void id;
    return false;
  }

  window.addEventListener('resize', () => {
    renderEndpoints();
    renderLog();
  });

  void refresh();
  window.setInterval(() => void refresh(), 5_000);
  window.setInterval(() => {
    void request<SessionInfo>('GET', '/api/session', { silentAuth: true }).then((result) => {
      if (ok(result) && result.body.accountId !== session.accountId) {
        window.sessionStorage.removeItem(HELD_KEY);
        window.location.assign(result.body.role === 'editor' ? '/editor' : '/stockist');
      }
    });
  }, 5_000);
}
