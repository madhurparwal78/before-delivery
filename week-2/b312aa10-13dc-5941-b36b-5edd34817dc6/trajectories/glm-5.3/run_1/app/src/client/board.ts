import { api, apiOrNull, ApiFailure, freshKey, type Block, type BoardResponse, type HourBank } from './api.js';
import { h, clear, money, hoursText, STATUS_WORDS, blockLabel, statusWords, addDays, headingDate, prefersReducedMotion } from './ui.js';
import { announce, showAlert, clearAlert, refreshBannerSoon, updateHourBankFigures, state as appState, type AppState } from './main.js';

interface BoardUiState {
  date: string;
  today: string;
  response: BoardResponse | null;
  /** Board reads sent after the latest own-action answer are the only ones drawn. */
  lastActionAnswered: number;
  pendingDrops: number;
  discardedTickets: Set<string>;
  takenTickets: Set<string>;
  inHand: { bookingId: string; version: number; origin: Block } | null;
  ghost: { stationId: string; localDate: string; localStart: string | null; localEnd: string | null; days: number | null } | null;
  timer: number | null;
}

let ui: BoardUiState | null = null;

export function boardCleanup(): void {
  if (ui?.timer) window.clearInterval(ui.timer);
  ui = null;
}

const HOUR_PX = 72;

function timeToPercent(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return ((h + m / 60) / 24) * 100;
}

function blockLeft(block: Block): number {
  return timeToPercent(block.localStart ?? '00:00');
}

function blockWidth(block: Block): number {
  const start = timeToPercent(block.localStart ?? '00:00');
  const end = timeToPercent(block.localEnd === '24:00' || block.localEnd === null ? '24:00' : block.localEnd);
  return end - start;
}

export async function renderBoard(main: HTMLElement, state: AppState): Promise<void> {
  const session = appState.session!;
  const kitchen = appState.kitchen!;
  const urlDate = new URLSearchParams(window.location.search).get('date');
  let date = urlDate ?? kitchen.today;
  if (urlDate && !/^\d{4}-\d{2}-\d{2}$/.test(urlDate)) {
    date = urlDate;
  }
  if (!urlDate) {
    history.replaceState({}, '', `/board?date=${date}`);
  }
  ui = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    today: kitchen.today,
    response: null,
    lastActionAnswered: Date.now(),
    pendingDrops: 0,
    discardedTickets: new Set(),
    takenTickets: new Set(),
    inHand: null,
    ghost: null,
    timer: null,
  };
  drawShell(main, state);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showAlert('Use a date in the form YYYY-MM-DD.');
    return;
  }
  await readBoard(true);
  ui.timer = window.setInterval(() => {
    if (ui && ui.pendingDrops === 0 && !ui.inHand) void readBoard(false);
  }, 15000);
}

function drawShell(main: HTMLElement, state: AppState): void {
  const session = appState.session!;
  clear(main);
  const heading = h('h1', { class: 'display', id: 'board-heading' });
  const kitchenTime = h('p', { class: 'kitchen-time', id: 'kitchen-time' });
  const prev = h('button', { text: 'Previous day', onclick: () => shiftDay(-1) });
  const todayBtn = h('button', { text: 'Today', onclick: () => goToDate(ui?.today ?? appState.kitchen?.today ?? '') });
  const next = h('button', { text: 'Next day', onclick: () => shiftDay(1) });
  const newBooking = session.user.role === 'member'
    ? h('button', { text: 'New booking', onclick: () => openNewBooking(null) })
    : null;
  const markOos = session.user.role !== 'member'
    ? h('button', { text: 'Mark out of service', onclick: () => openOutOfService() })
    : null;
  const rail = h('div', { role: 'region', 'aria-label': 'Ticket rail', id: 'ticket-rail', class: 'ticket-rail' });
  const ruler = h('div', { class: 'hour-ruler', role: 'list', 'aria-label': 'Hour ruler' });
  for (let hour = 0; hour < 24; hour++) {
    const label = `${String(hour).padStart(2, '0')}:00`;
    ruler.append(h('div', { class: 'hour-tick', role: 'listitem', text: label, style: `left:${(hour / 24) * 100}%; width:${100 / 24}%` }));
  }
  const board = h('div', { role: 'region', 'aria-label': 'Line board', id: 'line-board', class: 'line-board' }, ruler);
  main.append(
    h('div', { class: 'date-bar' },
      heading,
      kitchenTime,
      h('div', { class: 'date-controls' }, prev, todayBtn, next),
      newBooking,
      markOos,
    ),
    rail,
    board,
  );
}

function shiftDay(delta: number): void {
  if (!ui || !ui.date) return;
  goToDate(addDays(ui.date, delta));
}

function goToDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  history.pushState({}, '', `/board?date=${date}`);
  ui!.date = date;
  void readBoard(true);
}

/** The board draws only responses for requests sent after the latest own
 * board action answered. */
async function readBoard(scroll: boolean): Promise<void> {
  if (!ui || !ui.date) return;
  const sentAt = Date.now();
  const result = await apiOrNull<BoardResponse>('GET', `/api/board?date=${ui.date}`);
  if (!result || !ui) return;
  if (sentAt < ui.lastActionAnswered) return;
  ui.response = result.data;
  ui.today = result.data.today;
  if (result.data.hourBank) updateHourBankFigures(result.data.hourBank.balanceHours, result.data.hourBank.month);
  drawBoard(scroll);
}

