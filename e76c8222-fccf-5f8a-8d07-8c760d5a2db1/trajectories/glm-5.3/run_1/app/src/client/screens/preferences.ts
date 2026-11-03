import { api, isFailure } from '../lib/api.js';
import { h, clear, statusRegion } from '../lib/dom.js';
import { copy } from '../lib/copy.js';

export async function renderPreferences(): Promise<HTMLElement> {
  const wrap = h('div', { class: 'column' });
  wrap.appendChild(h('h1', {}, 'Interpreter preferences'));
  const status = statusRegion('Preferences status');
  const radios: Array<{ interpreterId: string; group: HTMLElement; getValue: () => string }> = [];

  let data: { preferred: string[]; blocked: string[]; interpreters: Array<{ id: string; name: string }> };
  try {
    data = await api.get<{ preferred: string[]; blocked: string[]; interpreters: Array<{ id: string; name: string }> }>('/consumers/me/preferences');
  } catch {
    wrap.appendChild(h('p', { class: 'muted' }, 'Could not load preferences.'));
    return wrap;
  }

  const table = h('table', { class: 'data', 'aria-label': 'Interpreter preferences' });
  table.appendChild(h('thead', {}, h('tr', {}, h('th', {}, 'Interpreter'), h('th', {}, 'Preference'))));
  const tbody = h('tbody', {});

  for (const interp of data.interpreters) {
    const initial = data.blocked.includes(interp.id) ? 'blocked' : data.preferred.includes(interp.id) ? 'preferred' : 'none';
    const group = h('div', { role: 'radiogroup', 'aria-label': interp.name, class: 'pref-group', style: 'display:flex;gap:12px;align-items:center' });
    const make = (value: 'preferred' | 'none' | 'blocked', label: string) => {
      const input = h('input', {
        type: 'radio',
        name: `pref-${interp.id}`,
        value,
        checked: initial === value ? true : null,
      });
      const labelEl = h('label', { style: 'display:inline-flex;gap:6px;align-items:center;margin:0;font-weight:400' }, input, label);
      group.appendChild(labelEl);
      return input;
    };
    make('preferred', 'Preferred');
    make('none', 'No preference');
    make('blocked', 'Blocked');
    radios.push({
      interpreterId: interp.id,
      group,
      getValue: () => (group.querySelector('input:checked') as HTMLInputElement | null)?.value ?? 'none',
    });
    tbody.appendChild(h('tr', {},
      h('td', { 'data-label': 'Interpreter' }, interp.name),
      h('td', { 'data-label': 'Preference' }, group),
    ));
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  const save = h('button', { class: 'primary', onclick: async () => {
    const preferred = radios.filter((r) => r.getValue() === 'preferred').map((r) => r.interpreterId);
    const blocked = radios.filter((r) => r.getValue() === 'blocked').map((r) => r.interpreterId);
    status.set(copy.preferences.pending, 'pending');
    try {
      await api.put('/consumers/me/preferences', { preferred, blocked });
      status.set(copy.preferences.success, undefined);
    } catch (err) {
      if (isFailure(err) && err.code === 'validation') status.set(copy.preferences.validation, 'error');
      else if (isFailure(err)) status.set(err.message, 'error');
    }
  } }, 'Save preferences');
  wrap.appendChild(h('div', { class: 'btn-row' }, save));
  wrap.appendChild(status.el);
  return wrap;
}
