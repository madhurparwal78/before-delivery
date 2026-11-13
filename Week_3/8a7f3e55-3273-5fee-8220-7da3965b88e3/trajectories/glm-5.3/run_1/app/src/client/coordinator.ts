// The coordinator's coverage board: day controls, rows, the detail pane with the weave,
// Seats, Prep materials, Billing and Audit trail panels, with the day and selection in the URL.
import type { Booking, AuditEntry, MaterialInfo, QuoteInfo } from '../shared/api.js';
import { api, app, announceError, announceStatus, clearError, startRefresh, stopRefresh, errorCopyFor, renderHeader, renderHome, newIdempotencyKey } from './shell.js';
import { ApiFailure, NetworkFailure } from './api.js';
import { h, focusNode, trapTab, focusable, countCodePoints } from './dom.js';
import { ERROR_COPY, PENDING_COPY, SUCCESS_COPY, openCallLine, quoteCopy } from './copy.js';
import { drawWeave, factsGrid, markerFor, planChanged, planKey, prepMaterialsPanel, rowButton, type PlanKey } from './detail.js';
import { STATUS_LABELS, TEXT_LIMITS, FIELD_MESSAGES } from '../shared/terms.js';
import { formatCents } from './dom.js';
import { openNewRequestDialog, openAssignDialog, openCompleteDialog, openReleaseDialog, openCancelDialog } from './dialogs.js';

interface BoardState {
  day: string;
  selectedId: string | null;
  selected: Booking | null;
  drawnPlan: PlanKey | null;
  detail: HTMLElement | null;
  listPane: HTMLElement;
  detailPane: HTMLElement;
}

const state: BoardState = {
  day: '',
  selectedId: null,
  selected: null,
  drawnPlan: null,
  detail: null,
  listPane: h('div', { class: 'list-pane' }),
  detailPane: h('div', { class: 'detail-pane' }),
};

export async function renderCoordinatorBoard(): Promise<void> {
  const main = app.main;
  main.replaceChildren(renderHeader());
  const layout = h('div', { class: 'layout' });
  applyLayoutRange(layout);
  layout.append(state.listPane, state.detailPane);
  main.append(layout);

  readUrl();
  await refreshBoard(false);
  startRefresh(() => { void refreshBoard(true); });
}

function applyLayoutRange(layout: HTMLElement): void {
  const sync = () => {
    const width = window.innerWidth;
    if (width <= 767) {
      layout.dataset.range = 'compact';
      state.listPane.classList.toggle('compact-hidden', state.selectedId !== null && state.detail !== null);
      state.detailPane.classList.toggle('compact-hidden', state.selectedId === null);
    } else {
      layout.dataset.range = width <= 1199 ? 'medium' : 'wide';
      state.listPane.classList.remove('compact-hidden');
      state.detailPane.classList.remove('compact-hidden');
    }
  };
  sync();
  window.addEventListener('resize', sync);
}

function readUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const today = app.agency?.today ?? '';
  let day = params.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = today;
  const booking = params.get('booking');
  state.day = day;
  state.selectedId = booking && /^\w[\w-]*$/.test(booking) ? booking : null;
}

function writeUrl(mode: 'push' | 'replace'): void {
  const params = new URLSearchParams();
  params.set('date', state.day);
  if (state.selectedId) params.set('booking', state.selectedId);
  const url = `/?${params.toString()}`;
  if (mode === 'push') window.history.pushState({}, '', url);
  else window.history.replaceState({}, '', url);
}

window.addEventListener('popstate', () => {
  if (app.me?.role !== 'coordinator') return;
  readUrl();
  state.selected = null;
  state.drawnPlan = null;
  void refreshBoard(false);
});

async function fetchDay(): Promise<Booking[]> {
  const result = await api.call<{ bookings: Booking[] }>(`/api/bookings?from=${state.day}&to=${state.day}`, { tag: 'board' });
  return result.bookings;
}

