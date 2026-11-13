import { el, announce } from '../dom.js';
import { api } from '../api.js';
import { state, renderHeader } from '../main.js';
import type { Profile } from '../apiTypes.js';
import { convertNumberToGrams } from '../../domain/weights.js';

/**
 * The Settings page: display name, display unit, base-weight goal with its
 * entry unit, time zone and paper size.
 */

export async function renderSettings(page: HTMLElement): Promise<void> {
  page.textContent = '';
  page.append(el('h1', { text: 'Settings' }));
  const profile = state.profile;
  if (profile === null) return;

  const name = el('input', { id: 'set-name', type: 'text', value: profile.displayName }) as HTMLInputElement;
  const unit = el('select', { id: 'set-unit' }) as HTMLSelectElement;
  for (const candidate of ['g', 'oz', 'lb'] as const) {
    const option = el('option', { value: candidate, text: candidate === 'g' ? 'Grams' : candidate === 'oz' ? 'Ounces' : 'Pounds and ounces' });
    if (profile.unit === candidate) option.setAttribute('selected', 'selected');
    unit.append(option);
  }
  // The goal always loads in whole grams with the entry unit set to g.
  const goal = el('input', { id: 'set-goal', type: 'number', min: '1', max: '50000', value: String(profile.goalGrams) }) as HTMLInputElement;
  const goalUnit = el('select', { id: 'set-goal-unit' }) as HTMLSelectElement;
  goalUnit.append(el('option', { value: 'g', text: 'g', selected: 'selected' }), el('option', { value: 'oz', text: 'oz' }));
  const timeZone = el('select', { id: 'set-timezone' }) as HTMLSelectElement;
  for (const zone of timeZoneOptions()) {
    const option = el('option', { value: zone, text: zone });
    if (profile.timeZone === zone) option.setAttribute('selected', 'selected');
    timeZone.append(option);
  }
  const paper = el('select', { id: 'set-paper' }) as HTMLSelectElement;
  for (const candidate of ['A4', 'Letter'] as const) {
    const option = el('option', { value: candidate, text: candidate });
    if (profile.paperSize === candidate) option.setAttribute('selected', 'selected');
    paper.append(option);
  }

  const save = el('button', { type: 'button', text: 'Save settings' });
  const addField = (labelText: string, control: HTMLElement, extra?: HTMLElement): void => {
    const wrap = el('div', { class: 'field' });
    wrap.append(el('label', { class: 'field-label', for: control.id, text: labelText }), control);
    if (extra !== undefined) wrap.append(extra);
    page.append(wrap);
  };
  addField('Display name', name);
  addField('Display unit', unit);
  addField('Base-weight goal', el('div', { class: 'mode-group' }, [goal, goalUnit]));
  addField('Time zone', timeZone);
  addField('Paper size', paper);
  page.append(save);

  save.addEventListener('click', () => {
    void (async () => {
      const grams = convertNumberToGrams(Number(goal.value), goalUnit.value === 'oz' ? 'oz' : 'g');
      const body: Record<string, unknown> = {
        displayName: name.value,
        unit: unit.value,
        goal: { value: Number(goal.value), unit: goalUnit.value },
        timeZone: timeZone.value,
        paperSize: paper.value,
      };
      const answer = await api.patch<{ profile: Profile }>('/api/profile', body);
      if (!answer.ok) {
        announce('Settings', answer.failure.fields !== undefined ? Object.values(answer.failure.fields)[0] ?? answer.failure.message : answer.failure.message);
        return;
      }
      state.profile = answer.body.profile;
      announce('Settings', 'Settings saved.');
      renderHeader();
      // Every weight on every page now uses the new unit, with no reload.
      await renderSettings(page);
    })();
  });
}

/** Every IANA zone name the runtime accepts. */
function timeZoneOptions(): string[] {
  const zones = (Intl.supportedValuesOf('timeZone') as string[]).slice().sort();
  return zones;
}