function drawBoard(scroll: boolean): void {
  const response = ui?.response;
  if (!response || !ui) return;
  const heading = document.getElementById('board-heading');
  if (heading) heading.textContent = headingDate(ui.date);
  const kitchenTime = document.getElementById('kitchen-time');
  if (kitchenTime) kitchenTime.textContent = `Kitchen time: ${response.timeZone}`;
  drawRail();
  drawLanes();
  if (scroll) scrollToHour();
}

function scrollToHour(): void {
  const response = ui?.response;
  if (!response) return;
  const board = document.getElementById('line-board');
  if (!board) return;
  const nowHour = Number(response.now.slice(11, 13));
  const target = response.date === response.today ? nowHour : 5;
  const px = (target / 24) * HOUR_PX * 24;
  const scrollable = board.querySelector('.lanes-scroll') as HTMLElement | null;
  if (scrollable) scrollable.scrollLeft = Math.max(0, px - 100);
  board.scrollLeft = Math.max(0, px - 100);
}

function drawRail(): void {
  const rail = document.getElementById('ticket-rail');
  const response = ui?.response;
  if (!rail || !response || !ui) return;
  clear(rail);
  const session = appState.session!;
  const isStaff = session.user.role !== 'member';
  if (isStaff) {
    // Conflict tickets and the block in hand.
    for (const block of response.blocks) {
      if (block.status === undefined) continue;
      if (block.conflict && ['confirmed', 'checked_in'].includes(block.status)) {
        const label = blockLabel({ stationName: block.stationName ?? '', kind: block.kind, localDate: block.localDate, localStart: block.localStart, localEnd: block.localEnd, days: block.days });
        rail.append(
          h('div', { class: 'ticket conflict-ticket', role: 'group', 'aria-label': `Conflict ${label}` },
            h('span', { class: 'ticket-text', text: `Conflict: ${oosReasonFor(response, block)}` }),
            h('button', { text: 'Move', onclick: () => pickUp(block) }),
            h('button', { text: 'Release', onclick: () => openRelease(block) }),
          ),
        );
      }
    }
    if (ui.inHand && ui.ghost) {
      const label = ghostLabel();
      rail.append(
        h('div', { class: 'ticket moving-ticket', role: 'group', 'aria-label': `Moving ${label}` },
          h('span', { class: 'ticket-text', text: 'Moving' }),
        ),
      );
    }
  } else {
    for (const block of response.blocks) {
      if (block.status === 'held' && block.seriesId !== undefined) {
        if (ui.discardedTickets.has(block.id)) continue;
        const label = blockLabel({ stationName: block.stationName ?? '', kind: block.kind, localDate: block.localDate, localStart: block.localStart, localEnd: block.localEnd, days: block.days });
        const taken = ui.takenTickets.has(block.id);
        const expired = false;
        const group = h('div', { class: 'ticket', role: 'group', 'aria-label': `Ticket ${label}` },
          h('span', { class: 'ticket-text', text: `Held until ${block.holdExpiresAt?.slice(11, 16) ?? ''} · ${money(block.chargeCents ?? 0)} · ${hoursText(block.hours ?? 0)} h${block.peakHours ? ` · ${hoursText(block.peakHours)} h peak` : ''}${taken ? ' · taken' : ''}${expired ? ' · expired' : ''}` }),
          h('button', { text: 'Confirm', onclick: () => confirmTicket(block) }),
          h('button', { text: 'Discard', onclick: () => discardTicket(block) }),
        );
        rail.append(group);
      }
    }
  }
}

function oosReasonFor(response: BoardResponse, block: Block): string {
  const window = response.outOfService.find((w) => w.stationId === block.stationId && block.start < w.end && block.end > w.start);
  return window?.reason ?? 'out of service';
}

