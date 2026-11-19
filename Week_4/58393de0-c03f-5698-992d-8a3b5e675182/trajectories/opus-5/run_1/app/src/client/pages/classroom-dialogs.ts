import type { Classroom } from '../../shared/types.js';
import { UI_COPY } from '../../shared/copy.js';
import { api, type ApiFailure } from '../api.js';
import { el } from '../dom.js';
import { fieldError, openDialog } from '../dialog.js';
import { say } from '../status.js';
import { navigate } from '../router.js';

const FIELD_IDS: Record<string, string> = {
  name: 'classroom-name',
  timeZone: 'classroom-zone',
  joinOpensLocal: 'classroom-join-opens',
  joinClosesLocal: 'classroom-join-closes',
  handInLocal: 'classroom-hand-in',
};

const zoneOptions = (selected: string): HTMLSelectElement => {
  const select = el('select', { id: FIELD_IDS.timeZone, class: 'qy-input', 'aria-label': 'Time zone' });
  const zones = Intl.supportedValuesOf('timeZone')
    .filter((zone) => zone.includes('/'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  for (const zone of zones) {
    select.append(el('option', { value: zone, text: zone, selected: zone === selected }));
  }
  select.value = selected;
  return select;
};

const timeField = (label: string, id: string, placeholder: string, value = ''): HTMLElement => {
  const input = el('input', { id, class: 'qy-input', 'aria-label': label, placeholder, value, autocomplete: 'off' });
  return el('div', { class: 'qy-field' }, [el('label', { for: id, text: label }), input]);
};

const valueOf = (root: HTMLElement, id: string): string =>
  (root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '').trim().replace(' ', 'T');

/** A field error sits under its field and is announced in Status as well. */
const showFieldErrors = (panel: HTMLElement, failure: ApiFailure): void => {
  const announced: string[] = [];
  for (const [field, id] of Object.entries(FIELD_IDS)) {
    const input = panel.querySelector<HTMLElement>(`#${id}`);
    if (input) fieldError(input, null);
    const copy = failure.fields?.[field];
    if (input && copy) {
      fieldError(input, copy);
      announced.push(copy);
    }
  }
  for (const copy of announced) say(copy);
  if (announced.length === 0) say(failure.message);
};

/** The Create classroom dialog: name, zone, join window and hand-in time, all by keyboard. */
export const openCreateClassroom = (opener: HTMLElement, defaultZone: string): void => {
  const handle = openDialog({ label: 'Create classroom', opener }, (dialog) => {
    const form = el('form', { class: 'qy-form', novalidate: true });
    const nameInput = el('input', {
      id: FIELD_IDS.name,
      class: 'qy-input',
      'aria-label': 'Classroom name',
      autocomplete: 'off',
      required: true,
    });
    form.append(
      el('h2', { class: 'qy-dialog-heading', text: 'Create classroom' }),
      el('div', { class: 'qy-field' }, [el('label', { for: FIELD_IDS.name, text: 'Classroom name' }), nameInput]),
      el('div', { class: 'qy-field' }, [
        el('label', { for: FIELD_IDS.timeZone, text: 'Time zone' }),
        zoneOptions(defaultZone),
      ]),
      timeField('Join opens', FIELD_IDS.joinOpensLocal, 'Now'),
      timeField('Join closes', FIELD_IDS.joinClosesLocal, '14 days after Join opens'),
      timeField('Hand-in time', FIELD_IDS.handInLocal, '70 days after Join opens'),
      el('div', { class: 'qy-dialog-actions' }, [
        el('button', { type: 'submit', class: 'qy-pill qy-pill-solid', text: 'Save classroom' }),
        (() => {
          const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
          cancel.addEventListener('click', dialog.close);
          return cancel;
        })(),
      ]),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void (async () => {
        const panel = form.closest('.qy-dialog') as HTMLElement;
        const result = await api.createClassroom({
          name: nameInput.value,
          timeZone: valueOf(panel, FIELD_IDS.timeZone),
          joinOpensLocal: valueOf(panel, FIELD_IDS.joinOpensLocal),
          joinClosesLocal: valueOf(panel, FIELD_IDS.joinClosesLocal),
          handInLocal: valueOf(panel, FIELD_IDS.handInLocal),
        });
        if (!result.ok) {
          showFieldErrors(panel, result);
          return;
        }
        dialog.close();
        say(UI_COPY.classroomCreated(result.value.name));
        navigate(`/classrooms/${result.value.id}`);
      })();
    });
    return [form];
  });
  handle.panel.querySelector<HTMLInputElement>(`#${FIELD_IDS.name}`)?.focus();
};

/** The Classroom times dialog, prefilled with the stored local times. */
export const openClassroomTimes = (
  classroom: Classroom,
  opener: HTMLElement,
  onSaved: (updated: Classroom) => void,
): void => {
  openDialog({ label: 'Classroom times', opener }, (dialog) => {
    const form = el('form', { class: 'qy-form', novalidate: true });
    form.append(
      el('h2', { class: 'qy-dialog-heading', text: 'Classroom times' }),
      timeField('Join opens', FIELD_IDS.joinOpensLocal, 'Now', classroom.joinOpensLocal.replace('T', ' ')),
      timeField('Join closes', FIELD_IDS.joinClosesLocal, '14 days after Join opens', classroom.joinClosesLocal.replace('T', ' ')),
      timeField('Hand-in time', FIELD_IDS.handInLocal, '70 days after Join opens', classroom.handInLocal.replace('T', ' ')),
      el('div', { class: 'qy-dialog-actions' }, [
        el('button', { type: 'submit', class: 'qy-pill qy-pill-solid', text: 'Save classroom' }),
        (() => {
          const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
          cancel.addEventListener('click', dialog.close);
          return cancel;
        })(),
      ]),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void (async () => {
        const panel = form.closest('.qy-dialog') as HTMLElement;
        const result = await api.patchClassroom(classroom.id, {
          joinOpensLocal: valueOf(panel, FIELD_IDS.joinOpensLocal),
          joinClosesLocal: valueOf(panel, FIELD_IDS.joinClosesLocal),
          handInLocal: valueOf(panel, FIELD_IDS.handInLocal),
        });
        if (!result.ok) {
          showFieldErrors(panel, result);
          return;
        }
        dialog.close();
        onSaved(result.value);
      })();
    });
    return [form];
  });
};