async function refreshBoard(periodic: boolean): Promise<void> {
  let bookings: Booking[];
  try {
    bookings = await fetchDay();
  } catch (err) {
    if (err instanceof NetworkFailure || err instanceof ApiFailure) {
      if (periodic) return; // periodic refreshes change nothing on failure
      return;
    }
    throw err;
  }
  renderList(bookings);
  if (state.selectedId) {
    let detail: Booking | null = bookings.find((b) => b.id === state.selectedId) ?? null;
    if (detail === null) {
      try {
        const single = await api.call<Booking>(`/api/bookings/${state.selectedId}`, { tag: 'board-detail' });
        detail = single;
      } catch {
        detail = null;
      }
    }
    if (detail !== null) {
      if (state.selected?.id !== detail.id) state.drawnPlan = null;
      renderDetail(detail, periodic);
    } else {
      // The booking is not on this day or not visible: drop it from the address.
      state.selectedId = null;
      writeUrl('replace');
      renderDetail(null, periodic);
    }
  } else {
    renderDetail(null, periodic);
  }
}

function renderList(bookings: Booking[]): void {
  const pane = state.listPane;
  const rows = pane.querySelector('.rows');
  if (rows !== null) {
    // Periodic refresh merges in place: keep the scroll position and the focused row.
    const previousScroll = rows.scrollTop;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.bookingId ?? null;
    rows.replaceChildren();
    if (bookings.length === 0) {
      rows.append(h('div', { class: 'empty-row' }, `Nothing is booked for ${state.day}.`));
    }
    for (const booking of bookings) {
      rows.append(buildRow(booking));
    }
    rows.scrollTop = previousScroll;
    if (focusedId !== null) {
      const refocused = rows.querySelector<HTMLElement>(`button.row[data-booking-id="${focusedId}"]`);
      if (refocused && document.activeElement !== document.body) refocused.focus();
    }
    return;
  }
  pane.replaceChildren();
  pane.setAttribute('role', 'region');
  pane.setAttribute('aria-label', 'Coverage board');
  const controls = h('div', { class: 'list-controls' });
  const prev = h('button', { 'aria-label': 'Previous day' }, '‹ Prev');
  const next = h('button', { 'aria-label': 'Next day' }, 'Next ›');
  const dateField = h('input', { type: 'date', 'aria-label': 'Board date', value: state.day });
  prev.addEventListener('click', () => changeDay(addDays(state.day, -1)));
  next.addEventListener('click', () => changeDay(addDays(state.day, 1)));
  dateField.addEventListener('change', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateField.value)) changeDay(dateField.value);
  });
  dateField.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateField.value)) changeDay(dateField.value);
    }
  });
  const newRequest = h('button', {}, 'New request');
  newRequest.addEventListener('click', () => openNewRequestDialog(async (created: Booking) => {
    state.selectedId = created.id;
    if (created.start.slice(0, 10) === state.day) {
      writeUrl('replace');
      await refreshBoard(false);
    } else {
      state.day = created.start.slice(0, 10);
      writeUrl('push');
      await refreshBoard(false);
    }
  }));
  controls.append(prev, next, dateField, newRequest);
  pane.append(controls);
  const freshRows = h('div', { class: 'rows' });
  for (const booking of bookings) {
    freshRows.append(buildRow(booking));
  }
  pane.append(freshRows);
}

function buildRow(booking: Booking): HTMLElement {
  const row = rowButton(booking);
  row.setAttribute('aria-current', booking.id === state.selectedId ? 'true' : 'false');
  if (booking.id === state.selectedId) row.setAttribute('data-selected', 'true');
  row.addEventListener('click', () => {
    state.day = booking.start.slice(0, 10);
    state.selectedId = booking.id;
    writeUrl('replace');
    state.selected = booking;
    state.drawnPlan = null;
    renderDetail(booking, false);
    void refreshBoard(false);
  });
  return row;
}

function changeDay(newDay: string): void {
  state.day = newDay;
  state.selectedId = null;
  state.selected = null;
  state.drawnPlan = null;
  writeUrl('push');
  void refreshBoard(false);
}

