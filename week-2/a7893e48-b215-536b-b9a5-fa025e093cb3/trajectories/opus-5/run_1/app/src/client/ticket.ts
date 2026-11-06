import type { Booking, Invoice, RefundOutcome } from '../shared/types.js';
import { api, idempotencyKey } from './api.js';
import { billingDelayed, delayedLabel, state } from './app.js';
import { STATUS_STAMP, copy, hours, money, termsLine } from './copy.js';
import { el, setStatus } from './dom.js';
import { DURATION, reducedMotion } from './motion.js';
import { openDialog } from './ui/dialog.js';

export interface TicketContext {
  status: HTMLElement;
  refresh: () => Promise<void>;
}

export function siteZone(siteId: string): string {
  return state.sites.find((site) => site.id === siteId)?.time_zone ?? 'UTC';
}

export function localStamp(zone: string, iso: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const parts = formatter.formatToParts(new Date(iso));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')} ${read('timeZoneName')}`;
}

export function paymentLabel(booking: Booking): string {
  if (booking.card_minutes === 0) return 'Pack';
  if (booking.paid) return 'Paid';
  if (booking.balance_due_by === null) return 'Paid';
  return `Balance due by ${localStamp(siteZone(booking.site_id), booking.balance_due_by)}`;
}

function timeOnly(stamp: string): string {
  return stamp.split(' ').slice(1).join(' ');
}

