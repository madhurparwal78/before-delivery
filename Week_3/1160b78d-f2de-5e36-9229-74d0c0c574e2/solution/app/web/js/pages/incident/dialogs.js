// The four dialogs of the incident page: snooze, reassign, merge and request a responder.
import { html, useState, useEffect, useRef } from '../../lib/html.js';
import { boot } from '../../lib/boot.js';
import { api, fieldErrors, newKey } from '../../lib/api.js';
import { live } from '../../lib/live.js';
import { instantFromLocal } from '../../lib/format.js';
import { Button, Problems, FieldError } from '../../lib/ui.js';
import { Sheet } from './sheet.js';
import { decisionSentence } from './store.js';
import { findIncidents } from './lookup.js';

const ZONE = boot.user.timezone;
const FORMAT_SENTENCE = 'Use the format YYYY-MM-DD HH:MM.';
const TRY_AGAIN = 'That did not work. Try again.';

// useSubmit runs one request per submit: a second press while the first is out does nothing.
function useSubmit(action) {
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    const slow = setTimeout(() => live.announce('Working on it.'), 1000);
    try {
      await action();
    } finally {
      clearTimeout(slow);
      guard.current = false;
      setBusy(false);
    }
  };
  return [busy, submit];
}

// People who are not stakeholders and the services, each alphabetical. The page reads them once on arrival, so a dialog
// opens with its choices already in place, and again each time a dialog opens, so they are never stale.
let known = { people: [], services: [], ready: false };

export async function readDirectory() {
  const [users, services] = await Promise.all([api.get('/api/users'), api.get('/api/services')]);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const people = users.ok ? users.data.items.filter((u) => u.role !== 'stakeholder').sort(byName) : [];
  const list = services.ok ? (services.data.items ?? services.data) : [];
  known = { people, services: [...list].sort(byName), ready: true };
  return known;
}

function useDirectory() {
  const [value, setValue] = useState(known);
  useEffect(() => {
    let alive = true;
    readDirectory().then((loaded) => {
      if (alive) setValue(loaded);
    });
    return () => { alive = false; };
  }, []);
  return value;
}

// Conflict is the common ending of a refused action: say who decided, refresh, close.
function refused(res, refresh, close) {
  const sentence = decisionSentence(res);
  live.announce(sentence ?? TRY_AGAIN);
  refresh();
  close();
}

export function SnoozeDialog({ incident, opener, close, adopt, refresh }) {
  const [choice, setChoice] = useState('1');
  const [until, setUntil] = useState('');
  const [errors, setErrors] = useState(null);
  const [busy, submit] = useSubmit(async () => {
    let body;
    if (choice === 'custom') {
      const instant = instantFromLocal(until, ZONE);
      if (!instant) {
        setErrors({ until: FORMAT_SENTENCE });
        return;
      }
      body = { until: instant };
    } else {
      body = { preset_hours: Number(choice) };
    }
    const res = await api.post(`/api/incidents/${incident.id}/snooze`, body);
    if (res.ok) {
      adopt(res.data);
      close();
    } else if (res.status === 422 && fieldErrors(res)) {
      setErrors(fieldErrors(res));
    } else {
      refused(res, refresh, close);
    }
  });
  const presets = [['1', '1 hour'], ['4', '4 hours'], ['8', '8 hours'], ['24', '24 hours'], ['custom', 'Custom time']];
  return html`<${Sheet} title="Snooze incident" opener=${opener} onClose=${close}>
    <form onSubmit=${submit} noValidate>
      <h2>Snooze incident</h2>
      <${Problems} errors=${errors} />
      <fieldset class="choices">
        <legend>Snooze for</legend>
        ${presets.map(([value, label]) => html`<label class="choice" key=${value}>
          <input type="radio" name="snooze" value=${value} checked=${choice === value} onChange=${() => setChoice(value)} />
          <span>${label}</span>
        </label>`)}
      </fieldset>
      <div class="field">
        <label for="until">Snooze until</label>
        <input id="until" name="until" type="text" autocomplete="off" placeholder="YYYY-MM-DD HH:MM" value=${until}
          aria-describedby=${errors?.until ? 'until-hint until-error' : 'until-hint'}
          onInput=${(e) => { setUntil(e.target.value); setChoice('custom'); }} />
        <p class="muted hint" id="until-hint">Typed in ${ZONE}.</p>
        <${FieldError} errors=${errors} name="until" />
      </div>
      <div class="toolbar">
        <${Button} type="submit" busy=${busy}>Snooze incident</${Button}>
        <button type="button" class="secondary" onClick=${close}>Cancel</button>
      </div>
    </form>
  </${Sheet}>`;
}

