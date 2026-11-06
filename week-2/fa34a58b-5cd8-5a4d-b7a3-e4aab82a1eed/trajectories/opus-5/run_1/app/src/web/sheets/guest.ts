import { api, ApiFailure, HubUnreachable, HUB_UNREACHABLE_COPY } from '../api';
import { el, focusFirstIn, openSheet, svgIcon } from '../dom';
import { hhmm, longDate, dayOf } from '../format';
import { setRegion } from '../live';
import type { GuestScene, Room, Scene } from '../../shared/types';

export function openGuestSheet(options: {
  rooms: Room[];
  scenes: Scene[];
  opener: HTMLElement;
  onCreated: () => void;
}): void {
  const sheet = openSheet({ name: 'New guest scene', opener: options.opener, className: 'guest-sheet' });
  if (sheet.body.childElementCount > 0) {
    focusFirstIn(sheet);
    return;
  }

  const roomPicker = el('select', { class: 'control input', 'aria-label': 'Room' }) as HTMLSelectElement;
  for (const room of options.rooms) roomPicker.append(el('option', { value: room.id }, [room.name]));
  const roomError = el('p', { class: 'field-error' });

  const scenePicker = el('select', { class: 'control input', 'aria-label': 'Scene' }) as HTMLSelectElement;
  for (const scene of options.scenes) {
    scenePicker.append(el('option', { value: scene.id }, [scene.name]));
  }
  const sceneError = el('p', { class: 'field-error' });

  const starts = el('input', {
    type: 'datetime-local',
    class: 'control input num',
    'aria-label': 'Starts',
  }) as HTMLInputElement;
  const startsError = el('p', { class: 'field-error' });

  const ends = el('input', {
    type: 'datetime-local',
    class: 'control input num',
    'aria-label': 'Ends',
  }) as HTMLInputElement;
  const endsError = el('p', { class: 'field-error' });

  const statusLine = el('p', {
    class: 'status-line',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Guest scene',
  });
  const alertSlot = el('div', { class: 'alert-slot' });
  const submit = el('button', { type: 'button', class: 'control primary' }, ['Start guest scene']);
  const closeButton = el('button', { type: 'button', class: 'control sheet-close' }, [
    svgIcon('x'),
    el('span', {}, ['Close']),
  ]);
  closeButton.addEventListener('click', () => sheet.close());

  sheet.body.replaceChildren(
    el('h2', { class: 'sheet-heading' }, ['New guest scene']),
    el('div', { class: 'field' }, [el('p', { class: 'field-label' }, ['Room']), roomPicker, roomError]),
    el('div', { class: 'field' }, [el('p', { class: 'field-label' }, ['Scene']), scenePicker, sceneError]),
    el('div', { class: 'field' }, [
      el('p', { class: 'field-label' }, ['Starts (empty means now)']),
      starts,
      startsError,
    ]),
    el('div', { class: 'field' }, [el('p', { class: 'field-label' }, ['Ends']), ends, endsError]),
    statusLine,
    alertSlot,
    el('div', { class: 'sheet-actions' }, [submit]),
    closeButton,
  );

  submit.addEventListener('click', () => {
    roomError.textContent = '';
    sceneError.textContent = '';
    startsError.textContent = '';
    endsError.textContent = '';
    alertSlot.replaceChildren();
    statusLine.textContent = 'Starting guest scene…';
    void api
      .post<{ guest_scene: GuestScene }>(
        '/api/guest-scenes',
        {
          room_id: roomPicker.value,
          scene_id: scenePicker.value,
          starts_at: starts.value === '' ? null : starts.value.slice(0, 16),
          ends_at: ends.value.slice(0, 16),
        },
        { 'idempotency-key': crypto.randomUUID() },
      )
      .then((result) => {
        const roomName =
          options.rooms.find((room) => room.id === result.guest_scene.room_id)?.name ?? '';
        const copy =
          `Guest scene set for ${roomName} until ${hhmm(result.guest_scene.ends_at)} ` +
          `on ${longDate(dayOf(result.guest_scene.ends_at))}.`;
        statusLine.textContent = copy;
        setRegion('guest-scene', copy);
        options.onCreated();
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
        if (error.code === 'guest_overlap') {
          statusLine.textContent = '';
          alertSlot.replaceChildren(el('p', { class: 'alert', role: 'alert' }, [error.message]));
          return;
        }
        statusLine.textContent = error.message;
        const fields = error.fields ?? {};
        if (fields['room_id']) roomError.textContent = fields['room_id'];
        if (fields['scene_id']) sceneError.textContent = fields['scene_id'];
        if (fields['starts_at']) startsError.textContent = fields['starts_at'];
        if (fields['ends_at']) endsError.textContent = fields['ends_at'];
      });
  });

  focusFirstIn(sheet);
}
