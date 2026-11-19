import { newIdempotencyKey, request, serverNow } from '../api';
import { COPY, STATUS_WORDS, hours, lateMinutes, money } from '../copy';
import { Dialog } from '../dialog';
import { button, clear, el, row, table } from '../dom';
import { icon } from '../icons';
import { StatusRegion, showFieldError } from '../status';
import { every } from '../timers';
import { setBlockingDialog } from '../auth';
import type { AppContext } from '../main';
import { addDays, localTimeOf } from '../../shared/tz';
import type { BookingJson, SiteJson } from '../../shared/types';

export function renderSiteDay(container: HTMLElement, ctx: AppContext): void {
  const first = ctx.sites[0] as SiteJson | undefined;
  if (first === undefined) return;
  const site = first;
  const status = new StatusRegion('Site day status');
  const bookings = table('Bookings', ['Time', 'Station', 'Member', 'Status', 'Actions']);
  const previousDay = button('Previous day', { class: 'rail-control chevron' });
  previousDay.prepend(icon('chevron-left'));
  const nextDay = button('Next day', { class: 'rail-control chevron' });
  nextDay.prepend(icon('chevron-right'));
  const dateInput = el('input', { type: 'date', class: 'rail-control', id: 'site-date' });
  const siteTime = el('p', { class: 'site-time' });
  dateInput.value = site.local_date;
  let rows: BookingJson[] = [];

  container.append(
    el('div', { class: 'rail' }, [
      el('div', { class: 'rail-row' }, [
        el('p', { class: 'rail-site', text: `Site: ${site.name}` }),
        previousDay,
        el('div', { class: 'field field-inline' }, [
          el('label', { for: 'site-date', text: 'Date' }),
          dateInput,
        ]),
        nextDay,
        siteTime,
      ]),
    ]),
    bookings.root,
    status.element,
  );

  function paintSiteTime(): void {
    siteTime.textContent = `Site time ${localTimeOf(site.time_zone, serverNow())}`;
  }

  function statusCellOf(bookingId: string): HTMLElement | null {
    return bookings.body.querySelector(
      `[data-booking="${bookingId}"] .row-status`,
    ) as HTMLElement | null;
  }

  function buttonOf(bookingId: string, name: string): HTMLElement | null {
    return bookings.body.querySelector(
      `[data-booking="${bookingId}"] [data-action="${name}"]`,
    ) as HTMLElement | null;
  }

  function resultText(booking: BookingJson): string {
    const manager = booking.checked_out_by?.name ?? '';
    if ((booking.late_quarter_hours ?? 0) === 0) return `On time · by ${manager}`;
    const total = booking.overage === null ? 0 : booking.overage.total_cents;
    return `Late ${hours((booking.late_quarter_hours ?? 0) * 0.25)} h · ${hours(
      booking.pack_hours_applied ?? 0,
    )} pack h · Overage $${money(total)} · by ${manager}`;
  }

  function drawRows(): void {
    clear(bookings.body);
    for (const booking of rows) {
      const statusCell = el('span', {
        class: 'row-status',
        tabindex: '-1',
        text: STATUS_WORDS[booking.status] ?? '',
      });
      const actions = el('div', { class: 'row-actions' });
      if (booking.status === 'confirmed') {
        const checkIn = button('Check in', { 'data-action': 'check-in' });
        const noShow = button('Mark no-show', { 'data-action': 'no-show' });
        const cancel = button('Cancel booking', { 'data-action': 'cancel' });
        checkIn.addEventListener('click', () => void sendCheckIn(booking, checkIn));
        noShow.addEventListener('click', () => void sendNoShow(booking, noShow));
        cancel.addEventListener('click', () => openCancelDialog(booking, cancel));
        actions.append(checkIn, noShow, cancel);
      } else if (booking.status === 'checked_in') {
        const checkOut = button('Check out', { 'data-action': 'check-out' });
        checkOut.addEventListener('click', () => openCheckOutDialog(booking, checkOut));
        actions.append(checkOut);
      } else if (booking.status === 'checked_out') {
        actions.append(el('p', { class: 'row-result', text: resultText(booking) }));
      }
      const tableRow = row(
        [
          { label: 'Time', content: `${booking.start}–${booking.end}` },
          { label: 'Station', content: booking.station_name },
          { label: 'Member', content: booking.business_name },
          { label: 'Status', content: statusCell },
          { label: 'Actions', content: actions },
        ],
        { 'data-booking': booking.id },
      );
      bookings.body.append(tableRow);
    }
  }

  function load(): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.getAttribute('data-action');
    const focusedRow = (document.activeElement as HTMLElement | null)
      ?.closest('[data-booking]')
      ?.getAttribute('data-booking');
    void request<{ bookings: BookingJson[] }>(
      `/api/sites/${site.id}/bookings?date=${encodeURIComponent(dateInput.value)}`,
    ).then((result) => {
      if (!result.ok) return;
      rows = result.data.bookings;
      drawRows();
      if (focusedRow !== null && focusedRow !== undefined) {
        const target =
          focusedId === null || focusedId === undefined
            ? null
            : buttonOf(focusedRow, focusedId);
        (target ?? statusCellOf(focusedRow))?.focus();
      }
    });
  }

  function replaceRow(booking: BookingJson): void {
    rows = rows.map((candidate) => (candidate.id === booking.id ? booking : candidate));
    drawRows();
  }

  function redrawOne(bookingId: string, copy: string): void {
    void request<{ booking: BookingJson }>(`/api/bookings/${bookingId}`).then((result) => {
      if (!result.ok) return;
      replaceRow(result.data.booking);
      statusCellOf(bookingId)?.focus();
      status.write(copy);
    });
  }

  async function sendCheckIn(booking: BookingJson, pressed: HTMLElement): Promise<void> {
    if (pressed.getAttribute('aria-disabled') === 'true') return;
    pressed.setAttribute('aria-disabled', 'true');
    status.write(COPY.checkingIn);
    const result = await request<{ booking: BookingJson }>(
      `/api/bookings/${booking.id}/check-in`,
      { method: 'POST', body: {} },
    );
    pressed.setAttribute('aria-disabled', 'false');
    if (result.ok) {
      replaceRow(result.data.booking);
      status.write(COPY.checkedIn(booking.business_name, booking.station_name));
      buttonOf(booking.id, 'check-out')?.focus();
      return;
    }
    const code = result.error.code;
    if (code === 'too_early') status.write(COPY.tooEarlyCheckIn);
    else if (code === 'too_late') status.write(COPY.tooLateCheckIn);
    else if (code === 'certificate_expired') {
      status.write(COPY.certificateExpiredManager(booking.business_name));
    } else if (code === 'invalid_transition') {
      redrawOne(booking.id, COPY.rowChanged);
      return;
    } else if (result.status === 0) status.write(COPY.offline);
    else if (code === 'csrf_failed') status.write(COPY.csrf);
    else if (result.status === 401) return;
    else status.write(COPY.internal);
    pressed.focus();
  }

  async function sendNoShow(booking: BookingJson, pressed: HTMLElement): Promise<void> {
    if (pressed.getAttribute('aria-disabled') === 'true') return;
    pressed.setAttribute('aria-disabled', 'true');
    status.write(COPY.saving);
    const result = await request<{ booking: BookingJson }>(
      `/api/bookings/${booking.id}/no-show`,
      { method: 'POST', body: {} },
    );
    pressed.setAttribute('aria-disabled', 'false');
    if (result.ok) {
      replaceRow(result.data.booking);
      status.write(COPY.noShowMarked(booking.business_name, booking.hours));
      statusCellOf(booking.id)?.focus();
      return;
    }
    const code = result.error.code;
    if (code === 'too_early') {
      const from = Date.parse(booking.start_at) + 30 * 60000;
      status.write(COPY.tooEarlyNoShow(localTimeOf(site.time_zone, from)));
      pressed.focus();
      return;
    }
    if (code === 'invalid_transition') {
      redrawOne(booking.id, COPY.rowChanged);
      return;
    }
    if (result.status === 401) return;
    status.write(
      code === 'csrf_failed' ? COPY.csrf : result.status === 0 ? COPY.offline : COPY.internal,
    );
    pressed.focus();
  }

  function openCheckOutDialog(booking: BookingJson, opener: HTMLElement): void {
    const confirm = button('Confirm check-out', { class: 'primary' });
    const keep = button('Keep checked in');
    const lateLine = el('p', { class: 'late-line' });
    const dialog = new Dialog({
      title: `Check out ${booking.business_name}`,
      opener,
      focusOnClose: () => statusCellOf(booking.id),
    });
    dialog.body.append(lateLine, confirm, keep);
    const key = newIdempotencyKey();
    const info = { dialog, pendingResend: null as (() => void) | null };
    setBlockingDialog(info);
    const paintLate = (): void => {
      const late = lateMinutes(serverNow() - Date.parse(booking.end_at));
      lateLine.textContent = `Booked until ${booking.end}. Late by ${late} min.`;
    };
    paintLate();
    const stop = every(60000, paintLate);
    const closeDialog = (): void => {
      stop();
      setBlockingDialog(null);
      dialog.close();
    };
    keep.addEventListener('click', closeDialog);
    const send = (): void => {
      status.write(COPY.checkingOut);
      info.pendingResend = send;
      void request<{ booking: BookingJson }>(`/api/bookings/${booking.id}/check-out`, {
        method: 'POST',
        idempotencyKey: key,
        body: {},
      }).then((result) => {
        if (result.status !== 401) info.pendingResend = null;
        if (result.ok) {
          closeDialog();
          replaceRow(result.data.booking);
          const updated = result.data.booking;
          if ((updated.late_quarter_hours ?? 0) > 0) {
            status.write(
              COPY.checkedOutLate(
                updated.business_name,
                (updated.late_quarter_hours ?? 0) * 0.25,
                updated.pack_hours_applied ?? 0,
                updated.overage === null ? 0 : updated.overage.total_cents,
              ),
            );
          } else {
            status.write(COPY.checkedOutOnTime(updated.business_name));
          }
          statusCellOf(updated.id)?.focus();
          return;
        }
        const code = result.error.code;
        if (code === 'billing_unavailable') status.write(COPY.billingUnavailableCheckOut);
        else if (code === 'idempotency_in_progress') status.write(COPY.checkOutInProgress);
        else if (code === 'idempotency_conflict') status.write(COPY.checkOutKeyConflict);
        else if (code === 'invalid_transition') {
          closeDialog();
          redrawOne(booking.id, COPY.rowChanged);
        } else if (result.status === 401) {
          /* Sign in again resumes this request */
        } else if (code === 'csrf_failed') status.write(COPY.csrf);
        else if (result.status === 0) status.write(COPY.offline);
        else status.write(COPY.internal);
      });
    };
    confirm.addEventListener('click', send);
    dialog.open(confirm);
  }

  function outcomeFor(booking: BookingJson): {
    kind: 'refund' | 'split' | 'forfeit';
    refunded: number;
    forfeited: number;
  } {
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

  function openCancelDialog(booking: BookingJson, opener: HTMLElement): void {
    const outcome = new StatusRegion('Cancellation outcome');
    const reason = el('textarea', { 'aria-label': 'Reason', rows: '3', id: 'cancel-reason' });
    const confirm = button('Confirm cancellation', { class: 'primary' });
    const keep = button('Keep booking');
    const dialog = new Dialog({
      title: `Cancel booking ${booking.reference}`,
      opener,
      focusOnClose: () => statusCellOf(booking.id),
    });
    dialog.body.append(
      outcome.element,
      el('div', { class: 'field' }, [
        el('label', { for: 'cancel-reason', text: 'Reason' }),
        reason,
      ]),
      confirm,
      keep,
    );
    const info = { dialog, pendingResend: null as (() => void) | null };
    setBlockingDialog(info);
    const paintOutcome = (): void => {
      const current = outcomeFor(booking);
      if (current.kind === 'refund') outcome.writeIfChanged(COPY.outcomeFullRefund(current.refunded));
      else if (current.kind === 'forfeit') {
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
    dialog.open(reason);
    paintOutcome();
    const stop = every(1000, paintOutcome);
    const closeDialog = (): void => {
      stop();
      setBlockingDialog(null);
      dialog.close();
    };
    keep.addEventListener('click', closeDialog);
    const send = (): void => {
      confirm.setAttribute('aria-disabled', 'true');
      status.write(COPY.cancelling);
      info.pendingResend = send;
      void request<{
        booking: BookingJson;
        refunded_hours: number;
        forfeited_hours: number;
      }>(`/api/bookings/${booking.id}/cancel`, {
        method: 'POST',
        body: { reason: reason.value },
      }).then((result) => {
        confirm.setAttribute('aria-disabled', 'false');
        if (result.status !== 401) info.pendingResend = null;
        if (result.ok) {
          closeDialog();
          replaceRow(result.data.booking);
          if (result.data.forfeited_hours === 0) {
            status.write(
              COPY.managerCancelledFullRefund(
                booking.reference,
                booking.business_name,
                result.data.refunded_hours,
              ),
            );
          } else if (result.data.refunded_hours === 0) {
            status.write(
              COPY.managerCancelledFullForfeit(
                booking.reference,
                booking.business_name,
                result.data.forfeited_hours,
              ),
            );
          } else {
            status.write(
              COPY.managerCancelledSplit(
                booking.reference,
                booking.business_name,
                result.data.refunded_hours,
                result.data.forfeited_hours,
              ),
            );
          }
          statusCellOf(booking.id)?.focus();
          return;
        }
        if (result.error.code === 'validation') {
          showFieldError(reason, COPY.reasonRequired);
          status.write(COPY.reasonRequired);
          return;
        }
        if (result.error.code === 'invalid_transition') {
          closeDialog();
          redrawOne(booking.id, COPY.rowChanged);
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

  previousDay.addEventListener('click', () => {
    dateInput.value = addDays(dateInput.value, -1);
    load();
  });
  nextDay.addEventListener('click', () => {
    dateInput.value = addDays(dateInput.value, 1);
    load();
  });
  dateInput.addEventListener('change', load);

  paintSiteTime();
  load();
  every(30000, load);
  every(60000, paintSiteTime);
}
