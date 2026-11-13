// /status-desk: the editor for status updates, then drafts and published updates.
import { html, useState, useEffect, useCallback } from '../lib/html.js';
import { useReveal } from '../lib/reveal.js';
import { api, fieldErrors, newKey } from '../lib/api.js';
import { boot } from '../lib/boot.js';
import { live } from '../lib/live.js';
import { fmtLocal } from '../lib/format.js';
import { Button, Bar, Empty, Problems, FieldError } from '../lib/ui.js';

const STATES = [['investigating', 'Investigating'], ['identified', 'Identified'], ['monitoring', 'Monitoring'], ['resolved', 'Resolved']];
const stateLabel = (state) => STATES.find(([value]) => value === state)?.[1] ?? state;
const SYSTEM_POLL_MS = 5000;
const BLANK = { id: null, title: '', body: '', state: 'investigating', service_ids: [] };

function Editor({ draft, setDraft, services, onSaved, onPublished }) {
  const [errors, setErrors] = useState(null);
  const change = (patch) => setDraft({ ...draft, ...patch });
  const payload = () => ({ title: draft.title, body: draft.body, state: draft.state, service_ids: draft.service_ids });

  // save stores the draft (POST for a new one, PUT after that) and returns the record, or null with the errors shown.
  const save = async () => {
    const res = draft.id ? await api.put(`/api/status-updates/${draft.id}`, payload()) : await api.post('/api/status-updates', payload());
    if (!res.ok) {
      setErrors(fieldErrors(res) ?? { title: 'This update is already published.' });
      return null;
    }
    setErrors(null);
    setDraft({ ...draft, id: res.data.id });
    return res.data;
  };

  const saveDraft = async () => {
    const record = await save();
    if (!record) return;
    live.announce('Saved.');
    onSaved();
  };

  const publish = async () => {
    const record = await save();
    if (!record) return;
    const res = await api.post(`/api/status-updates/${record.id}/publish`, {}, { idempotencyKey: newKey() });
    if (!res.ok) {
      setErrors({ title: 'This update is already published.' });
      return;
    }
    live.announce(`Published. Notices to ${res.data.subscribers} subscribers are on their way.`);
    setDraft(BLANK);
    onPublished();
  };

  const toggle = (id, on) => change({ service_ids: on ? [...draft.service_ids, id] : draft.service_ids.filter((item) => item !== id) });

  return html`<form class="editor" onSubmit=${(event) => event.preventDefault()} noValidate>
    <h2>${draft.id ? 'Edit draft' : 'New update'}</h2>
    <${Problems} errors=${errors} />
    <div class="field">
      <label for="title">Update title</label>
      <input id="title" type="text" value=${draft.title} onInput=${(event) => change({ title: event.target.value })} autocomplete="off" />
      <${FieldError} errors=${errors} name="title" />
    </div>
    <div class="field">
      <label for="body">Update body</label>
      <textarea id="body" rows="6" value=${draft.body} onInput=${(event) => change({ body: event.target.value })}></textarea>
      <${FieldError} errors=${errors} name="body" />
    </div>
    <div class="field state">
      <label for="state">Update state</label>
      <select id="state" value=${draft.state} onChange=${(event) => change({ state: event.target.value })}>
        ${STATES.map(([value, label]) => html`<option value=${value} selected=${draft.state === value}>${label}</option>`)}
      </select>
      <${FieldError} errors=${errors} name="state" />
    </div>
    <fieldset id="service_ids" tabindex="-1">
      <legend>Affected services</legend>
      ${services.map((service) => html`<label class="check" key=${service.id}>
        <input type="checkbox" checked=${draft.service_ids.includes(service.id)} onChange=${(event) => toggle(service.id, event.target.checked)} />
        <span>${service.name}</span>
      </label>`)}
      <${FieldError} errors=${errors} name="service_ids" />
    </fieldset>
    <div class="toolbar">
      <${Button} class="secondary" onClick=${saveDraft}>Save draft</${Button}>
      <${Button} class="tab-accent" onClick=${publish}>Publish update</${Button}>
      ${draft.id ? html`<button type="button" class="secondary" onClick=${() => setDraft(BLANK)}>Start a new update</button>` : null}
    </div>
  </form>`;
}

function UpdateItem({ update, services, zone, onEdit }) {
  const names = (update.service_ids ?? []).map((id) => services.get(id) ?? id);
  const where = update.services ?? names;
  return html`<li class="update">
    <div class="line">
      <h3>${update.title}</h3>
      <span class="state">${stateLabel(update.state)}</span>
    </div>
    <p class="body">${update.body}</p>
    <p class="meta">${where.length ? where.join(', ') : 'All services'}${update.published_at ? ` · Published ${fmtLocal(update.published_at, zone)}` : ''}</p>
    ${update.published_at ? null : html`<button type="button" class="secondary" onClick=${onEdit}>Edit ${update.title}</button>`}
  </li>`;
}

export default function StatusDesk() {
  const zone = boot.user.timezone;
  const [updates, setUpdates] = useState(null);
  const [queued, setQueued] = useState(0);
  const [services, setServices] = useState([]);
  const [mailDown, setMailDown] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [ready, loaded] = useReveal(1);

  const load = useCallback(async () => {
    const [list, all] = await Promise.all([api.get('/api/status-updates'), api.get('/api/services')]);
    if (list.ok) {
      setUpdates(list.data.items);
      setQueued(list.data.queued_notices ?? 0);
    }
    if (all.ok) setServices(all.data.items);
    loaded('first');
  }, []);

  const loadSystem = useCallback(async () => {
    const res = await api.get('/api/system');
    if (res.ok) setMailDown(res.data.mail === 'down');
  }, []);

  useEffect(() => {
    load();
    loadSystem();
    const off = live.on('status', load);
    const poll = setInterval(() => {
      loadSystem();
      load();
    }, SYSTEM_POLL_MS);
    return () => {
      off();
      clearInterval(poll);
    };
  }, []);

  const names = new Map(services.map((service) => [service.id, service.name]));
  const drafts = (updates ?? []).filter((update) => !update.published_at);
  const published = (updates ?? []).filter((update) => update.published_at);
  const edit = (update) => {
    setDraft({ id: update.id, title: update.title, body: update.body, state: update.state, service_ids: update.service_ids ?? [] });
    document.getElementById('title')?.focus();
  };

  return html`<div class=${ready ? 'statusdesk' : 'statusdesk pending'}>
    <h1>Status desk</h1>
    ${mailDown ? html`<${Bar}>Mail is unreachable. ${queued} subscriber notices are queued and will go out when it returns.</${Bar}>` : null}
    <div class="layout">
      <${Editor} draft=${draft} setDraft=${setDraft} services=${services} onSaved=${load} onPublished=${load} />
      <div class="lists">
        ${drafts.length ? html`<section class="block">
          <h2>Drafts</h2>
          <ul aria-label="Drafts">${drafts.map((update) => html`<${UpdateItem} key=${update.id} update=${update} services=${names} zone=${zone}
            onEdit=${() => edit(update)} />`)}</ul>
        </section>` : null}
        <section class="block">
          <h2>Published</h2>
          ${updates && !published.length ? html`<${Empty}>No updates published.</${Empty}>` : null}
          ${published.length ? html`<ul aria-label="Published updates">${published.map((update) => html`<${UpdateItem} key=${update.id} update=${update}
            services=${names} zone=${zone} />`)}</ul>` : null}
        </section>
      </div>
    </div>
  </div>`;
}
