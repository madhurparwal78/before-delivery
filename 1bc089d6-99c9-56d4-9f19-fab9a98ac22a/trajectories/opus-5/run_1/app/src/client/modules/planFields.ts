import { countCharacters, startsAtLocal, type PlanRitual } from '../../shared/plan.js';
import {
  FIELD_LABELS,
  FIELD_MESSAGES,
  isKnownTimeZone,
  isValidBedtime,
  isValidEmail,
  isValidNote,
  readRituals,
} from '../../shared/planRules.js';
import { MAX_NOTE_CHARACTERS } from '../../shared/rituals.js';
import { create, two } from './dom.js';
import { catalogue, chosenRituals, isChosen, minutesFor, removeRitual, addRitual, setMinutes } from './store.js';

export interface PlanFieldRefs {
  form: HTMLFormElement;
  alertHost: HTMLElement;
  email?: HTMLInputElement;
  bedtime: HTMLSelectElement;
  zone: HTMLSelectElement;
  note: HTMLTextAreaElement;
  noteCounter: HTMLElement;
  ritualHost: HTMLElement;
  errors: Record<string, HTMLElement>;
  summaryHour: HTMLElement;
  summaryTotal: HTMLElement;
  headingLevel: 'h2' | 'h3';
}

export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function fillBedtimes(select: HTMLSelectElement, initial: string): void {
  const fragment = document.createDocumentFragment();
  for (let minute = 0; minute < 24 * 60; minute += 5) {
    const value = `${two(Math.floor(minute / 60))}:${two(minute % 60)}`;
    fragment.append(create('option', { value }, value));
  }
  select.replaceChildren(fragment);
  select.value = initial;
}

export function fillZones(select: HTMLSelectElement, initial: string): void {
  const names = new Set<string>(['UTC']);
  for (const zone of Intl.supportedValuesOf('timeZone')) names.add(zone);
  names.add(browserZone());
  names.add(initial);
  const fragment = document.createDocumentFragment();
  for (const zone of [...names].sort()) fragment.append(create('option', { value: zone }, zone));
  select.replaceChildren(fragment);
  select.value = initial;
}

export interface RitualRow {
  checkbox: HTMLInputElement;
  minutes: HTMLInputElement;
}

/** One checkbox and one minutes spinbutton per catalogue ritual. */
export function buildRitualRows(
  host: HTMLElement,
  idPrefix: string,
  onRefused?: (id: string) => void,
): Map<string, RitualRow> {
  const rows = new Map<string, RitualRow>();
  for (const ritual of catalogue) {
    const row = create('div', { class: 'ritual-row' });
    const label = create('label', { for: `${idPrefix}-${ritual.id}` });
    const checkbox = create('input', {
      type: 'checkbox',
      id: `${idPrefix}-${ritual.id}`,
      value: ritual.id,
    }) as HTMLInputElement;
    label.append(checkbox, create('span', {}, ritual.title));
    const minutes = create('input', {
      type: 'number',
      min: '5',
      max: '30',
      step: '5',
      'aria-label': `${ritual.title} minutes`,
      id: `${idPrefix}-${ritual.id}-minutes`,
    }) as HTMLInputElement;
    minutes.value = String(ritual.defaultMinutes);
    minutes.disabled = true;
    row.append(label, minutes);
    host.append(row);

    checkbox.addEventListener('change', () => {
      if (!checkbox.checked) {
        removeRitual(ritual.id);
        return;
      }
      if (!addRitual(ritual.id)) {
        checkbox.checked = false;
        onRefused?.(ritual.id);
      }
    });
    minutes.addEventListener('change', () => {
      if (setMinutes(ritual.id, Number(minutes.value))) return;
      minutes.value = String(minutesFor(ritual.id));
      onRefused?.(ritual.id);
    });
    rows.set(ritual.id, { checkbox, minutes });
  }
  return rows;
}

export function syncRitualRows(rows: Map<string, RitualRow>): void {
  for (const [id, row] of rows) {
    const chosen = isChosen(id);
    row.checkbox.checked = chosen;
    row.minutes.disabled = !chosen;
    row.minutes.value = String(minutesFor(id));
  }
}

