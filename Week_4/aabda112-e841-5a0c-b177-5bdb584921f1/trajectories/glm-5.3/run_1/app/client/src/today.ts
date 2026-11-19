import { el, bannerAlert, openDialog, errorSummary, inlineError } from './ui.js';
import { get, post, patch, del, clinicTime, STATUS_LABELS, SPECIES_LABELS, initials, ApiRequestFailed } from './api.js';
import { renderSplitBand, renderBeacons } from './shell.js';
import { announcer, live } from './live.js';
import type { Me } from './shell.js';

export type Appointment = {
  id: string; patientId: string; patientName: string; species: string;
  vetId: string; vetName: string; roomId: string; roomName: string;
  start: string; end: string; minutes: number; reason: string;
  status: string; late: boolean;
};

type SlotInfo = { roomId: string; roomName: string; time: Date; free: boolean; appt?: Appointment };

const SLOT_MINUTES_DEFAULT = 15;

let undoState: { id: string; undoUntil: string; now: string } | null = null;
let toastEl: HTMLElement | null = null;
let toastTimer: number | null = null;

function apptButtonName(a: Appointment): string {
  return `${a.patientName} with ${a.vetName}, ${clinicTime(a.start)} to ${clinicTime(a.end)}, ${STATUS_LABELS[a.status]}${a.late ? ', late' : ''}`;
}

