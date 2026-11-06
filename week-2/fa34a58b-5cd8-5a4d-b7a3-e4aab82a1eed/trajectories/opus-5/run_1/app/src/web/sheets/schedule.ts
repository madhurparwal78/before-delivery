import { api, ApiFailure, HubUnreachable, HUB_UNREACHABLE_COPY } from '../api';
import { el, focusFirstIn, openSheet, svgIcon } from '../dom';
import { longDate } from '../format';
import type { Room, Scene, Schedule } from '../../shared/types';

interface EditorSlot {
  time: string;
  scene_id: string;
  room_ids: string[];
}

export function openScheduleEditor(options: {
  schedule: Schedule;
  today: string;
  rooms: Room[];
  scenes: Scene[];
  opener: HTMLElement;
  onSaved: () => void;
}): void {
  const { schedule, today, rooms, scenes, opener } = options;
  const name = `Edit ${schedule.name} schedule`;
  const sheet = openSheet({ name, opener, className: 'schedule-sheet' });
  if (sheet.body.childElementCount > 0) {
    focusFirstIn(sheet);
    return;
  }

  let revision = schedule.revision;
  let slots: EditorSlot[] = versionSlotsFor(schedule, today);

  const fromField = el('input', {
    type: 'date',
    class: 'control input num',
    id: 'schedule-from',
    'aria-label': 'From',
    value: today,
  }) as HTMLInputElement;
  const fromError = el('p', { class: 'field-error' });
  const slotsHost = el('div', { class: 'slots' });
  const slotsError = el('p', { class: 'field-error' });
  const statusLine = el('p', {
    class: 'status-line',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Schedule save',
    'data-schedule-status': '',
  });
  const alertSlot = el('div', { class: 'alert-slot' });
  const actions = el('div', { class: 'sheet-actions' });

  const addSlotButton = el('button', { type: 'button', class: 'control' }, [
    svgIcon('plus'),
    el('span', {}, ['Add slot']),
  ]);
  const saveButton = el('button', { type: 'button', class: 'control primary' }, [
    'Save schedule',
  ]);
  const closeButton = el('button', { type: 'button', class: 'control sheet-close' }, [
    svgIcon('x'),
    el('span', {}, ['Close']),
  ]);
  closeButton.addEventListener('click', () => sheet.close());

  sheet.body.replaceChildren(
    el('h2', { class: 'sheet-heading' }, [name]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'schedule-from' }, ['From']),
      fromField,
      fromError,
    ]),
    slotsHost,
    slotsError,
    el('div', { class: 'sheet-actions' }, [addSlotButton]),
    statusLine,
    alertSlot,
    actions,
    closeButton,
  );
  actions.append(saveButton);

  function paintSlots(errors: Record<string, string> = {}): void {
    slotsHost.replaceChildren(
      ...slots.map((slot, index) => {
        const position = index + 1;
        const time = el('input', {
          type: 'time',
          class: 'control input num',
          'aria-label': 'Time',
          value: slot.time,
        }) as HTMLInputElement;
        time.addEventListener('change', () => {
          slot.time = time.value;
        });

        const scenePicker = el('select', {
          class: 'control input',
          'aria-label': 'Scene',
        }) as HTMLSelectElement;
        scenePicker.append(el('option', { value: '' }, ['Choose a scene']));
        for (const scene of scenes) {
          const option = el('option', { value: scene.id }, [scene.name]);
          if (scene.id === slot.scene_id) option.setAttribute('selected', 'selected');
          scenePicker.append(option);
        }
        scenePicker.value = slot.scene_id;
        scenePicker.addEventListener('change', () => {
          slot.scene_id = scenePicker.value;
        });

        const roomBoxes = rooms.map((room) => {
          const box = el('input', {
            type: 'checkbox',
            class: 'control checkbox',
            'aria-label': room.name,
          }) as HTMLInputElement;
          box.checked = slot.room_ids.includes(room.id);
          box.addEventListener('change', () => {
            slot.room_ids = box.checked
              ? [...slot.room_ids, room.id]
              : slot.room_ids.filter((id) => id !== room.id);
          });
          return el('label', { class: 'room-check' }, [box, el('span', {}, [room.name])]);
        });

        const remove = el(
          'button',
          { type: 'button', class: 'control icon-button', 'aria-label': `Remove slot ${position}` },
          [svgIcon('trash-2')],
        );
        remove.addEventListener('click', () => {
          slots = slots.filter((candidate) => candidate !== slot);
          paintSlots();
        });

        return el('div', { class: 'slot', role: 'group', 'aria-label': `Slot ${position}` }, [
          el('p', { class: 'slot-number num', 'aria-hidden': 'true' }, [`Slot ${position}`]),
          el('div', { class: 'field' }, [time, errorNode(errors[`slots.${index}.time`])]),
          el('div', { class: 'field' }, [
            scenePicker,
            errorNode(errors[`slots.${index}.scene_id`]),
          ]),
          el('div', { class: 'room-checks' }, [
            ...roomBoxes,
            errorNode(errors[`slots.${index}.room_ids`]),
          ]),
          remove,
        ]);
      }),
    );
  }

  function errorNode(message: string | undefined): HTMLElement {
    return el('p', { class: 'field-error' }, message ? [message] : []);
  }

  addSlotButton.addEventListener('click', () => {
    slots = [...slots, { time: '', scene_id: '', room_ids: [] }];
    paintSlots();
  });

  saveButton.addEventListener('click', () => {
    statusLine.textContent = 'Saving schedule…';
    fromError.textContent = '';
    slotsError.textContent = '';
    alertSlot.replaceChildren();
    void api
      .put<{ schedule: Schedule }>(`/api/schedules/${schedule.id}`, {
        revision,
        from: fromField.value,
        slots: slots.map((slot) => ({
          time: slot.time,
          scene_id: slot.scene_id,
          room_ids: slot.room_ids,
        })),
      })
      .then((result) => {
        revision = result.schedule.revision;
        slots = versionSlotsFor(result.schedule, fromField.value);
        paintSlots();
        statusLine.textContent = `Saved. ${schedule.name} slots change from ${longDate(
          fromField.value,
        )}.`;
        options.onSaved();
      })
      .catch((error: unknown) => {
        if (error instanceof HubUnreachable) {
          statusLine.textContent = '';
          alertSlot.replaceChildren(
            el('p', { class: 'alert', role: 'alert' }, [HUB_UNREACHABLE_COPY]),
          );
          return;
        }
        if (!(error instanceof ApiFailure)) throw error;
        if (error.code === 'schedule_changed') {
          statusLine.textContent = '';
          showConflict(error.message);
          return;
        }
        statusLine.textContent = error.message;
        const fields = error.fields ?? {};
        if (fields['from']) fromError.textContent = fields['from'];
        if (fields['slots']) slotsError.textContent = fields['slots'];
        paintSlots(fields);
      });
  });

  function showConflict(message: string): void {
    const reload = el('button', { type: 'button', class: 'control' }, [
      svgIcon('rotate-cw'),
      el('span', {}, ['Reload schedule']),
    ]);
    reload.addEventListener('click', () => {
      void api.get<{ schedule: Schedule }>(`/api/schedules/${schedule.id}`).then((result) => {
        revision = result.schedule.revision;
        slots = versionSlotsFor(result.schedule, fromField.value);
        paintSlots();
        alertSlot.replaceChildren();
        statusLine.textContent = '';
      });
    });
    alertSlot.replaceChildren(
      el('p', { class: 'alert', role: 'alert' }, [message]),
      reload,
    );
  }

  paintSlots();
  focusFirstIn(sheet);
}

/** The slots of the version in force on a day. */
export function versionSlotsFor(schedule: Schedule, day: string): EditorSlot[] {
  let chosen: { from: string; slots: EditorSlot[] } | null = null;
  for (const version of schedule.versions) {
    if (version.from <= day && (!chosen || version.from > chosen.from)) {
      chosen = {
        from: version.from,
        slots: version.slots.map((slot) => ({
          time: slot.time,
          scene_id: slot.scene_id,
          room_ids: [...slot.room_ids],
        })),
      };
    }
  }
  return chosen ? chosen.slots : [];
}
