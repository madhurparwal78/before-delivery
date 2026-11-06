import {
  api,
  ApiError,
  type Allocation,
  type BarnDay,
  type Booking,
  type BookingRow,
  type CancellationPreview,
  type CancellationResult,
  type WaitlistEntry,
  type Horse,
} from '../api.js';
import { clear, el, money, openDialog, playSequence, staggerIn, withSkeleton } from '../dom.js';
import { announce, announceWithToast, failureCopy, pending } from '../notices.js';
import { CARD_OPTIONS, copy } from '../copy.js';
import type { ScreenContext } from '../shell.js';
import { openStream } from '../stream-client.js';

/**
 * `/days/<barn day id>`: the day sheet for the farrier and apprentice, the ready sheet
 * for a barn manager, and the owner day view for an owner.
 */
function cutoffText(day: BarnDay): string {
  // The server's answer already carries the practice-zone offset; its wall clock is
  // read straight from it rather than from the device.
  return `${day.cancellation_cutoff_at.slice(0, 10)} ${day.cancellation_cutoff_at.slice(11, 16)} (${day.time_zone})`;
}

function statusChip(text: string, kind?: 'pending' | 'live'): HTMLElement {
  return el('span', { class: kind === undefined ? 'chip' : `chip ${kind}`, text });
}

function visitStatusText(status: string): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'closed':
      return 'Closing';
    case 'invoice_pending':
      return 'Invoice pending';
    case 'invoiced':
      return 'Invoiced';
    default:
      return status;
  }
}

export async function renderDay(ctx: ScreenContext, barnDayId: string): Promise<void> {
  let day: BarnDay;
  try {
    day = await api.get<BarnDay>(`/api/barn-days/${barnDayId}`);
  } catch (error) {
    clear(ctx.main);
    const failure = error instanceof ApiError ? error.failure : null;
    ctx.main.append(
      el('p', {
        class: 'form-error',
        text: failure?.network === true ? copy.networkFailure : copy.dayNotAvailable,
      }),
    );
    return;
  }

  if (ctx.me.role === 'owner') await renderOwnerDay(ctx, day);
  else if (ctx.me.role === 'barn_manager') await renderReadySheet(ctx, day);
  else await renderDaySheet(ctx, day);
}

/* ---------------------------------------------------------------- farrier day sheet */