export const noteCounterText = (note: string): string =>
  `${countCharacters(note)} of ${MAX_NOTE_CHARACTERS} characters`;

export const summaryHourText = (bedtime: string, zone: string): string =>
  `Your hour starts at ${startsAtLocal(bedtime)} and ends at ${bedtime}, ${zone} time.`;

export const summaryTotalText = (total: number): string => `${total} of 60 minutes planned.`;

export function refreshSummary(refs: PlanFieldRefs): void {
  const total = chosenRituals().reduce((sum, ritual) => sum + ritual.minutes, 0);
  refs.summaryHour.textContent = summaryHourText(refs.bedtime.value, refs.zone.value);
  refs.summaryTotal.textContent = summaryTotalText(total);
  refs.noteCounter.textContent = noteCounterText(refs.note.value);
}

export interface PlanDraft {
  email?: string;
  bedtime: string;
  time_zone: string;
  rituals: { id: string; minutes: number }[];
  note: string;
}

export function readDraft(refs: PlanFieldRefs): PlanDraft {
  const draft: PlanDraft = {
    bedtime: refs.bedtime.value,
    time_zone: refs.zone.value,
    rituals: chosenRituals(),
    note: refs.note.value,
  };
  if (refs.email) draft.email = refs.email.value.trim();
  return draft;
}

/** Checks the named keys against the plan rules before anything is sent. */
export function checkDraft(draft: PlanDraft, keys: (keyof PlanDraft)[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of keys) {
    if (key === 'email' && !isValidEmail(draft.email)) fields['email'] = FIELD_MESSAGES.email;
    if (key === 'bedtime' && !isValidBedtime(draft.bedtime)) fields['bedtime'] = FIELD_MESSAGES.bedtime;
    if (key === 'time_zone' && !isKnownTimeZone(draft.time_zone)) fields['time_zone'] = FIELD_MESSAGES.time_zone;
    if (key === 'rituals' && readRituals(draft.rituals) === null) fields['rituals'] = FIELD_MESSAGES.rituals;
    if (key === 'note' && !isValidNote(draft.note)) fields['note'] = FIELD_MESSAGES.note;
  }
  return fields;
}

const controlFor = (refs: PlanFieldRefs, key: string): HTMLElement | undefined => {
  if (key === 'email') return refs.email;
  if (key === 'bedtime') return refs.bedtime;
  if (key === 'time_zone') return refs.zone;
  if (key === 'note') return refs.note;
  if (key === 'rituals') return refs.ritualHost.querySelector('input[type="checkbox"]') as HTMLElement | null ?? undefined;
  return undefined;
};

export function clearFieldErrors(refs: PlanFieldRefs): void {
  refs.alertHost.replaceChildren();
  for (const [key, host] of Object.entries(refs.errors)) {
    host.textContent = '';
    const control = controlFor(refs, key);
    control?.removeAttribute('aria-invalid');
    control?.removeAttribute('aria-describedby');
  }
}

/** Shows the error summary and each field's own message, and takes focus. */
export function showFieldErrors(refs: PlanFieldRefs, fields: Record<string, string>): void {
  clearFieldErrors(refs);
  const alert = create('div', { class: 'alert', role: 'alert', tabindex: '-1' });
  alert.append(create(refs.headingLevel, {}, 'Check your hour'));
  const list = create('ul', {});
  for (const [key, message] of Object.entries(fields)) {
    const control = controlFor(refs, key);
    const item = create('li', {});
    const link = create('a', { href: `#${control?.id ?? ''}` }, FIELD_LABELS[key] ?? key);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      control?.focus();
    });
    item.append(link, create('span', {}, `: ${message}`));
    list.append(item);
    const host = refs.errors[key];
    if (host) {
      host.textContent = message;
      control?.setAttribute('aria-invalid', 'true');
      if (host.id) control?.setAttribute('aria-describedby', host.id);
    }
  }
  alert.append(list);
  refs.alertHost.replaceChildren(alert);
  alert.focus();
}

export function planRitualList(rituals: PlanRitual[]): { id: string; minutes: number }[] {
  return rituals.map((ritual) => ({ id: ritual.id, minutes: ritual.minutes }));
}
