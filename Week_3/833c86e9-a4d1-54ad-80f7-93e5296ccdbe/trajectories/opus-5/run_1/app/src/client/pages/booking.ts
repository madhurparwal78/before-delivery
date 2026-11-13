import { Booking } from '../../shared/types';
import { sumLines } from '../../shared/lines';
import { api, failureOf, newIdempotencyKey } from '../api';
import { Route, onEvent, toast } from '../app';
import { clear, el, money, openDialog } from '../dom';
import { amount, longDate, m, moment, t } from '../i18n';
import { browserZone, state } from '../state';
import { StripNight, nightStrip } from '../components/nightstrip';
import { buildDayGrid } from '../components/datepicker';
import { Problem, problemsRegion } from '../components/problems';

const ACTIVE = ['confirmed', 'changed'];

export async function bookingPage(main: HTMLElement, route: Route): Promise<void> {
  const code = route.path.split('/')[2];
  let booking: Booking;
  try {
    booking = await api<Booking>(`/api/bookings/${code}`);
  } catch (err) {
    const failure = failureOf(err);
    main.append(
      el('div', { class: 'empty' }, [
        el('p', { class: 'huge-word' }, [m('empty.results.word')]),
        el('p', {}, [m(failure?.status === 403 ? 'page.forbidden' : 'page.missing')]),
      ]),
    );
    return;
  }

  const body = el('div', { class: 'booking' });
  main.append(body);

  const refresh = async (): Promise<void> => {
    booking = await api<Booking>(`/api/bookings/${code}`);
    paint();
  };

  const paint = (): void => {
    clear(body);
    const zone = booking.property.zone;
    body.append(
      el('h1', {}, [t('ui.booking_heading', { code: booking.code })]),
      el('p', {}, [`${booking.given_name} ${booking.surname}`]),
      el('p', {}, [`${booking.property.name} — ${zone}`]),
      el('p', {}, [`${longDate(booking.in, zone)} — ${longDate(booking.out, zone)}`]),
    );

    const roomsList = el('ul', { class: 'booking-rooms' });
    for (const room of booking.rooms) {
      roomsList.append(
        el('li', {}, [
          `${room.n}. ${room.room_type} — ${room.state} — `,
          money(room.paid_minor - room.refunded_minor, 'EUR', amount(room.paid_minor - room.refunded_minor, 'EUR')),
        ]),
      );
    }
    body.append(roomsList);

    const first = booking.rooms[0];
    if (first) {
      const strip: StripNight[] = first.nights.map((night, index) => ({
        date: night.date,
        minor: booking.rooms.reduce((sum, room) => sum + (room.nights[index]?.total_minor ?? 0), 0),
        currency: 'EUR' as const,
        state: discountOf(booking, index) ? ('discount' as const) : ('base' as const),
        lines: sumLines(booking.rooms.map((room) => room.nights[index]?.lines ?? [])),
      }));
      body.append(nightStrip(strip, zone));
    }

    body.append(
      el('p', { class: 'total' }, [
        money(booking.total_minor, 'EUR', amount(booking.total_minor, 'EUR'), { class: 'total' }),
      ]),
    );

    const cancellation = el('div', {
      role: 'region',
      'aria-label': t('ui.cancellation'),
      class: 'cancellation sage-block',
    });
    for (const tier of booking.cancellation.tiers) {
      cancellation.append(
        el('p', { 'data-deadline-utc': tier.deadline_utc }, [
          `${tier.refund_pct === 100 ? m('tier.free') : m('tier.partial', { p: tier.refund_pct })} — ${m(
            'deadline.line',
            {
              'moment in property zone': moment(tier.deadline_utc, zone),
              zone,
              'moment in browser zone': moment(tier.deadline_utc, browserZone()),
            },
          )}`,
        ]),
      );
    }
    const status = booking.cancellation.status;
    const statusText =
      status.kind === 'free'
        ? m('refund.free', { 'moment in property zone': moment(status.until_utc ?? booking.in, zone) })
        : status.kind === 'partial'
          ? m('refund.partial', {
              p: status.refund_pct,
              'moment in property zone': moment(status.until_utc ?? booking.in, zone),
            })
          : m('refund.none');
    cancellation.append(
      el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': t('ui.refund_status') }, [statusText]),
    );
    body.append(cancellation);

    const activeRooms = booking.rooms.filter((room) => ACTIVE.includes(room.state));
    for (const room of activeRooms) {
      const button = el('button', { type: 'button', 'data-focus-key': `cancel-room:${room.n}` }, [
        t('ui.cancel_room', { n: room.n }),
      ]);
      button.addEventListener('click', () => void openCancelDialog([room.n], t('ui.cancel_room_dialog'), button));
      body.append(button);
    }
    if (activeRooms.length > 0) {
      const cancelAll = el('button', { type: 'button', 'data-focus-key': 'cancel-booking' }, [
        t('ui.cancel_booking'),
      ]);
      cancelAll.addEventListener('click', () =>
        void openCancelDialog(
          activeRooms.map((room) => room.n),
          t('ui.cancel_booking_dialog'),
          cancelAll,
        ),
      );
      const changeDates = el('button', { type: 'button', 'data-focus-key': 'change-dates' }, [t('ui.change_dates')]);
      changeDates.addEventListener('click', () => openChangeDialog(changeDates));
      body.append(cancelAll, changeDates);
    }

    if (booking.no_show_open && state.me.user?.manages.includes(booking.property.code)) {
      const noShow = el('button', { type: 'button', 'data-focus-key': 'no-show' }, [t('ui.mark_no_show')]);
      noShow.addEventListener('click', () => {
        void (async () => {
          await api<Booking>(`/api/bookings/${code}/no-show`, {
            method: 'POST',
            headers: { 'If-Match': `"${booking.version}"` },
            busy: noShow,
          }).catch(() => undefined);
          await refresh();
        })();
      });
      body.append(noShow);
    }

    body.append(ledgerTable(booking));

    const invoice = el('a', { href: `/bookings/${booking.code}/invoice`, 'data-focus-key': 'invoice' }, [
      t('ui.invoice'),
    ]);
    body.append(invoice);
  };

  const openCancelDialog = async (rooms: number[], name: string, opener: HTMLElement): Promise<void> => {
    const preview = await api<{ refund_minor: number; refund_pct: number }>(
      `/api/bookings/${code}/cancellations/preview?rooms=${rooms.join(',')}`,
      { busy: opener },
    );
    openDialog({ name, opener }, (dialogBody, handle) => {
      dialogBody.append(
        el('p', {}, [m('refund.amount', { amount: amount(preview.refund_minor, 'EUR') })]),
        money(preview.refund_minor, 'EUR', amount(preview.refund_minor, 'EUR')),
      );
      const confirm = el('button', { type: 'button' }, [t('ui.confirm_cancellation')]);
      confirm.addEventListener('click', () => {
        void (async () => {
          try {
            const result = await api<{ refund_minor: number }>(`/api/bookings/${code}/cancellations`, {
              method: 'POST',
              headers: { 'If-Match': `"${booking.version}"` },
              body: { rooms },
              busy: confirm,
            });
            handle.close();
            toast(m('toast.cancelled', { amount: amount(result.refund_minor, 'EUR') }));
            await refresh();
          } catch (err) {
            const failure = failureOf(err);
            toast(m(failure?.body.error === 'invalid_state' ? 'change.not_now' : 'page.forbidden'));
          }
        })();
      });
      const keep = el('button', { type: 'button' }, [t('ui.keep_booking')]);
      keep.addEventListener('click', () => handle.close());
      dialogBody.append(confirm, keep);
    });
  };

  const openChangeDialog = (opener: HTMLElement): void => {
    openDialog({ name: t('ui.change_dates'), opener, className: 'change-dates' }, (dialogBody, handle) => {
      const figures = el('div', { class: 'change-figures' });
      const problemsHolder = el('div', {});
      const grid = buildDayGrid({
        source: { property: booking.property.code, zone: booking.property.zone, cur: 'EUR' },
        start: booking.in,
        end: booking.out,
        months: window.innerWidth < 768 ? 1 : 2,
        onRangeComplete: (inDate, outDate) => void preview(inDate, outDate),
      });
      dialogBody.append(grid.element, figures, problemsHolder);
      void grid.refresh().then(() => grid.focusDay(booking.in));

      const preview = async (inDate: string, outDate: string): Promise<void> => {
        clear(figures);
        clear(problemsHolder);
        try {
          const result = await api<{
            new_total_minor: number;
            paid_minor: number;
            pay_minor?: number;
            refund_minor?: number;
          }>(`/api/bookings/${code}/changes/preview`, { method: 'POST', body: { in: inDate, out: outDate } });
          figures.append(
            el('p', {}, [m('change.new_total', { amount: amount(result.new_total_minor, 'EUR') })]),
            el('p', {}, [m('change.paid', { amount: amount(result.paid_minor, 'EUR') })]),
          );
          const card = el('input', { type: 'text', 'aria-label': t('ui.card_number'), class: 'field' });
          const expiry = el('input', { type: 'text', 'aria-label': t('ui.expiry'), class: 'field' });
          const security = el('input', { type: 'text', 'aria-label': t('ui.security_code'), class: 'field' });
          if ((result.pay_minor ?? 0) > 0) {
            figures.append(
              el('p', {}, [m('change.pay', { amount: amount(result.pay_minor as number, 'EUR') })]),
              card,
              expiry,
              security,
            );
            const payButton = el('button', { type: 'button' }, [t('ui.pay')]);
            payButton.addEventListener('click', () => void send(inDate, outDate, payButton, { card, expiry, security }));
            figures.append(payButton);
          } else {
            figures.append(el('p', {}, [m('refund.amount', { amount: amount(result.refund_minor ?? 0, 'EUR') })]));
            const confirm = el('button', { type: 'button' }, [t('ui.confirm_change')]);
            confirm.addEventListener('click', () => void send(inDate, outDate, confirm, null));
            figures.append(confirm);
          }
        } catch (err) {
          const failure = failureOf(err);
          const problems: Problem[] = [];
          if (failure?.body.error === 'restricted') {
            const reason = failure.body.reason as { code: string; date?: string; n?: number };
            problems.push({
              label: t('ui.dates'),
              message: m(`reason.${reason.code}`, {
                date: reason.date ? longDate(reason.date, booking.property.zone) : '',
                n: reason.n ?? 0,
                count: reason.n ?? 0,
              }),
              focus: () => grid.focusDay(inDate),
            });
          } else if (failure?.body.error === 'nonrefundable') {
            problems.push({
              label: t('ui.dates'),
              message: m('change.nonrefundable'),
              focus: () => grid.focusDay(inDate),
            });
          } else if (failure?.body.error === 'invalid_state') {
            problems.push({
              label: t('ui.dates'),
              message: m('change.not_now'),
              focus: () => grid.focusDay(inDate),
            });
          }
          if (problems.length > 0) {
            const region = problemsRegion(problems);
            problemsHolder.append(region);
            region.focus();
          }
        }
      };

      const send = async (
        inDate: string,
        outDate: string,
        button: HTMLElement,
        card: { card: HTMLInputElement; expiry: HTMLInputElement; security: HTMLInputElement } | null,
      ): Promise<void> => {
        try {
          await api<Booking>(`/api/bookings/${code}/changes`, {
            method: 'POST',
            headers: { 'If-Match': `"${booking.version}"`, 'Idempotency-Key': newIdempotencyKey() },
            busy: button,
            body: {
              in: inDate,
              out: outDate,
              ...(card
                ? {
                    card_number: card.card.value,
                    expiry: card.expiry.value.trim(),
                    security_code: card.security.value.trim(),
                  }
                : {}),
            },
          });
          handle.close();
          toast(m('toast.changed'));
          await refresh();
        } catch (err) {
          const failure = failureOf(err);
          if (failure?.status === 402) {
            const region = problemsRegion([
              {
                label: t('ui.card_number'),
                message: m(`card.${String(failure.body.outcome)}`),
                focus: () => card?.card.focus(),
              },
            ]);
            clear(problemsHolder);
            problemsHolder.append(region);
            region.focus();
          }
        }
      };
    });
  };

  paint();
  onEvent('clock', () => {
    // A dialog is the guest's work in progress; the page waits for it.
    if (document.querySelector('.dialog')) return;
    void refresh();
  });
}