async function renderDaySheet(ctx: ScreenContext, initial: BarnDay): Promise<void> {
  const isFarrier = ctx.me.role === 'farrier';
  let day = initial;
  let rows: BookingRow[] = [];
  const announcedInvoices = new Set<string>();
  const pendingBefore = new Set<string>();
  const visitStatusBefore = new Map<string, string | null>();
  let firstLoad = true;

  const header = el('div', { class: 'day-header' });
  const table = el('table', { class: 'stacked', 'aria-label': 'Day sheet' });
  const waitlistHost = el('div', { class: 'section' });
  const adjustmentsHost = el('div', { class: 'section' });

  clear(ctx.main);
  ctx.main.append(header, table, waitlistHost, adjustmentsHost);

  const transition = async (
    action: 'publish' | 'start' | 'close' | 'cancel',
    button: HTMLButtonElement,
  ): Promise<void> => {
    const handle = pending(button, copy.saving);
    try {
      await api.post<BarnDay>(`/api/barn-days/${day.id}/${action}`, { body: {} });
      const messages = {
        publish: copy.dayPublished,
        start: copy.dayStartedOk,
        close: copy.dayClosed,
        cancel: copy.dayCancelled,
      };
      handle.done();
      announceWithToast(messages[action]);
      await refresh();
      await ctx.refreshRail();
    } catch (error) {
      const failure = error instanceof ApiError ? error.failure : null;
      let message = failureCopy(error, copy.networkFailure);
      if (failure !== null && !failure.network) {
        if (failure.code === 'unresolved_bookings') message = copy.unresolvedBookings;
        else if (failure.code === 'illegal_transition') {
          message = copy.illegalDayTransition(String(failure.extra.from ?? day.status));
        } else if (failure.code === 'date_passed' || failure.code === 'too_early') {
          message = copy.illegalDayTransition(day.status);
        }
      }
      handle.failed(message);
      await refresh();
    }
  };

  const renderHeader = (): void => {
    clear(header);
    const controls = el('div', { class: 'row-actions' });
    const edges: { action: 'publish' | 'start' | 'close' | 'cancel'; label: string }[] = [];
    if (isFarrier) {
      if (day.status === 'draft') edges.push({ action: 'publish', label: 'Publish day' });
      if (day.status === 'published' || day.status === 'full') edges.push({ action: 'start', label: 'Start day' });
      if (day.status === 'in_progress') edges.push({ action: 'close', label: 'Close day' });
      if (day.status === 'draft' || day.status === 'published' || day.status === 'full') {
        edges.push({ action: 'cancel', label: 'Cancel day' });
      }
    }
    for (const edge of edges) {
      const button = el('button', {
        type: 'button',
        class: edge.action === 'cancel' ? '' : 'primary',
        text: edge.label,
      }) as HTMLButtonElement;
      button.addEventListener('click', () => void transition(edge.action, button));
      controls.append(button);
    }

    header.append(
      el('h5', { text: `${day.barn.name} — ${day.business_date}` }),
      el('div', { class: 'meta' }, [
        el('span', { class: 'num', text: `Start ${day.start_time}` }),
        el('span', { class: 'num', text: `Cancel by ${cutoffText(day)}` }),
        statusChip(day.status),
        isFarrier && day.trip_fee_cents !== undefined
          ? el('span', { class: 'amount', text: `Trip fee ${money(day.trip_fee_cents)}` })
          : null,
      ]),
      controls,
    );
  };

  const openVisit = async (row: BookingRow, button: HTMLButtonElement): Promise<void> => {
    const handle = pending(button, copy.saving);
    try {
      await api.post(`/api/bookings/${row.booking_id}/visit`, { body: {} });
      handle.done();
      ctx.navigate(`/horses/${row.horse_id}?hoof=LF`);
    } catch (error) {
      handle.failed(failureCopy(error, copy.dayNotInProgress));
      await refresh();
    }
  };

  const markNoShow = async (row: BookingRow, button: HTMLButtonElement): Promise<void> => {
    const handle = pending(button, copy.saving);
    try {
      await api.post(`/api/bookings/${row.booking_id}/no-show`, { body: {} });
      handle.done();
      await refresh();
    } catch (error) {
      handle.failed(failureCopy(error, copy.dayNotInProgress));
      await refresh();
    }
  };

  const excuse = async (row: BookingRow, opener: HTMLButtonElement): Promise<void> => {
    const share = row.trip_share_cents ?? 0;
    let depositCents = 0;
    try {
      const payments = await api.get<
        { kind: string; captured_cents: number; refunded_cents: number; applied_cents: number }[]
      >(`/api/payments?booking_id=${encodeURIComponent(row.booking_id)}`);
      const deposit = payments.find((payment) => payment.kind === 'deposit');
      if (deposit !== undefined) {
        depositCents = deposit.captured_cents - deposit.refunded_cents - deposit.applied_cents;
      }
    } catch {
      depositCents = 0;
    }

    let text = copy.excuseBody(row.horse_name, money(share).slice(1));
    if (depositCents > 0) text += copy.excuseBodyDeposit(money(depositCents).slice(1));

    const keep = el('button', { type: 'button', text: 'Keep horse' }) as HTMLButtonElement;
    const confirm = el('button', { type: 'button', class: 'primary', text: 'Excuse horse' }) as HTMLButtonElement;
    const dialog = openDialog({
      title: 'Excuse horse',
      body: [el('p', { text }), el('div', { class: 'actions' }, [keep, confirm])],
      initialFocus: () => keep,
      opener,
    });
    keep.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const handle = pending(confirm, copy.excusingHorse);
        try {
          const result = await api.post<{ booking: Booking; allocation: Allocation }>(
            `/api/bookings/${row.booking_id}/excuse`,
            { body: {} },
          );
          const changed = result.allocation.adjustments.filter(
            (adjustment) =>
              adjustment.cause_booking_id === row.booking_id && adjustment.booking_id !== row.booking_id,
          ).length;
          handle.done();
          dialog.close();
          announceWithToast(copy.excused(row.horse_name, changed));
          await refresh();
          table.querySelector<HTMLElement>(`[data-horse-link="${row.horse_id}"]`)?.focus();
        } catch (error) {
          const failure = error instanceof ApiError ? error.failure : null;
          let message = failureCopy(error, copy.cannotExcuse);
          if (failure !== null && !failure.network) {
            if (failure.code === 'no_share_recipient') message = copy.noShareRecipient(row.horse_name);
            else if (failure.code === 'day_not_in_progress') message = copy.dayNotInProgress;
            else if (failure.code === 'illegal_transition') message = copy.cannotExcuse;
          }
          handle.failed(message);
          dialog.close();
        }
      })();
    });
  };

  const visitCell = (row: BookingRow): HTMLElement => {
    const cell = el('td', { 'data-label': 'Visit' });
    const status = row.visit_status;
    if (status !== null && status !== undefined) {
      cell.append(statusChip(visitStatusText(status), status === 'invoice_pending' ? 'pending' : undefined));
      // The apprentice's sheet holds no invoice data at all.
      if (
        isFarrier &&
        status === 'invoiced' &&
        row.invoice_total_cents !== null &&
        row.invoice_total_cents !== undefined
      ) {
        cell.append(document.createTextNode(' '), el('span', { class: 'amount', text: money(row.invoice_total_cents) }));
      }
      return cell;
    }
    if (isFarrier && (row.status === 'cancelled_late' || row.status === 'no_show')) {
      if (row.invoice_status === 'pending') cell.append(statusChip('Invoice pending', 'pending'));
      else if (row.invoice_status === 'unpaid' || row.invoice_status === 'paid') {
        cell.append(
          statusChip('Invoiced'),
          document.createTextNode(' '),
          el('span', { class: 'amount', text: money(row.invoice_total_cents ?? 0) }),
        );
      }
    }
    return cell;
  };

  const renderRows = (cycles: Map<string, number>): void => {
    clear(table);
    const columns = isFarrier
      ? ['Time', 'Horse', 'Stall', 'Owner', 'Cycle (weeks)', 'Status', 'Share', 'Visit']
      : ['Time', 'Horse', 'Stall', 'Cycle (weeks)', 'Status', 'Visit'];
    table.append(
      el('caption', { text: 'Day sheet' }),
      el('thead', {}, [el('tr', {}, columns.map((label) => el('th', { scope: 'col', text: label })))]),
    );
    const body = el('tbody');
    for (const row of rows) {
      const horseLink = el('a', {
        href: `/horses/${row.horse_id}?hoof=LF`,
        text: row.horse_name,
        'data-horse-link': row.horse_id ?? '',
      });
      horseLink.addEventListener('click', (event) => {
        event.preventDefault();
        ctx.navigate(`/horses/${row.horse_id}?hoof=LF`);
      });

      const actions = el('div', { class: 'row-actions' });
      if (isFarrier && day.status === 'in_progress' && row.status === 'confirmed') {
        const open = el('button', {
          type: 'button',
          class: 'primary',
          text: `Open visit for ${row.horse_name}`,
        }) as HTMLButtonElement;
        open.addEventListener('click', () => void openVisit(row, open));
        const noShow = el('button', { type: 'button', text: `Mark ${row.horse_name} no-show` }) as HTMLButtonElement;
        noShow.addEventListener('click', () => void markNoShow(row, noShow));
        const excuseButton = el('button', { type: 'button', text: `Excuse ${row.horse_name}` }) as HTMLButtonElement;
        excuseButton.addEventListener('click', () => void excuse(row, excuseButton));
        actions.append(open, noShow, excuseButton);
      }

      const cells: HTMLElement[] = [
        el('td', { 'data-label': 'Time', class: 'num', text: row.slot_time }),
        el('td', { 'data-label': 'Horse' }, [horseLink]),
        el('td', { 'data-label': 'Stall', class: 'num', text: row.stall }),
      ];
      if (isFarrier) cells.push(el('td', { 'data-label': 'Owner', text: row.owner_name ?? '' }));
      cells.push(
        el('td', {
          'data-label': 'Cycle (weeks)',
          class: 'num',
          text: String(cycles.get(row.horse_id ?? '') ?? ''),
        }),
      );
      cells.push(el('td', { 'data-label': 'Status' }, [statusChip(row.status ?? '')]));
      if (isFarrier) {
        cells.push(
          el('td', { 'data-label': 'Share', class: 'amount' }, [
            row.trip_share_cents === null || row.trip_share_cents === undefined
              ? document.createTextNode('')
              : el('span', { text: money(row.trip_share_cents) }),
          ]),
        );
      }
      const visit = visitCell(row);
      if (actions.children.length > 0) visit.append(actions);
      cells.push(visit);

      body.append(el('tr', { 'data-booking': row.booking_id }, cells));
    }
    table.append(body);
    staggerIn([...body.children].filter((node): node is HTMLElement => node instanceof HTMLElement));
  };

  const renderWaitlist = async (): Promise<void> => {
    if (!isFarrier) return;
    clear(waitlistHost);
    const entries = await api.get<WaitlistEntry[]>(`/api/barn-days/${day.id}/waitlist`);
    waitlistHost.append(
      el('table', { class: 'stacked', 'aria-label': 'Waitlist' }, [
        el('caption', { text: 'Waitlist' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Position' }),
            el('th', { scope: 'col', text: 'Horse' }),
            el('th', { scope: 'col', text: 'Join time' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          entries.map((entry) =>
            el('tr', {}, [
              el('td', { 'data-label': 'Position', class: 'num', text: String(entry.position) }),
              el('td', { 'data-label': 'Horse', text: entry.horse.name }),
              el('td', { 'data-label': 'Join time', class: 'num', text: entry.joined_at.slice(11, 19) }),
            ]),
          ),
        ),
      ]),
    );
  };

  const renderAdjustments = async (): Promise<void> => {
    if (!isFarrier) return;
    clear(adjustmentsHost);
    if (day.status !== 'in_progress' && day.status !== 'closed') return;
    let allocation: Allocation;
    try {
      allocation = await api.get<Allocation>(`/api/barn-days/${day.id}/allocation`);
    } catch {
      return;
    }
    const shareOf = new Map(allocation.shares.map((share) => [share.booking_id, share]));
    const running = new Map<string, number>();
    for (const share of allocation.shares) running.set(share.booking_id, share.initial_cents ?? 0);
    const out: HTMLElement[] = [];
    for (const adjustment of allocation.adjustments) {
      const after = (running.get(adjustment.booking_id) ?? 0) + adjustment.delta_cents;
      running.set(adjustment.booking_id, after);
      // The sign, not colour, carries the meaning: a minus sign U+2212 for a fall.
      const sign = adjustment.delta_cents < 0 ? '\u2212' : '+';
      out.push(
        el('tr', {}, [
          el('td', { 'data-label': 'Horse', text: shareOf.get(adjustment.booking_id)?.horse.name ?? '' }),
          el('td', {
            'data-label': 'Change',
            class: 'amount',
            text: `${sign}${money(Math.abs(adjustment.delta_cents))}`,
          }),
          el('td', { 'data-label': 'Share', class: 'amount', text: money(after) }),
          el('td', { 'data-label': 'At', class: 'num', text: adjustment.at.slice(11, 19) }),
        ]),
      );
    }
    adjustmentsHost.append(
      el('table', { class: 'stacked', 'aria-label': 'Trip share adjustments' }, [
        el('caption', { text: 'Trip share adjustments' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Horse' }),
            el('th', { scope: 'col', text: 'Change' }),
            el('th', { scope: 'col', text: 'Share' }),
            el('th', { scope: 'col', text: 'At' }),
          ]),
        ]),
        el('tbody', {}, out),
      ]),
    );
  };

  const refresh = async (): Promise<void> => {
    const load = async (): Promise<[BarnDay, BookingRow[], Horse[]]> =>
      await Promise.all([
        api.get<BarnDay>(`/api/barn-days/${day.id}`),
        api.get<BookingRow[]>(`/api/barn-days/${day.id}/bookings`),
        api.get<Horse[]>('/api/horses').catch(() => [] as Horse[]),
      ]);
    const [freshDay, freshRows, horses] = firstLoad
      ? await withSkeleton(ctx.main, 4, load)
      : await load();
    firstLoad = false;
    day = freshDay;
    rows = freshRows;
    renderHeader();
    renderRows(new Map(horses.map((horse) => [horse.id, horse.cycle_weeks])));

    // A row whose visit has just left 'open' plays the close sequence.
    for (const row of rows) {
      const before = visitStatusBefore.get(row.booking_id);
      const after = row.visit_status ?? null;
      visitStatusBefore.set(row.booking_id, after);
      if (before === 'open' && after !== null && after !== 'open') {
        const tr = table.querySelector<HTMLElement>(`tr[data-booking="${row.booking_id}"]`);
        if (tr !== null) playSequence(tr, 'visit-closed', 440);
      }
    }

    // A row leaving pending is announced once per page, and only where the role sees
    // invoice data at all.
    if (isFarrier) {
      for (const row of rows) {
        const wasPending = pendingBefore.has(row.booking_id);
        const nowPending = row.visit_status === 'invoice_pending' || row.invoice_status === 'pending';
        const reached =
          row.visit_status === 'invoiced' || row.invoice_status === 'unpaid' || row.invoice_status === 'paid';
        if (nowPending) pendingBefore.add(row.booking_id);
        else pendingBefore.delete(row.booking_id);
        if (wasPending && reached && !announcedInvoices.has(row.booking_id)) {
          announcedInvoices.add(row.booking_id);
          const amount = money(row.invoice_total_cents ?? 0).slice(1);
          const line =
            row.visit_status === 'invoiced'
              ? copy.invoiceReached(row.horse_name, amount)
              : copy.tripInvoiceReached(row.horse_name, amount);
          announceWithToast(line);
          const tr = table.querySelector<HTMLElement>(`tr[data-booking="${row.booking_id}"]`);
          if (tr !== null) playSequence(tr, 'invoice-reconciled', 440);
        }
      }
    }

    await renderWaitlist();
    await renderAdjustments();
  };

  await refresh();
  ctx.onRefresh(refresh, 30000);
  ctx.onRefresh(async () => {
    if (rows.some((row) => row.visit_status === 'invoice_pending' || row.invoice_status === 'pending')) {
      await refresh();
    }
  }, 10000);

  const stream = openStream(`/api/barn-days/${day.id}/events`, {
    onEvent: (event) => {
      if (event.type === 'allocation_adjusted' || event.type === 'allocation_fixed') {
        void renderAdjustments();
        return;
      }
      void refresh();
      if (event.type === 'day_status') void ctx.refreshRail();
    },
  });
  ctx.onTeardown(() => stream.close());
}

