import { api, apiOrNull, ApiFailure, freshKey, type Block } from './api.js';
import { h, clear, money, monthName, blockLabel, statusWords, STATUS_WORDS, addDays } from './ui.js';
import { announce, showAlert, refreshBannerSoon, type AppState } from './main.js';

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------
export async function renderBookings(main: HTMLElement, state: AppState): Promise<void> {
  const session = state.session!;
  const url = new URLSearchParams(window.location.search);
  const monthParam = url.get('month');
  let month = monthParam ?? state.kitchen?.currentMonth ?? '';
  if (!monthParam) {
    history.replaceState({}, '', `/bookings?month=${month}`);
  }
  const region = h('div', { role: 'region', 'aria-label': 'Booking list', id: 'booking-list' });
  const monthInput = h('input', { type: 'text', 'aria-label': 'Month', value: month }) as HTMLInputElement;
  const monthError = h('p', { class: 'field-error' });
  const commitMonth = () => {
    const value = monthInput.value;
    const current = new URLSearchParams(window.location.search).get('month') ?? '';
    if (value === current) return;
    if (!/^\d{4}-\d{2}$/.test(value)) {
      monthError.textContent = 'Use a month in the form YYYY-MM.';
      return;
    }
    monthError.textContent = '';
    history.pushState({}, '', `/bookings?month=${value}`);
    void loadBookings(value);
  };
  monthInput.addEventListener('change', commitMonth);
  monthInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commitMonth();
    }
  });
  main.append(h('div', { class: 'panel' }, h('label', { text: 'Month' }, monthInput), monthError));
  main.append(region);
  if (session.user.role === 'member' && session.user.memberId) {
    main.append(businessPanel(state));
  }
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    monthInput.value = month;
    monthError.textContent = 'Use a month in the form YYYY-MM.';
    return;
  }
  await loadBookings(month);
}

async function loadBookings(month: string): Promise<void> {
  const region = document.getElementById('booking-list')!;
  region.setAttribute('aria-busy', 'true');
  const target = new URLSearchParams(window.location.search).get('month') ?? month;
  const result = await apiOrNull<{ month: string; bookings: Block[] }>('GET', `/api/bookings?month=${target}`);
  if (!result || new URLSearchParams(window.location.search).get('month') !== target) return;
  region.removeAttribute('aria-busy');
  clear(region);
  const table = h('table', { 'aria-label': document.querySelector('nav a') && 'My bookings' || 'My bookings' });
  table.setAttribute('aria-label', 'My bookings');
  table.append(h('thead', {}, h('tr', {},
    h('th', { text: 'Block' }), h('th', { text: 'Business' }), h('th', { text: 'Status' }), h('th', { text: 'Charge' }), h('th', { text: 'Actions' }),
  )));
  const body = h('tbody');
  for (const booking of result.data.bookings) {
    const label = blockLabel({ stationName: booking.stationName ?? '', kind: booking.kind, localDate: booking.localDate, localStart: booking.localStart, localEnd: booking.localEnd, days: booking.days });
    const row = h('tr', {},
      h('td', { text: label }),
      h('td', { text: booking.businessName ?? '' }),
      h('td', { text: statusWords({ status: booking.status, conflict: booking.conflict, billingStatus: booking.billingStatus }) }),
      h('td', { text: money(booking.chargeCents ?? 0) }),
      h('td', {}),
    );
    if ((booking.actions ?? []).includes('cancel')) {
      row.lastElementChild!.append(h('button', { text: `Cancel ${label}`, onclick: () => cancelBooking(booking) }));
    }
    body.append(row);
  }
  table.append(body);
  region.append(table);
}

function cancelBooking(booking: Block): Promise<void> {
  const label = blockLabel({ stationName: booking.stationName ?? '', kind: booking.kind, localDate: booking.localDate, localStart: booking.localStart, localEnd: booking.localEnd, days: booking.days });
  const cutoff = Date.parse(booking.start) - 48 * 3600 * 1000;
  const late = Date.now() > cutoff && booking.status === 'confirmed';
  const fee = late ? Math.round((booking.chargeCents ?? 0) / 2) : 0;
  const dim = h('div', { class: 'dialog-dim', id: 'dialog-dim' });
  const dialog = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cancel booking', class: 'board-dialog' },
    h('h2', { class: 'display', text: 'Cancel booking' }),
    h('p', { text: late ? `Late cancellation fee: ${money(fee)}` : 'No cancellation fee' }),
    h('button', { text: 'Confirm cancellation', onclick: async () => {
      announce('Cancelling…');
      try {
        const result = await api<{ booking: Block }>('POST', `/api/bookings/${booking.id}/cancel`, {}, { idempotencyKey: freshKey() });
        announce(result.data.booking.penaltyCents ? `Cancelled. Late cancellation fee: ${money(result.data.booking.penaltyCents)}.` : 'Cancelled. No cancellation fee.');
        dim.remove();
        const month = new URLSearchParams(window.location.search).get('month') ?? '';
        await loadBookings(month);
      } catch (err) {
        announce('');
        dim.remove();
        const failure = err as ApiFailure;
        showAlert(failure instanceof ApiFailure ? failure.body.message : 'Lineboard could not reach the server. Check the connection and try again.');
      }
    } }),
    h('button', { text: 'Keep booking', onclick: () => dim.remove() }),
  );
  dim.append(dialog);
  document.body.append(dim);
  dialog.querySelector('button')?.focus();
  return Promise.resolve();
}

function businessPanel(state: AppState): HTMLElement {
  const nameInput = h('input', { type: 'text', 'aria-label': 'Business name', value: '' }) as HTMLInputElement;
  const save = h('button', { text: 'Save business name', onclick: async () => {
    announce('Saving…');
    (save as HTMLButtonElement).disabled = true;
    save.setAttribute('aria-busy', 'true');
    try {
      const result = await api<{ member: { businessName: string } }>('PATCH', '/api/members/me', { businessName: nameInput.value });
      announce('Business name saved.');
      nameInput.value = result.data.member.businessName;
    } catch (err) {
      announce('');
      const failure = err as ApiFailure;
      if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
        showAlert(Object.values(failure.body.errors)[0] ?? '');
      } else if (failure instanceof ApiFailure) {
        showAlert(failure.body.message);
      } else {
        showAlert('Lineboard could not reach the server. Check the connection and try again.');
      }
    }
    (save as HTMLButtonElement).disabled = false;
    save.removeAttribute('aria-busy');
  } });
  const panel = h('div', { class: 'panel', role: 'region', 'aria-label': 'Business details' },
    h('h2', { class: 'display', text: 'Business details' }),
    h('label', { text: 'Business name' }, nameInput),
    save,
  );
  void api<{ member: { businessName: string } }>('GET', `/api/members/${state.session!.user.memberId}`).then((r) => {
    nameInput.value = r.data.member.businessName;
  }).catch(() => undefined);
  return panel;
}
