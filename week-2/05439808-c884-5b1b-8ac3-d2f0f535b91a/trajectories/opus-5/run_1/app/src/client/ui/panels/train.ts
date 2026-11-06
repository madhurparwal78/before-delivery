import { request } from '../../api.js';
import { noticeCopy, pendingCopy } from '../../copy.js';
import { button, el } from '../../dom.js';
import { amounts, localTime } from '../../format.js';
import { state } from '../../store.js';
import { UNITS } from '../../../shared/catalog.js';
import { UNIT_KEYS, type UnitKey } from '../../../shared/types.js';
import type { Army } from '../../apitypes.js';
import { run } from '../action.js';

export function trainPanel(handlers: { onChanged: () => void }): {
  node: HTMLElement;
  update: () => void;
} {
  let unit: UnitKey = 'saltjack';
  const count = el('input', {
    type: 'number',
    min: '1',
    max: '20',
    value: '1',
    'aria-label': 'Count',
    class: 'count-input'
  });

  const radios = UNIT_KEYS.map((key) => {
    const spec = UNITS[key];
    const radio = el('button', {
      type: 'button',
      role: 'radio',
      'aria-label': spec.name,
      'aria-checked': key === unit ? 'true' : 'false',
      class: 'radio'
    });
    radio.append(
      el('span', { text: spec.name }),
      el('span', {
        class: 'cost',
        text: ` · ${amounts(spec.cost)} · ${
          state.catalog?.units.find((entry) => entry.unit === key)?.trainSeconds ?? spec.trainSeconds
        } s`
      })
    );
    radio.addEventListener('click', () => {
      unit = key;
      for (const [index, other] of radios.entries()) {
        other.setAttribute('aria-checked', UNIT_KEYS[index] === unit ? 'true' : 'false');
      }
    });
    return radio;
  });

  const train = button('Train', { class: 'primary' });
  train.addEventListener('click', () => {
    void run({
      action: 'train',
      pending: pendingCopy.train,
      control: train,
      work: () =>
        request<{ army: Army }>('POST', '/api/army/train', {
          body: { unit, count: Number(count.value) }
        }),
      success: (result) => {
        const batch = result.army.training[result.army.training.length - 1];
        return noticeCopy.trainSuccess(
          Number(count.value),
          UNITS[unit].name,
          localTime(batch?.finishesAt ?? new Date().toISOString())
        );
      }
    }).then(handlers.onChanged);
  });

  const node = el(
    'aside',
    { role: 'complementary', 'aria-label': 'Train army', class: 'panel' },
    [
      el('h2', { text: 'Train army' }),
      el('div', { role: 'radiogroup', 'aria-label': 'Units', class: 'radio-group' }, radios),
      el('label', { class: 'count-label' }, ['Count', count]),
      train
    ]
  );

  return { node, update: () => undefined };
}
