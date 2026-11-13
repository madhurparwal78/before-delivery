// The interpreter home: Open calls and My assignments, the detail pane with the weave,
// the Seats panel and Prep materials, with claims that move only on the server's answer.
import type { Booking } from '../shared/api.js';
import { api, app, announceError, announceStatus, clearError, startRefresh, renderHeader, errorCopyFor } from './shell.js';
import { ApiFailure, NetworkFailure } from './api.js';
import { h, focusNode, focusable } from './dom.js';
import { ERROR_COPY, PENDING_COPY, SUCCESS_COPY, openCallLine } from './copy.js';
import { drawWeave, factsGrid, markerFor, planChanged, planKey, prepMaterialsPanel, rowButton, type PlanKey } from './detail.js';
import { openReleaseDialog } from './dialogs.js';
import { STATUS_LABELS } from '../shared/terms.js';

interface InterpreterState {
  openCalls: Booking[];
  assignments: Booking[];
  selectedId: string | null;
  selected: Booking | null;
  drawnPlan: PlanKey | null;
  listPane: HTMLElement;
  detailPane: HTMLElement;
  claimInFlight: Set<string>;
}

const state: InterpreterState = {
  openCalls: [],
  assignments: [],
  selectedId: null,
  selected: null,
  drawnPlan: null,
  listPane: h('div', { class: 'list-pane' }),
  detailPane: h('div', { class: 'detail-pane' }),
  claimInFlight: new Set(),
};

export async function renderInterpreterHome(): Promise<void> {
  const main = app.main;
  main.replaceChildren(renderHeader());
  const layout = h('div', { class: 'layout' });
  layout.append(state.listPane, state.detailPane);
  main.append(layout);
  syncLayoutRange(layout);
  await refreshLists(false);
  startRefresh(() => { void refreshLists(true); });
}

