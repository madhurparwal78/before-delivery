// One webhook endpoint: its name as a heading, then its own Deliveries and Attempts tables. Used by /webhooks and /webhooks/<id>.
import { html, useState, useEffect, useCallback } from '../../lib/html.js';
import { api } from '../../lib/api.js';
import { boot } from '../../lib/boot.js';
import { live } from '../../lib/live.js';
import { fmtLocal } from '../../lib/format.js';
import { Button, Bar, Empty, Tone } from '../../lib/ui.js';

const POLL_MS = 5000;
const FINISHED = new Set(['delivered', 'rejected', 'failed']);

const word = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '');

// useDeliveries keeps an endpoint's newest deliveries fresh: it reads them now and again every few real seconds.
function useDeliveries(webhookId, limit, pollMs = POLL_MS) {
  const [items, setItems] = useState(null);
  const load = useCallback(async () => {
    const res = await api.get(`/api/webhooks/${webhookId}/deliveries?limit=${limit}`);
    if (res.ok) setItems(res.data.items);
  }, [webhookId, limit]);
  useEffect(() => {
    load();
    const poll = setInterval(load, pollMs);
    return () => clearInterval(poll);
  }, [load, pollMs]);
  return [items, load];
}

function attemptsOf(deliveries) {
  const all = deliveries.flatMap((delivery) => delivery.attempts.map((attempt) => ({ ...attempt, type: delivery.type, delivery: delivery.id })));
  return all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.attempt - a.attempt));
}

function Deliveries({ deliveries, onReplay, zone }) {
  if (!deliveries.length) return html`<${Empty}>Nothing has been sent yet.</${Empty}>`;
  return html`<div class="table-scroll" tabindex="0" role="region" aria-label="Deliveries table">
    <table aria-label="Deliveries">
      <thead><tr>
        <th scope="col">Event</th><th scope="col">Event id</th><th scope="col">Status</th>
        <th scope="col">Attempts</th><th scope="col">Next attempt</th><th scope="col">Action</th>
      </tr></thead>
      <tbody>${deliveries.map((delivery) => html`<tr key=${delivery.id}>
        <td data-label="Event">${delivery.type}</td>
        <td class="mono clip" data-label="Event id">${delivery.event_id}</td>
        <td data-label="Status"><${Tone} status=${word(delivery.status)} /></td>
        <td data-label="Attempts">${delivery.attempts.length}</td>
        <td data-label="Next attempt">${delivery.next_attempt_at && !FINISHED.has(delivery.status) ? fmtLocal(delivery.next_attempt_at, zone) : ''}</td>
        <td data-label="Action">${FINISHED.has(delivery.status)
          ? html`<${Button} class="secondary" onClick=${() => onReplay(delivery)}>Replay delivery</${Button}>`
          : null}</td>
      </tr>`)}</tbody>
    </table>
  </div>`;
}

function Attempts({ attempts, zone }) {
  if (!attempts.length) return html`<${Empty}>No attempts yet.</${Empty}>`;
  return html`<div class="table-scroll" tabindex="0" role="region" aria-label="Attempts table">
    <table aria-label="Attempts">
      <thead><tr>
        <th scope="col">Event</th><th scope="col">Attempt</th><th scope="col">Time</th>
        <th scope="col">Status code</th><th scope="col">Receiver answer</th><th scope="col">Outcome</th>
      </tr></thead>
      <tbody>${attempts.map((attempt) => html`<tr key=${`${attempt.delivery}-${attempt.attempt}`}>
        <td data-label="Event">${attempt.type}</td>
        <td data-label="Attempt">${attempt.attempt}</td>
        <td data-label="Time">${fmtLocal(attempt.at, zone)}</td>
        <td data-label="Status code">${attempt.status_code ?? 'None'}</td>
        <td class="mono answer" data-label="Receiver answer">${attempt.body ?? ''}</td>
        <td data-label="Outcome">${attempt.status_code === null ? 'Receiver unreachable' : word(attempt.outcome)}</td>
      </tr>`)}</tbody>
    </table>
  </div>`;
}

export function EndpointSection({ endpoint, services, limit, pollMs, titleLevel = 'h2', linked = true }) {
  const zone = boot.user.timezone;
  const [deliveries, reload] = useDeliveries(endpoint.id, limit, pollMs);
  const attempts = deliveries ? attemptsOf(deliveries) : [];
  const unreachable = attempts.length > 0 && attempts[0].status_code === null;

  const replay = async (delivery) => {
    const res = await api.post(`/api/webhook-deliveries/${delivery.id}/replay`);
    if (res.ok) live.announce('Replay queued under the same event id.');
    reload();
  };

  const scope = endpoint.service_ids.length
    ? endpoint.service_ids.map((id) => services.get(id) ?? id).join(', ')
    : 'All services';
  const Title = titleLevel;
  const Sub = titleLevel === 'h1' ? 'h2' : 'h3';

  return html`<section class="endpoint">
    <${Title}>${linked ? html`<a href=${`/webhooks/${endpoint.id}`}>${endpoint.name}</a>` : endpoint.name}</${Title}>
    <dl class="facts">
      <div><dt>Receiver path</dt><dd class="mono">${endpoint.path}</dd></div>
      <div><dt>Event types</dt><dd>${endpoint.event_types.join(', ')}</dd></div>
      <div><dt>Scope</dt><dd>${scope}</dd></div>
    </dl>
    ${unreachable ? html`<${Bar}>The receiver is unreachable. Attempts continue on the published schedule.</${Bar}>` : null}
    ${deliveries ? html`<${Sub} class="sub">Deliveries</${Sub}><${Deliveries} deliveries=${deliveries} onReplay=${replay} zone=${zone} />
      ${deliveries.length ? html`<${Sub} class="sub">Attempts</${Sub}><${Attempts} attempts=${attempts} zone=${zone} />` : null}` : null}
  </section>`;
}