function drawLanes(): void {
  const response = ui?.response;
  const board = document.getElementById('line-board');
  if (!response || !board || !ui) return;
  const lanesWrap = board.querySelector('.lanes-scroll') ?? (() => {
    const wrap = h('div', { class: 'lanes-scroll' });
    board.append(wrap);
    return wrap;
  })();
  const session = appState.session!;
  const isStaff = session.user.role !== 'member';
  const lanes = lanesWrap as HTMLElement;
  const scrollLeft = lanes.scrollLeft;
  const scrollTop = lanes.scrollTop;
  clear(lanes);
  for (const station of response.stations) {
    const lane = h('div', { class: `lane ${station.kind}`, 'aria-label': station.name });
    lane.append(h('span', { class: 'lane-name display', text: station.name }));
    const laneBody = h('div', { class: 'lane-body' });
    if (station.kind === 'hourly') {
      // Empty quarter-hour cells open New booking for members.
      if (session.user.role === 'member') {
        for (let hour = 0; hour < 24; hour++) {
          for (let quarter = 0; quarter < 4; quarter++) {
            const startMin = hour * 60 + quarter * 15;
            const start = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
            const cell = h('div', {
              class: 'cell',
              style: `left:${(startMin / (24 * 60)) * 100}%; width:${100 / 96}%`,
              onclick: () => openNewBooking({ stationId: station.id, stationName: station.name, date: ui!.date, start }),
            });
            laneBody.append(cell);
          }
        }
      }
    } else {
      const occupying = response.blocks.filter((b) => b.stationId === station.id && (b.status === 'booked' || OCCUPYING.includes(b.status ?? '')));
      const free = (station.capacity ?? 0) - occupying.filter((b) => b.kind === 'shelf').length;
      const cell = h('div', { class: 'shelf-cell', role: 'group', 'aria-label': `${station.name} ${ui.date}` },
        h('span', { class: 'shelf-free', text: `${Math.max(0, free)} of ${station.capacity} free` }),
      );
      if (session.user.role === 'member' && free > 0) {
        cell.addEventListener('click', () => openNewBooking({ stationId: station.id, stationName: station.name, date: ui!.date, days: 1 }));
      }
      laneBody.append(cell);
    }
    // Out-of-service bands.
    for (const oos of response.outOfService.filter((w) => w.stationId === station.id)) {
      if (station.kind === 'hourly') {
        laneBody.append(h('div', {
          class: 'oos-band',
          style: `left:${timeToPercent(oos.localStart)}%; width:${timeToPercent(oos.localEnd === '24:00' ? '24:00' : oos.localEnd) - timeToPercent(oos.localStart)}%`,
          text: oos.reason,
        }));
      }
    }
    for (const block of response.blocks.filter((b) => b.stationId === station.id)) {
      if (block.status === undefined) continue;
      if (ui.discardedTickets.has(block.id)) continue;
      const label = blockLabel({ stationName: station.name, kind: block.kind, localDate: block.localDate, localStart: block.localStart, localEnd: block.localEnd, days: block.days });
      const who = block.businessName ?? 'Booked';
      const words = block.status === 'booked' ? '' : statusWords({ status: block.status, conflict: block.conflict, billingStatus: block.billingStatus });
      const accessibleName = block.status === 'booked' ? `${label}, Booked` : `${label}, ${who}, ${words}`;
      const element = h('button', {
        class: `block ${block.status} ${block.conflict ? 'conflict' : ''}`,
        style: `left:${blockLeft(block)}%; width:${blockWidth(block)}%`,
        'aria-label': accessibleName,
        onclick: () => openBlockDetails(block, station),
      });
      element.dataset.bookingId = block.id;
      element.dataset.station = station.id;
      if (block.status !== 'booked') {
        const label2 = h('span', { class: 'block-label', text: `${label}` });
        element.append(label2);
        if (block.conflict) element.append(h('span', { class: 'marker', text: 'Conflict' }));
        if (block.billingStatus === 'pending_billing') element.append(h('span', { class: 'marker', text: 'Pending billing' }));
        if (block.kind === 'hourly' && (block.peakHours ?? 0) > 0 && response.peakWindows.length > 0) {
          element.append(h('span', { class: 'peak-band', text: 'peak' }));
        }
        if (block.status === 'booked') element.append(h('span', { class: 'marker', text: 'Booked' }));
      }
      laneBody.append(element);
    }
    if (ui.ghost && ui.ghost.stationId === station.id) {
      const ghostLabel = ui.inHand?.origin ? blockLabel({ stationName: station.name, kind: ui.inHand.origin.kind, localDate: ui.ghost.localDate, localStart: ui.ghost.localStart, localEnd: ui.ghost.localEnd, days: ui.ghost.days }) : '';
      const occupied = laneOccupied(station.id);
      const marker = occupied ? 'Occupied' : '';
      const ghost = h('div', {
        class: `ghost ${occupied ? 'occupied' : ''}`,
        tabindex: '0',
        role: 'group',
        'aria-label': `Moving to ${ghostLabel}${marker ? ` ${marker}` : ''}`,
        style: `left:${timeToPercent(ui.ghost.localStart ?? '00:00')}%; width:${timeToPercent(ui.ghost.localEnd ?? '24:00') - timeToPercent(ui.ghost.localStart ?? '00:00')}%`,
      }, h('span', { class: 'block-label', text: ghostLabel }), marker ? h('span', { class: 'marker', text: marker }) : null);
      (ghost as HTMLElement).id = 'moving-ghost';
      ghost.addEventListener('keydown', (ev) => ghostKeydown(ev));
      laneBody.append(ghost);
    }
    lane.append(laneBody);
    lanes.append(lane);
  }
  lanes.scrollLeft = scrollLeft;
  lanes.scrollTop = scrollTop;
}

const OCCUPYING = ['held', 'confirmed', 'checked_in', 'completed', 'no_show'];

function laneOccupied(stationId: string): boolean {
  const response = ui?.response;
  if (!response || !ui?.ghost) return false;
  if (response.outOfService.some((w) => w.stationId === stationId && overlapsGhost(w.localDate, w.localStart, w.localEnd))) return false;
  return response.blocks.some(
    (b) => b.stationId === stationId && b.id !== ui!.inHand?.bookingId && OCCUPYING.includes(b.status ?? '') && ghostOverlaps(b),
  );
}

function overlapsGhost(date: string, start: string, end: string): boolean {
  const ghost = ui?.ghost;
  if (!ghost) return false;
  return ghost.localDate === date && (ghost.localStart ?? '') < end && (start < (ghost.localEnd ?? '24:00'));
}

function ghostOverlaps(block: Block): boolean {
  const ghost = ui?.ghost;
  if (!ghost) return false;
  if (ghost.localDate !== block.localDate) return false;
  return (ghost.localStart ?? '') < (block.localEnd === '24:00' ? '24:00' : block.localEnd ?? '24:00') && ((block.localStart ?? '00:00') < (ghost.localEnd ?? '24:00'));
}

