// /webhooks: add an endpoint (admin), then each endpoint with its deliveries and attempts.
import { html, useState, useEffect, useCallback } from '../lib/html.js';
import { api, fieldErrors } from '../lib/api.js';
import { Button, Bar, Empty, Problems, FieldError } from '../lib/ui.js';
import { EndpointSection } from './webhook/section.js';

const EVENT_TYPES = [
  'incident.triggered', 'incident.acknowledged', 'incident.snoozed', 'incident.unacknowledged',
  'incident.escalated', 'incident.reassigned', 'incident.merged', 'incident.resolved',
];
const LIST_DELIVERIES = 5;
const LIST_POLL_MS = 15000;

function toggled(list, value, on) {
  return on ? [...list, value] : list.filter((item) => item !== value);
}

function AddEndpoint({ services, onAdded }) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [types, setTypes] = useState(EVENT_TYPES);
  const [scope, setScope] = useState([]);
  const [errors, setErrors] = useState(null);

  const add = async () => {
    const res = await api.post('/api/webhooks', { name: name.trim(), path: path.trim(), event_types: types, service_ids: scope });
    if (!res.ok) {
      setErrors(fieldErrors(res) ?? { name: 'The endpoint could not be added.' });
      return;
    }
    setErrors(null);
    setName('');
    setPath('');
    onAdded(res.data);
  };

  return html`<form class="add" onSubmit=${(event) => event.preventDefault()} noValidate>
    <h2>Add an endpoint</h2>
    <${Problems} errors=${errors} />
    <div class="row">
      <div class="field">
        <label for="name">Endpoint name</label>
        <input id="name" type="text" value=${name} onInput=${(event) => setName(event.target.value)} autocomplete="off" />
        <${FieldError} errors=${errors} name="name" />
      </div>
      <div class="field">
        <label for="path">Receiver path</label>
        <input id="path" type="text" value=${path} onInput=${(event) => setPath(event.target.value)} autocomplete="off" spellcheck="false" />
        <${FieldError} errors=${errors} name="path" />
      </div>
    </div>
    <div class="row">
      <fieldset id="event_types" tabindex="-1">
        <legend>Event types</legend>
        ${EVENT_TYPES.map((type) => html`<label class="check" key=${type}>
          <input type="checkbox" checked=${types.includes(type)} onChange=${(event) => setTypes(toggled(types, type, event.target.checked))} />
          <span>${type}</span>
        </label>`)}
        <${FieldError} errors=${errors} name="event_types" />
      </fieldset>
      <fieldset id="service_ids" tabindex="-1">
        <legend>Scope</legend>
        ${services.map((service) => html`<label class="check" key=${service.id}>
          <input type="checkbox" checked=${scope.includes(service.id)} onChange=${(event) => setScope(toggled(scope, service.id, event.target.checked))} />
          <span>${service.name}</span>
        </label>`)}
        <p class="hint">No service ticked sends events for all services.</p>
        <${FieldError} errors=${errors} name="service_ids" />
      </fieldset>
    </div>
    <div class="toolbar"><${Button} type="submit" onClick=${add}>Add endpoint</${Button}></div>
  </form>`;
}

export default function Webhooks() {
  const [endpoints, setEndpoints] = useState(null);
  const [services, setServices] = useState([]);
  const [secret, setSecret] = useState(null);

  const load = useCallback(async () => {
    const [list, all] = await Promise.all([api.get('/api/webhooks'), api.get('/api/services')]);
    if (list.ok) setEndpoints(list.data.items);
    if (all.ok) setServices(all.data.items);
  }, []);
  useEffect(() => {
    load();
  }, []);

  const names = new Map(services.map((service) => [service.id, service.name]));
  const added = async (created) => {
    setSecret({ name: created.name, value: created.secret });
    await load();
  };

  return html`<div class="webhooks">
    <h1>Webhooks</h1>
    ${secret ? html`<${Bar}>
      <span>Signing secret for ${secret.name}: <code class="secret">${secret.value}</code>. It is shown once and cannot be read again.</span>
      <button type="button" class="secondary hide" onClick=${() => setSecret(null)}>Hide secret</button>
    </${Bar}>` : null}
    <${AddEndpoint} services=${services} onAdded=${added} />
    <div class="endpoints">
      ${endpoints && !endpoints.length ? html`<${Empty}>No endpoints yet.</${Empty}>` : null}
      ${(endpoints ?? []).map((endpoint) => html`<${EndpointSection} key=${endpoint.id} endpoint=${endpoint} services=${names}
        limit=${LIST_DELIVERIES} pollMs=${LIST_POLL_MS} />`)}
    </div>
  </div>`;
}
