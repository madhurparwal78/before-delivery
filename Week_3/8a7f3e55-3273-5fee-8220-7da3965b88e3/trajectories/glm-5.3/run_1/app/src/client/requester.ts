// The requester home: the organisation's bookings, New request, the Interpreters panel,
// prep uploads and Cancel booking.
import type { Booking } from '../shared/api.js';
import { api, app, announceError, announceStatus, clearError, startRefresh, renderHeader, errorCopyFor } from './shell.js';
import { ApiFailure } from './api.js';
import { h, focusNode, focusable, formatCents } from './dom.js';
import { ERROR_COPY } from './copy.js';
import { drawWeave, factsGrid, interpretersPanel, planChanged, planKey, prepMaterialsPanel, rowButton, type PlanKey } from './detail.js';
import { openNewRequestDialog, openCancelDialog } from './dialogs.js';
import { STATUS_LABELS } from '../shared/terms.js';

interface RequesterState {
  bookings: Booking[];
  selectedId: string | null;
  selected: Booking | null;
  drawnPlan: PlanKey | null;
  listPane: HTMLElement;
  detailPane: HTMLElement;
}

const state: RequesterState = {
  bookings: [],
  selectedId: null,
  selected: null,
  drawnPlan: null,
  listPane: h('div', { class: 'list-pane' }),
  detailPane: h('div', { class: 'detail-pane' }),
};

export async function renderRequesterHome(): Promise<void> {
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

async function refreshLists(periodic: boolean): Promise<void> {
  let bookings: Booking[];
  try {
    const result = await api.call<{ bookings: Booking[] }>('/api/bookings', { tag: 'requester-list' });
    bookings = result.bookings;
  } catch {
    if (periodic) return;
    return;
  }
  state.bookings = bookings;
  renderList();
  if (state.selectedId) {
    const selected = bookings.find((b) => b.id === state.selectedId) ?? null;
    if (selected !== null) {
      if (state.selected?.id !== selected.id) state.drawnPlan = null;
      renderDetail(selected, periodic);
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
  const rows = pane.querySelector('.rows');
  if (rows !== null) {
    // A refresh merges in place: keep the scroll position and the focused row.
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.bookingId ?? null;
    const previousScroll = rows.scrollTop;
    const focusedSelected = document.activeElement?.getAttribute('aria-label') === 'New request';
    rows.replaceChildren();
    for (const booking of state.bookings) {
      rows.append(buildRequesterRow(booking));
    }
    rows.scrollTop = previousScroll;
    if (focusedSelected) {
      const button = pane.querySelector<HTMLElement>('button[aria-label="New request"]');
      if (button && document.activeElement !== document.body) button.focus();
    } else if (focusedId !== null && document.activeElement !== document.body) {
      const refocused = rows.querySelector<HTMLElement>(`button.row[data-booking-id="${focusedId}"]`);
      if (refocused) refocused.focus();
    }
    return;
  }
  pane.replaceChildren();
  pane.setAttribute('role', 'region');
  pane.setAttribute('aria-label', 'Bookings');
  const controls = h('div', { class: 'list-controls' });
  const newRequest = h('button', {}, 'New request');
  newRequest.addEventListener('click', () => {
    void openNewRequestDialog(async (created: Booking) => {
      state.selectedId = created.id;
      state.drawnPlan = null;
      await refreshLists(false);
    });
  });
  controls.append(newRequest);
  pane.append(controls);
  const freshRows = h('div', { class: 'rows' });
  if (state.bookings.length === 0) {
    freshRows.append(h('div', { class: 'empty-row' }, 'No bookings for your organisation yet.'));
  }
  for (const booking of state.bookings) {
    freshRows.append(buildRequesterRow(booking));
  }
  pane.append(freshRows);
}

function buildRequesterRow(booking: Booking): HTMLElement {
  const row = rowButton(booking);
  row.setAttribute('aria-current', booking.id === state.selectedId ? 'true' : 'false');
  if (booking.id === state.selectedId) row.setAttribute('data-selected', 'true');
  row.addEventListener('click', () => {
    state.selectedId = booking.id;
    state.drawnPlan = null;
    renderList();
    renderDetail(booking, false);
    const selectedRow = document.querySelector<HTMLElement>(`button.row[data-booking-id="${booking.id}"]`);
    if (selectedRow) {
      selectedRow.setAttribute('data-selected', 'true');
    }
    const heading = document.querySelector<HTMLElement>('section[aria-label="Assignment detail"] h2');
    focusNode(heading);
  });
  return row;
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
  region.append(heading);
  const cancelBtn = h('button', {}, 'Cancel booking');
  const canCancel = ['submitted', 'open', 'partially_covered', 'covered'].includes(booking.status);
  if (canCancel) {
    cancelBtn.addEventListener('click', () => {
      void openCancelDialog(booking.id, () => { void refreshLists(false); });
    });
  } else {
    cancelBtn.disabled = true;
  }
  const headerRow = h('div', { class: 'detail-header-row' });
  headerRow.append(cancelBtn);
  region.append(headerRow);
  region.append(factsGrid(booking));
  if (booking.requester_notes) {
    const notes = h('div', { class: 'fact' });
    notes.append(h('span', { class: 'k' }, 'Notes for the agency'));
    notes.append(h('span', {}, booking.requester_notes));
    region.append(notes);
  }
  const weaveWrap = h('div', { class: 'weave-wrap' });
  const changed = planChanged(state.drawnPlan, booking);
  drawWeave(weaveWrap, booking, { animate: changed ? 'entry' : 'none', collapseHolder: null });
  if (changed) state.drawnPlan = planKey(booking);
  region.append(weaveWrap);
  region.append(interpretersPanel(booking));
  region.append(prepMaterialsPanel(booking, {
    upload: true,
    onUpload: async (file) => {
      const { uploadMaterial } = await import('./download.js');
      await uploadMaterial(booking.id, file, () => { void refreshLists(false); });
    },
  }));
  if (booking.charge) {
    const charge = h('div', { class: 'seat-row' });
    charge.append(h('span', { class: 'k' }, 'Charge'));
    charge.append(h('span', { class: 'num mono' }, formatCents(booking.charge.amount_cents)));
    region.append(charge);
  }
  pane.append(region);
  if (!periodic) {
    focusNode(heading);
  } else if (activeLabel !== null) {
    const candidates = focusable(pane).filter((el) =>
      (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 60) === activeLabel);
    candidates[0]?.focus();
  }
}
