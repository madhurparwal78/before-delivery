import type { QuotaCode, Station } from '../api';
import { h } from '../dom';
import { QUOTA_LABEL } from '../format';
import type { Screen, ScreenContext } from '../screen';

const QUOTAS: readonly QuotaCode[] = ['GN', 'TQ', 'LD', 'SS'];

export function stationSelect(
  label: string,
  stations: readonly Station[],
  selected: string,
  id: string,
): HTMLSelectElement {
  return h('select', { id }, [
    h('option', { value: '' }, [`Choose ${label}`]),
    ...stations.map((station) =>
      h('option', { value: station.code, selected: station.code === selected }, [
        `${station.code} ${station.name}`,
      ])),
  ]);
}

export function quotaRadios(
  selected: QuotaCode,
  onChange: (quota: QuotaCode) => void,
  idPrefix: string,
): HTMLElement {
  const row = h('div', { class: 'radio-row' });
  for (const quota of QUOTAS) {
    const id = `${idPrefix}-quota-${quota}`;
    const input = h('input', {
      type: 'radio',
      name: `${idPrefix}-quota`,
      id,
      value: quota,
      checked: quota === selected,
    });
    input.addEventListener('change', () => onChange(quota));
    row.appendChild(h('span', { class: 'radio' }, [
      input,
      h('label', { for: id }, [QUOTA_LABEL[quota]]),
    ]));
  }
  return h('fieldset', { role: 'radiogroup', 'aria-label': 'Quota' }, [
    h('legend', {}, ['Quota']),
    row,
  ]);
}

export async function renderSearch(context: ScreenContext): Promise<Screen> {
  const { main, state, router } = context;
  let quota: QuotaCode = 'GN';
  const from = stationSelect('From', state.stations, '', 'search-from');
  const to = stationSelect('To', state.stations, '', 'search-to');
  const date = h('input', { type: 'text', id: 'journey-date', placeholder: 'YYYY-MM-DD' });

  const form = h('form', { class: 'panel stack' }, [
    h('h1', {}, ['Search trains']),
    h('div', { class: 'field' }, [h('label', { for: 'search-from' }, ['From']), from]),
    h('div', { class: 'field' }, [h('label', { for: 'search-to' }, ['To']), to]),
    h('div', { class: 'field' }, [h('label', { for: 'journey-date' }, ['Journey date']), date]),
    quotaRadios('GN', (next) => {
      quota = next;
    }, 'search'),
    h('button', { type: 'submit', class: 'btn' }, ['Search trains']),
  ]);

  const updateRibbon = (): void => {
    const stops = [from, to]
      .map((select) => state.stations.find((station) => station.code === select.value))
      .filter((station): station is Station => station !== undefined)
      .map((station) => ({ code: station.code, name: station.name, time: null, emphasis: true }));
    context.setRibbon(stops);
  };
  from.addEventListener('change', updateRibbon);
  to.addEventListener('change', updateRibbon);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const params = new URLSearchParams({
      from: from.value,
      to: to.value,
      date: date.value,
      quota,
      class: 'SL',
    });
    router.go(`/trains?${params.toString()}`);
  });

  main.appendChild(form);
  return { ribbon: [] };
}
