import { request } from '../../api.js';
import { noticeCopy, pendingCopy } from '../../copy.js';
import { button, el, field } from '../../dom.js';
import { setDisplayZone } from '../../format.js';
import { refreshRewards, state } from '../../store.js';
import type { Me } from '../../apitypes.js';
import { run } from '../action.js';

function zoneOptions(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  const zones = supported ? supported('timeZone') : [];
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

export function timeZoneSelect(selected: string): HTMLSelectElement {
  const select = el('select', { 'aria-label': 'Time zone', class: 'zone-select' });
  for (const zone of zoneOptions()) {
    select.append(el('option', { value: zone, text: zone, selected: zone === selected }));
  }
  if (select.value !== selected) {
    select.append(el('option', { value: selected, text: selected, selected: true }));
    select.value = selected;
  }
  return select;
}

export function profilePanel(handlers: { onChanged: () => void }): {
  node: HTMLElement;
  update: () => void;
} {
  const displayName = field('Display name');
  displayName.input.value = state.user?.displayName ?? '';
  const zone = timeZoneSelect(state.user?.timeZone ?? 'UTC');
  const save = button('Save profile', { class: 'primary' });

  save.addEventListener('click', () => {
    void run({
      action: 'profile',
      pending: pendingCopy.profile,
      control: save,
      fields: { displayName },
      work: () =>
        request<Me>('PATCH', '/api/me', {
          body: { displayName: displayName.input.value, timeZone: zone.value }
        }),
      success: () => noticeCopy.profileSuccess
    }).then(async (result) => {
      if (result === null) return;
      state.user = result;
      setDisplayZone(result.timeZone);
      await refreshRewards();
      handlers.onChanged();
    });
  });

  const node = el('aside', { role: 'complementary', 'aria-label': 'Profile', class: 'panel' }, [
    el('h2', { text: 'Profile' }),
    displayName.wrapper,
    el('label', { class: 'zone-label' }, ['Time zone', zone]),
    save
  ]);

  return { node, update: () => undefined };
}