export function renderTodayScreen(
  root: HTMLElement,
  me: Me,
  path: string,
  navigate: (p: string) => void
): void {
  const state = {
    date: '',
    appointments: [] as Appointment[],
    rooms: [] as { id: string; name: string }[],
    vets: [] as { id: string; name: string }[],
    clients: [] as { id: string; name: string; patients: { id: string; name: string }[] }[],
    queue: [] as any[],
    beacons: { waiting: 0, overdue: 0, dueWithinHour: 0 } as { waiting: number; overdue: number; dueWithinHour: number },
    slotMinutes: SLOT_MINUTES_DEFAULT,
    focusedSlot: null as { roomIdx: number; slotIdx: number } | null,
  };

  const wrap = el('div', { class: 'page-col' });

  // ---- band with beacons
  const beacons = renderBeacons(() => state.beacons);
  const heading = el('h1', { class: 'screen-headline', text: 'Today' });
  const dateLine = el('p', { class: 'clinic-date' });
  const band = renderSplitBand('Today', beacons.root);
  band.querySelector('.band-left')!.append(dateLine);
  wrap.append(band);

  const calendarRegion = el('section', { 'aria-label': 'Day calendar region' });
  wrap.append(calendarRegion);

  root.textContent = '';
  root.append(wrap);

  const refetch = async (): Promise<void> => {
    const [apptsR, roomsR, vetsR, queueR, beaconR, timeR] = await Promise.all([
      get(`/api/appointments${state.date ? `?date=${state.date}` : ''}`),
      get('/api/rooms'),
      get('/api/vets'),
      get('/api/queue'),
      get('/api/beacons'),
      get('/api/time'),
    ]);
    state.appointments = apptsR.appointments;
    state.rooms = roomsR.rooms;
    state.vets = vetsR.vets;
    state.queue = queueR.queue;
    state.beacons = beaconR.beacons;
    state.date = apptsR.date;
    dateLine.textContent = formatClinicDateHeading(timeR.now);
    beacons.update(state.beacons);
    renderCalendar();
    renderQueue();
  };

  live.onEvent((event, data) => {
    if (event === 'appointments' || event === 'queue' || event === 'tick') refetch();
    if (event === 'beacons') {
      get('/api/beacons').then((b) => {
        state.beacons = b.beacons;
        beacons.update(state.beacons);
      });
    }
    if (event === 'announcement' && data?.text) {
      // low stock and overdue announcements arrive on every open window
      if (typeof data.text === 'string' && data.text.includes(' is low: ')) {
        if (me.role === 'manager') announcer.say(data.text);
      }
    }
  });

  refetch();

  function slotsForDate(): SlotInfo[] {
    const out: SlotInfo[] = [];
    for (const room of state.rooms) {
      for (let minutes = 8 * 60; minutes < 18 * 60; minutes += state.slotMinutes) {
        const time = new Date(`${state.date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00Z`);
        // appointments are UTC instants; compare by instant
        out.push({ roomId: room.id, roomName: room.name, time, free: true });
      }
    }
    return out;
  }

  function apptCovers(a: Appointment, slot: SlotInfo): boolean {
    const s = new Date(a.start).getTime();
    const e = new Date(a.end).getTime();
    const t = slot.time.getTime();
    return t >= s && t < e && a.roomId === slot.roomId;
  }

  function renderCalendar(): void {
    calendarRegion.textContent = '';
    const controls = el('div', { style: 'display:flex;gap:10px;margin-bottom:14px;align-items:center' });
    const prev = el('button', { class: 'btn', onclick: () => shiftDay(-1) }, 'Previous day');
    const next = el('button', { class: 'btn', onclick: () => shiftDay(1) }, 'Next day');
    const jump = el('button', { class: 'btn', onclick: () => { navigate('/today'); } }, 'Jump to today');
    jump.addEventListener('click', () => {
      state.date = '';
      refetch();
    });
    controls.append(prev, next, jump);
    calendarRegion.append(controls);

    const isPhone = window.innerWidth <= 375;
    if (isPhone) {
      renderAgenda();
      return;
    }
    renderGrid();
  }

  function shiftDay(delta: number): void {
    const d = new Date(`${state.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    state.date = d.toISOString().slice(0, 10);
    refetch();
  }

  function renderGrid(): void {
    const surface = el('div', { class: 'cal-surface' });
    const scroll = el('div', { class: 'cal-scroll' });
    const grid = el('div', {
      role: 'grid',
      'aria-label': 'Day calendar',
      tabindex: '0',
    });
    grid.addEventListener('keydown', (e) => gridKeydown(e));

    const cols = state.rooms.length;
    grid.style.gridTemplateColumns = `70px repeat(${cols}, 1fr)`;

    // header row: time axis + room names
    grid.append(el('div', { role: 'row' }));
    for (const room of state.rooms) {
      grid.append(el('div', { role: 'columnheader', class: 'cal-time', style: 'font-weight:600;color:#14212b' }, room.name));
    }

    const slotMinutes = state.slotMinutes;
    const slots: SlotInfo[] = [];
    for (let minutes = 8 * 60; minutes < 18 * 60; minutes += slotMinutes) {
      for (const room of state.rooms) {
        const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
        const mm = String(minutes % 60).padStart(2, '0');
        const time = new Date(`${state.date}T${hh}:${mm}:00Z`);
        slots.push({ roomId: room.id, roomName: room.name, time, free: true });
      }
    }

    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const isRowStart = i % cols === 0;
      if (isRowStart) {
        const hh = String(slot.time.getUTCHours()).padStart(2, '0');
        const mm = String(slot.time.getUTCMinutes()).padStart(2, '0');
        const row = el('div', { role: 'row' });
        row.append(el('div', { class: 'cal-time', role: 'rowheader' }, `${hh}:${mm}`));
        grid.append(row);
      }
      const covering = state.appointments.filter((a) => apptCovers(a, slot));
      const isBooked = covering.length > 0;
      const cell = el(
        'div',
        {
          role: 'gridcell',
          'aria-label': `${slot.roomName}, ${slot.time.toISOString().slice(11, 16)}, ${isBooked ? 'booked' : 'free'}`,
          tabindex: '-1',
          'data-room': slot.roomName,
          'data-time': slot.time.toISOString(),
          'data-idx': String(i),
        },
        classed('slot', isBooked ? 'booked' : '')
      ) as HTMLElement;
      const rowEl = grid.lastElementChild as HTMLElement;
      rowEl.append(cell);
      if (cell.firstChild) cell.firstChild.classList.add('slot');

      const firstOfAppt = covering.find((a) => new Date(a.start).getTime() === slot.time.getTime());
      if (firstOfAppt) {
        const card = buildApptCard(firstOfAppt, slot, covering[0]);
        (cell as any)._appt = firstOfAppt;
        (cell as any)._card = card;
        cell.append(card);
      }
      (cell as any)._slot = slot;
      (cell as any)._isBooked = isBooked;
    }

    scroll.append(grid);
    surface.append(scroll);
    calendarRegion.append(surface);

    // touch: long-press drag
    attachTouchDrag(grid);
    // mouse drag
    attachMouseDrag(grid);

    const firstCell = grid.querySelector('[data-idx="0"]') as HTMLElement;
    if (firstCell) {
      // grid is one tab stop; focus the first cell when tabbing in
      grid.addEventListener('focus', () => {
        if (!grid.contains(document.activeElement) || document.activeElement === grid) {
          firstCell.focus();
        }
      });
      firstCell.setAttribute('tabindex', '-1');
    }
  }

  function classed(cls: string, extra: string): HTMLElement {
    const d = document.createElement('div');
    d.className = extra ? `${cls} ${extra}` : cls;
    return d;
  }

  function buildApptCard(a: Appointment, slot: SlotInfo, covering: Appointment): HTMLElement {
    const btn = el('button', {
      class: 'appt-card',
      'data-reason': a.reason,
      'data-testid': `appt-${a.id}`,
      'aria-label': apptButtonName(a),
      'data-motion': 'appointment-move',
      'data-motion-ms': '250',
      'data-motion-easing': '0.2, 0, 0, 1',
      onclick: (e: Event) => {
        e.stopPropagation();
        openAppointmentDetails(a);
      },
    });
    const spans = Math.max(1, Math.round((new Date(a.end).getTime() - new Date(a.start).getTime()) / (state.slotMinutes * 60000)));
    btn.style.height = `calc(${spans * 44}px * ${spans} / ${spans} - 4px)`;
    btn.style.height = `${spans * 44 - 4}px`;
    btn.style.zIndex = '2';
    const avatar = el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(a.patientName));
    const who = el('span', { class: 'who' }, a.patientName);
    const meta = el('span', { class: 'meta' }, `${a.vetName}, ${clinicTime(a.start)}–${clinicTime(a.end)}`);
    const chips = el('span', { style: 'display:flex;gap:4px;flex-wrap:wrap' });
    chips.append(el('span', { class: 'chip chip-status' }, STATUS_LABELS[a.status]));
    if (a.late) chips.append(el('span', { class: 'chip chip-late' }, 'Late'));
    btn.style.display = 'flex';
    btn.style.flexDirection = 'row';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.append(avatar);
    const texts = el('span', { style: 'display:flex;flex-direction:column;gap:1px;overflow:hidden' });
    texts.append(who, meta, chips);
    btn.append(texts);
    return btn;
  }

  function renderAgenda(): void {
    const list = el('ul', { role: 'list', 'aria-label': 'Day agenda' });
    const sorted = [...state.appointments].sort((a, b) => (a.start < b.start ? -1 : 1));
    for (const a of sorted) {
      const li = el('li');
      const btn = el('button', {
        class: 'appt-card',
        style: 'position:static;height:auto;width:100%;inset:auto',
        'data-testid': `appt-${a.id}`,
        'aria-label': apptButtonName(a),
        onclick: () => openAppointmentDetails(a),
      });
      const avatar = el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(a.patientName));
      const who = el('span', { class: 'who' }, a.patientName);
      const meta = el('span', { class: 'meta' }, `${a.vetName}, ${clinicTime(a.start)}–${clinicTime(a.end)}`);
      const chips = el('span', { style: 'display:flex;gap:4px' });
      chips.append(el('span', { class: 'chip chip-status' }, STATUS_LABELS[a.status]));
      if (a.late) chips.append(el('span', { class: 'chip chip-late' }, 'Late'));
      const texts = el('span', { style: 'display:flex;flex-direction:column;gap:1px;text-align:left' });
      texts.append(who, meta, chips);
      btn.append(avatar, texts);
      li.append(btn);
      list.append(li);
    }
    const bookBtn = el('button', { class: 'pill pill-primary', onclick: () => bookFromPhone() }, 'Book a time');
    calendarRegion.append(list, bookBtn);
  }

  async function bookFromPhone(): Promise<void> {
    // earliest slot at or after the next boundary of the server clock that is
    // free for the first free vet and a free room
    const timeR = await get('/api/time');
    const now = new Date(timeR.now);
    const slotMs = state.slotMinutes * 60000;
    const boundary = new Date(Math.ceil((now.getTime() + 1) / slotMs) * slotMs);
    let found: { time: Date; vet: any; room: any } | null = null;
    for (let t = boundary.getTime(); t < boundary.getTime() + 24 * 3600_000 && !found; t += slotMs) {
      const time = new Date(t);
      if (time.getUTCHours() < 8 || time.getUTCHours() >= 18) continue;
      if (time.toISOString().slice(0, 10) !== state.date) continue;
      for (const room of state.rooms) {
        for (const vet of state.vets) {
          const busy = state.appointments.some(
            (a) =>
              (a.vetId === vet.id || a.roomId === room.id) &&
              new Date(a.start).getTime() < t + slotMs &&
              new Date(a.end).getTime() > t
          );
          if (!busy) {
            found = { time, vet, room };
            break;
          }
        }
        if (found) break;
      }
    }
    if (!found) {
      showToastAlert('No times are available on this day.');
      return;
    }
    openBookingDialog(found.room, found.time, found.vet.id);
  }

  function showToastAlert(msg: string): void {
    const old = calendarRegion.querySelector('[data-role="cal-alert"]');
    old?.remove();
    const b = bannerAlert(msg);
    b.setAttribute('data-role', 'cal-alert');
    calendarRegion.prepend(b);
  }

  function gridKeydown(e: KeyboardEvent): void {
    const grid = e.currentTarget as HTMLElement;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-idx]'));
    const active = document.activeElement as HTMLElement;
    const idx = cells.indexOf(active.closest('[data-idx]') as HTMLElement);
    const cols = state.rooms.length;
    if (idx === -1) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        cells[0]?.focus();
      }
      return;
    }
    const appt = (cells[idx] as any)._appt as Appointment | undefined;
    const move = (to: number) => {
      if (to < 0 || to >= cells.length) return;
      e.preventDefault();
      cells[to].focus();
    };
    switch (e.key) {
      case 'ArrowDown': move(idx + cols); break;
      case 'ArrowUp': move(idx - cols); break;
      case 'ArrowRight': move(idx + 1); break;
      case 'ArrowLeft': move(idx - 1); break;
      case 'Enter': {
        e.preventDefault();
        if (appt) openAppointmentDetails(appt);
        else {
          const slot = (cells[idx] as any)._slot as SlotInfo;
          openBookingDialog({ id: slot.roomId, name: slot.roomName }, slot.time);
        }
        break;
      }
      case 't':
      case 'T': {
        if (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA') return;
        e.preventDefault();
        state.date = '';
        refetch();
        break;
      }
      default:
        if (appt) apptKeydown(e, appt, cells, idx);
        break;
    }
  }

  function apptKeydown(e: KeyboardEvent, appt: Appointment, cells: HTMLElement[], idx: number): void {
    const cols = state.rooms.length;
    const canEdit = ['front-desk', 'vet', 'manager'].includes(me.role);
    if (e.altKey && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (!canEdit) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      const roomDelta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      void roomDelta;
      const target = idx + delta * cols;
      if (delta !== 0) {
        moveAppt(appt, delta, 0, cells, idx);
      } else {
        moveApptRoom(appt, e.key === 'ArrowRight' ? 1 : -1, cells, idx);
      }
      return;
    }
    if (e.shiftKey && e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (!canEdit) return;
      e.preventDefault();
      resizeAppt(appt, e.key === 'ArrowDown' ? 1 : -1, cells, idx);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace' && !e.ctrlKey) {
      if (e.key === 'Backspace') return;
      if (!canEdit) return;
      e.preventDefault();
      cancelAppt(appt, cells, idx);
      return;
    }
    if (e.key === 'i' || e.key === 'I') {
      if (!canEdit) return;
      e.preventDefault();
      checkIn(appt);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      restoreLast();
      return;
    }
  }

  async function moveAppt(appt: Appointment, slotsDelta: number, _roomDelta: number, cells: HTMLElement[], idx: number): Promise<void> {
    try {
      const start = new Date(new Date(appt.start).getTime() + slotsDelta * state.slotMinutes * 60000);
      await patch(`/api/appointments/${appt.id}`, { start: start.toISOString() });
      announcer.say(`Moved ${appt.patientName} to ${appt.roomName}, ${clinicTime(start.toISOString())}.`);
      await refetch();
      focusApptAfter(appt.id);
    } catch (e) {
      if (e instanceof ApiRequestFailed) showToastAlert(e.err.message);
    }
  }

  async function moveApptRoom(appt: Appointment, dir: number, cells: HTMLElement[], idx: number): Promise<void> {
    try {
      const roomIdx = state.rooms.findIndex((r) => r.id === appt.roomId);
      const newIdx = roomIdx + dir;
      if (newIdx < 0 || newIdx >= state.rooms.length) return;
      const room = state.rooms[newIdx];
      await patch(`/api/appointments/${appt.id}`, { roomId: room.id });
      announcer.say(`Moved ${appt.patientName} to ${room.name}, ${clinicTime(appt.start)}.`);
      await refetch();
      focusApptAfter(appt.id);
    } catch (e) {
      if (e instanceof ApiRequestFailed) showToastAlert(e.err.message);
    }
  }

  async function resizeAppt(appt: Appointment, delta: number, cells: HTMLElement[], idx: number): Promise<void> {
    try {
      const minutes = appt.minutes + delta * state.slotMinutes;
      await patch(`/api/appointments/${appt.id}`, { minutes });
      const end = new Date(new Date(appt.start).getTime() + minutes * 60000);
      announcer.say(`${appt.patientName} now runs ${clinicTime(appt.start)} to ${clinicTime(end.toISOString())}.`);
      await refetch();
      focusApptAfter(appt.id);
    } catch (e) {
      if (e instanceof ApiRequestFailed) showToastAlert(e.err.message);
    }
  }

  async function checkIn(appt: Appointment): Promise<void> {
    try {
      await post(`/api/appointments/${appt.id}/check-in`);
      announcer.say(`${appt.patientName} checked in.`);
      await refetch();
    } catch (e) {
      if (e instanceof ApiRequestFailed) showToastAlert(e.err.message);
    }
  }

  async function cancelAppt(appt: Appointment, cells: HTMLElement[], idx: number): Promise<void> {
    try {
      const res = await del(`/api/appointments/${appt.id}`);
      undoState = { id: appt.id, undoUntil: res.undoUntil, now: res.now };
      showToast();
      announcer.say('Appointment cancelled.');
      await refetch();
      const cell = calendarRegion.querySelector(`[data-idx="${idx}"]`) as HTMLElement;
      cell?.focus();
    } catch (e) {
      if (e instanceof ApiRequestFailed) showToastAlert(e.err.message);
    }
  }

  async function restoreLast(): Promise<void> {
    if (!undoState) return;
    try {
      await post(`/api/appointments/${undoState.id}/restore`);
      announcer.say('Appointment restored.');
      dismissToast();
      await refetch();
      focusApptAfter(undoState.id);
    } catch (e) {
      if (e instanceof ApiRequestFailed) {
        showToastAlert(e.err.message);
        dismissToast();
      }
    }
  }

  function focusApptAfter(id: string): void {
    setTimeout(() => {
      const btn = calendarRegion.querySelector(`[data-testid="appt-${id}"]`) as HTMLElement;
      btn?.focus();
    }, 50);
  }

  function showToast(): void {
    dismissToast();
    const notice = el('div', { class: 'toast', role: 'status', 'aria-label': 'Notice', 'data-motion': 'toast', 'data-motion-ms': '200', 'data-motion-easing': 'ease-out' },
      el('span', { text: 'Appointment cancelled.' }));
    const undoBtn = el('button', { class: 'pill pill-primary', onclick: () => restoreLast() }, 'Undo');
    notice.append(undoBtn);
    document.body.append(notice);
    toastEl = notice;
    const lifetime = new Date(undoState!.undoUntil).getTime() - new Date(undoState!.now).getTime();
    toastTimer = window.setTimeout(dismissToast, Math.max(0, lifetime));
  }

  function dismissToast(): void {
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = null;
    toastEl?.remove();
    toastEl = null;
  }

  function attachTouchDrag(grid: HTMLElement): void {
    let heldId: string | null = null;
    let pickTimer: number | null = null;
    let moved = false;
    const findCell = (x: number, y: number): HTMLElement | null => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null;
      return target?.closest('[data-idx]') as HTMLElement | null;
    };
    grid.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const cell = findCell(t.clientX, t.clientY);
      if (!cell) return;
      const card = (cell as any)._card as HTMLElement | undefined;
      const appt = (cell as any)._appt as Appointment | undefined;
      if (!card || !appt) return;
      heldId = null;
      pickTimer = window.setTimeout(() => {
        heldId = appt.id;
        card.setAttribute('data-picked', 'true');
        if (navigator.vibrate) navigator.vibrate(10);
      }, 500);
    }, { passive: true });
    grid.addEventListener('touchmove', (e) => {
      if (!heldId) return;
      moved = true;
      e.preventDefault();
    }, { passive: false });
    grid.addEventListener('touchend', (e) => {
      if (pickTimer) window.clearTimeout(pickTimer);
      pickTimer = null;
      if (!heldId) return;
      const id = heldId;
      heldId = null;
      const card = grid.querySelector(`[data-testid="appt-${id}"]`);
      card?.removeAttribute('data-picked');
      if (!moved) return;
      moved = false;
      const t = e.changedTouches[0];
      const cell = findCell(t.clientX, t.clientY);
      if (!cell || cell === (grid.querySelector(`[data-testid="appt-${id}"]`) as any)?.closest('[data-idx]')) return;
      const slot = (cell as any)._slot as SlotInfo | undefined;
      const appt = state.appointments.find((a) => a.id === id);
      if (!slot || !appt) return;
      patch(`/api/appointments/${id}`, { start: slot.time.toISOString(), roomId: slot.roomId })
        .then(() => {
          announcer.say(`Moved ${appt.patientName} to ${slot.roomName}, ${clinicTime(slot.time.toISOString())}.`);
          refetch().then(() => focusApptAfter(id));
        })
        .catch((err) => {
          if (err instanceof ApiRequestFailed) showToastAlert(err.err.message);
        });
    });
    grid.addEventListener('touchcancel', () => {
      if (pickTimer) window.clearTimeout(pickTimer);
      pickTimer = null;
      heldId = null;
    });
  }

  function attachMouseDrag(grid: HTMLElement): void {
    let dragId: string | null = null;
    grid.addEventListener('mousedown', (e) => {
      const card = (e.target as HTMLElement).closest('[data-testid^="appt-"]') as HTMLElement | null;
      if (!card) return;
      dragId = card.getAttribute('data-testid')!.slice('appt-'.length);
    });
    grid.addEventListener('mouseup', (e) => {
      if (!dragId) return;
      const id = dragId;
      dragId = null;
      const cell = (e.target as HTMLElement).closest('[data-idx]') as HTMLElement | null;
      if (!cell) return;
      const slot = (cell as any)._slot as SlotInfo | undefined;
      const appt = state.appointments.find((a) => a.id === id);
      if (!slot || !appt) return;
      if (new Date(slot.time).getTime() === new Date(appt.start).getTime() && slot.roomId === appt.roomId) return;
      patch(`/api/appointments/${id}`, { start: slot.time.toISOString(), roomId: slot.roomId })
        .then(() => refetch())
        .catch((err) => {
          if (err instanceof ApiRequestFailed) showToastAlert(err.err.message);
        });
    });
  }

  // ---- waiting room ----
  function renderQueue(): void {
    const old = wrap.querySelector('[data-role="queue"]');
    old?.remove();
    const section = el('section', { 'data-role': 'queue' });
    section.append(el('h2', { text: 'Waiting room' }));
    const list = el('ul', { role: 'list', 'aria-label': 'Waiting room' });
    if (state.queue.length === 0) {
      const card = el('div', { class: 'empty-card' });
      card.append(el('p', { class: 'title', text: 'No one is waiting.' }));
      const goBtn = el('button', {
        class: 'pill pill-primary',
        onclick: () => {
          const isPhone = window.innerWidth <= 375;
          if (isPhone) {
            wrap.querySelector('[role="list"][aria-label="Day agenda"]')?.scrollIntoView();
            const first = wrap.querySelector('[role="list"][aria-label="Day agenda"] button, [aria-label="Day agenda"] li button') as HTMLElement;
            first?.focus();
          } else {
            const grid = wrap.querySelector('[role="grid"]') as HTMLElement;
            grid?.scrollIntoView();
            const firstCell = grid?.querySelector('[data-idx="0"]') as HTMLElement;
            firstCell?.focus();
          }
        },
      }, 'Go to calendar');
      card.append(goBtn);
      section.append(card);
    } else {
      for (const item of state.queue) {
        const li = el('li', {
          class: 'queue-row',
          'aria-label': `${item.patientName}, waiting ${item.waitingMinutes} min`,
          'data-motion': 'queue-arrive',
          'data-motion-ms': '400',
          'data-motion-easing': 'ease-out',
        });
        const avatar = el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(item.patientName));
        const mid = el('span', { style: 'display:flex;flex-direction:column;gap:2px;flex:1' });
        const nameRow = el('span', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' });
        nameRow.append(el('span', { class: 'name', text: item.patientName }));
        nameRow.append(el('span', { class: 'chip' }, SPECIES_LABELS[item.species] ?? item.species));
        if (item.lateByMinutes !== null && item.lateByMinutes !== undefined) {
          nameRow.append(el('span', { class: 'chip chip-late' }, `Arrived ${item.lateByMinutes} min late`));
        }
        const wait = el('span', { class: 'wait', text: `waiting ${item.waitingMinutes} min` });
        const vet = el('span', { class: 'wait', text: item.vetName });
        mid.append(nameRow, wait, vet);
        li.append(avatar, mid);
        if (me.role === 'vet' || me.role === 'manager') {
          const startBtn = el('button', {
            class: 'btn',
            'aria-label': `Start consult for ${item.patientName}`,
            onclick: async (ev: Event) => {
              const btn = ev.currentTarget as HTMLButtonElement;
              btn.setAttribute('aria-busy', 'true');
              btn.disabled = true;
              try {
                await post(`/api/appointments/${item.appointmentId}/start`);
                announcer.say(`${item.patientName} is now in consult.`);
                await refetch();
              } catch (e) {
                if (e instanceof ApiRequestFailed) {
                  showToastAlert(e.err.message);
                  await refetch();
                }
              } finally {
                btn.removeAttribute('aria-busy');
                btn.disabled = false;
              }
            },
          }, `Start consult for ${item.patientName}`);
          li.append(startBtn);
        }
        const openLink = el('a', { class: 'arrow-chip', href: `/patients/${item.patientId}`, 'aria-label': `Open ${item.patientName}`, 'data-motion': 'chip-nudge', 'data-motion-ms': '250', 'data-motion-easing': 'ease-in-out' }, '→');
        li.append(openLink);
        list.append(li);
      }
      section.append(list);
    }
    wrap.append(section);
  }

  // ---- dialogs ----
  function openBookingDialog(room: { id: string; name: string }, time: Date, presetVet?: string): void {
    let dlg: HTMLDialogElement | null = null;
    let clientsCache: typeof state.clients = [];
    let chosenVet: string = presetVet ?? '';
    let summaryEl: HTMLElement | null = null;
    openDialog(() => {
      const body = el('div', { class: 'dialog-body' });
      const title = el('h2', { id: 'dlg-book', text: 'Book appointment' });
      body.append(title);
      const summaryHolder = el('div');
      body.append(summaryHolder);

      const clientSel = el('select', { class: 'input-pill', 'aria-label': 'Client', id: 'bk-client' }) as HTMLSelectElement;
      const patientSel = el('select', { class: 'input-pill', 'aria-label': 'Patient', id: 'bk-patient' }) as HTMLSelectElement;
      const vetSel = el('select', { class: 'input-pill', 'aria-label': 'Vet', id: 'bk-vet' }) as HTMLSelectElement;
      const reasonSel = el('select', { class: 'input-pill', 'aria-label': 'Reason', id: 'bk-reason' }) as HTMLSelectElement;
      for (const r of ['Consult', 'Vaccination', 'Surgery']) {
        reasonSel.append(new Option(r, r));
      }

      const clientErr = el('p', { id: 'bk-client-err' });
      const patientErr = el('p', { id: 'bk-patient-err' });

      const loadClients = async () => {
        const r = await get('/api/clients');
        clientsCache = r.clients;
        clientSel.textContent = '';
        clientSel.append(new Option('', ''));
        for (const c of r.clients) clientSel.append(new Option(c.name, c.id));
        loadPatients();
      };
      const loadPatients = () => {
        const client = clientsCache.find((c) => c.id === clientSel.value);
        patientSel.textContent = '';
        patientSel.append(new Option('', ''));
        for (const p of client?.patients ?? []) patientSel.append(new Option(p.name, p.id));
      };
      clientSel.addEventListener('change', loadPatients);

      const fields = [
        { label: 'Client', select: clientSel, err: clientErr, id: 'bk-client' },
        { label: 'Patient', select: patientSel, err: patientErr, id: 'bk-patient' },
        { label: 'Vet', select: vetSel, err: el('p'), id: 'bk-vet' },
        { label: 'Reason', select: reasonSel, err: el('p'), id: 'bk-reason' },
      ];
      for (const f of fields) {
        const wrapF = el('div', { class: 'field' });
        wrapF.append(el('label', { for: f.id, text: f.label }), f.select, f.err);
        body.append(wrapF);
      }

      const actions = el('div', { style: 'display:flex;gap:10px' });
      const bookBtn = el('button', { class: 'pill pill-primary' }, 'Book');
      const cancelBtn = el('button', { class: 'btn' }, 'Cancel');
      actions.append(bookBtn, cancelBtn);
      body.append(actions);

      bookBtn.addEventListener('click', async () => {
        // browser-side checks first; nothing is sent on failure
        const problems: { message: string; focus: () => void }[] = [];
        if (!clientSel.value) problems.push({ message: 'Client is required.', focus: () => clientSel.focus() });
        if (!patientSel.value) problems.push({ message: 'Patient is required.', focus: () => patientSel.focus() });
        clientErr.textContent = clientSel.value ? '' : 'Client is required.';
        patientErr.textContent = patientSel.value ? '' : 'Patient is required.';
        if (problems.length > 0) {
          summaryHolder.textContent = '';
          const box = errorSummary(problems);
          summaryHolder.append(box);
          box.querySelector('a')?.focus();
          return;
        }
        bookBtn.setAttribute('aria-busy', 'true');
        bookBtn.disabled = true;
        try {
          const created = await post('/api/appointments', {
            patientId: patientSel.value,
            vetId: vetSel.value,
            roomId: room.id,
            start: time.toISOString(),
            reason: reasonSel.value || 'Consult',
          });
          announcer.say(`Booked ${created.patientName} with ${created.vetName} at ${clinicTime(created.start)}.`);
          dlg?.close();
          await refetch();
          focusApptAfter(created.id);
        } catch (e) {
          if (e instanceof ApiRequestFailed) {
            summaryHolder.textContent = '';
            const box = errorSummary([{ message: e.err.message, focus: () => clientSel.focus() }]);
            summaryHolder.append(box);
            box.querySelector('a')?.focus();
          }
        } finally {
          bookBtn.removeAttribute('aria-busy');
          bookBtn.disabled = false;
        }
      });
      cancelBtn.addEventListener('click', () => dlg?.close());

      // default vet: first vet by name who is free for that slot
      void (async () => {
        await loadClients();
        vetSel.textContent = '';
        const free = state.vets.filter(
          (v) => !state.appointments.some(
            (a) => a.vetId === v.id &&
              new Date(a.start).getTime() < time.getTime() + state.slotMinutes * 60000 &&
              new Date(a.end).getTime() > time.getTime()
          )
        );
        const ordered = [...state.vets].sort((a, b) => a.name.localeCompare(b.name));
        for (const v of ordered) vetSel.append(new Option(v.name, v.id));
        const defaultVet = free.sort((a, b) => a.name.localeCompare(b.name))[0] ?? ordered[0];
        chosenVet = presetVet ?? defaultVet?.id ?? '';
        vetSel.value = chosenVet;
      })();

      return body;
    }, {
      labelledBy: 'dlg-book',
      onOpen: (d) => { dlg = d; },
      onClose: () => {
        // focus returns to the slot that opened it
        const cell = calendarRegion.querySelector('[data-idx]') as HTMLElement;
        const first = calendarRegion.querySelector('[data-idx="0"]') as HTMLElement;
        (cell ?? first)?.focus();
      },
    });
  }

  function openAppointmentDetails(appt: Appointment): void {
    let dlg: HTMLDialogElement | null = null;
    openDialog(() => {
      const body = el('div', { class: 'dialog-body' });
      body.append(el('h2', { id: 'dlg-appt', text: 'Appointment details' }));
      body.append(el('p', {}, `${appt.patientName} with ${appt.vetName}, ${clinicTime(appt.start)} to ${clinicTime(appt.end)}, ${STATUS_LABELS[appt.status]}`));
      const actions = el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px' });
      const canEdit = ['front-desk', 'vet', 'manager'].includes(me.role);
      const edges: { from: string; label: string; run: () => Promise<void>; roles: string[] }[] = [
        { from: 'booked', label: 'Check in', roles: ['front-desk', 'vet', 'manager'], run: async () => { await post(`/api/appointments/${appt.id}/check-in`); announcer.say(`${appt.patientName} checked in.`); } },
        { from: 'checked-in', label: 'Start consult', roles: ['front-desk', 'vet', 'manager'], run: async () => { await post(`/api/appointments/${appt.id}/start`); announcer.say(`${appt.patientName} is now in consult.`); } },
        { from: 'in-consult', label: 'Complete consult', roles: ['vet', 'manager'], run: async () => { await post(`/api/appointments/${appt.id}/complete`); announcer.say(`Consult completed for ${appt.patientName}.`); } },
      ];
      for (const edge of edges) {
        if (edge.from === appt.status && edge.roles.includes(me.role)) {
          const btn = el('button', {
            class: 'btn',
            onclick: async (ev: Event) => {
              const b = ev.currentTarget as HTMLButtonElement;
              b.setAttribute('aria-busy', 'true');
              b.disabled = true;
              try {
                await edge.run();
                dlg?.close();
                await refetch();
              } catch (e) {
                if (e instanceof ApiRequestFailed) showToastAlert(e.err.message);
              } finally {
                b.removeAttribute('aria-busy');
                b.disabled = false;
              }
            },
          }, edge.label);
          actions.append(btn);
        }
      }
      if (['front-desk', 'vet', 'manager'].includes(me.role) && (appt.status === 'booked' || appt.status === 'checked-in')) {
        actions.append(el('button', {
          class: 'btn',
          onclick: async () => {
            try {
              const res = await del(`/api/appointments/${appt.id}`);
              undoState = { id: appt.id, undoUntil: res.undoUntil, now: res.now };
              announcer.say('Appointment cancelled.');
              dlg?.close();
              await refetch();
              showToast();
            } catch (e) {
              if (e instanceof ApiRequestFailed) showToastAlert(e.err.message);
            }
          },
        }, 'Cancel appointment'));
      }
      if (['front-desk', 'vet', 'manager'].includes(me.role) && appt.status === 'booked') {
        actions.append(el('button', {
          class: 'btn',
          onclick: async () => {
            try {
              await post(`/api/appointments/${appt.id}/no-show`);
              announcer.say(`${appt.patientName} marked no-show.`);
              dlg?.close();
              await refetch();
            } catch (e) {
              if (e instanceof ApiRequestFailed) showToastAlert(e.err.message);
            }
          },
        }, 'Mark no-show'));
      }
      if (appt.status === 'in-consult') {
        actions.append(el('a', { class: 'btn', href: `/consult/${appt.id}` }, 'Open consult'));
      }
      actions.append(el('a', { class: 'btn', href: `/patients/${appt.patientId}` }, 'Open patient'));
      actions.append(el('button', { class: 'btn', onclick: () => dlg?.close() }, 'Close'));
      body.append(actions);
      return body;
    }, {
      labelledBy: 'dlg-appt',
      onOpen: (d) => { dlg = d; },
      onClose: () => {
        const btn = calendarRegion.querySelector(`[data-testid="appt-${appt.id}"]`) as HTMLElement;
        btn?.focus();
      },
    });
  }
}

function formatClinicDateHeading(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/London' }).format(d);
  const rest = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(d);
  return `${day} ${rest}`;
}