export function ReassignDialog({ incident, opener, close, adopt, refresh }) {
  const { people, services } = useDirectory();
  const [person, setPerson] = useState('');
  const [service, setService] = useState('');
  const [errors, setErrors] = useState(null);
  const [busy, submit] = useSubmit(async () => {
    const body = {};
    if (person) body.person_id = person;
    if (service) body.service_id = service;
    const res = await api.post(`/api/incidents/${incident.id}/reassign`, body);
    if (res.ok) {
      adopt(res.data);
      close();
    } else if (res.status === 422 && fieldErrors(res)) {
      setErrors(fieldErrors(res));
    } else {
      refused(res, refresh, close);
    }
  });
  return html`<${Sheet} title="Reassign incident" opener=${opener} onClose=${close}>
    <form onSubmit=${submit} noValidate>
      <h2>Reassign incident</h2>
      <${Problems} errors=${errors} />
      <div class="field">
        <label for="person_id">Person</label>
        <select id="person_id" name="person_id" value=${person} onChange=${(e) => setPerson(e.target.value)}>
          <option value="">Not chosen</option>
          ${people.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select>
        <${FieldError} errors=${errors} name="person_id" />
      </div>
      <div class="field">
        <label for="service_id">Service</label>
        <select id="service_id" name="service_id" value=${service} onChange=${(e) => setService(e.target.value)}>
          <option value="">Not chosen</option>
          ${services.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}
        </select>
        <${FieldError} errors=${errors} name="service_id" />
      </div>
      <div class="toolbar">
        <${Button} type="submit" busy=${busy}>Reassign incident</${Button}>
        <button type="button" class="secondary" onClick=${close}>Cancel</button>
      </div>
    </form>
  </${Sheet}>`;
}

const MERGE_REFUSALS = {
  merge_target_resolved: () => 'This incident is resolved, so nothing can merge into it.',
  merge_source_resolved: (body) => `Incident #${body.number} is resolved, so it cannot be merged.`,
};

export function MergeDialog({ incident, opener, close, adopt }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState(null);
  const [busy, submit] = useSubmit(async () => {
    const words = text.split(/[\s,]+/).filter(Boolean);
    if (!words.length || words.some((w) => !/^#?\d+$/.test(w))) {
      setErrors({ source_ids: 'Enter incident numbers separated by commas or spaces.' });
      return;
    }
    const numbers = [...new Set(words.map((w) => Number(w.replace('#', ''))))];
    const found = await findIncidents('open', numbers);
    const missing = numbers.find((n) => !found.has(n));
    if (missing !== undefined) {
      setErrors({ source_ids: `No open incident has the number ${missing}.` });
      return;
    }
    const res = await api.post(`/api/incidents/${incident.id}/merge`, { source_ids: numbers.map((n) => found.get(n)) },
      { idempotencyKey: newKey() });
    if (res.ok) {
      live.announce(`Merged ${numbers.length} incidents into #${res.data.number}.`);
      adopt(res.data);
      close();
      return;
    }
    const refusal = MERGE_REFUSALS[res.data?.error];
    setErrors(fieldErrors(res) ?? { source_ids: refusal ? refusal(res.data) : TRY_AGAIN });
  });
  return html`<${Sheet} title="Merge incidents" opener=${opener} onClose=${close}>
    <form onSubmit=${submit} noValidate>
      <h2>Merge incidents</h2>
      <${Problems} errors=${errors} />
      <div class="field">
        <label for="source_ids">Incident numbers</label>
        <input id="source_ids" name="source_ids" type="text" autocomplete="off" inputmode="numeric" value=${text}
          aria-describedby=${errors?.source_ids ? 'source_ids-hint source_ids-error' : 'source_ids-hint'} onInput=${(e) => setText(e.target.value)} />
        <p class="muted hint" id="source_ids-hint">Open incidents to fold into #${incident.number}, separated by commas or spaces.</p>
        <${FieldError} errors=${errors} name="source_ids" />
      </div>
      <div class="toolbar">
        <${Button} type="submit" busy=${busy}>Merge incidents</${Button}>
        <button type="button" class="secondary" onClick=${close}>Cancel</button>
      </div>
    </form>
  </${Sheet}>`;
}

export function ResponderDialog({ incident, opener, close, refresh }) {
  const { people, ready } = useDirectory();
  const taken = new Set([...incident.holders, ...incident.responders].map((p) => p.id));
  const options = people.filter((p) => !taken.has(p.id));
  const [person, setPerson] = useState('');
  const [errors, setErrors] = useState(null);
  const chosen = person || options[0]?.id || '';
  const [busy, submit] = useSubmit(async () => {
    const res = await api.post(`/api/incidents/${incident.id}/responder-requests`, { person_id: chosen });
    if (res.ok) {
      refresh();
      close();
    } else if (res.data?.error === 'already_responding') {
      setErrors({ person_id: 'This person is already responding.' });
    } else if (res.status === 422 && fieldErrors(res)) {
      setErrors(fieldErrors(res));
    } else {
      refused(res, refresh, close);
    }
  });
  return html`<${Sheet} title="Request responder" opener=${opener} onClose=${close}>
    <form onSubmit=${submit} noValidate>
      <h2>Request responder</h2>
      <${Problems} errors=${errors} />
      <div class="field">
        <label for="person_id">Responder</label>
        <select id="person_id" name="person_id" value=${chosen} onChange=${(e) => setPerson(e.target.value)}>
          ${options.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select>
        <${FieldError} errors=${errors} name="person_id" />
      </div>
      <div class="toolbar">
        ${ready && !options.length ? html`<button type="button" disabled>Send request</button>`
          : html`<${Button} type="submit" busy=${busy}>Send request</${Button}>`}
        <button type="button" class="secondary" onClick=${close}>Cancel</button>
      </div>
    </form>
  </${Sheet}>`;
}
