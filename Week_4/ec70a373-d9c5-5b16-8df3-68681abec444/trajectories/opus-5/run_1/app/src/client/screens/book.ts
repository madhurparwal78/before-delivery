import { newIdempotencyKey, request, serverNow } from '../api';
import { COPY, STATION_TYPE_FILTERS, STATUS_WORDS, hours } from '../copy';
import { Dialog } from '../dialog';
import { button, clear, el, prefersReducedMotion } from '../dom';
import { icon } from '../icons';
import { StatusRegion } from '../status';
import { every } from '../timers';
import { setBlockingDialog } from '../auth';
import type { AppContext } from '../main';
import { Dial } from './book-dial';
import { addDays, localTimeOf, localToInstant, minutesToWall, weekdayName } from '../../shared/tz';
import type {
  AvailabilityJson,
  AvailabilityStation,
  BalancesJson,
  BookingJson,
  SiteJson,
} from '../../shared/types';

interface HoldResponse {
  booking: BookingJson;
  balances: BalancesJson;
}

export function renderBook(container: HTMLElement, ctx: AppContext): void {
  const member = ctx.me.member;
  if (member === null) return;
  let site: SiteJson = ctx.siteById(member.home_site_id) ?? (ctx.sites[0] as SiteJson);
  let stationType = 'all';
  let availableQuarters = Math.round(member.available_hours * 4);
  let availabilityGeneration = 0;
  let pendingRequests = 0;
  let dials: Dial[] = [];
  let tickets: BookingJson[] = [];

  const status = new StatusRegion('Booking status');
  const dialList = el('div', { class: 'dial-list' });
  const spike = el('ul', { role: 'list', 'aria-label': 'Tickets', class: 'ticket-spike' });

  const siteSelect = el('select', { 'aria-label': 'Site', class: 'rail-control' });
  for (const candidate of ctx.sites) {
    siteSelect.append(el('option', { value: candidate.id, text: candidate.name }));
  }
  siteSelect.value = site.id;
  const previousDay = button('Previous day', { class: 'rail-control chevron' });
  previousDay.prepend(icon('chevron-left'));
  const nextDay = button('Next day', { class: 'rail-control chevron' });
  nextDay.prepend(icon('chevron-right'));
  const dateInput = el('input', { type: 'date', class: 'rail-control', id: 'book-date' });
  const dateField = el('div', { class: 'field field-inline' }, [
    el('label', { for: 'book-date', text: 'Date' }),
    dateInput,
  ]);
  const siteTime = el('p', { class: 'site-time' });
  const typeGroup = el('div', { role: 'radiogroup', 'aria-label': 'Station type', class: 'type-filter' });
  const radios: HTMLElement[] = [];
  for (const filter of STATION_TYPE_FILTERS) {
    const radio = el('div', {
      role: 'radio',
      'aria-checked': filter.value === 'all' ? 'true' : 'false',
      tabindex: filter.value === 'all' ? '0' : '-1',
      class: 'type-radio',
      'data-value': filter.value,
      text: filter.label,
    });
    radio.addEventListener('click', () => chooseType(filter.value));
    radio.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseType(filter.value);
      }
    });
    radios.push(radio);
    typeGroup.append(radio);
  }

  const rail = el('div', { class: 'rail' }, [
    el('div', { class: 'rail-row' }, [siteSelect, previousDay, dateField, nextDay, siteTime]),
    typeGroup,
  ]);

  dateInput.value = nextOpenDate(site);

  container.append(
    rail,
    el('div', { class: 'book-body' }, [dialList, el('section', { class: 'spike-column' }, [spike])]),
    status.element,
  );

  function nextOpenDate(forSite: SiteJson): string {
    const localDate = forSite.local_date;
    const wallHour = Number.parseInt(forSite.local_now.slice(11, 13), 10);
    const afterCutoff = wallHour >= 18;
    return addDays(localDate, afterCutoff ? 2 : 1);
  }

  function quartersFor(startMinutes: number, endMinutes: number): number {
    if (endMinutes <= startMinutes) return 0;
    const date = dateInput.value;
    const start = localToInstant(site.time_zone, date, startMinutes);
    const end = localToInstant(site.time_zone, date, endMinutes);
    return Math.round((end - start) / 900000);
  }

  function chooseType(value: string): void {
    stationType = value;
    for (const radio of radios) {
      const checked = radio.getAttribute('data-value') === value;
      radio.setAttribute('aria-checked', checked ? 'true' : 'false');
      radio.setAttribute('tabindex', checked ? '0' : '-1');
    }
    loadAvailability({ reset: true });
  }

  function paintSiteTime(): void {
    siteTime.textContent = `Site time ${localTimeOf(site.time_zone, serverNow())}`;
  }

  function dialFor(station: AvailabilityStation): Dial {
    return new Dial(station, {
      quartersFor,
      availableQuarters: () => availableQuarters,
      isBusy: () => pendingRequests > 0,
      serverNow,
      onClaim: (dial) => void sendHold(dial),
      onConfirm: (dial) => void confirmHold(dial),
      onRelease: (dial) => void releaseHold(dial),
      onRepeatWeekly: (dial) => openRepeatWeekly(dial),
    });
  }

  function drawDials(stations: AvailabilityStation[], reset: boolean): void {
    const sameSet =
      dials.length === stations.length &&
      dials.every((dial, index) => dial.station.id === (stations[index] as AvailabilityStation).id);
    if (!sameSet) {
      clear(dialList);
      dials = stations.map((station) => dialFor(station));
      for (const dial of dials) {
        dial.updateSectors(dial.station);
        dial.resetToEarliestOpen();
        dialList.append(dial.group);
      }
      return;
    }
    for (let index = 0; index < dials.length; index += 1) {
      const dial = dials[index] as Dial;
      const station = stations[index] as AvailabilityStation;
      dial.updateSectors(station);
      if (reset) {
        dial.holdBookingId = null;
        dial.holdExpiresAt = null;
        dial.confirmedBalanceQuarters = null;
        dial.hideHeldActions();
        dial.resetToEarliestOpen();
        continue;
      }
      if (
        !dial.dragging &&
        !dial.attemptPending &&
        dial.endMinutes > dial.startMinutes &&
        dial.footprintBlocked(dial.startMinutes, dial.endMinutes)
      ) {
        dial.resetToEarliestOpen();
        status.write(COPY.slotTaken);
      } else {
        dial.paint();
      }
    }
  }

  function loadAvailability(options: { reset?: boolean } = {}): void {
    availabilityGeneration += 1;
    const generation = availabilityGeneration;
    pendingRequests += 1;
    for (const dial of dials) dial.setBusy(true);
    const date = dateInput.value;
    void request<AvailabilityJson>(
      `/api/sites/${site.id}/availability?date=${encodeURIComponent(date)}`,
    ).then((result) => {
      pendingRequests = Math.max(0, pendingRequests - 1);
      if (generation !== availabilityGeneration) return;
      for (const dial of dials) dial.setBusy(false);
      if (!result.ok) return;
      const stations = result.data.stations.filter(
        (station) => stationType === 'all' || station.kind === stationType,
      );
      drawDials(stations, options.reset === true);
    });
  }

  function loadTickets(): void {
    void request<{ bookings: BookingJson[] }>('/api/bookings').then((result) => {
      if (!result.ok) return;
      tickets = result.data.bookings;
      drawTickets();
    });
  }

  function applyBalances(balances: BalancesJson): void {
    availableQuarters = Math.round(balances.available_hours * 4);
    for (const dial of dials) dial.paintCentre();
  }

  function drawTickets(): void {
    clear(spike);
    for (const booking of tickets) {
      spike.append(ticketItem(booking));
    }
  }

  function ticketItem(booking: BookingJson): HTMLElement {
    const item = el('li', { role: 'listitem', class: 'ticket', tabindex: '0' });
    item.setAttribute('data-booking', booking.id);
    const statusCell = el('p', { class: 'ticket-status', text: STATUS_WORDS[booking.status] ?? '' });
    item.append(
      el('p', { class: 'ticket-reference', text: booking.reference }),
      el('p', { class: 'ticket-station', text: `${booking.station_name} · ${siteName(booking.site_id)}` }),
      el('p', {
        class: 'ticket-when',
        text: `${booking.date} ${booking.start}–${booking.end}`,
      }),
      el('p', { class: 'ticket-hours', text: `${hours(booking.hours)} h` }),
      statusCell,
    );
    if (booking.status === 'cancelled' && booking.cancelled_by !== null) {
      if (booking.cancelled_by.user_id !== ctx.me.user.id) {
        item.append(
          el('p', { class: 'ticket-canceller', text: `Cancelled by ${booking.cancelled_by.name}` }),
        );
      }
    }
    if (booking.status === 'held' || booking.status === 'confirmed') {
      const cancel = button('Cancel booking', { class: 'ticket-action' });
      cancel.addEventListener('click', () => openCancelDialog(booking, cancel, item));
      item.append(cancel);
    }
    item.append(el('span', { class: 'ticket-tear', 'aria-hidden': 'true' }));
    return item;
  }

  function siteName(siteId: string): string {
    return ctx.siteById(siteId)?.name ?? '';
  }

  function redrawOneBooking(bookingId: string, copy: string): void {
    void request<{ booking: BookingJson }>(`/api/bookings/${bookingId}`).then((result) => {
      if (!result.ok) return;
      const booking = result.data.booking;
      tickets = tickets.map((candidate) => (candidate.id === booking.id ? booking : candidate));
      const existing = spike.querySelector(`[data-booking="${bookingId}"]`);
      const replacement = ticketItem(booking);
      if (existing !== null) existing.replaceWith(replacement);
      else spike.prepend(replacement);
      replacement.focus();
      status.write(copy);
    });
    void request<{ balances: BalancesJson }>('/api/me/ledger').then((result) => {
      if (result.ok) applyBalances(result.data.balances);
    });
  }

  async function sendHold(dial: Dial): Promise<void> {
    if (dial.attemptKey === null || !dial.attemptPending) {
      if (dial.attemptKey === null) dial.attemptKey = newIdempotencyKey();
    }
    if (dial.attemptPending) return;
    const key = dial.attemptKey as string;
    const start = minutesToWall(dial.startMinutes);
    const end = minutesToWall(dial.endMinutes);
    dial.attemptPending = true;
    status.write(COPY.holding(start, end));
    const result = await request<HoldResponse>('/api/bookings', {
      method: 'POST',
      idempotencyKey: key,
      body: { station_id: dial.station.id, date: dateInput.value, start, end },
    });
    dial.attemptPending = false;
    if (result.ok) {
      dial.attemptKey = null;
      const booking = result.data.booking;
      dial.holdBookingId = booking.id;
      dial.holdExpiresAt =
        booking.hold_expires_at === null ? null : Date.parse(booking.hold_expires_at);
      dial.showHeldActions();
      dial.resetToEarliestOpen();
      dial.paintCentre();
      applyBalances(result.data.balances);
      tickets = [booking, ...tickets.filter((candidate) => candidate.id !== booking.id)];
      drawTickets();
      status.write(
        COPY.held(
          dial.station.name,
          booking.start,
          booking.end,
          localTime(booking.hold_expires_at, site.time_zone),
        ),
      );
      dial.confirmButton.focus();
      loadAvailability();
      return;
    }
    const code = result.error.code;
    if (code === 'idempotency_in_progress') {
      status.write(COPY.holdInProgress);
      return;
    }
    dial.attemptKey = null;
    dial.resetToEarliestOpen();
    status.write(holdFailureCopy(code, result));
    loadAvailability();
  }

  function holdFailureCopy(code: string, result: { status: number }): string {
    if (code === 'slot_taken') return COPY.slotTaken;
    if (code === 'certificate_expired') return COPY.certificateExpired(dateInput.value);
    if (code === 'cutoff') return COPY.cutoff;
    if (code === 'hold_limit') return COPY.holdLimit;
    if (code === 'insufficient_hours') return COPY.insufficientHours;
    if (code === 'idempotency_conflict') return COPY.holdKeyConflict;
    if (code === 'validation') return COPY.windowInvalid;
    if (code === 'csrf_failed') return COPY.csrf;
    if (result.status === 0) return COPY.offline;
    return COPY.internal;
  }

  function localTime(instant: string | null, zone: string): string {
    if (instant === null) return '';
    return localTimeOf(zone, Date.parse(instant));
  }

  async function confirmHold(dial: Dial): Promise<void> {
    const bookingId = dial.holdBookingId;
    if (bookingId === null) return;
    dial.confirmButton.setAttribute('aria-disabled', 'true');
    status.write(COPY.confirming);
    const result = await request<HoldResponse>(`/api/bookings/${bookingId}/confirm`, {
      method: 'POST',
      body: {},
    });
    dial.confirmButton.setAttribute('aria-disabled', 'false');
    if (result.ok) {
      const booking = result.data.booking;
      dial.holdBookingId = null;
      dial.holdExpiresAt = null;
      dial.hideHeldActions();
      applyBalances(result.data.balances);
      dial.confirmedBalanceQuarters = Math.round(result.data.balances.available_hours * 4);
      dial.paintCentre();
      tickets = tickets.map((candidate) => (candidate.id === booking.id ? booking : candidate));
      drawTickets();
      status.write(
        COPY.confirmed(
          booking.station_name,
          booking.date,
          booking.start,
          booking.end,
          result.data.balances.available_hours,
        ),
      );
      const ticket = spike.querySelector(`[data-booking="${booking.id}"]`) as HTMLElement | null;
      ticket?.focus();
      loadAvailability();
      return;
    }
    if (result.error.code === 'hold_expired') {
      dial.holdBookingId = null;
      dial.holdExpiresAt = null;
      dial.hideHeldActions();
      dial.paintCentre();
      redrawOneBooking(bookingId, COPY.holdExpired);
      loadAvailability();
      return;
    }
    if (result.error.code === 'invalid_transition') {
      redrawOneBooking(bookingId, COPY.ticketChanged);
      return;
    }
    if (result.error.code === 'certificate_expired') {
      status.write(COPY.certificateExpired(dateInput.value));
      return;
    }
    status.write(result.status === 0 ? COPY.offline : COPY.internal);
  }

  async function releaseHold(dial: Dial): Promise<void> {
    const bookingId = dial.holdBookingId;
    if (bookingId === null) return;
    dial.releaseButton.setAttribute('aria-disabled', 'true');
    status.write(COPY.releasing);
    const result = await request<{ balances: BalancesJson; booking: BookingJson }>(
      `/api/bookings/${bookingId}/cancel`,
      { method: 'POST', body: {} },
    );
    dial.releaseButton.setAttribute('aria-disabled', 'false');
    if (result.ok) {
      dial.holdBookingId = null;
      dial.holdExpiresAt = null;
      dial.hideHeldActions();
      dial.resetToEarliestOpen();
      applyBalances(result.data.balances);
      tickets = tickets.map((candidate) =>
        candidate.id === result.data.booking.id ? result.data.booking : candidate,
      );
      drawTickets();
      status.write(COPY.released(result.data.balances.available_hours));
      loadAvailability();
      return;
    }
    if (result.error.code === 'invalid_transition') {
      dial.holdBookingId = null;
      dial.holdExpiresAt = null;
      dial.hideHeldActions();
      dial.paintCentre();
      redrawOneBooking(bookingId, COPY.ticketChanged);
      return;
    }
    status.write(result.status === 0 ? COPY.offline : COPY.internal);
  }

  function outcomeFor(booking: BookingJson): {
    kind: 'refund' | 'split' | 'forfeit';
    refunded: number;
    forfeited: number;
  } {
    if (booking.status === 'held') {
      return { kind: 'refund', refunded: booking.hours, forfeited: 0 };
    }
    const noticeMs = Date.parse(booking.start_at) - serverNow();
    const quarters = Math.round(booking.hours * 4);
    if (noticeMs >= 72 * 3600 * 1000) {
      return { kind: 'refund', refunded: booking.hours, forfeited: 0 };
    }
    if (noticeMs >= 48 * 3600 * 1000) {
      const forfeited = Math.ceil(quarters / 2);
      return { kind: 'split', refunded: (quarters - forfeited) / 4, forfeited: forfeited / 4 };
    }
    return { kind: 'forfeit', refunded: 0, forfeited: booking.hours };
  }

  function openCancelDialog(
    booking: BookingJson,
    opener: HTMLElement,
    ticket: HTMLElement,
  ): void {
    const outcome = new StatusRegion('Cancellation outcome');
    const confirm = button('Confirm cancellation', { class: 'primary' });
    const keep = button('Keep booking');
    const dialog = new Dialog({
      title: `Cancel booking ${booking.reference}`,
      opener,
      focusOnClose: () => ticket,
    });
    dialog.body.append(outcome.element, confirm, keep);
    const info = { dialog, pendingResend: null as (() => void) | null };
    setBlockingDialog(info);
    const paintOutcome = (): void => {
      const current = outcomeFor(booking);
      if (current.kind === 'refund') {
        outcome.writeIfChanged(COPY.outcomeFullRefund(current.refunded));
      } else if (current.kind === 'forfeit') {
        outcome.writeNodes(COPY.outcomeFullForfeit(current.forfeited), [
          el('span', { class: 'forfeit', text: COPY.outcomeFullForfeit(current.forfeited) }),
        ]);
      } else {
        outcome.writeNodes(
          `${COPY.outcomeSplitLead(current.refunded)}${COPY.outcomeSplitTail(current.forfeited)}`,
          [
            document.createTextNode(COPY.outcomeSplitLead(current.refunded)),
            el('span', { class: 'forfeit', text: COPY.outcomeSplitTail(current.forfeited) }),
          ],
        );
      }
    };
    dialog.open(confirm);
    paintOutcome();
    const stop = every(1000, paintOutcome);
    const closeDialog = (): void => {
      stop();
      setBlockingDialog(null);
      dialog.close();
    };
    keep.addEventListener('click', closeDialog);
    dialog.body.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeDialog();
      }
    });
    const send = (): void => {
      confirm.setAttribute('aria-disabled', 'true');
      status.write(COPY.cancelling);
      info.pendingResend = send;
      void request<{
        booking: BookingJson;
        refunded_hours: number;
        forfeited_hours: number;
        balances: BalancesJson;
      }>(`/api/bookings/${booking.id}/cancel`, { method: 'POST', body: {} }).then((result) => {
        confirm.setAttribute('aria-disabled', 'false');
        if (result.status !== 401) info.pendingResend = null;
        if (result.ok) {
          closeDialog();
          applyBalances(result.data.balances);
          const updated = result.data.booking;
          tickets = tickets.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          );
          drawTickets();
          const replacement = spike.querySelector(
            `[data-booking="${updated.id}"]`,
          ) as HTMLElement | null;
          replacement?.focus();
          if (result.data.forfeited_hours === 0) {
            status.write(COPY.cancelledFullRefund(result.data.refunded_hours));
          } else if (result.data.refunded_hours === 0) {
            status.write(COPY.cancelledFullForfeit(result.data.forfeited_hours));
          } else {
            status.write(
              COPY.cancelledSplit(result.data.refunded_hours, result.data.forfeited_hours),
            );
          }
          loadAvailability();
          return;
        }
        if (result.error.code === 'invalid_transition') {
          closeDialog();
          redrawOneBooking(booking.id, COPY.ticketChanged);
          return;
        }
        if (result.status === 401) return;
        status.write(
          result.error.code === 'csrf_failed'
            ? COPY.csrf
            : result.status === 0
              ? COPY.offline
              : COPY.internal,
        );
      });
    };
    confirm.addEventListener('click', () => {
      if (confirm.getAttribute('aria-disabled') === 'true') return;
      send();
    });
  }

  function openRepeatWeekly(dial: Dial): void {
    const weeksSpin = el('input', {
      type: 'number',
      min: '2',
      max: '12',
      value: '4',
      'aria-label': 'Number of weeks',
      class: 'weeks-input',
      id: 'weeks-input',
    });
    const occurrences = el('ul', { role: 'list', 'aria-label': 'Occurrences', class: 'occurrences' });
    const total = new StatusRegion('Series total');
    const bookSeries = button('Book series', { class: 'primary' });
    const close = button('Close');
    const refused = el('p', { class: 'series-refused' });
    const dialog = new Dialog({ title: 'Repeat weekly', opener: dial.repeatButton });
    const startWall = minutesToWall(dial.startMinutes);
    const endWall = minutesToWall(dial.endMinutes);
    dialog.body.append(
      el('p', {
        text: `Every ${weekdayName(dateInput.value)} ${startWall}–${endWall}`,
      }),
      el('div', { class: 'field field-inline' }, [
        el('label', { for: 'weeks-input', text: 'Number of weeks' }),
        weeksSpin,
      ]),
      occurrences,
      total.element,
      bookSeries,
      close,
      refused,
    );

    const preview = (): void => {
      let weeks = Number.parseInt(weeksSpin.value, 10);
      if (!Number.isFinite(weeks)) weeks = 4;
      weeks = Math.min(12, Math.max(2, weeks));
      if (String(weeks) !== weeksSpin.value) weeksSpin.value = String(weeks);
      clear(occurrences);
      let usedQuarters = 0;
      for (let index = 0; index < weeks; index += 1) {
        const date = addDays(dateInput.value, 7 * index);
        const start = localToInstant(site.time_zone, date, dial.startMinutes);
        const end = localToInstant(site.time_zone, date, dial.endMinutes);
        const quarters = Math.round((end - start) / 900000);
        usedQuarters += quarters;
        occurrences.append(
          el('li', {
            role: 'listitem',
            text: `${date} ${startWall}–${endWall} · ${hours(quarters / 4)} h`,
          }),
        );
      }
      const left = availableQuarters - usedQuarters;
      if (left < 0) {
        total.writeIfChanged(`${COPY.seriesUses(usedQuarters / 4)}\n${COPY.seriesNotEnough(weeks)}`);
        bookSeries.setAttribute('aria-disabled', 'true');
      } else {
        total.writeIfChanged(`${COPY.seriesUses(usedQuarters / 4)}\n${COPY.seriesAfter(left / 4)}`);
        bookSeries.setAttribute('aria-disabled', 'false');
      }
    };

    weeksSpin.addEventListener('input', preview);
    weeksSpin.addEventListener('change', preview);
    weeksSpin.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const current = Number.parseInt(weeksSpin.value, 10);
      const next = event.key === 'ArrowUp' ? current + 1 : current - 1;
      if (next < 2 || next > 12) return;
      weeksSpin.value = String(next);
      preview();
    });
    close.addEventListener('click', () => dialog.close());
    bookSeries.addEventListener('click', () => {
      if (bookSeries.getAttribute('aria-disabled') === 'true') return;
      const weeks = Number.parseInt(weeksSpin.value, 10);
      bookSeries.setAttribute('aria-disabled', 'true');
      status.write(COPY.bookingSeries(weeks));
      void request<{ bookings: BookingJson[]; balances: BalancesJson }>('/api/recurring-series', {
        method: 'POST',
        body: {
          station_id: dial.station.id,
          first_date: dateInput.value,
          start: startWall,
          end: endWall,
          weeks,
        },
      }).then((result) => {
        bookSeries.setAttribute('aria-disabled', 'false');
        if (result.ok) {
          dialog.close();
          applyBalances(result.data.balances);
          dial.resetToEarliestOpen();
          tickets = [...result.data.bookings, ...tickets];
          drawTickets();
          status.write(COPY.seriesBooked(weeks, result.data.balances.available_hours));
          dial.repeatButton.focus();
          loadAvailability();
          return;
        }
        const dates = result.error.dates ?? [];
        if (result.error.code === 'series_conflict') {
          refused.textContent = dates.join(', ');
          status.write(COPY.seriesConflict(dates));
          return;
        }
        if (result.error.code === 'certificate_expired') {
          refused.textContent = dates.join(', ');
          status.write(COPY.seriesCertificate(dates));
          return;
        }
        status.write(holdFailureCopy(result.error.code, result));
      });
    });
    dialog.open(weeksSpin);
    preview();
  }

  siteSelect.addEventListener('change', () => {
    const chosen = ctx.siteById(siteSelect.value);
    if (chosen === null) return;
    site = chosen;
    dateInput.value = nextOpenDate(site);
    paintSiteTime();
    loadAvailability({ reset: true });
  });
  previousDay.addEventListener('click', () => {
    dateInput.value = addDays(dateInput.value, -1);
    loadAvailability({ reset: true });
  });
  nextDay.addEventListener('click', () => {
    dateInput.value = addDays(dateInput.value, 1);
    loadAvailability({ reset: true });
  });
  dateInput.addEventListener('change', () => loadAvailability({ reset: true }));

  paintSiteTime();
  loadAvailability({ reset: true });
  loadTickets();
  every(15000, () => loadAvailability());
  every(60000, paintSiteTime);
  every(prefersReducedMotion() ? 60000 : 1000, () => {
    for (const dial of dials) {
      if (dial.holdBookingId === null || dial.holdExpiresAt === null) continue;
      if (dial.holdExpiresAt - serverNow() <= 0) {
        const bookingId = dial.holdBookingId;
        dial.holdBookingId = null;
        dial.holdExpiresAt = null;
        dial.hideHeldActions();
        dial.resetToEarliestOpen();
        status.write(COPY.holdExpired);
        loadAvailability();
        redrawOneBooking(bookingId, COPY.holdExpired);
        continue;
      }
      dial.paintCentre();
    }
  });
}
