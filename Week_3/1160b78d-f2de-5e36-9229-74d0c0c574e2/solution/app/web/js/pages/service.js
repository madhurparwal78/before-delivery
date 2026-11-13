import { html, useState, useEffect } from '../lib/html.js';
import { boot, me } from '../lib/boot.js';
import { api, fieldErrors } from '../lib/api.js';
import { live } from '../lib/live.js';
import { Button, Empty, Problems, FieldError, Tone } from '../lib/ui.js';
import { listAll, byName, canEditServices } from './service/data.js';

const STALE = 'Someone saved a newer version. Reload to see it.';
const NOT_FOUND = 'We could not find that page.';
const GROUPING = [['none', 'None'], ['window', 'Window'], ['until_resolved', 'Until resolved']];

const text = (value) => (value === null || value === undefined ? '' : String(value));
const minutes = (value) => (value.trim() === '' ? null : Number(value));

function Field({ id, label, errors, children }) {
  return html`<div class="field">
    <label for=${id}>${label}</label>
    ${children}
    <${FieldError} errors=${errors} name=${id} />
  </div>`;
}

function Form({ record, others, policies }) {
  const editable = canEditServices(me);
  const [form, setForm] = useState({
    name: record.name, team: record.team, policy_id: record.policy_id, depends_on: record.depends_on,
    grouping_mode: record.grouping_mode, grouping_minutes: text(record.grouping_minutes),
    ack_timeout_minutes: text(record.ack_timeout_minutes), auto_resolve_minutes: text(record.auto_resolve_minutes),
  });
  const [version, setVersion] = useState(record.version);
  const [errors, setErrors] = useState(null);
  const [adding, setAdding] = useState('');
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const names = new Map(others.map((s) => [s.id, s.name]));
  const choices = others.filter((s) => s.id !== record.id && !form.depends_on.includes(s.id));
  const windowed = form.grouping_mode === 'window';

  const save = async () => {
    const body = {
      name: form.name, team: form.team, policy_id: form.policy_id, depends_on: form.depends_on,
      grouping_mode: form.grouping_mode, grouping_minutes: windowed ? minutes(form.grouping_minutes) : null,
      ack_timeout_minutes: minutes(form.ack_timeout_minutes), auto_resolve_minutes: minutes(form.auto_resolve_minutes),
    };
    const res = await api.put('/api/services/' + record.id, body, { version });
    if (res.ok) {
      setErrors(null);
      setVersion(res.data.version);
      live.announce('Saved.');
    } else if (res.status === 412) {
      setErrors(null);
      live.announce(STALE);
    } else if (fieldErrors(res)) {
      setErrors(fieldErrors(res));
    }
  };

  return html`<form class="service-form" onSubmit=${(e) => e.preventDefault()} noValidate>
    <${Problems} errors=${errors} />
    <div class="form-grid">
      <${Field} id="name" label="Name" errors=${errors}>
        <input id="name" type="text" value=${form.name} readOnly=${!editable} onInput=${set('name')} />
      </${Field}>
      <${Field} id="team" label="Team" errors=${errors}>
        <input id="team" type="text" value=${form.team} readOnly=${!editable} onInput=${set('team')} />
      </${Field}>
      <${Field} id="policy_id" label="Policy" errors=${errors}>
        <select id="policy_id" value=${form.policy_id} disabled=${!editable} onChange=${set('policy_id')}>
          ${policies.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select>
      </${Field}>
      <${Field} id="grouping_mode" label="Grouping" errors=${errors}>
        <select id="grouping_mode" value=${form.grouping_mode} disabled=${!editable} onChange=${set('grouping_mode')}>
          ${GROUPING.map(([value, label]) => html`<option key=${value} value=${value}>${label}</option>`)}
        </select>
      </${Field}>
      <${Field} id="grouping_minutes" label="Grouping minutes" errors=${errors}>
        <input id="grouping_minutes" type="number" inputmode="numeric" min="1" max="1440" value=${windowed ? form.grouping_minutes : ''}
          readOnly=${!editable} disabled=${!windowed} onInput=${set('grouping_minutes')} />
      </${Field}>
      <${Field} id="ack_timeout_minutes" label="Acknowledge timeout in minutes" errors=${errors}>
        <input id="ack_timeout_minutes" type="number" inputmode="numeric" min="1" max="1440" value=${form.ack_timeout_minutes} placeholder="None"
          readOnly=${!editable} onInput=${set('ack_timeout_minutes')} />
      </${Field}>
      <${Field} id="auto_resolve_minutes" label="Auto-resolve after minutes" errors=${errors}>
        <input id="auto_resolve_minutes" type="number" inputmode="numeric" min="1" max="10080" value=${form.auto_resolve_minutes} placeholder="Never"
          readOnly=${!editable} onInput=${set('auto_resolve_minutes')} />
      </${Field}>
    </div>
    <fieldset class="depends" id="depends_on" tabindex="-1">
      <legend>Depends on</legend>
      ${form.depends_on.length === 0 && html`<p class="muted">Nothing.</p>`}
      <ul class="dependency-list">${form.depends_on.map((id) => html`<li key=${id} class="dependency">
        <span class="dependency-name">${names.get(id) ?? id}</span>
        ${editable && html`<button type="button" class="secondary" aria-label=${'Remove ' + (names.get(id) ?? id) + ' from dependencies'}
          onClick=${() => setForm({ ...form, depends_on: form.depends_on.filter((x) => x !== id) })}>Remove</button>`}
      </li>`)}</ul>
      ${editable && html`<div class="target-add">
        <select aria-label="Service to depend on" value=${adding} onChange=${(e) => setAdding(e.target.value)}>
          <option value="">Pick a service</option>
          ${choices.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}
        </select>
        <button type="button" class="secondary" onClick=${() => {
          if (!adding) return;
          setForm({ ...form, depends_on: [...form.depends_on, adding] });
          setAdding('');
        }}>Add dependency</button>
      </div>`}
      <${FieldError} errors=${errors} name="depends_on" />
    </fieldset>
    ${editable && html`<div class="toolbar"><${Button} class="tab-accent" onClick=${save}>Save service</${Button}></div>`}
  </form>`;
}

export default function Service() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    const load = async (first) => {
      const [res, services, policies] = await Promise.all([
        api.get('/api/services/' + boot.params.id), listAll('/api/services'), first ? listAll('/api/policies') : null,
      ]);
      if (!alive) return;
      if (!res.ok) {
        setState({ missing: true });
        return;
      }
      setState((old) => ({ ...old, loading: false, record: first ? res.data : old.record, shown: res.data,
        others: (services ?? []).sort(byName), policies: first ? (policies ?? []).sort(byName) : old.policies }));
    };
    load(true);
    const off = live.on('status', () => load(false));
    return () => { alive = false; off(); };
  }, []);

  if (state.loading) return html`<h1 class="page-label">Service</h1>`;
  if (state.missing) return html`<${Empty}>${NOT_FOUND}</${Empty}>`;
  const { record, shown, others, policies } = state;
  return html`<section class="service">
    <h1 class="page-label">${shown.name}</h1>
    <p class="figure status-figure"><${Tone} status=${shown.status} /></p>
    ${shown.own_status !== shown.status && html`<p class="own-status">${'Its own status is ' + shown.own_status + '.'}</p>`}
    <${Form} record=${record} others=${others} policies=${policies} />
  </section>`;
}