/** Switch the board day from outside the board (used by booking deep links). */
export function setBoardDay(day: string): void {
  state.day = day;
  state.selectedId = null;
  state.selected = null;
  state.drawnPlan = null;
  writeUrl('replace');
  void refreshBoard(false);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function renderDetail(booking: Booking | null, periodic: boolean): void {
  const pane = state.detailPane;
  // A periodic refresh keeps the focus inside the detail pane where it was.
  const activeInPane = pane.contains(document.activeElement)
    ? (document.activeElement as HTMLElement)
    : null;
  const activeLabel = activeInPane
    ? (activeInPane.getAttribute('aria-label') ?? activeInPane.textContent ?? '').slice(0, 60)
    : null;
  pane.replaceChildren();
  if (booking === null) {
    state.detail = null;
    pane.append(h('div', { class: 'not-available' }, 'Select a booking to see its detail.'));
    return;
  }
  // In the compact range the detail replaces the list; Back to list returns to it.
  if (window.innerWidth <= 767) {
    const back = h('button', { class: 'back-to-list' }, 'Back to list');
    back.addEventListener('click', () => {
      state.selectedId = null;
      state.selected = null;
      state.drawnPlan = null;
      writeUrl('replace');
      void refreshBoard(false);
      const firstRow = document.querySelector<HTMLElement>('.list-pane .row');
      if (firstRow) firstRow.focus();
    });
    pane.append(back);
  }
  const region = h('section', { 'aria-label': 'Assignment detail', class: 'detail-region', 'data-booking-id': booking.id });
  const heading = h('h2', { class: 'focusable-heading', tabindex: '-1' }, `${booking.ref} · ${booking.title}`);
  region.append(heading);
  const headerRow = h('div', { class: 'detail-header-row' });
  const cancelBtn = h('button', {}, 'Cancel booking');
  cancelBtn.addEventListener('click', () => {
    void openCancelDialog(booking.id, () => { void refreshBoard(false); });
  });
  headerRow.append(cancelBtn);
  region.append(headerRow);
  region.append(factsGrid(booking));

  // The weave redraws only when the plan changed.
  const weaveWrap = h('div', { class: 'weave-wrap' });
  const changed = planChanged(state.drawnPlan, booking);
  let animate: 'entry' | 'collapse' | 'none' = 'none';
  if (changed) animate = 'entry';
  drawWeave(weaveWrap, booking, { animate, collapseHolder: null });
  if (changed) state.drawnPlan = planKey(booking);
  region.append(weaveWrap);

  // Seats panel.
  const seats = h('section', { class: 'panel', 'aria-label': 'Seats' });
  const seatsHeading = h('h3', { class: 'focusable-heading', tabindex: '-1' }, 'Seats');
  seats.append(seatsHeading);
  for (const seat of booking.seats) {
    const row = h('div', { class: 'seat-row' });
    row.append(h('span', { class: 'seat-no' }, `Seat ${seat.seat}`));
    if (seat.holder) {
      const card = h('span', { class: 'holder-card' });
      card.append(h('span', { class: 'initials-badge' }, seat.holder.initials));
      const info = h('span', {});
      info.append(h('span', { class: 'holder-name' }, ` ${seat.holder.name}`));
      const credText = (seat.holder.credentials as Array<{ code: string; expires_on: string }>)
        .map((c) => c.code).join(', ');
      info.append(h('span', { class: 'credentials' }, ` ${credText}`));
      card.append(info);
      row.append(card);
      row.append(h('span', { class: 'private-note' }, `${seat.holder.phone ?? ''} · ${seat.holder.home_city ?? ''}`));
      const release = h('button', { 'aria-label': `Release seat ${seat.seat}` }, `Release seat ${seat.seat}`);
      release.addEventListener('click', () => {
        void openReleaseDialog(booking.id, seat.seat, seat.holder!.name, () => { void refreshBoard(false); });
      });
      row.append(release);
    } else {
      row.append(h('span', { class: 'credentials' }, 'Vacant'));
      const assign = h('button', { 'aria-label': `Assign seat ${seat.seat}` }, `Assign seat ${seat.seat}`);
      assign.addEventListener('click', () => {
        void openAssignDialog(booking.id, seat.seat, () => { void refreshBoard(false); });
      });
      row.append(assign);
    }
    seats.append(row);
  }
  const actions = h('div', { class: 'actions' });
  if (booking.seat_count === 1 && !['in_progress', 'completed', 'cancelled', 'cancelled_late'].includes(booking.status)) {
    const makeTeam = h('button', {}, 'Make team booking');
    makeTeam.addEventListener('click', async () => {
      makeTeam.disabled = true;
      makeTeam.textContent = PENDING_COPY.makeTeam;
      clearError();
      try {
        await api.call<Booking>(`/api/bookings/${booking.id}/team`, { method: 'POST' });
        announceStatus(SUCCESS_COPY.madeTeam(booking.ref));
        await refreshBoard(false);
      } catch (err) {
        makeTeam.disabled = false;
        makeTeam.textContent = 'Make team booking';
        if (err instanceof ApiFailure) announceError(errorCopyFor(err));
        else announceError(ERROR_COPY.network);
      }
    });
    actions.append(makeTeam);
  }
  if (booking.status === 'submitted') {
    const postCall = h('button', {}, 'Post open call');
    postCall.addEventListener('click', async () => {
      postCall.disabled = true;
      postCall.textContent = PENDING_COPY.postOpenCall;
      clearError();
      try {
        await api.call<Booking>(`/api/bookings/${booking.id}/open-call`, { method: 'POST' });
        announceStatus(SUCCESS_COPY.openCall(booking.ref));
        await refreshBoard(false);
      } catch (err) {
        postCall.disabled = false;
        postCall.textContent = 'Post open call';
        if (err instanceof ApiFailure) announceError(errorCopyFor(err));
        else announceError(ERROR_COPY.network);
      }
    });
    actions.append(postCall);
  }
  if (booking.status === 'covered') {
    const checkIn = h('button', {}, 'Check in');
    checkIn.addEventListener('click', async () => {
      checkIn.disabled = true;
      checkIn.textContent = PENDING_COPY.checkIn;
      clearError();
      try {
        await api.call<Booking>(`/api/bookings/${booking.id}/check-in`, { method: 'POST' });
        announceStatus(SUCCESS_COPY.checkIn(booking.ref));
        await refreshBoard(false);
      } catch (err) {
        checkIn.disabled = false;
        checkIn.textContent = 'Check in';
        if (err instanceof ApiFailure) announceError(errorCopyFor(err));
        else announceError(ERROR_COPY.network);
      }
    });
    actions.append(checkIn);
  }
  if (booking.status === 'in_progress') {
    const complete = h('button', {}, 'Mark complete');
    complete.addEventListener('click', () => {
      void openCompleteDialog(booking, () => { void refreshBoard(false); });
    });
    actions.append(complete);
  }
  seats.append(actions);
  const line = openCallLine(booking.open_call_status, booking.open_call_closes_at, 'coordinator');
  if (line) seats.append(h('div', { class: 'open-call-line' }, line));
  region.append(seats);

  // Prep materials.
  region.append(prepMaterialsPanel(booking, {
    upload: true,
    onUpload: async (file) => {
      const { uploadMaterial } = await import('./download.js');
      await uploadMaterial(booking.id, file, () => { void refreshBoard(false); });
    },
  }));

  // Billing panel.
  const billing = h('section', { class: 'panel', 'aria-label': 'Billing' });
  billing.append(h('h3', {}, 'Billing'));
  if (booking.charge) {
    const row = h('div', { class: 'seat-row' });
    row.append(h('span', { class: 'ref' }, booking.charge.line_ref));
    row.append(h('span', { class: 'num mono' }, formatCents(booking.charge.amount_cents)));
    row.append(h('span', { class: 'status-chip' }, booking.charge.sync_status === 'synced' ? 'Synced' : 'Pending sync'));
    billing.append(row);
  } else {
    billing.append(h('div', { class: 'empty-row' }, 'No invoice line yet.'));
  }
  region.append(billing);

  // Audit trail.
  const audit = h('section', { class: 'panel', 'aria-label': 'Audit trail' });
  audit.append(h('h3', {}, 'Audit trail'));
  const auditList = h('ul', { class: 'audit-list' });
  audit.append(auditList);
  region.append(audit);

  state.detail = region;
  pane.append(region);

  if (!periodic) {
    focusNode(heading);
  } else if (activeLabel !== null) {
    // Restore focus to the control with the same name inside the re-rendered pane.
    const candidates = focusable(pane).filter((el) =>
      (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 60) === activeLabel);
    candidates[0]?.focus();
  }

  void loadAudit(booking.id, auditList);
}

async function loadAudit(bookingId: string, list: HTMLElement): Promise<void> {
  try {
    const result = await api.call<{ entries: AuditEntry[] }>(`/api/bookings/${bookingId}/audit`, { tag: `audit-${bookingId}` });
    list.replaceChildren();
    for (const entry of result.entries) {
      const date = entry.at.slice(0, 10);
      const time = entry.at.slice(11, 16);
      list.append(h('li', {}, h('span', { class: 'mono' }, `${date} ${time} · `), `${entry.actor_name} · ${entry.action}`));
    }
  } catch {
    // The audit trail stays empty when it cannot be read.
  }
}