export function ticketListItem(booking: Booking, context: TicketContext): HTMLLIElement {
  const open = el('button', { type: 'button', class: 'ticket' }, [
    el('span', { class: 'ticket-perforation', 'aria-hidden': 'true' }),
    el('span', { class: 'ticket-station' }, [booking.station_name]),
    el('span', { class: 'ticket-time mono' }, [
      `${booking.local_start.slice(0, 10)} ${timeOnly(booking.local_start)} – ${timeOnly(booking.local_end)}`,
    ]),
    el('span', { class: 'ticket-hours mono' }, [`${hours(booking.minutes)} h`]),
    el('span', { class: 'ticket-stamp' }, [STATUS_STAMP[booking.status]]),
    el('span', { class: 'ticket-payment' }, [paymentLabel(booking)]),
    el('span', { class: 'ticket-amount mono' }, [
      money(booking.card_cents + booking.deposit_cents + booking.overrun_cents + booking.cleaning_fee_cents),
    ]),
  ]);
  open.addEventListener('click', () => void openBookingDetails(booking, context));
  const item = el('li', { class: 'ticket-item', role: 'listitem' }, [open]);
  if (!reducedMotion()) {
    item.animate(
      [
        { transform: 'translateX(40px)', opacity: 0 },
        { transform: 'translateX(0)', opacity: 1 },
      ],
      { duration: DURATION.step, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }
  return item;
}

async function invoiceOf(bookingId: string): Promise<Invoice | null> {
  const result = await api.get<Invoice>(`/api/bookings/${bookingId}/invoice`);
  return result.ok ? result.data : null;
}

export async function openBookingDetails(booking: Booking, context: TicketContext): Promise<void> {
  const invoice = await invoiceOf(booking.id);
  const rows = (invoice?.lines ?? []).map((line) =>
    el('li', { class: 'invoice-line' }, [
      el('span', {}, [line.description]),
      el('span', { class: 'mono' }, [
        line.minutes === null ? '' : `${hours(line.minutes)} h`,
      ]),
      el('span', { class: 'mono' }, [money(line.amount_cents)]),
    ]),
  );
  const actions = el('div', { class: 'dialog-actions' });
  const body: Node[] = [
    el('dl', { class: 'detail-grid' }, [
      el('dt', {}, ['Station']),
      el('dd', {}, [booking.station_name]),
      el('dt', {}, ['Starts']),
      el('dd', { class: 'mono' }, [booking.local_start]),
      el('dt', {}, ['Ends']),
      el('dd', { class: 'mono' }, [booking.local_end]),
      el('dt', {}, ['Hours']),
      el('dd', { class: 'mono' }, [`${hours(booking.minutes)} h`]),
      el('dt', {}, ['Status']),
      el('dd', {}, [STATUS_STAMP[booking.status]]),
      el('dt', {}, ['Payment']),
      el('dd', {}, [paymentLabel(booking)]),
      el('dt', {}, ['Pack hours']),
      el('dd', { class: 'mono' }, [`${hours(booking.pack_minutes)} h`]),
      el('dt', {}, ['Card']),
      el('dd', { class: 'mono' }, [money(booking.card_cents)]),
      el('dt', {}, ['Deposit']),
      el('dd', { class: 'mono' }, [money(booking.deposit_cents)]),
    ]),
    el('h3', {}, ['Invoice']),
    el('ul', { class: 'invoice-lines' }, rows),
    el('p', { class: 'invoice-total mono' }, [
      `Total ${money(invoice?.total_cents ?? 0)} · paid ${money(invoice?.paid_cents ?? 0)} · refunded ${money(invoice?.refunded_cents ?? 0)}`,
    ]),
    el('p', { class: 'terms' }, [booking.terms]),
    actions,
  ];
  const dialog = openDialog({ label: 'Booking details' }, body);

  if (booking.status === 'confirmed' && !booking.paid && booking.card_cents > 0) {
    const pay = el('button', { type: 'button', class: 'button primary', 'aria-label': 'Pay balance' }, [
      delayedLabel('Pay balance'),
    ]);
    pay.addEventListener('click', () => {
      setStatus(context.status, copy.paying);
      void api
        .post<{ booking: Booking }>(`/api/bookings/${booking.id}/pay`, {}, idempotencyKey())
        .then(async (result) => {
          if (!result.ok) {
            setStatus(
              context.status,
              result.status === 503 ? copy.billingDelayedConfirm : result.error.message,
            );
            return;
          }
          setStatus(context.status, copy.paid(result.data.booking.card_cents));
          dialog.close();
          await context.refresh();
        });
    });
    actions.append(pay);
  }

  if (booking.status === 'confirmed') {
    const cancel = el('button', { type: 'button', class: 'button' }, ['Cancel booking']);
    cancel.addEventListener('click', () => {
      dialog.close();
      openCancelDialog(booking, context);
    });
    actions.append(cancel);
  }

  if (state.user?.role === 'manager' && booking.status === 'confirmed') {
    const reason = el('input', { type: 'text', class: 'input', 'aria-label': 'Override reason' });
    const override = el('button', { type: 'button', class: 'button' }, [
      delayedLabel('Cancel with full refund'),
    ]);
    override.setAttribute('aria-label', 'Cancel with full refund');
    const error = el('p', { class: 'field-error' });
    override.addEventListener('click', () => {
      if (reason.value.trim().length < 5) {
        error.textContent = copy.overrideReasonShort;
        setStatus(context.status, copy.overrideReasonShort);
        return;
      }
      setStatus(context.status, copy.overrideCancelling);
      void api
        .post<{ booking: Booking; refund: RefundOutcome }>(`/api/bookings/${booking.id}/override`, {
          action: 'cancel_refunded',
          reason: reason.value.trim(),
        })
        .then(async (result) => {
          if (!result.ok) {
            const message =
              result.status === 503 ? copy.cancelBillingDelayed : result.error.fields?.reason ?? result.error.message;
            error.textContent = message;
            setStatus(context.status, message);
            return;
          }
          setStatus(context.status, copy.overrideCancelled);
          dialog.close();
          await context.refresh();
        });
    });
    actions.append(
      el('div', { class: 'override-controls' }, [
        el('label', { class: 'field-label' }, ['Override reason']),
        reason,
        override,
        error,
      ]),
    );
  }
}

export function openCancelDialog(booking: Booking, context: TicketContext): void {
  const notice = booking.policy.notice_hours;
  const aheadOfNotice =
    Date.now() <= Date.parse(booking.start_at) - notice * 3_600_000;
  const outcome = aheadOfNotice ? copy.cancelAhead : copy.cancelInside(notice);
  const confirm = el('button', { type: 'button', class: 'button primary' }, ['Yes, cancel']);
  const keep = el('button', { type: 'button', class: 'button' }, ['Keep booking']);
  const dialog = openDialog({ label: 'Cancel booking', kind: 'alertdialog' }, [
    el('p', { class: 'cancel-outcome' }, [outcome]),
    el('p', { class: 'terms' }, [termsLine(notice)]),
    el('div', { class: 'dialog-actions' }, [confirm, keep]),
  ]);
  keep.addEventListener('click', () => dialog.close());
  confirm.addEventListener('click', () => {
    setStatus(context.status, copy.cancelling);
    void api
      .post<{ booking: Booking; refund: RefundOutcome }>(
        `/api/bookings/${booking.id}/cancel`,
        {},
        idempotencyKey(),
      )
      .then(async (result) => {
        if (!result.ok) {
          setStatus(
            context.status,
            result.status === 503 ? copy.cancelBillingDelayed : result.error.message,
          );
          return;
        }
        const refund = result.data.refund;
        setStatus(
          context.status,
          refund.tier === 'full'
            ? copy.cancelledFull(
                refund.card_refund_cents,
                refund.pack_minutes_returned,
                refund.deposit_refund_cents,
              )
            : copy.cancelledForfeit(booking.policy.notice_hours),
        );
        dialog.close();
        await context.refresh();
      });
  });
  if (billingDelayed()) confirm.append(el('span', { class: 'delayed-mark' }, [' (delayed)']));
}