function ghostLabel(): string {
  const ghost = ui?.ghost;
  const origin = ui?.inHand?.origin;
  if (!ghost || !origin) return '';
  const stationName = ui?.response?.stations.find((s) => s.id === ghost.stationId)?.name ?? '';
  return blockLabel({ stationName, kind: origin.kind, localDate: ghost.localDate, localStart: ghost.localStart, localEnd: ghost.localEnd, days: ghost.days });
}

// ---------------------------------------------------------------------------
// New booking dialog
// ---------------------------------------------------------------------------
function dialogShell(title: string, opener: HTMLElement | null): HTMLElement {
  const existing = document.getElementById('board-dialog');
  if (existing) existing.remove();
  const dialog = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, id: 'board-dialog', class: 'board-dialog' });
  dialog.append(h('h2', { class: 'display', text: title }));
  const dim = h('div', { class: 'dialog-dim', id: 'dialog-dim' });
  dim.append(dialog);
  document.body.append(dim);
  (dim as HTMLElement).dataset.openerId = opener?.id ?? '';
  return dialog;
}

function closeDialog(): void {
  const dim = document.getElementById('dialog-dim');
  if (dim) {
    const openerId = (dim as HTMLElement).dataset.openerId;
    dim.remove();
    if (openerId) document.getElementById(openerId)?.focus();
  }
}

function openNewBooking(prefill: { stationId: string; stationName: string; date: string; start?: string; days?: number } | null): void {
  const response = ui?.response;
  const session = appState.session!;
  if (!response || session.user.role !== 'member') return;
  const opener = document.activeElement as HTMLElement | null;
  const dialog = dialogShell('New booking', opener);
  const stationSelect = h('select', { 'aria-label': 'Station' }) as HTMLSelectElement;
  for (const station of response.stations) {
    stationSelect.append(h('option', { value: station.id, text: station.name }));
  }
  if (prefill?.stationId) stationSelect.value = prefill.stationId;
  const dateInput = h('input', { type: 'text', 'aria-label': 'Date', value: prefill?.date ?? ui?.date ?? '' }) as HTMLInputElement;
  const startInput = h('input', { type: 'text', 'aria-label': 'Start', value: prefill?.start ?? '18:00' }) as HTMLInputElement;
  const endInput = h('input', { type: 'text', 'aria-label': 'End', value: prefill?.start ? plusHour(prefill.start) : '21:00' }) as HTMLInputElement;
  const daysInput = h('input', { type: 'number', 'aria-label': 'Days', value: '1', min: '1', max: '31' }) as HTMLInputElement;
  const repeatInput = h('input', { type: 'number', 'aria-label': 'Repeat weekly', value: '1', min: '1', max: '12' }) as HTMLInputElement;
  const notesInput = h('input', { type: 'text', 'aria-label': 'Notes', value: '' }) as HTMLInputElement;
  const fieldError = h('p', { class: 'field-error', id: 'new-booking-error' });
  const syncKind = () => {
    const isShelf = response.stations.find((s) => s.id === stationSelect.value)?.kind === 'shelf';
    startInput.parentElement?.classList.toggle('hidden', !!isShelf);
    endInput.parentElement?.classList.toggle('hidden', !!isShelf);
    repeatInput.parentElement?.classList.toggle('hidden', !!isShelf);
    daysInput.parentElement?.classList.toggle('hidden', !isShelf);
  };
  stationSelect.addEventListener('change', syncKind);
  const form = h('form', { onsubmit: async (ev: Event) => {
    ev.preventDefault();
    const isShelf = response.stations.find((s) => s.id === stationSelect.value)?.kind === 'shelf';
    const body: Record<string, unknown> = isShelf
      ? { stationId: stationSelect.value, date: dateInput.value, days: Number(daysInput.value), notes: notesInput.value }
      : { stationId: stationSelect.value, date: dateInput.value, start: startInput.value, end: endInput.value, repeatWeeks: Number(repeatInput.value), notes: notesInput.value };
    const key = freshKey();
    announce(`Holding ${bodyLabel(body, response)}…`);
    try {
      const result = await api<{ bookings: Block[]; seriesId: string | null }>('POST', '/api/bookings', body, { idempotencyKey: key });
      ui!.lastActionAnswered = Date.now();
      const first = result.data.bookings[0];
      const label = blockLabel({ stationName: stationNameById(first.stationId), kind: first.kind, localDate: first.localDate, localStart: first.localStart, localEnd: first.localEnd, days: first.days });
      announce(`Held ${label} until ${(first.holdExpiresAt ?? '').slice(11, 16)}.`);
      closeDialog();
      if (ui!.date !== first.localDate) {
        ui!.date = first.localDate;
        history.pushState({}, '', `/board?date=${first.localDate}`);
      }
      await readBoard(true);
      const confirmButton = document.querySelector('#ticket-rail button') as HTMLElement | null;
      confirmButton?.focus();
    } catch (err) {
      ui!.lastActionAnswered = Date.now();
      announce('');
      const failure = err as ApiFailure;
      if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
        fieldError.textContent = Object.values(failure.body.errors)[0] ?? 'Check the highlighted fields.';
        showAlert(Object.values(failure.body.errors)[0] ?? 'Check the highlighted fields.');
      } else if (failure instanceof ApiFailure) {
        showAlert(failure.body.message);
      } else {
        showAlert('Lineboard could not reach the server. Check the connection and try again.');
      }
    }
  } },
    h('label', { text: 'Station' }, stationSelect),
    h('label', { text: 'Date' }, dateInput),
    h('label', { class: 'hourly-only', text: 'Start' }, startInput),
    h('label', { class: 'hourly-only', text: 'End' }, endInput),
    h('label', { class: 'shelf-only hidden', text: 'Days' }, daysInput),
    h('label', { class: 'hourly-only', text: 'Repeat weekly' }, repeatInput),
    h('label', { text: 'Notes' }, notesInput),
    fieldError,
    h('button', { type: 'submit', text: 'Hold block' }),
    h('button', { type: 'button', text: 'Close', onclick: () => closeDialog() }),
  );
  dialog.append(form);
  syncKind();
  (dialog.querySelector('select') as HTMLElement).focus();
}

