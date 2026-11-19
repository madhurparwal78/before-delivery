import type { RoutineDto } from '../../shared/types.js';
import { api, RequestFailed } from '../api.js';
import { announce, fieldError, loadMe, registerScreen, render, state } from '../app.js';
import { el, icon } from '../dom.js';
import { openDialog } from '../dialog.js';
import { numberField, pending, textField, timeZoneField } from '../forms.js';
import { dayLabel, todayInZone } from '../../shared/time.js';

const REPEAT_COPY: Record<RoutineDto['repeats'], string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
};

function daySettings(): HTMLElement {
  const member = state.me?.member;
  const zone = timeZoneField('Time zone', member?.timeZone);
  const thresholdField = numberField('Workload threshold (minutes)', {
    value: member?.thresholdMinutes ?? 360,
    min: 60,
    max: 960,
    step: 15,
  });
  const save = el('button', { type: 'submit', class: 'button button--primary' }, ['Save settings']);
  const form = el('form', { 'aria-label': 'Day settings', novalidate: true }, [
    zone.wrapper,
    thresholdField.wrapper,
    save,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    zone.showError(null);
    thresholdField.showError(null);
    pending(save, 'Saving…', 'Save settings');
    announce('Saving…');
    void api
      .updateMe({
        timeZone: zone.select.value,
        thresholdMinutes: Number(thresholdField.input.value),
      })
      .then(async (result) => {
        pending(save, null, 'Save settings');
        await loadMe();
        state.board = null;
        announce(
          `Settings saved. Today is ${dayLabel(todayInZone(result.member.timeZone))} in ${result.member.timeZone}.`,
        );
        void render();
      })
      .catch((error: unknown) => {
        pending(save, null, 'Save settings');
        zone.showError(fieldError(error, 'timeZone'));
        thresholdField.showError(fieldError(error, 'thresholdMinutes'));
        announce(error instanceof RequestFailed ? error.message : 'Check the highlighted fields.');
      });
  });

  return el('section', { class: 'section' }, [el('h2', { text: 'Day settings' }), form]);
}

function feedSection(url: string): HTMLElement {
  const field = textField('Feed URL', { value: url, readonly: true });
  const copy = el('button', { type: 'button', class: 'button', 'data-focus-key': 'copy-feed' }, [icon('copy'), 'Copy feed URL']);
  copy.setAttribute('aria-label', 'Copy feed URL');
  const rotate = el('button', { type: 'button', class: 'button', 'data-focus-key': 'rotate-feed' }, [icon('refresh-cw'), 'Rotate feed URL']);
  rotate.setAttribute('aria-label', 'Rotate feed URL');

  copy.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(field.input.value)
      .then(() => announce('Feed URL copied.'))
      .catch(() => announce('Couldn\u2019t copy. Select the URL and copy it yourself.'));
  });

  rotate.addEventListener('click', () => {
    const confirmButton = el('button', { type: 'button', class: 'button button--primary' }, ['Rotate']);
    const keep = el('button', { type: 'button', class: 'button' }, ['Keep current URL']);
    const handle = openDialog({
      label: 'Rotate feed URL?',
      role: 'alertdialog',
      heading: 'Rotate feed URL?',
      content: [el('p', { text: 'Calendar apps using the old URL will stop updating.' })],
      actions: [confirmButton, keep],
      opener: rotate,
    });
    keep.addEventListener('click', () => handle.close());
    confirmButton.addEventListener('click', () => {
      pending(confirmButton, 'Rotating…', 'Rotate');
      announce('Rotating…');
      void api
        .rotateFeed()
        .then((result) => {
          handle.close();
          field.input.value = result.url;
          announce('Feed URL rotated. The old URL has stopped working.');
        })
        .catch(() => {
          pending(confirmButton, null, 'Rotate');
          announce('Something went wrong on our side. Nothing was changed.');
        });
    });
  });

  return el(
    'section',
    { role: 'region', 'aria-label': 'Calendar feed', class: 'section' },
    [
      el('h2', { text: 'Calendar feed' }),
      el('div', { class: 'feed-row' }, [field.wrapper, copy, rotate]),
    ],
  );
}

