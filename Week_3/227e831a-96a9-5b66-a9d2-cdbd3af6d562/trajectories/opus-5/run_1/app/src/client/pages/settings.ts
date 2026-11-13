import type { Profile } from '../../shared/types.js';
import { api } from '../api.js';
import type { AppContext } from '../app.js';
import { el } from '../dom.js';

const UNITS: Array<{ label: string; value: Profile['unit'] }> = [
  { label: 'Grams', value: 'g' },
  { label: 'Ounces', value: 'oz' },
  { label: 'Pounds and ounces', value: 'lb' },
];

function timeZones(): string[] {
  const supported = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = supported.supportedValuesOf?.('timeZone') ?? [];
  const extra = ['UTC', 'America/Denver', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
  return [...new Set([...extra, ...zones])].sort();
}

export function mountSettings(root: HTMLElement, context: AppContext): void {
  const profile = context.profile();
  const live = el('div', { class: 'live', role: 'status', 'aria-label': 'Settings' });
  const displayName = el('input', {
    type: 'text',
    id: 'display-name',
    class: 'field',
    value: profile.displayName,
  });
  const unitRadios = UNITS.map((unit) =>
    el('input', {
      type: 'radio',
      name: 'display-unit',
      id: `unit-${unit.value}`,
      value: unit.value,
      checked: profile.unit === unit.value,
    }),
  );
  const goal = el('input', {
    type: 'number',
    id: 'goal',
    class: 'field figure',
    min: '1',
    step: 'any',
    value: String(profile.goalGrams),
  });
  const goalUnits = (['g', 'oz'] as const).map((unit, index) =>
    el('input', {
      type: 'radio',
      name: 'goal-unit',
      id: `goal-unit-${unit}`,
      value: unit,
      checked: index === 0,
    }),
  );
  const zone = el(
    'select',
    { id: 'time-zone', class: 'field' },
    timeZones().map((name) =>
      el('option', { value: name, selected: name === profile.timeZone }, [name]),
    ),
  );
  const paperRadios = (['A4', 'Letter'] as const).map((size) =>
    el('input', {
      type: 'radio',
      name: 'paper-size',
      id: `paper-${size}`,
      value: size,
      checked: profile.paperSize === size,
    }),
  );
  const errors = el('p', { class: 'field-error' });

  const form = el('form', { class: 'gear-form settings-form' }, [
    el('div', { class: 'form-row' }, [
      el('label', { for: 'display-name' }, ['Display name']),
      displayName,
    ]),
    el('fieldset', { class: 'form-row' }, [
      el('legend', {}, ['Display unit']),
      ...UNITS.map((unit, index) =>
        el('label', { for: `unit-${unit.value}` }, [unitRadios[index] as HTMLElement, unit.label]),
      ),
    ]),
    el('div', { class: 'form-row' }, [
      el('label', { for: 'goal' }, ['Base-weight goal']),
      goal,
    ]),
    el('fieldset', { class: 'form-row' }, [
      el('legend', {}, ['Goal unit']),
      ...(['g', 'oz'] as const).map((unit, index) =>
        el('label', { for: `goal-unit-${unit}` }, [goalUnits[index] as HTMLElement, unit]),
      ),
    ]),
    el('div', { class: 'form-row' }, [el('label', { for: 'time-zone' }, ['Time zone']), zone]),
    el('fieldset', { class: 'form-row' }, [
      el('legend', {}, ['Paper size']),
      ...(['A4', 'Letter'] as const).map((size, index) =>
        el('label', { for: `paper-${size}` }, [paperRadios[index] as HTMLElement, size]),
      ),
    ]),
    errors,
    el('div', { class: 'form-actions' }, [
      el('button', { type: 'submit', class: 'primary' }, ['Save settings']),
    ]),
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errors.textContent = '';
    const body = {
      displayName: displayName.value,
      unit: unitRadios.find((radio) => radio.checked)?.value ?? 'g',
      goal: {
        value: Number(goal.value),
        unit: goalUnits.find((radio) => radio.checked)?.value ?? 'g',
      },
      timeZone: zone.value,
      paperSize: paperRadios.find((radio) => radio.checked)?.value ?? 'A4',
    };
    void api<{ profile: Profile }>('PATCH', '/api/profile', { body }).then((result) => {
      if (result.ok) {
        context.setProfile(result.data.profile);
        goal.value = String(result.data.profile.goalGrams);
        (goalUnits[0] as HTMLInputElement).checked = true;
        live.textContent = 'Settings saved.';
        return;
      }
      if (result.status === 401) {
        context.signedOut();
        return;
      }
      errors.textContent = Object.values(result.fields)[0] ?? result.message;
    });
  });

  root.append(
    el('div', { class: 'sheet' }, [el('h1', { tabindex: '-1' }, ['Settings']), live, form]),
  );
}
