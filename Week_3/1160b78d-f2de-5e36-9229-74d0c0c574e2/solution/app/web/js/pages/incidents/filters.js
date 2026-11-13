// The two filters, and the saved filters of this person.
import { html, useState, useEffect, useRef } from '../../lib/html.js';
import { api, fieldErrors } from '../../lib/api.js';
import { live } from '../../lib/live.js';
import { Button, Problems, FieldError } from '../../lib/ui.js';
import { STATUS_OPTIONS, filterAddress } from './model.js';

export function Filters({ filter, services, onChange }) {
  return html`<div class="filters">
    <div class="field">
      <label for="status-filter">Status filter</label>
      <select id="status-filter" onChange=${(e) => onChange({ ...filter, status: e.target.value })}>
        ${STATUS_OPTIONS.map(([value, label]) => html`<option value=${value} selected=${value === filter.status}>${label}</option>`)}
      </select>
    </div>
    <div class="field">
      <label for="service-filter">Service filter</label>
      <select id="service-filter" onChange=${(e) => onChange({ ...filter, service: e.target.value })}>
        <option value="" selected=${!filter.service}>All services</option>
        ${services.map((s) => html`<option value=${s.id} selected=${s.id === filter.service}>${s.name}</option>`)}
      </select>
    </div>
  </div>`;
}

export function SavedFilters({ filter, onOpen }) {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [errors, setErrors] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get('/api/me/saved-filters').then((res) => {
      if (alive && res.ok) setItems(res.data.items);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const res = await api.post('/api/me/saved-filters', { name, status: filter.status, service_id: filter.service || null });
    if (!res.ok) {
      setErrors(fieldErrors(res) ?? { name: 'The filter could not be saved.' });
      return;
    }
    setErrors(null);
    setName('');
    setItems((now) => [...now, res.data]);
    live.announce('Filter saved.');
  };

  const remove = async (item, index) => {
    const res = await api.del(`/api/me/saved-filters/${item.id}`);
    if (!res.ok) return;
    setItems((now) => now.filter((f) => f.id !== item.id));
    const heir = document.querySelectorAll('.saved-filters li a')[index + 1] ?? input.current;
    heir.focus();
  };

  const go = (event, target) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen({ status: target.status, service: target.service_id ?? '' });
  };

  return html`<div class="saved">
    <form class="save-form" onSubmit=${save} noValidate>
      <${Problems} errors=${errors} />
      <div class="field">
        <label for="name">Filter name</label>
        <div class="inline">
          <input id="name" name="name" type="text" ref=${input} value=${name} autocomplete="off"
            onInput=${(e) => setName(e.target.value)} aria-describedby=${errors?.name ? 'name-error' : undefined} />
          <${Button} type="submit" class="tab-accent" onClick=${save}>Save filter</${Button}>
        </div>
        <${FieldError} errors=${errors} name="name" />
      </div>
    </form>
    <ul role="list" aria-label="Saved filters" class="saved-filters">
      ${items.map((item, index) => {
        const target = { status: item.status, service_id: item.service_id };
        return html`<li key=${item.id}>
          <a href=${filterAddress({ status: item.status, service: item.service_id ?? '' })} onClick=${(e) => go(e, target)}>${item.name}</a>
          <button type="button" class="secondary" aria-label=${`Remove ${item.name}`} onClick=${() => remove(item, index)}>Remove</button>
        </li>`;
      })}
    </ul>
  </div>`;
}
