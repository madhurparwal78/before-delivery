// /integrations/<id>: the live counter, the Retry-After countdown, the routing key, the event log and the dead letters.
import { html, useState, useEffect, useRef, useCallback } from '../lib/html.js';
import { api } from '../lib/api.js';
import { boot } from '../lib/boot.js';
import { live } from '../lib/live.js';
import { fmtLocal } from '../lib/format.js';
import { Bar, Empty } from '../lib/ui.js';
import { DeadLetters } from './integration/dead-letters.js';
import { OutcomeWord } from './integration/outcome.js';

const EVENT_PAGE = 50;
const SYSTEM_POLL_MS = 5000;
const REFETCH_DELAY_MS = 80;

function EventLog({ rows, more, onMore, zone }) {
  return html`<div class="table-scroll" tabindex="0" role="region" aria-label="Event log table">
    <table aria-label="Event log">
      <thead><tr>
        <th scope="col">Time</th><th scope="col">Action</th><th scope="col">Dedup key</th>
        <th scope="col">Outcome</th><th scope="col">Reason</th><th scope="col">Incident</th>
      </tr></thead>
      <tbody>${rows.map((row, index) => html`<tr key=${index}>
        <td data-label="Time">${fmtLocal(row.at, zone)}</td>
        <td data-label="Action">${row.action}</td>
        <td class="mono clip" data-label="Dedup key">${row.dedup_key ?? ''}</td>
        <td data-label="Outcome"><${OutcomeWord} outcome=${row.outcome} /></td>
        <td data-label="Reason">${row.reason ?? ''}</td>
        <td data-label="Incident">${row.incident_number ? `#${row.incident_number}` : ''}</td>
      </tr>`)}</tbody>
    </table>
    ${rows.length ? null : html`<${Empty}>No events yet.</${Empty}>`}
    ${more ? html`<div class="toolbar more"><button type="button" class="secondary" onClick=${onMore}>Older events</button></div>` : null}
  </div>`;
}

export default function Integration() {
  const id = boot.params.id;
  const zone = boot.user.timezone;
  const [record, setRecord] = useState(null);
  const [missing, setMissing] = useState(false);
  const [counter, setCounter] = useState(null);
  const [head, setHead] = useState({ items: [], next: null });
  const [older, setOlder] = useState({ items: [], next: undefined });
  const [letters, setLetters] = useState(null);
  const [queueDown, setQueueDown] = useState(false);
  const timer = useRef(null);
  const lettersTitle = useRef(null);

  const load = useCallback(async () => {
    const [found, events, dead] = await Promise.all([
      api.get(`/api/integrations/${id}`),
      api.get(`/api/integrations/${id}/events?limit=${EVENT_PAGE}`),
      api.get(`/api/dead-letters?integration_id=${id}`),
    ]);
    if (found.status === 404) {
      setMissing(true);
      return;
    }
    if (found.ok) {
      setRecord(found.data);
      setCounter(found.data.counter);
    }
    if (events.ok) setHead({ items: events.data.items, next: events.data.next_cursor });
    if (dead.ok) {
      setLetters(dead.data.items);
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && lettersTitle.current) lettersTitle.current.focus();
      });
    }
  }, [id]);

  const loadSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, REFETCH_DELAY_MS);
  }, [load]);

  const loadSystem = useCallback(async () => {
    const res = await api.get('/api/system');
    if (res.ok) setQueueDown(res.data.queue === 'down');
  }, []);

  useEffect(() => {
    load();
    loadSystem();
    live.watch('integration', id);
    const offEvent = live.on('integration', (data) => {
      if (!data.integration_id || data.integration_id === id) loadSoon();
      loadSystem();
    });
    const offCountdown = live.on('countdown', (data) => {
      if (data.scope === 'integration' && data.id === id) setCounter(data.countdown);
    });
    const poll = setInterval(loadSystem, SYSTEM_POLL_MS);
    return () => {
      offEvent();
      offCountdown();
      clearInterval(poll);
      clearTimeout(timer.current);
    };
  }, [id]);

  const loadOlder = async () => {
    const cursor = older.next === undefined ? head.next : older.next;
    const res = await api.get(`/api/integrations/${id}/events?limit=${EVENT_PAGE}&after=${encodeURIComponent(cursor)}`);
    if (res.ok) setOlder({ items: [...older.items, ...res.data.items], next: res.data.next_cursor });
  };

  if (missing) return html`<p class="sentence">We could not find that page.</p>`;
  if (!record) return html`<div class="integration"></div>`;

  const rows = [...head.items, ...older.items];
  const next = older.next === undefined ? head.next : older.next;
  const unavailable = counter && counter.count === null;
  const retry = counter ? counter.retry_after : null;

  return html`<div class="integration">
    ${queueDown ? html`<${Bar}>The queue is unreachable. New events are being refused.</${Bar}>` : null}
    <header class="head">
      <h1>${record.name}</h1>
      <p class="meta">
        <span class="muted">Routing key</span> <span class="mono key">${record.routing_key}</span>
        ${record.service_id ? html` <a href=${`/services/${record.service_id}`}>${record.service?.name ?? record.service_name ?? 'Service'}</a>` : null}
      </p>
    </header>

    <section class="counter" aria-label="Rate window">
      <div>
        <p class="figure-label">Events this minute</p>
        ${unavailable
          ? html`<${Bar}>Counter unavailable: events are accepted uncounted until it returns.</${Bar}>`
          : html`<p class="figure" role="status" aria-label="Events this minute">${counter ? `${counter.count} / ${counter.limit}` : ''}</p>`}
      </div>
      <div>
        <p class="figure-label">Retry-After</p>
        <p class="countdown" role="timer" aria-label="Retry-After countdown">${retry === null || retry === undefined ? 'Accepting events' : `${retry} s`}</p>
      </div>
    </section>

    <section class="block">
      <h2 tabindex="-1" ref=${lettersTitle}>Dead letters</h2>
      ${letters ? html`<${DeadLetters} items=${letters} onChanged=${load} />` : null}
    </section>

    <section class="block">
      <h2>Event log</h2>
      <${EventLog} rows=${rows} more=${Boolean(next)} onMore=${loadOlder} zone=${zone} />
    </section>
  </div>`;
}
