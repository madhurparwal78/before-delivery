import { isMonth } from '../../shared/calendar.js';
import { blockLabel, bookingStatusWord, formatMoney, type BookingStatus } from '../../shared/format.js';
import { AbandonedError, ApiError, NetworkError, networkCopy, get, patch, writeAction } from '../api.js';
import { openDialog } from '../components/dialog.js';
import { clear, el, fieldError, labelled, on, replace, setFieldError } from '../dom.js';
import type { Screen, ScreenContext } from '../screen.js';
import type { HourBank } from '../shell.js';

type Booking = {
  id: string;
  stationName: string;
  businessName: string;
  kind: 'hourly' | 'shelf';
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
  start: string;
  status: BookingStatus;
  billingStatus: string;
  chargeCents: number;
  penaltyCents: number;
  hours: number;
  actions: string[];
};

export function labelFor(booking: Booking): string {
  return booking.kind === 'shelf'
    ? blockLabel({
        kind: 'shelf',
        stationName: booking.stationName,
        localDate: booking.localDate,
        days: booking.days ?? 1,
      })
    : blockLabel({
        kind: 'hourly',
        stationName: booking.stationName,
        localDate: booking.localDate,
        localStart: booking.localStart ?? '00:00',
        localEnd: booking.localEnd ?? '00:00',
      });
}