/* -------------------------------------------------------------------- ready sheet */

async function renderReadySheet(ctx: ScreenContext, initial: BarnDay): Promise<void> {
  let day = initial;
  const header = el('div', { class: 'day-header' });
  const table = el('table', { class: 'stacked', 'aria-label': 'Ready sheet' });
  clear(ctx.main);
  ctx.main.append(header, table);

  const refresh = async (): Promise<void> => {
    const [freshDay, rows] = await Promise.all([
      api.get<BarnDay>(`/api/barn-days/${day.id}`),
      api.get<BookingRow[]>(`/api/barn-days/${day.id}/bookings`),
    ]);
    day = freshDay;
    clear(header);
    header.append(
      el('h5', { text: `${day.barn.name} — ${day.business_date}` }),
      el('div', { class: 'meta' }, [
        el('span', { class: 'num', text: `Start ${day.start_time}` }),
        statusChip(day.status),
      ]),
    );
    clear(table);
    table.append(
      el('caption', { text: 'Ready sheet' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Time' }),
          el('th', { scope: 'col', text: 'Horse' }),
          el('th', { scope: 'col', text: 'Stall' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        rows.map((row) =>
          el('tr', {}, [
            el('td', { 'data-label': 'Time', class: 'num', text: row.slot_time }),
            el('td', { 'data-label': 'Horse', text: row.horse_name }),
            el('td', { 'data-label': 'Stall', class: 'num', text: row.stall }),
          ]),
        ),
      ),
    );
  };

  await refresh();
  ctx.onRefresh(refresh, 30000);
  const stream = openStream(`/api/barn-days/${day.id}/events`, { onEvent: () => void refresh() });
  ctx.onTeardown(() => stream.close());
}

/* ----------------------------------------------------------------- owner day view */

async function renderOwnerDay(ctx: ScreenContext, initial: BarnDay): Promise<void> {
  let day = initial;
  let myBookings: Booking[] = [];
  let horses: Horse[] = [];
  const announcedOffers = new Set<string>();

  const horsePicker = el('select', { 'aria-label': 'Horse' }) as HTMLSelectElement;
  const cardPicker = el('select', { 'aria-label': 'Card' }) as HTMLSelectElement;
  for (const option of CARD_OPTIONS) {
    cardPicker.append(el('option', { value: option.token, text: option.label }));
  }

  const header = el('div', { class: 'day-header' });
  const pickers = el('div', { class: 'inline' }, [
    el('div', { class: 'field' }, [el('label', { text: 'Horse' }), horsePicker]),
    el('div', { class: 'field' }, [el('label', { text: 'Card' }), cardPicker]),
  ]);
  const table = el('table', { class: 'stacked', 'aria-label': 'Slots' });
  const waitlistHost = el('div', { class: 'row-actions' });

  clear(ctx.main);
  ctx.main.append(header, pickers, table, waitlistHost);

  const selectedHorse = (): Horse | undefined => horses.find((horse) => horse.id === horsePicker.value);

  const joinWaitlist = async (button: HTMLButtonElement): Promise<void> => {
    const horse = selectedHorse();
    if (horse === undefined) return;
    const handle = pending(button, copy.joiningWaitlist);
    try {
      const entry = await api.post<{ position: number }>(`/api/barn-days/${day.id}/waitlist`, {
        body: { horse_id: horse.id, card_token: cardPicker.value },
      });
      handle.done();
      announceWithToast(copy.onWaitlist(horse.name, entry.position));
      await refresh();
    } catch (error) {
      const failure = error instanceof ApiError ? error.failure : null;
      let message = failureCopy(error, copy.networkFailure);
      if (failure !== null && !failure.network) {
        if (failure.code === 'already_on_waitlist') message = copy.alreadyOnWaitlist(horse.name);
        else if (failure.code === 'horse_already_booked') message = copy.horseAlreadyBooked(horse.name);
        else if (failure.code === 'account_blocked') message = copy.accountBlocked;
        else if (failure.code === 'day_not_full') message = copy.dayNotFull;
      }
      handle.failed(message);
    }
  };

  const openConfirmDialog = (booking: Booking, opener: HTMLElement | null): void => {
    const depositSentence =
      booking.deposit_cents > 0 ? `Deposit ${money(booking.deposit_cents)}. ` : '';
    // The hold end shown is the server's stored value; the dialog never counts down.
    const holdEnd = (booking.hold_expires_at ?? '').slice(11, 19);
    const body =
      `Hold ${booking.slot_time} on ${day.business_date} at ${day.barn.name} for ${booking.horse.name}. ` +
      `${depositSentence}Cancel by ${cutoffText(day)} or the trip share still applies. ` +
      `Hold ends at ${holdEnd} (${day.time_zone}).`;

    const confirm = el('button', { type: 'button', class: 'primary', text: 'Confirm booking' }) as HTMLButtonElement;
    const release = el('button', { type: 'button', text: 'Release hold' }) as HTMLButtonElement;
    const dialog = openDialog({
      title: 'Confirm booking',
      body: [el('p', { text: body }), el('div', { class: 'actions' }, [confirm, release])],
      initialFocus: () => confirm,
      opener,
    });

    confirm.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const handle = pending(confirm, copy.confirmingBooking);
        try {
          await api.post<Booking>(`/api/bookings/${booking.id}/confirm`, { body: {} });
          handle.done();
          dialog.close();
          announceWithToast(copy.booked(booking.horse.name, booking.slot_time, day.business_date));
          await refresh();
          const cancelButton = table.querySelector<HTMLElement>(`[data-cancel="${booking.id}"]`);
          const row = cancelButton?.closest('tr');
          if (row instanceof HTMLElement) playSequence(row, 'slot-won', 480);
          cancelButton?.focus();
        } catch (error) {
          const failure = error instanceof ApiError ? error.failure : null;
          if (failure !== null && failure.code === 'hold_expired') {
            handle.failed(copy.holdExpired(booking.slot_time));
            dialog.close();
            await refresh();
            horsePicker.focus();
            return;
          }
          handle.failed(failureCopy(error, copy.networkFailure));
          dialog.close();
          await refresh();
        }
      })();
    });

    release.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const handle = pending(release, copy.releasingHold);
        try {
          await api.delete(`/api/bookings/${booking.id}`);
          handle.done(copy.holdReleased);
        } catch (error) {
          handle.failed(failureCopy(error, copy.networkFailure));
        }
        dialog.close();
        await refresh();
      })();
    });
  };

  const book = async (slotId: string, button: HTMLButtonElement): Promise<void> => {
    const horse = selectedHorse();
    if (horse === undefined) return;
    const handle = pending(button, copy.holdingSlot);
    try {
      const booking = await api.post<Booking>(`/api/barn-days/${day.id}/bookings`, {
        body: { slot_id: slotId, horse_id: horse.id, card_token: cardPicker.value },
      });
      handle.done();
      openConfirmDialog(booking, button);
    } catch (error) {
      const failure = error instanceof ApiError ? error.failure : null;
      let message = failureCopy(error, copy.networkFailure);
      let toWaitlist = false;
      if (failure !== null && !failure.network) {
        switch (failure.code) {
          case 'day_full':
            message = copy.dayFull;
            toWaitlist = true;
            break;
          case 'slot_taken':
            message = copy.slotTaken;
            break;
          case 'not_open_for_booking':
            message = copy.notOpenForBooking;
            break;
          case 'horse_already_booked':
            message = copy.horseAlreadyBooked(horse.name);
            break;
          case 'card_declined':
            message = copy.cardDeclinedHold;
            break;
          case 'account_blocked':
            message = copy.accountBlocked;
            break;
          default:
            break;
        }
      }
      handle.failed(message);
      await refresh();
      if (toWaitlist) waitlistHost.querySelector('button')?.focus();
    }
  };

  const cancel = async (booking: Booking, opener: HTMLButtonElement): Promise<void> => {
    let preview: CancellationPreview;
    try {
      preview = await api.get<CancellationPreview>(`/api/bookings/${booking.id}/cancellation-preview`);
    } catch (error) {
      announce(failureCopy(error, copy.networkFailure));
      return;
    }
    // The body copy is the server's verdict, not the device's reading of the clock.
    let text = preview.late
      ? copy.cancelAfterCutoff(cutoffText(day), booking.horse.name)
      : copy.cancelBeforeCutoff;
    if (preview.deposit_outcome === 'refund') {
      text += copy.cancelBeforeCutoffDeposit(money(preview.deposit_cents).slice(1));
    } else if (preview.deposit_outcome === 'keep') {
      text += copy.cancelAfterCutoffDeposit(money(preview.deposit_cents).slice(1));
    }

    const keep = el('button', { type: 'button', text: 'Keep booking' }) as HTMLButtonElement;
    const confirm = el('button', {
      type: 'button',
      class: 'primary',
      text: 'Confirm cancellation',
    }) as HTMLButtonElement;
    const dialog = openDialog({
      title: 'Cancel booking',
      body: [el('p', { text }), el('div', { class: 'actions' }, [keep, confirm])],
      initialFocus: () => keep,
      opener,
    });
    keep.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const handle = pending(confirm, copy.cancellingBooking);
        try {
          const result = await api.post<CancellationResult>(`/api/bookings/${booking.id}/cancel`, { body: {} });
          handle.done();
          dialog.close();
          announceWithToast(
            result.trip_share_applies ? copy.cancelledLate(booking.horse.name) : copy.cancelledInTime,
          );
          await refresh();
          const freed = table.querySelector<HTMLElement>(`[data-book="${booking.slot_id}"]`);
          if (freed !== null) freed.focus();
          else horsePicker.focus();
        } catch (error) {
          const failure = error instanceof ApiError ? error.failure : null;
          handle.failed(
            failure !== null && failure.code === 'day_started'
              ? copy.dayStarted
              : failureCopy(error, copy.networkFailure),
          );
          dialog.close();
          await refresh();
        }
      })();
    });
  };

  const refresh = async (): Promise<void> => {
    const [freshDay, bookings, allHorses] = await Promise.all([
      api.get<BarnDay>(`/api/barn-days/${day.id}`),
      api.get<Booking[]>('/api/my/bookings'),
      api.get<Horse[]>('/api/horses'),
    ]);
    day = freshDay;
    myBookings = bookings.filter((booking) => booking.barn_day_id === day.id);
    horses = allHorses.filter((horse) => horse.barn.id === day.barn.id);

    const kept = horsePicker.value;
    clear(horsePicker);
    for (const horse of horses) horsePicker.append(el('option', { value: horse.id, text: horse.name }));
    if (horses.some((horse) => horse.id === kept)) horsePicker.value = kept;

    clear(header);
    header.append(
      el('h5', { text: `${day.barn.name} — ${day.business_date}` }),
      el('div', { class: 'meta' }, [
        el('span', { class: 'num', text: `Start ${day.start_time}` }),
        el('span', { class: 'num', text: `Cancel by ${cutoffText(day)}` }),
        statusChip(day.status),
      ]),
    );

    clear(table);
    table.append(
      el('caption', { text: 'Slots' }),
      el('thead', {}, [
        el('tr', {}, [el('th', { scope: 'col', text: 'Time' }), el('th', { scope: 'col', text: 'Slot' })]),
      ]),
    );
    const body = el('tbody');
    for (const slot of day.slots) {
      const mine = myBookings.find((booking) => booking.slot_id === slot.id);
      const cell = el('td', { 'data-label': 'Slot' });
      if (mine !== undefined && mine.status === 'held') {
        const confirmOffer = el('button', {
          type: 'button',
          class: 'primary',
          text: `Confirm offer for ${mine.horse.name}`,
        }) as HTMLButtonElement;
        confirmOffer.addEventListener('click', () => openConfirmDialog(mine, confirmOffer));
        cell.append(confirmOffer);
        if (mine.offer && !announcedOffers.has(mine.id)) {
          announcedOffers.add(mine.id);
          announceWithToast(
            copy.offerMade(mine.horse.name, (mine.hold_expires_at ?? '').slice(11, 19), day.time_zone),
          );
        }
      } else if (mine !== undefined && mine.status === 'confirmed') {
        const cancelButton = el('button', {
          type: 'button',
          text: `Cancel booking for ${mine.horse.name}`,
          'data-cancel': mine.id,
        }) as HTMLButtonElement;
        cancelButton.addEventListener('click', () => void cancel(mine, cancelButton));
        cell.append(el('span', { text: `${mine.horse.name} ` }), cancelButton);
      } else if (slot.state === 'taken') {
        cell.append(document.createTextNode('Taken'));
      } else {
        const bookButton = el('button', {
          type: 'button',
          class: 'primary',
          text: `Book ${slot.time}`,
          'data-book': slot.id,
        }) as HTMLButtonElement;
        bookButton.addEventListener('click', () => void book(slot.id, bookButton));
        cell.append(bookButton);
      }
      body.append(el('tr', {}, [el('td', { 'data-label': 'Time', class: 'num', text: slot.time }), cell]));
    }
    table.append(body);

    clear(waitlistHost);
    if (day.status === 'full') {
      const join = el('button', { type: 'button', text: 'Join waitlist' }) as HTMLButtonElement;
      join.addEventListener('click', () => void joinWaitlist(join));
      waitlistHost.append(join);
    }
  };

  await refresh();
  // An offered hold appears after any action or refresh, so within 30 seconds at most.
  ctx.onRefresh(refresh, 30000);
}