function routinesSection(routines: RoutineDto[]): HTMLElement {
  const list = el('ul', { class: 'routine-list', role: 'list' });
  for (const routine of routines) {
    const remove = el('button', {
      type: 'button',
      class: 'button button--quiet',
      'aria-label': `Delete routine ${routine.name}`,
    });
    remove.append(icon('trash'));
    remove.addEventListener('click', () => {
      void api
        .deleteRoutine(routine.id)
        .then(() => {
          announce(`Deleted routine ${routine.name}.`);
          state.board = null;
          void render();
        })
        .catch(() => announce('Something went wrong on our side. Nothing was changed.'));
    });
    list.append(
      el('li', {}, [
        el('span', {
          text: `${routine.name} · ${routine.startTime} · ${routine.durationMinutes}m · ${REPEAT_COPY[routine.repeats]}`,
        }),
        remove,
      ]),
    );
  }

  const add = el('button', { type: 'button', class: 'button', 'data-focus-key': 'add-routine' }, [icon('plus'), 'Add routine']);
  add.setAttribute('aria-label', 'Add routine');
  add.addEventListener('click', () => openRoutineDialog(add));

  return el('section', { role: 'region', 'aria-label': 'Routines', class: 'section' }, [
    el('h2', { text: 'Routines' }),
    list,
    add,
  ]);
}

function openRoutineDialog(opener: HTMLElement): void {
  const name = textField('Name');
  const start = textField('Start time', { type: 'time', value: '08:30' });
  const minutes = numberField('Minutes', { value: 30, min: 5, max: 240, step: 5 });

  const repeats = el('div', { role: 'radiogroup', 'aria-label': 'Repeats', class: 'estimates' });
  const daily = el('input', { type: 'radio', name: 'repeats', 'aria-label': 'Every day', checked: true });
  const weekdays = el('input', { type: 'radio', name: 'repeats', 'aria-label': 'Weekdays' });
  repeats.append(
    el('label', {}, [daily, 'Every day']),
    el('label', {}, [weekdays, 'Weekdays']),
  );

  const save = el('button', { type: 'button', class: 'button button--primary' }, ['Save routine']);
  const cancel = el('button', { type: 'button', class: 'button' }, ['Cancel']);
  const handle = openDialog({
    label: 'Add routine',
    heading: 'Add routine',
    content: [name.wrapper, start.wrapper, minutes.wrapper, repeats],
    actions: [save, cancel],
    opener,
  });
  cancel.addEventListener('click', () => handle.close());

  save.addEventListener('click', () => {
    name.showError(null);
    pending(save, 'Saving…', 'Save routine');
    announce('Saving…');
    void api
      .addRoutine({
        name: name.input.value,
        startTime: start.input.value,
        durationMinutes: Number(minutes.input.value),
        repeats: weekdays.checked ? 'weekdays' : 'daily',
      })
      .then((result) => {
        handle.close();
        announce(`Added routine ${result.routine.name} at ${result.routine.startTime}.`);
        state.board = null;
        void render();
      })
      .catch((error: unknown) => {
        pending(save, null, 'Save routine');
        name.showError(fieldError(error, 'name'));
        start.showError(fieldError(error, 'startTime'));
        minutes.showError(fieldError(error, 'durationMinutes'));
        announce(error instanceof RequestFailed ? error.message : 'Check the highlighted fields.');
      });
  });
}

registerScreen('/settings', async (root) => {
  root.append(el('h2', { text: 'Settings' }));
  const [feed, routines] = await Promise.all([
    api.feed().catch(() => ({ url: '' })),
    api.routines().catch(() => ({ routines: [] as RoutineDto[] })),
  ]);
  root.append(daySettings(), feedSection(feed.url), routinesSection(routines.routines));
});