export function bookingsScreen(context: ScreenContext): Screen {
  const isMember = context.session!.user.role === 'member';
  const monthInput = el('input', { type: 'text', value: context.query.get('month') ?? '' });
  const monthError = fieldError();
  const table = el('table', { 'aria-label': isMember ? 'My bookings' : 'Bookings' });
  const listRegion = el('div', { role: 'region', 'aria-label': 'Booking list' }, table);
  const element = el('div', { class: 'bookings-screen' }, [
    labelled('Month', monthInput, monthError),
    listRegion,
  ]);

  let token = 0;
  let destroyed = false;

  if (isMember) {
    const nameInput = el('input', { type: 'text', value: '' });
    const nameError = fieldError();
    const saveButton = el('button', { type: 'button', text: 'Save business name' });
    nameInput.setAttribute('aria-label', 'Business name');
    const panel = el('div', { role: 'region', 'aria-label': 'Business details' }, [
      labelled('Business name', nameInput, nameError),
      saveButton,
    ]);
    element.appendChild(panel);
    void (async () => {
      try {
        const result = await get<{ member: { businessName: string } }>(
          `/api/members/${context.session!.user.memberId}`,
        );
        if (!destroyed) nameInput.value = result.body.member.businessName;
      } catch {
        // Left blank; the save still works.
      }
    })();
    on(saveButton, 'click', () => {
      void (async () => {
        setFieldError(nameInput, nameError, null);
        saveButton.setAttribute('disabled', '');
        saveButton.setAttribute('aria-busy', 'true');
        context.announce('Saving\u2026');
        try {
          await patch('/api/members/me', { businessName: nameInput.value });
          context.announce('Business name saved.');
        } catch (error) {
          if (error instanceof ApiError) {
            const message = error.fieldErrors()['businessName'];
            if (message) setFieldError(nameInput, nameError, message);
            context.showAlert(message ?? error.copy);
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
        } finally {
          saveButton.removeAttribute('disabled');
          saveButton.removeAttribute('aria-busy');
        }
      })();
    });
  }

  function commitMonth(): void {
    const value = monthInput.value.trim();
    if (value.length === 0) return;
    context.navigate(`/bookings?month=${encodeURIComponent(value)}`);
  }
  on(monthInput, 'change', commitMonth);
  on(monthInput, 'keydown', (event) => {
    if (event.key === 'Enter') commitMonth();
  });

  async function load(): Promise<void> {
    const month = context.query.get('month');
    if (month !== null && !isMonth(month)) {
      setFieldError(monthInput, monthError, 'Use a month in the form YYYY-MM.');
      clear(table);
      return;
    }
    setFieldError(monthInput, monthError, null);
    token += 1;
    const mine = token;
    listRegion.setAttribute('aria-busy', 'true');
    clear(table);
    try {
      const query = month === null ? '' : `?month=${encodeURIComponent(month)}`;
      const result = await get<{ month: string; bookings: Booking[] }>(`/api/bookings${query}`);
      if (destroyed || mine !== token) return;
      if (month === null) context.fillAddress(`/bookings?month=${result.body.month}`);
      monthInput.value = result.body.month;
      drawTable(result.body.bookings);
      await loadBank(result.body.month, mine);
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (destroyed || mine !== token) return;
      if (error instanceof ApiError && error.status === 422) {
        setFieldError(monthInput, monthError, error.firstFieldMessage() ?? error.copy);
      } else if (error instanceof NetworkError) {
        context.showAlert(networkCopy);
      }
    } finally {
      if (mine === token) listRegion.removeAttribute('aria-busy');
    }
  }

  async function loadBank(month: string, mine: number): Promise<void> {
    if (!isMember) return;
    try {
      const bank = await get<HourBank>(
        `/api/members/${context.session!.user.memberId}/hour-bank?month=${month}`,
      );
      if (!destroyed && mine === token) context.setHourBank(bank.body);
    } catch {
      // The header keeps its last figure.
    }
  }

  function drawTable(bookings: Booking[]): void {
    const head = el('tr', {}, [
      el('th', { text: 'Block' }),
      el('th', { text: 'Business' }),
      el('th', { text: 'Status' }),
      el('th', { text: 'Charge' }),
      el('th', { text: 'Fee' }),
      el('th', { text: 'Actions' }),
    ]);
    const rows = bookings.map((booking) => {
      const label = labelFor(booking);
      const cells = [
        el('td', { text: label }),
        el('td', { text: booking.businessName }),
        el('td', { text: bookingStatusWord(booking.status) }),
        el('td', { text: formatMoney(booking.chargeCents) }),
        el('td', { text: formatMoney(booking.penaltyCents) }),
      ];
      const actions = el('td');
      if (booking.actions.includes('cancel')) {
        const cancel = el('button', {
          type: 'button',
          text: 'Cancel',
          'aria-label': `Cancel ${label}`,
        });
        on(cancel, 'click', () => openCancel(booking, cancel));
        actions.appendChild(cancel);
      }
      cells.push(actions);
      return el('tr', {}, cells);
    });
    replace(table, [el('thead', {}, head), el('tbody', {}, rows)]);
  }

  function openCancel(booking: Booking, opener: HTMLElement): void {
    const startMs = Date.parse(booking.start);
    const late = Date.now() > startMs - 48 * 3600 * 1000;
    const amount = Math.round(booking.chargeCents / 2);
    const confirmButton = el('button', { type: 'button', text: 'Confirm cancellation' });
    const keepButton = el('button', { type: 'button', text: 'Keep booking' });
    const handle = openDialog({
      label: 'Cancel booking',
      opener,
      content: [
        el('p', {
          text: late ? `Late cancellation fee: ${formatMoney(amount)}` : 'No cancellation fee',
        }),
        el('div', { class: 'dialog-actions' }, [confirmButton, keepButton]),
      ],
    });
    on(keepButton, 'click', () => handle.close());
    on(confirmButton, 'click', () => {
      handle.close();
      void (async () => {
        context.announce('Cancelling\u2026');
        try {
          const result = await writeAction<{ booking: Booking; hourBank: HourBank }>(
            `/api/bookings/${booking.id}/cancel`,
            {},
          );
          const penalty = result.body.booking.penaltyCents;
          context.announce(
            penalty > 0
              ? `Cancelled. Late cancellation fee: ${formatMoney(penalty)}.`
              : 'Cancelled. No cancellation fee.',
          );
          await load();
        } catch (error) {
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) context.showAlert(error.copy);
          else if (error instanceof NetworkError) context.showAlert(networkCopy);
        }
      })();
    });
  }

  void load();
  if (!isMember) context.setHourBank(null);

  return {
    element,
    destroy: () => {
      destroyed = true;
    },
  };
}