function plusHour(start: string): string {
  const [h, m] = start.split(':').map(Number);
  const end = h + 1;
  return end >= 24 ? '24:00' : `${String(end).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function stationNameById(stationId: string): string {
  return ui?.response?.stations.find((s) => s.id === stationId)?.name ?? stationId;
}

function bodyLabel(body: Record<string, unknown>, response: BoardResponse): string {
  const station = response.stations.find((s) => s.id === body.stationId)?.name ?? '';
  if (body.days !== undefined) {
    return `${station} ${body.date} for ${body.days === 1 ? '1 day' : `${body.days} days`}`;
  }
  return `${station} ${body.date} ${body.start}–${body.end}`;
}

// ---------------------------------------------------------------------------
// Ticket actions
// ---------------------------------------------------------------------------
async function confirmTicket(block: Block): Promise<void> {
  if (!ui) return;
  const session = appState.session!;
  const label = blockLabel({ stationName: stationNameById(block.stationId), kind: block.kind, localDate: block.localDate, localStart: block.localStart, localEnd: block.localEnd, days: block.days });
  ui.pendingDrops++;
  const drawnBalance = appState.hourBankBalance ?? 0;
  const hoursInFlight = block.hours ?? 0;
  const target = Math.max(0, drawnBalance - hoursInFlight);
  announce(`Confirming ${label}…`);
  if (prefersReducedMotion()) {
    updateHourBankFigures(target);
  } else {
    rollHourBank(drawnBalance, target);
  }
  try {
    const result = await api<{ bookings: Block[]; hourBank: HourBank }>('POST', `/api/bookings/${block.id}/confirm`, {}, { idempotencyKey: freshKey() });
    ui.lastActionAnswered = Date.now();
    const confirmed = result.data.bookings[0];
    ui.pendingDrops--;
    const extra = result.data.bookings.length - 1;
    let message = block.kind === 'shelf'
      ? `${blockLabel({ stationName: stationNameById(confirmed.stationId), kind: confirmed.kind, localDate: confirmed.localDate, localStart: confirmed.localStart, localEnd: confirmed.localEnd, days: confirmed.days })} booked`
      : `${stationNameById(confirmed.stationId)}, ${confirmed.localStart} to ${confirmed.localEnd} booked, ${hoursText(result.data.hourBank.balanceHours)} ${result.data.hourBank.balanceHours === 1 ? 'hour' : 'hours'} left${(confirmed.peakHours ?? 0) > 0 ? `, ${hoursText(confirmed.peakHours ?? 0)} ${(confirmed.peakHours ?? 0) === 1 ? 'hour' : 'hours'} at peak` : ''}`;
    if (extra > 0) message += ` and ${extra} ${extra === 1 ? 'week' : 'weeks'}`;
    if (result.status === 202) message += '. Billing is pending.';
    announce(message);
    if (prefersReducedMotion()) {
      // The block appears at once with a ring.
      updateHourBankFigures(result.data.hourBank.balanceHours);
      await readBoard(true);
      ringBlock(confirmed.id);
    } else {
      updateHourBankFigures(result.data.hourBank.balanceHours);
      await readBoard(true);
    }
    refreshBannerSoon();
  } catch (err) {
    ui.lastActionAnswered = Date.now();
    ui.pendingDrops--;
    const failure = err as ApiFailure;
    announce('');
    if (failure instanceof ApiFailure && failure.body.error === 'block_taken') {
      ui.takenTickets.add(block.id);
      showAlert(failure.body.message);
    } else if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
      showAlert(Object.values(failure.body.errors)[0] ?? '');
    } else if (failure instanceof ApiFailure) {
      showAlert(failure.body.message);
    } else {
      showAlert('Lineboard could not reach the server. Check the connection and try again.');
    }
    updateHourBankFigures(Math.max(0, (appState.hourBankBalance ?? 0)));
    await readBoard(false);
  }
}

function ringBlock(id: string): void {
  const element = document.querySelector(`[data-booking-id="${id}"]`);
  if (element) {
    element.classList.add('landing-ring');
    window.setTimeout(() => element.classList.remove('landing-ring'), 1000);
  }
}

/** The hour-bank figures roll to the target, never below zero. */
function rollHourBank(from: number, to: number): void {
  const figures = document.getElementById('hour-bank-figures');
  if (!figures) return;
  const steps = Math.min(8, Math.max(1, Math.abs(to - from) * 4));
  const delta = (to - from) / steps;
  let value = from;
  let step = 0;
  const tick = () => {
    step++;
    if (step >= steps) {
      figures.textContent = `${hoursText(to)} h left`;
      return;
    }
    value += delta;
    figures.textContent = `${hoursText(Math.max(0, Math.round(value * 4) / 4))} h left`;
    window.setTimeout(tick, 180);
  };
  tick();
}

async function discardTicket(block: Block): Promise<void> {
  if (!ui) return;
  ui.discardedTickets.add(block.id);
  announce('Releasing hold…');
  try {
    await api('POST', `/api/bookings/${block.id}/cancel`, {}, { idempotencyKey: freshKey() });
    ui.lastActionAnswered = Date.now();
    announce('Hold released.');
    await readBoard(false);
  } catch (err) {
    ui.lastActionAnswered = Date.now();
    const failure = err as ApiFailure;
    announce('');
    if (failure instanceof ApiFailure) showAlert(failure.body.message);
    else showAlert('Lineboard could not reach the server. Check the connection and try again.');
  }
}

// ---------------------------------------------------------------------------
// Block details
// ---------------------------------------------------------------------------
function openBlockDetails(block: Block, station: { id: string; name: string; kind: string }): void {
  const session = appState.session!;
  const isStaff = session.user.role !== 'member';
  const owns = block.memberId === session.user.memberId;
  if (block.status === 'booked' && !owns) return;
  const opener = document.activeElement as HTMLElement | null;
  const dialog = dialogShell('Block details', opener);
  const label = blockLabel({ stationName: station.name, kind: block.kind, localDate: block.localDate, localStart: block.localStart, localEnd: block.localEnd, days: block.days });
  dialog.append(h('p', { class: 'block-detail-label', text: label }));
  dialog.append(h('p', { text: `Charge ${money(block.chargeCents ?? 0)}` }));
  const actions = block.actions ?? [];
  const buttons: HTMLElement[] = [];
  if (actions.includes('check_in') && isStaff) buttons.push(h('button', { text: 'Check in', onclick: () => statusAction(block, 'check-in', 'Checked in') }));
  if (actions.includes('check_out') && isStaff) buttons.push(h('button', { text: 'Check out', onclick: () => statusAction(block, 'check-out', 'Checked out') }));
  if (actions.includes('no_show') && isStaff) buttons.push(h('button', { text: 'Mark no-show', onclick: () => statusAction(block, 'no-show', 'Marked no-show') }));
  if (actions.includes('move') && isStaff) buttons.push(h('button', { text: 'Pick up to move', onclick: () => { closeDialog(); pickUp(block); } }));
  if (actions.includes('cancel')) buttons.push(h('button', { text: 'Cancel booking', onclick: () => openCancelBooking(block) }));
  buttons.push(h('button', { text: 'Close', onclick: () => closeDialog() }));
  dialog.append(...buttons);
  (buttons[0] ?? buttons[buttons.length - 1])?.focus();
}

async function statusAction(block: Block, action: 'check-in' | 'check-out' | 'no-show', verb: string): Promise<void> {
  if (!ui) return;
  announce('Saving…');
  const button = document.activeElement as HTMLElement;
  button.setAttribute('aria-busy', 'true');
  try {
    const result = await api<{ booking: Block }>('POST', `/api/bookings/${block.id}/${action}`, {});
    ui.lastActionAnswered = Date.now();
    const business = result.data.booking.businessName ?? '';
    announce(`${verb} ${business}.`);
    closeDialog();
    await readBoard(false);
  } catch (err) {
    ui.lastActionAnswered = Date.now();
    button.removeAttribute('aria-busy');
    const failure = err as ApiFailure;
    announce('');
    if (failure instanceof ApiFailure && failure.body.error === 'invalid_transition') {
      closeDialog();
      showAlert(failure.body.message);
      await readBoard(false);
      const element = document.querySelector(`[data-booking-id="${block.id}"]`) as HTMLElement | null;
      element?.focus();
    } else if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
      closeDialog();
      showAlert(Object.values(failure.body.errors)[0] ?? '');
      const element = document.querySelector(`[data-booking-id="${block.id}"]`) as HTMLElement | null;
      element?.focus();
    } else if (failure instanceof ApiFailure) {
      closeDialog();
      showAlert(failure.body.message);
      await readBoard(false);
    } else {
      showAlert('Lineboard could not reach the server. Check the connection and try again.');
    }
  }
}

function openCancelBooking(block: Block): void {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = dialogShell('Cancel booking', opener);
  const cutoff = Date.parse(block.start) - 48 * 3600 * 1000;
  const late = Date.now() > cutoff && block.status === 'confirmed';
  const fee = late ? Math.round((block.chargeCents ?? 0) / 2) : 0;
  dialog.append(h('p', { text: late ? `Late cancellation fee: ${money(fee)}` : 'No cancellation fee' }));
  dialog.append(
    h('button', { text: 'Confirm cancellation', onclick: async () => {
      announce('Cancelling…');
      try {
        const result = await api<{ booking: Block }>('POST', `/api/bookings/${block.id}/cancel`, {}, { idempotencyKey: freshKey() });
        ui!.lastActionAnswered = Date.now();
        const lateFee = result.data.booking.penaltyCents;
        announce(lateFee ? `Cancelled. Late cancellation fee: ${money(lateFee)}.` : 'Cancelled. No cancellation fee.');
        closeDialog();
        await readBoard(false);
      } catch (err) {
        ui!.lastActionAnswered = Date.now();
        announce('');
        const failure = err as ApiFailure;
        closeDialog();
        if (failure instanceof ApiFailure) showAlert(failure.body.message);
        else showAlert('Lineboard could not reach the server. Check the connection and try again.');
        await readBoard(false);
      }
    } }),
    h('button', { text: 'Keep booking', onclick: () => closeDialog() }),
  );
}

function openRelease(block: Block): void {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = dialogShell('Release block', opener);
  const label = blockLabel({ stationName: stationNameById(block.stationId), kind: block.kind, localDate: block.localDate, localStart: block.localStart, localEnd: block.localEnd, days: block.days });
  dialog.append(h('p', { text: `Release ${label} free of charge?` }));
  dialog.append(
    h('button', { text: 'Release', onclick: async () => {
      announce('Releasing…');
      try {
        await api('POST', `/api/bookings/${block.id}/release`, {});
        ui!.lastActionAnswered = Date.now();
        announce(`Released ${label}. No cancellation fee.`);
        closeDialog();
        await readBoard(false);
      } catch (err) {
        ui!.lastActionAnswered = Date.now();
        announce('');
        closeDialog();
        const failure = err as ApiFailure;
        if (failure instanceof ApiFailure) showAlert(failure.body.message);
        else showAlert('Lineboard could not reach the server. Check the connection and try again.');
      }
    } }),
    h('button', { text: 'Keep', onclick: () => closeDialog() }),
  );
}

function openOutOfService(): void {
  const response = ui?.response;
  if (!response) return;
  const opener = document.activeElement as HTMLElement | null;
  const dialog = dialogShell('Out of service', opener);
  const stationSelect = h('select', { 'aria-label': 'Station' }) as HTMLSelectElement;
  for (const station of response.stations.filter((s) => s.kind === 'hourly')) {
    stationSelect.append(h('option', { value: station.id, text: station.name }));
  }
  const dateInput = h('input', { type: 'text', 'aria-label': 'Date', value: ui?.date ?? '' }) as HTMLInputElement;
  const startInput = h('input', { type: 'text', 'aria-label': 'Start', value: '18:00' }) as HTMLInputElement;
  const endInput = h('input', { type: 'text', 'aria-label': 'End', value: '24:00' }) as HTMLInputElement;
  const reasonInput = h('input', { type: 'text', 'aria-label': 'Reason', value: '' }) as HTMLInputElement;
  const errorLine = h('p', { class: 'field-error' });
  dialog.append(
    h('label', { text: 'Station' }, stationSelect),
    h('label', { text: 'Date' }, dateInput),
    h('label', { text: 'Start' }, startInput),
    h('label', { text: 'End' }, endInput),
    h('label', { text: 'Reason' }, reasonInput),
    errorLine,
    h('button', { text: 'Save window', onclick: async () => {
      announce('Saving…');
      try {
        const result = await api<{ window: { localDate: string; localStart: string; localEnd: string }; conflicts: string[] }>('POST', '/api/out-of-service', {
          stationId: stationSelect.value,
          date: dateInput.value,
          start: startInput.value,
          end: endInput.value,
          reason: reasonInput.value,
        });
        ui!.lastActionAnswered = Date.now();
        const stationName = stationNameById(stationSelect.value);
        announce(`${stationName} out of service ${result.data.window.localDate} ${result.data.window.localStart}–${result.data.window.localEnd}. ${result.data.conflicts.length} blocks need moving.`);
        closeDialog();
        await readBoard(false);
      } catch (err) {
        ui!.lastActionAnswered = Date.now();
        announce('');
        const failure = err as ApiFailure;
        if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
          errorLine.textContent = Object.values(failure.body.errors)[0] ?? '';
        } else if (failure instanceof ApiFailure) {
          showAlert(failure.body.message);
        } else {
          showAlert('Lineboard could not reach the server. Check the connection and try again.');
        }
      }
    } }),
    h('button', { text: 'Close', onclick: () => closeDialog() }),
  );
  stationSelect.focus();
}

// ---------------------------------------------------------------------------
// Moving with the keyboard
// ---------------------------------------------------------------------------
function pickUp(block: Block): void {
  if (!ui) return;
  ui.inHand = { bookingId: block.id, version: block.version ?? 1, origin: block };
  ui.ghost = { stationId: block.stationId, localDate: block.localDate, localStart: block.localStart, localEnd: block.localEnd, days: block.days };
  drawRail();
  drawLanes();
  const label = blockLabel({ stationName: stationNameById(block.stationId), kind: block.kind, localDate: block.localDate, localStart: block.localStart, localEnd: block.localEnd, days: block.days });
  announce(`Picked up ${label}. Arrow keys move it, Enter places it, Escape puts it back.`);
  const ghost = document.getElementById('moving-ghost');
  ghost?.focus();
}

function ghostKeydown(ev: KeyboardEvent): void {
  if (!ui || !ui.ghost || !ui.inHand) return;
  const origin = ui.inHand.origin;
  const key = ev.key;
  const shift = ev.shiftKey;
  const kind = origin.kind;
  const response = ui.response;
  if (!response) return;
  if (key === 'Escape') {
    ev.preventDefault();
    putBackFromGhost();
    return;
  }
  if (key === 'Enter') {
    ev.preventDefault();
    if (laneOccupied(ui.ghost.stationId) || oosAtGhost()) {
      announce(`${ghostLabel()} is not free. Choose free time.`);
      return;
    }
    openMoveDialog();
    return;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    ev.preventDefault();
    if (kind === 'shelf') {
      const delta = key === 'ArrowLeft' ? -1 : 1;
      const next = addDays(ui.ghost.localDate, delta);
      if (next < response.today) {
        announce(`${ghostLabel()} Edge of the board.`);
        return;
      }
      ui.ghost.localDate = next;
    } else {
      const deltaMinutes = shift ? 60 : 15;
      const direction = key === 'ArrowLeft' ? -1 : 1;
      const [h, m] = (ui.ghost.localStart ?? '00:00').split(':').map(Number);
      const startMinutes = h * 60 + m;
      const nextStart = startMinutes + direction * deltaMinutes;
      if (nextStart < 0) {
        announce(`${ghostLabel()} Edge of the board.`);
        return;
      }
      const [eh, em] = (ui.ghost.localEnd ?? '24:00').split(':').map(Number);
      const endMinutes = ui.ghost.localEnd === '24:00' ? 24 * 60 : eh * 60 + em;
      const nextEnd = endMinutes + direction * deltaMinutes;
      if (nextEnd > 24 * 60) {
        announce(`${ghostLabel()} Edge of the board.`);
        return;
      }
      ui.ghost.localStart = minutesToTime(nextStart);
      ui.ghost.localEnd = nextEnd === 24 * 60 ? '24:00' : minutesToTime(nextEnd);
    }
    drawLanes();
    drawRail();
    const occupied = laneOccupied(ui.ghost.stationId);
    const oos = oosAtGhost();
    announce(`${ghostLabel()}${occupied ? '. Occupied.' : oos ? '. Out of service.' : '.'}`);
    const ghost = document.getElementById('moving-ghost');
    ghost?.focus();
    return;
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    ev.preventDefault();
    const sameKind = response.stations.filter((s) => s.kind === kind);
    const index = sameKind.findIndex((s) => s.id === ui!.ghost!.stationId);
    const nextIndex = key === 'ArrowUp' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= sameKind.length) {
      announce(`${ghostLabel()} Edge of the board.`);
      return;
    }
    ui.ghost.stationId = sameKind[nextIndex].id;
    drawLanes();
    drawRail();
    const occupied = laneOccupied(ui.ghost.stationId);
    const oos = oosAtGhost();
    announce(`${ghostLabel()}${occupied ? '. Occupied.' : oos ? '. Out of service.' : '.'}`);
    const ghost = document.getElementById('moving-ghost');
    ghost?.focus();
    return;
  }
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function oosAtGhost(): boolean {
  const response = ui?.response;
  const ghost = ui?.ghost;
  if (!response || !ghost) return false;
  return response.outOfService.some(
    (w) => w.stationId === ghost.stationId && w.localDate === ghost.localDate && (w.localStart < (ghost.localEnd ?? '24:00')) && (ghost.localStart ?? '00:00') < w.localEnd,
  );
}

function putBackFromGhost(): void {
  if (!ui || !ui.inHand) return;
  const origin = ui.inHand.origin;
  ui.inHand = null;
  ui.ghost = null;
  drawRail();
  drawLanes();
  const element = document.querySelector(`[data-booking-id="${origin.id}"]`) as HTMLElement | null;
  if (element) {
    element.focus();
  } else {
    const lane = document.querySelector('.lane') as HTMLElement | null;
    lane?.focus();
  }
}

function openMoveDialog(): void {
  if (!ui || !ui.ghost || !ui.inHand) return;
  const origin = ui.inHand.origin;
  const dialog = dialogShell('Move block', document.getElementById('moving-ghost'));
  const fromLabel = blockLabel({ stationName: stationNameById(origin.stationId), kind: origin.kind, localDate: origin.localDate, localStart: origin.localStart, localEnd: origin.localEnd, days: origin.days });
  const toLabel = ghostLabel();
  dialog.append(h('p', { text: `From ${fromLabel} to ${toLabel}` }));
  dialog.append(h('p', { text: 'New charge $—' }));
  const confirm = h('button', { text: 'Confirm move', onclick: async () => {
    const ghost = ui!.ghost!;
    announce('Moving…');
    try {
      const body = origin.kind === 'hourly'
        ? { stationId: ghost.stationId, date: ghost.localDate, start: ghost.localStart, end: ghost.localEnd, version: ui!.inHand!.version }
        : { stationId: ghost.stationId, date: ghost.localDate, days: ghost.days, version: ui!.inHand!.version };
      const result = await api<{ booking: Block }>('POST', `/api/bookings/${ui!.inHand!.bookingId}/move`, body);
      ui!.lastActionAnswered = Date.now();
      announce(`Moved to ${blockLabel({ stationName: stationNameById(result.data.booking.stationId), kind: result.data.booking.kind, localDate: result.data.booking.localDate, localStart: result.data.booking.localStart, localEnd: result.data.booking.localEnd, days: result.data.booking.days })}.`);
      const inHandId = ui!.inHand!.bookingId;
      ui!.inHand = null;
      ui!.ghost = null;
      closeDialog();
      await readBoard(false);
      const element = document.querySelector(`[data-booking-id="${inHandId}"]`) as HTMLElement | null;
      element?.focus();
    } catch (err) {
      const inHand = ui!.inHand!;
      ui!.lastActionAnswered = Date.now();
      announce('');
      ui!.inHand = null;
      ui!.ghost = null;
      closeDialog();
      const failure = err as ApiFailure;
      if (failure instanceof ApiFailure) showAlert(failure.body.message);
      else showAlert('Lineboard could not reach the server. Check the connection and try again.');
      await readBoard(false);
      const element = document.querySelector(`[data-booking-id="${inHand.bookingId}"]`) as HTMLElement | null;
      element?.focus();
    }
  } });
  const putBackButton = h('button', { text: 'Put back', onclick: () => { closeDialog(); putBackFromGhost(); } });
  dialog.append(confirm, putBackButton);
  confirm.focus();
}

export { drawBoard };
