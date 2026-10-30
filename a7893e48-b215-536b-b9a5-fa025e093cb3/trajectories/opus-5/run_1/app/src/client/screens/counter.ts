import type { Booking } from '../../shared/types.js';
import { api, idempotencyKey } from '../api.js';
import { delayedLabel, onStatusChange, state } from '../app.js';
import { STATUS_STAMP, copy, money } from '../copy.js';
import { clear, el, setStatus, statusRegion } from '../dom.js';
import { openDialog } from '../ui/dialog.js';
import { localStamp, paymentLabel, siteZone } from '../ticket.js';

export function counterScreen(host: HTMLElement): void {
  const user = state.user;
  if (user === null) return;
  const status = statusRegion('Counter status');
  const siteId = state.sites[0]?.id ?? '';
  const body = el('tbody');
  const table = el('table', { class: 'data-table counter-table', 'aria-label': "Today's bookings" }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Renter']),
        el('th', { scope: 'col' }, ['Station']),
        el('th', { scope: 'col' }, ['Time']),
        el('th', { scope: 'col' }, ['Status']),
        el('th', { scope: 'col' }, ['Actions']),
      ]),
    ]),
    body,
  ]);

  const sitePicker = el(
    'select',
    { class: 'select', 'aria-label': 'Site' },
    state.sites.map((site) => el('option', { value: site.id }, [site.name])),
  );
  let currentSite = siteId;
  sitePicker.addEventListener('change', () => {
    currentSite = sitePicker.value;
    void load();
  });

  function today(): string {
    const zone = siteZone(currentSite);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date())
      .replace(/\//g, '-');
  }

  async function load(): Promise<void> {
    const result = await api.get<{ bookings: Booking[] }>(
      `/api/bookings?site_id=${currentSite}&date=${today()}`,
    );
    clear(body);
    if (!result.ok) return;
    for (const booking of result.data.bookings) body.append(row(booking));
    if (result.data.bookings.length === 0) {
      body.append(
        el('tr', {}, [el('td', { colspan: 5, class: 'empty-cell' }, ['No bookings today.'])]),
      );
    }
  }

  function act(
    booking: Booking,
    path: string,
    pending: string,
    success: (booking: Booking) => string,
    failure: (status: number, message: string) => string,
    key?: string,
  ): void {
    setStatus(status, pending);
    void api.post<{ booking: Booking }>(`/api/bookings/${booking.id}/${path}`, {}, key).then(
      async (result) => {
        if (!result.ok) {
          setStatus(status, failure(result.status, result.error.message));
          return;
        }
        setStatus(status, success(result.data.booking));
        await load();
      },
    );
  }

  function row(booking: Booking): HTMLTableRowElement {
    const actions = el('div', { class: 'row-actions' });
    if (booking.status === 'confirmed') {
      const checkIn = el('button', { type: 'button', class: 'button' }, ['Check in']);
      checkIn.addEventListener('click', () =>
        act(
          booking,
          'check-in',
          copy.saving,
          (updated) => copy.checkedIn(updated.renter_business),
          (code, message) => (code === 409 ? copy.outsideCheckInWindow : message),
        ),
      );
      actions.append(checkIn);
    }
    if (booking.status === 'checked_in') {
      const overrun = el('button', { type: 'button', class: 'button', 'aria-label': 'Charge overrun' }, [
        delayedLabel('Charge overrun'),
      ]);
      overrun.addEventListener('click', () => openOverrunDialog(booking));
      actions.append(overrun);
    }
    if (booking.status === 'checked_in' || booking.status === 'overrun_billed') {
      const checkOut = el('button', { type: 'button', class: 'button' }, ['Check out']);
      checkOut.addEventListener('click', () =>
        act(
          booking,
          'check-out',
          copy.saving,
          (updated) => copy.checkedOut(updated.renter_business),
          (_code, message) => message,
        ),
      );
      actions.append(checkOut);
    }
    if (booking.status === 'checked_out') {
      if (booking.cleaning_fee_cents === 0) {
        const cleaning = el(
          'button',
          { type: 'button', class: 'button', 'aria-label': 'Add cleaning fee' },
          [delayedLabel('Add cleaning fee')],
        );
        cleaning.addEventListener('click', () =>
          act(
            booking,
            'cleaning-fee',
            copy.charging,
            (updated) => copy.cleaningCharged(updated.cleaning_fee_cents),
            (code, message) => (code === 503 ? copy.cleaningBillingDelayed : message),
            idempotencyKey(),
          ),
        );
        actions.append(cleaning);
      }
      const settle = el('button', { type: 'button', class: 'button primary', 'aria-label': 'Settle' }, [
        delayedLabel('Settle'),
      ]);
      settle.addEventListener('click', () =>
        act(
          booking,
          'settle',
          copy.settling,
          (updated) => copy.settled(updated.deposit_cents),
          (code, message) => (code === 503 ? copy.settleBillingDelayed : message),
        ),
      );
      actions.append(settle);
    }
    return el('tr', {}, [
      el('td', { 'data-label': 'Renter' }, [booking.renter_business]),
      el('td', { 'data-label': 'Station' }, [booking.station_name]),
      el('td', { class: 'mono', 'data-label': 'Time' }, [
        `${localStamp(siteZone(booking.site_id), booking.start_at).slice(11)} – ${localStamp(siteZone(booking.site_id), booking.end_at).slice(11)}`,
      ]),
      el('td', { 'data-label': 'Status' }, [
        el('span', { class: 'stamp' }, [STATUS_STAMP[booking.status]]),
        el('span', { class: 'payment-note' }, [paymentLabel(booking)]),
      ]),
      el('td', { 'data-label': 'Actions' }, [actions]),
    ]);
  }

  function openOverrunDialog(booking: Booking): void {
    const key = idempotencyKey();
    const minutes = el('input', {
      type: 'number',
      class: 'input mono',
      'aria-label': 'Overrun minutes',
      min: 1,
      max: 240,
      value: 15,
    });
    const quote = el('p', { class: 'overrun-quote mono' }, ['$0.00']);
    const charge = el('button', { type: 'button', class: 'button primary' }, [delayedLabel('Charge')]);
    charge.setAttribute('aria-label', 'Charge');
    const rate = state.sites
      .find((site) => site.id === booking.site_id)
      ?.stations.find((station) => station.id === booking.station_id)?.rate_cents ?? 0;
    const refreshQuote = (): void => {
      const value = Math.min(240, Math.max(1, Number(minutes.value) || 0));
      quote.textContent = money(Math.floor((value * rate) / 60 + 0.5));
    };
    refreshQuote();
    minutes.addEventListener('input', refreshQuote);
    const dialog = openDialog({ label: 'Charge overrun' }, [
      el('label', { class: 'field-label' }, ['Overrun minutes']),
      minutes,
      quote,
      el('div', { class: 'dialog-actions' }, [charge]),
    ]);
    charge.addEventListener('click', () => {
      const value = Math.min(240, Math.max(1, Number(minutes.value) || 0));
      setStatus(status, copy.charging);
      void api
        .post<{ booking: Booking }>(
          `/api/bookings/${booking.id}/overrun`,
          { minutes: value },
          key,
        )
        .then(async (result) => {
          if (!result.ok) {
            setStatus(
              status,
              result.status === 503 ? copy.overrunBillingDelayed : result.error.message,
            );
            return;
          }
          setStatus(
            status,
            copy.overrunCharged(result.data.booking.overrun_minutes, result.data.booking.overrun_cents),
          );
          dialog.close();
          await load();
        });
    });
  }

  host.append(
    el('section', { class: 'panel' }, [
      el('h1', {}, ['Counter']),
      el('div', { class: 'field inline' }, [
        el('label', { class: 'field-label' }, ['Site']),
        sitePicker,
      ]),
      status,
      el('div', { class: 'table-frame' }, [table]),
    ]),
  );
  void load();
  onStatusChange(() => void load());
  window.setInterval(() => void load(), 15_000);
}
