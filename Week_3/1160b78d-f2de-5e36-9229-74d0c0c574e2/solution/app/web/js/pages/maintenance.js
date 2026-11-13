import { html, useState, useEffect } from '../lib/html.js';
import { me } from '../lib/boot.js';
import { api, fieldErrors } from '../lib/api.js';
import { live } from '../lib/live.js';
import { fmtLocal, instantFromLocal } from '../lib/format.js';
import { Button, Empty, Problems, FieldError, Tone } from '../lib/ui.js';
import { listAll, byName, windowState } from './service/data.js';

const BAD_FORMAT = 'Use the format YYYY-MM-DD HH:MM.';
const STATE_WORDS = { upcoming: 'Upcoming', running: 'Running', ended: 'Ended' };
const ORDER = { running: 0, upcoming: 1, ended: 2 };

function sortWindows(windows) {
  return [...windows].sort((a, b) => {
    const rank = ORDER[windowState(a)] - ORDER[windowState(b)];
    if (rank) return rank;
    const flip = windowState(a) === 'ended' ? -1 : 1;
    return flip * (Date.parse(a.starts_at) - Date.parse(b.starts_at));
  });
}

export default function Maintenance() {
  const [data, setData] = useState(null);
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [errors, setErrors] = useState(null);

  useEffect(() => {
    let latest = 0;
    const load = async () => {
      const mine = ++latest;
      const [services, windows] = await Promise.all([listAll('/api/services'), listAll('/api/maintenance-windows')]);
      if (mine !== latest || !services || !windows) return;
      const sorted = [...services].sort(byName);
      setData({ services: sorted, windows });
      setServiceId((current) => current || sorted[0]?.id || '');
    };
    load();
    const off = live.on('status', load);
    return () => {
      latest = Infinity;
      off();
    };
  }, []);

  const reload = async () => {
    const windows = await listAll('/api/maintenance-windows');
    if (windows) setData((old) => ({ ...old, windows }));
  };

  const add = async () => {
    const problems = {};
    const startsAt = instantFromLocal(starts, me.timezone);
    const endsAt = instantFromLocal(ends, me.timezone);
    if (!startsAt) problems.starts_at = BAD_FORMAT;
    if (!endsAt) problems.ends_at = BAD_FORMAT;
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }
    const res = await api.post('/api/maintenance-windows', { service_id: serviceId, starts_at: startsAt, ends_at: endsAt });
    if (res.ok) {
      setErrors(null);
      setStarts('');
      setEnds('');
      live.announce('Saved.');
      await reload();
    } else if (fieldErrors(res)) {
      setErrors(fieldErrors(res));
    }
  };

  const end = async (item) => {
    const res = await api.del('/api/maintenance-windows/' + item.id);
    if (res.ok) await reload();
  };

  if (!data) return html`<h1 class="page-label">Maintenance</h1>`;
  const names = new Map(data.services.map((s) => [s.id, s.name]));
  const windows = sortWindows(data.windows);
  const running = windows.filter((w) => windowState(w) === 'running').length;
  return html`<section class="maintenance">
    <h1 class="page-label">Maintenance</h1>
    <p class="figure">${running}</p>
    <p class="figure-label">Windows running now</p>
    <form class="window-form" onSubmit=${(e) => e.preventDefault()} noValidate>
      <${Problems} errors=${errors} />
      <div class="window-fields">
        <div class="field">
          <label for="starts_at">Starts</label>
          <input id="starts_at" type="text" placeholder="YYYY-MM-DD HH:MM" autocomplete="off" value=${starts}
            onInput=${(e) => setStarts(e.target.value)} />
          <${FieldError} errors=${errors} name="starts_at" />
        </div>
        <div class="field">
          <label for="ends_at">Ends</label>
          <input id="ends_at" type="text" placeholder="YYYY-MM-DD HH:MM" autocomplete="off" value=${ends}
            onInput=${(e) => setEnds(e.target.value)} />
          <${FieldError} errors=${errors} name="ends_at" />
        </div>
        <div class="field">
          <label for="service_id">Service</label>
          <select id="service_id" value=${serviceId} onChange=${(e) => setServiceId(e.target.value)}>
            ${data.services.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}
          </select>
          <${FieldError} errors=${errors} name="service_id" />
        </div>
        <div class="field add-field"><${Button} class="tab-accent" onClick=${add}>Add window</${Button}></div>
      </div>
    </form>
    ${windows.length === 0
      ? html`<${Empty}>No maintenance windows.</${Empty}>`
      : html`<ul class="window-rows" aria-label="Maintenance windows">${windows.map((w) => html`<li key=${w.id} class="window-row">
        <span class="window-service">${names.get(w.service_id) ?? w.service_id}</span>
        <span class="window-times">${fmtLocal(w.starts_at, me.timezone)} to ${fmtLocal(w.ends_at, me.timezone)}</span>
        <${Tone} status=${STATE_WORDS[windowState(w)]} />
        ${windowState(w) !== 'ended' && html`<${Button} class="secondary"
          aria-label=${(windowState(w) === 'running' ? 'End window for ' : 'Remove window for ') + (names.get(w.service_id) ?? w.service_id)}
          onClick=${() => end(w)}>${windowState(w) === 'running' ? 'End window' : 'Remove window'}</${Button}>`}
      </li>`)}</ul>`}
  </section>`;
}