function discountOf(booking: Booking, index: number): boolean {
  return booking.rooms.some(
    (room) =>
      room.plan === 'nonrefundable' ||
      (room.nights[index]?.lines ?? []).some(
        (line) =>
          line.minor < 0 &&
          ['occupancy', 'length_of_stay', 'early_booking', 'last_minute', 'loyalty'].includes(line.key),
      ),
  );
}

function ledgerTable(booking: Booking): HTMLElement {
  const table = el('table', {
    'aria-label': t('ui.ledger'),
    'data-balance-minor': booking.balance_minor,
    class: 'ledger',
  });
  table.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, [t('ui.col.kind')]),
        el('th', { scope: 'col' }, [t('ui.col.account')]),
        el('th', { scope: 'col' }, [t('ui.col.debit')]),
        el('th', { scope: 'col' }, [t('ui.col.credit')]),
        el('th', { scope: 'col' }, [t('ui.col.time')]),
      ]),
    ]),
  );
  const rows = booking.ledger.map((entry) =>
    el('tr', { 'data-kind': entry.kind, 'data-account': entry.account, 'data-pair': entry.pair }, [
      el('td', {}, [t(`ui.kind.${entry.kind}`)]),
      el('td', {}, [t(`ui.account.${entry.account}`)]),
      el('td', { 'data-minor': entry.debit_minor, 'data-currency': 'EUR' }, [
        entry.debit_minor > 0 ? amount(entry.debit_minor, 'EUR') : '',
      ]),
      el('td', { 'data-minor': entry.credit_minor, 'data-currency': 'EUR' }, [
        entry.credit_minor > 0 ? amount(entry.credit_minor, 'EUR') : '',
      ]),
      el('td', {}, [moment(entry.at, booking.property.zone)]),
    ]),
  );
  table.append(el('tbody', {}, rows));
  const approx = el('p', {}, [
    el(
      'span',
      {
        'data-minor': booking.converted_total_minor,
        'data-currency': booking.quote_currency,
        'data-approx': 'true',
      },
      [`≈ ${amount(booking.converted_total_minor, booking.quote_currency)}`],
    ),
  ]);
  return el('div', {}, [table, approx]);
}