function syncLayoutRange(layout: HTMLElement): void {
  const sync = () => {
    const width = window.innerWidth;
    if (width <= 767) {
      layout.dataset.range = 'compact';
      state.listPane.classList.toggle('compact-hidden', state.selectedId !== null);
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

async function fetchLists(): Promise<{ openCalls: Booking[]; assignments: Booking[] }> {
  const [openCallsRes, mineRes] = await Promise.all([
    api.call<{ bookings: Booking[] }>('/api/open-calls', { tag: 'open-calls' }),
    api.call<{ bookings: Booking[] }>(`/api/bookings`, { tag: 'my-assignments' }),
  ]);
  return { openCalls: openCallsRes.bookings, assignments: mineRes.bookings };
}

async function refreshLists(periodic: boolean): Promise<void> {
  let lists: { openCalls: Booking[]; assignments: Booking[] };
  try {
    lists = await fetchLists();
  } catch {
    if (periodic) return;
    return;
  }
  state.openCalls = lists.openCalls.filter((b) => !state.claimInFlight.has(b.id));
  state.assignments = lists.assignments;
  renderList();
  if (state.selectedId) {
    const held = state.assignments.find((b) => b.id === state.selectedId) ?? null;
    if (held !== null) {
      if (state.selected?.id !== held.id) state.drawnPlan = null;
      renderDetail(held, periodic);
    } else {
      state.selectedId = null;
      renderDetail(null, periodic);
    }
  } else {
    renderDetail(null, periodic);
  }
}

function renderList(): void {
  const pane = state.listPane;
  const priorRows = pane.querySelectorAll('.rows');
  if (priorRows.length > 0) {
    // A refresh merges in place: keep the scroll position and the focused row.
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.bookingId ?? null;
    const scrolls = Array.from(priorRows).map((r) => (r as HTMLElement).scrollTop);
    rebuildListRows(pane);
    Array.from(pane.querySelectorAll('.rows')).forEach((r, i) => {
      (r as HTMLElement).scrollTop = scrolls[i] ?? 0;
    });
    if (focusedId !== null && document.activeElement !== document.body) {
      const refocused = pane.querySelector<HTMLElement>(`button.row[data-booking-id="${focusedId}"]`);
      if (refocused) refocused.focus();
    }
    return;
  }
  rebuildListRows(pane);
}

function rebuildListRows(pane: HTMLElement): void {
  pane.replaceChildren();
  const openRegion = h('div', { role: 'region', 'aria-label': 'Open calls', tabindex: '-1' });
  openRegion.append(h('h3', {}, 'Open calls'));
  const openRows = h('div', { class: 'rows' });
  if (state.openCalls.length === 0) {
    openRows.append(h('div', { class: 'empty-row' }, 'No open calls right now.'));
  }
  for (const booking of state.openCalls) {
    const row = rowButton(booking);
    const claim = h('button', { class: 'claim-btn', 'aria-label': `Claim seat on ${booking.ref}` }, 'Claim seat');
    claim.addEventListener('click', (event) => {
      event.stopPropagation();
      void claimSeat(booking.id, claim);
    });
    row.append(claim);
    row.setAttribute('aria-current', booking.id === state.selectedId ? 'true' : 'false');
    row.addEventListener('click', () => selectBooking(booking.id));
    openRows.append(row);
  }
  openRegion.append(openRows);

  const mineRegion = h('div', { role: 'region', 'aria-label': 'My assignments' });
  mineRegion.append(h('h3', {}, 'My assignments'));
  const mineRows = h('div', { class: 'rows' });
  if (state.assignments.length === 0) {
    mineRows.append(h('div', { class: 'empty-row' }, 'You hold no assignments yet.'));
  }
  for (const booking of state.assignments) {
    const row = rowButton(booking);
    row.setAttribute('aria-current', booking.id === state.selectedId ? 'true' : 'false');
    if (booking.id === state.selectedId) row.setAttribute('data-selected', 'true');
    row.addEventListener('click', () => selectBooking(booking.id));
    mineRows.append(row);
  }
  mineRegion.append(mineRows);
  pane.append(openRegion, mineRegion);
}

function selectBooking(id: string): void {
  state.selectedId = id;
  renderList();
  const booking = state.assignments.find((b) => b.id === id) ?? state.openCalls.find((b) => b.id === id) ?? null;
  if (booking) {
    state.drawnPlan = null;
    renderDetail(booking, false);
  }
  const selectedRow = findRowById(id);
  if (selectedRow) selectedRow.focus();
}

function findRowById(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`button.row[data-booking-id="${id}"]`);
}

async function claimSeat(bookingId: string, claimButton: HTMLButtonElement): Promise<void> {
  const originalLabel = claimButton.getAttribute('aria-label') ?? 'Claim seat';
  claimButton.disabled = true;
  claimButton.textContent = PENDING_COPY.claim;
  claimButton.setAttribute('aria-label', PENDING_COPY.claim);
  state.claimInFlight.add(bookingId);
  clearError();
  try {
    const updated = await api.call<Booking>(`/api/bookings/${bookingId}/claim`, { method: 'POST', tag: 'claim' });
    announceStatus(SUCCESS_COPY.claim(updated.seats.find((s) => s.holder?.is_me)?.seat ?? 1, updated.ref));
    state.claimInFlight.delete(bookingId);
    state.selectedId = bookingId;
    state.drawnPlan = null;
    await refreshLists(false);
    const heading = document.querySelector<HTMLElement>('section[aria-label="Assignment detail"] h2');
    focusNode(heading);
  } catch (err) {
    state.claimInFlight.delete(bookingId);
    claimButton.disabled = false;
    claimButton.textContent = 'Claim seat';
    claimButton.setAttribute('aria-label', originalLabel);
    if (err instanceof ApiFailure && err.code === 'unauthenticated') {
      const { openSessionDialog } = await import('./dialogs.js');
      void openSessionDialog(err, () => { void claimSeat(bookingId, claimButton); });
      return;
    }
    if (err instanceof ApiFailure) {
      announceError(errorCopyFor(err));
      await refreshLists(false);
      const stillListed = state.openCalls.some((b) => b.id === bookingId);
      if (stillListed) {
        claimButton.focus();
      } else {
        const index = state.openCalls.findIndex((b) => b.id === bookingId);
        void index;
        const rows = Array.from(document.querySelectorAll<HTMLElement>('.list-pane [aria-label="Open calls"] .row'));
        const target = rows[0] ?? document.querySelector<HTMLElement>('[aria-label="Open calls"]');
        focusNode(target);
      }
      return;
    }
    announceError(ERROR_COPY.network);
    claimButton.focus();
  }
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
    pane.append(h('div', { class: 'not-available' }, 'Select a booking to see its detail.'));
    return;
  }
  const region = h('section', { 'aria-label': 'Assignment detail', 'data-booking-id': booking.id });
  const heading = h('h2', { class: 'focusable-heading', tabindex: '-1' }, `${booking.ref} · ${booking.title}`);
  region.append(heading, factsGrid(booking));
  const weaveWrap = h('div', { class: 'weave-wrap' });
  const changed = planChanged(state.drawnPlan, booking);
  drawWeave(weaveWrap, booking, { animate: changed ? 'entry' : 'none', collapseHolder: null });
  if (changed) state.drawnPlan = planKey(booking);
  region.append(weaveWrap);

  const seats = h('section', { class: 'panel', 'aria-label': 'Seats' });
  const seatsHeading = h('h3', { class: 'focusable-heading', tabindex: '-1' }, 'Seats');
  seats.append(seatsHeading);
  const mine = booking.seats.some((s) => s.holder?.is_me === true);
  for (const seat of booking.seats) {
    const row = h('div', { class: 'seat-row' });
    row.append(h('span', { class: 'seat-no' }, `Seat ${seat.seat}`));
    if (seat.holder) {
      const creds = (seat.holder.credentials as string[]).join(', ');
      row.append(h('span', { class: 'holder-card' }, h('span', { class: 'initials-badge' }, seat.holder.initials), ` ${seat.holder.name}`));
      row.append(h('span', { class: 'credentials' }, creds));
      if (seat.holder.is_me) {
        const withdraw = h('button', {}, 'Withdraw');
        withdraw.addEventListener('click', () => {
          void openReleaseDialog(booking.id, seat.seat, seat.holder?.name ?? null, async () => {
            state.selectedId = booking.id;
            await refreshLists(false);
          }, { interpreter: true });
        });
        row.append(withdraw);
      }
    } else {
      row.append(h('span', { class: 'credentials' }, 'Vacant'));
    }
    seats.append(row);
  }
  if (!mine && booking.seats.some((s) => s.holder === null) && booking.open_call_status === 'open') {
    const claim = h('button', { 'aria-label': 'Claim seat' }, 'Claim seat');
    claim.addEventListener('click', () => {
      void claimSeat(booking.id, claim as HTMLButtonElement);
    });
    seats.append(claim);
  }
  const line = openCallLine(booking.open_call_status, booking.open_call_closes_at, 'interpreter');
  if (line) seats.append(h('div', { class: 'open-call-line' }, line));
  region.append(seats);
  region.append(prepMaterialsPanel(booking, { downloads: true }));
  pane.append(region);
  if (!periodic) {
    focusNode(heading);
  } else if (activeLabel !== null) {
    const candidates = focusable(pane).filter((el) =>
      (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 60) === activeLabel);
    candidates[0]?.focus();
  }
}
