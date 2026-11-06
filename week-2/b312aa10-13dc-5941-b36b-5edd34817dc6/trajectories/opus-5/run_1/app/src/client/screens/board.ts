import { addDays, dateLabel, minutesOfDay, timeFromMinutes } from '../../shared/calendar.js';
import {
  blockLabel,
  bookingStatusWord,
  formatHours,
  formatMoney,
  type BookingStatus,
} from '../../shared/format.js';
import {
  AbandonedError,
  ApiError,
  NetworkError,
  networkCopy,
  post,
  writeAction,
  get,
} from '../api.js';
import { openDialog, type DialogHandle } from '../components/dialog.js';
import { clear, el, fieldError, labelled, on, reducedMotion, setFieldError } from '../dom.js';
import type { Screen, ScreenContext } from '../screen.js';
import type { HourBank } from '../shell.js';

type StationSummary = { id: string; name: string; kind: 'hourly' | 'shelf'; capacity: number | null };

type Booking = {
  id: string;
  memberId?: string;
  businessName?: string;
  stationId: string;
  stationName?: string;
  kind?: 'hourly' | 'shelf';
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
  start: string;
  end: string;
  status: BookingStatus | 'booked';
  billingStatus?: 'not_billed' | 'billed' | 'pending_billing';
  hours?: number;
  peakHours?: number;
  chargeCents?: number;
  penaltyCents?: number;
  conflict?: boolean;
  seriesId?: string | null;
  notes?: string;
  holdExpiresAt?: string | null;
  actions?: string[];
  version?: number;
};

type OutOfServiceWindow = {
  id: string;
  stationId: string;
  localDate: string;
  localStart: string;
  localEnd: string;
  reason: string;
};

type BoardResponse = {
  date: string;
  today: string;
  now: string;
  timeZone: string;
  stations: StationSummary[];
  peakWindows: Array<{ days: string[]; start: string; end: string }>;
  blocks: Booking[];
  outOfService: OutOfServiceWindow[];
  hourBank: HourBank | null;
};

type Ticket = {
  booking: Booking;
  label: 'taken' | 'expired' | null;
};

type InHand = {
  booking: Booking;
  originLabel: string;
  stationId: string;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
  saving: boolean;
};

const lanesAcross = (): number => (window.innerWidth < 768 ? 4 : window.innerWidth < 1280 ? 8 : 12);

function statusWords(booking: Booking, saving: boolean): string {
  const parts = [bookingStatusWord(booking.status as BookingStatus)];
  if (booking.conflict) parts.push('Conflict');
  if (booking.billingStatus === 'pending_billing') parts.push('Pending billing');
  else if (booking.billingStatus === 'billed') parts.push('Billed');
  if (saving) parts.push('Saving\u2026');
  return parts.join(', ');
}

function labelOf(booking: {
  kind?: 'hourly' | 'shelf';
  stationName?: string;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
}, stationName: string): string {
  if (booking.kind === 'shelf' || (booking.days !== null && booking.localStart === null)) {
    return blockLabel({
      kind: 'shelf',
      stationName,
      localDate: booking.localDate,
      days: booking.days ?? 1,
    });
  }
  return blockLabel({
    kind: 'hourly',
    stationName,
    localDate: booking.localDate,
    localStart: booking.localStart ?? '00:00',
    localEnd: booking.localEnd ?? '00:00',
  });
}

export function boardScreen(context: ScreenContext): Screen {
  const role = context.session!.user.role;
  const isMember = role === 'member';
  const myMemberId = context.session!.user.memberId;

  let board: BoardResponse | null = null;
  let tickets: Ticket[] = [];
  const discardedTickets = new Set<string>();
  let inHand: InHand | null = null;
  let ghostElement: HTMLElement | null = null;
  let hourWidth = 96;
  let ownActionSeq = 0;
  let pendingActions = 0;
  let drawnBalance = 0;
  let hoursInFlight = 0;
  let pressCounter = 0;
  let lastBalanceSetter = 0;
  let lastAnnouncedDrop = 0;
  let savingBlocks = new Set<string>();
  let openBoardDialog: DialogHandle | null = null;
  let refreshTimer: number | null = null;
  let scrolledOnce = false;
  let destroyed = false;

  const dateParam = context.query.get('date');

  const heading = el('h1', { class: 'display board-date' });
  const zoneLine = el('p', { class: 'kitchen-time' });
  const previousButton = el('button', { type: 'button', text: 'Previous day' });
  const todayButton = el('button', { type: 'button', text: 'Today' });
  const nextButton = el('button', { type: 'button', text: 'Next day' });
  const actionButton = el('button', {
    type: 'button',
    text: isMember ? 'New booking' : 'Mark out of service',
  });
  const dateBar = el('div', { class: 'date-bar' }, [
    heading,
    zoneLine,
    el('div', { class: 'date-controls' }, [previousButton, todayButton, nextButton, actionButton]),
  ]);

  const rail = el('div', { role: 'region', 'aria-label': 'Ticket rail', class: 'rail' });
  const ruler = el('ul', { role: 'list', 'aria-label': 'Hour ruler', class: 'ruler' });
  const lanes = el('div', { class: 'lanes' });
  const scale = el('div', { class: 'scale' }, [ruler, lanes]);
  const lineBoard = el('div', { role: 'region', 'aria-label': 'Line board', class: 'line-board' }, scale);
  const element = el('div', { class: 'board-screen' }, [dateBar, rail, lineBoard]);

  on(previousButton, 'click', () => goToDate(addDays(currentDate(), -1)));
  on(nextButton, 'click', () => goToDate(addDays(currentDate(), 1)));
  on(todayButton, 'click', () => goToDate(board?.today ?? currentDate()));
  on(actionButton, 'click', () => {
    if (isMember) openNewBooking(null, actionButton);
    else openOutOfService(actionButton);
  });

  function currentDate(): string {
    return board?.date ?? dateParam ?? '';
  }

  function goToDate(date: string): void {
    context.navigate(`/board?date=${date}`);
  }

  function bumpOwnAction(): void {
    ownActionSeq += 1;
  }

  async function load(initial: boolean): Promise<void> {
    const seq = ownActionSeq;
    const hadPending = pendingActions;
    const query = dateParam === null ? '' : `?date=${encodeURIComponent(dateParam)}`;
    try {
      const result = await get<BoardResponse>(`/api/board${query}`);
      if (destroyed) return;
      if (ownActionSeq !== seq || pendingActions > 0 || hadPending > 0) return;
      draw(result.body, initial);
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (error instanceof ApiError && error.status === 422) {
        board = null;
        clear(lanes);
        clear(ruler);
        context.showAlert(error.firstFieldMessage() ?? error.copy);
        heading.textContent = dateParam ?? '';
        return;
      }
      if (error instanceof NetworkError) context.showAlert(networkCopy);
    }
  }

  /** Draws a board response and reconciles the rail with it. */
  function draw(response: BoardResponse, initial: boolean): void {
    board = response;
    if (dateParam === null) context.fillAddress(`/board?date=${response.date}`);
    heading.textContent = dateLabel(response.date);
    zoneLine.textContent = `Kitchen time: ${response.timeZone}`;
    if (response.hourBank) {
      drawnBalance = response.hourBank.balanceHours;
      context.setHourBank({ ...response.hourBank, balanceHours: targetBalance() });
    }
    reconcileTickets(response);
    drawRuler();
    drawLanes();
    drawRail();
    if (initial && !scrolledOnce) {
      scrolledOnce = true;
      scrollToStartHour();
    }
  }

  function targetBalance(): number {
    return Math.max(0, drawnBalance - hoursInFlight);
  }

  function showBalance(): void {
    if (!board?.hourBank) return;
    context.setHourBank({ ...board.hourBank, balanceHours: targetBalance() });
  }

  /** A ticket marked taken keeps that label; a discarded ticket is never drawn again. */
  function reconcileTickets(response: BoardResponse): void {
    if (!isMember) {
      tickets = [];
      return;
    }
    const takenLabels = new Map(
      tickets.filter((ticket) => ticket.label !== null).map((t) => [t.booking.id, t.label]),
    );
    tickets = response.blocks
      .filter(
        (block) =>
          block.memberId === myMemberId &&
          (block.status === 'held' || block.status === 'expired') &&
          !discardedTickets.has(block.id),
      )
      .map((block) => ({
        booking: block,
        label: block.status === 'expired' ? 'expired' : takenLabels.get(block.id) ?? null,
      }));
  }

  function stationOf(stationId: string): StationSummary | null {
    return board?.stations.find((station) => station.id === stationId) ?? null;
  }

  function stationName(stationId: string): string {
    return stationOf(stationId)?.name ?? '';
  }

  function drawRuler(): void {
    clear(ruler);
    for (let hour = 0; hour < 24; hour += 1) {
      ruler.appendChild(
        el('li', {
          role: 'listitem',
          class: 'ruler-hour',
          'aria-label': timeFromMinutes(hour * 60),
          text: timeFromMinutes(hour * 60),
        }),
      );
    }
    applyScale();
  }

  function applyScale(): void {
    hourWidth = Math.max(64, Math.floor(lineBoard.clientWidth / lanesAcross()) || 96);
    scale.style.setProperty('--hour-width', `${hourWidth}px`);
    scale.style.width = `${hourWidth * 24}px`;
  }

  function positionOf(time: string): number {
    return (minutesOfDay(time) / 60) * hourWidth;
  }

  function drawLanes(): void {
    if (!board) return;
    clear(lanes);
    for (const station of board.stations) {
      const lane = el('div', {
        role: 'group',
        'aria-label': station.name,
        class: `lane lane-${station.kind}`,
      });
      const laneLabel = el('div', { class: 'lane-label display', text: station.name });
      const track = el('div', { class: 'lane-track' });
      lane.append(laneLabel, track);
      if (station.kind === 'hourly') {
        drawHourlyLane(station, track);
      } else {
        drawShelfLane(station, track);
      }
      lanes.appendChild(lane);
    }
    drawGhost();
  }

  function drawHourlyLane(station: StationSummary, track: HTMLElement): void {
    if (!board) return;
    for (let quarter = 0; quarter < 96; quarter += 1) {
      const cell = el('div', { class: 'cell', 'data-minutes': String(quarter * 15) });
      cell.style.left = `${(quarter * 15 * hourWidth) / 60}px`;
      cell.style.width = `${hourWidth / 4}px`;
      if (isMember) {
        on(cell, 'click', () => {
          const start = timeFromMinutes(quarter * 15);
          const endMinutes = Math.min(1440, quarter * 15 + 60);
          openNewBooking(
            { stationId: station.id, date: board!.date, start, end: timeFromMinutes(endMinutes) },
            null,
          );
        });
      }
      track.appendChild(cell);
    }
    for (const window of board.outOfService.filter((w) => w.stationId === station.id)) {
      const band = el('div', { class: 'oos-band', text: window.reason });
      band.style.left = `${positionOf(window.localStart)}px`;
      band.style.width = `${positionOf(window.localEnd) - positionOf(window.localStart)}px`;
      track.appendChild(band);
    }
    for (const peak of board.peakWindows) {
      const weekday = weekdayKey(board.date);
      if (!peak.days.includes(weekday)) continue;
      const band = el('div', { class: 'peak-band', text: 'peak' });
      band.style.left = `${positionOf(peak.start)}px`;
      band.style.width = `${positionOf(peak.end) - positionOf(peak.start)}px`;
      track.appendChild(band);
    }
    const blocks = board.blocks.filter(
      (block) =>
        block.stationId === station.id &&
        block.status !== 'expired' &&
        (inHand === null || block.id !== inHand.booking.id),
    );
    for (const block of blocks) {
      track.appendChild(blockElement(block, station));
    }
  }

  function drawShelfLane(station: StationSummary, track: HTMLElement): void {
    if (!board) return;
    const occupying = board.blocks.filter(
      (block) => block.stationId === station.id && block.status !== 'expired',
    );
    const free = Math.max(0, (station.capacity ?? 0) - occupying.length);
    const cell = el('div', {
      role: 'group',
      'aria-label': `${station.name} ${board.date}`,
      class: `shelf-cell${free === 0 ? ' full' : ''}`,
    });
    cell.appendChild(
      el('span', { class: 'shelf-free', text: `${free} of ${station.capacity ?? 0} free` }),
    );
    const stack = el('div', { class: 'shelf-stack' });
    for (const block of occupying) {
      stack.appendChild(blockElement(block, station));
    }
    cell.appendChild(stack);
    if (isMember) {
      on(cell, 'click', (event) => {
        if ((event.target as HTMLElement).closest('.block')) return;
        openNewBooking({ stationId: station.id, date: board!.date, days: 1 }, null);
      });
    }
    track.appendChild(cell);
  }

  function blockElement(block: Booking, station: StationSummary): HTMLElement {
    const ownBlock = block.status !== 'booked';
    const label = labelOf({ ...block, stationName: station.name }, station.name);
    const saving = savingBlocks.has(block.id);
    const name = ownBlock
      ? `${label}, ${block.businessName ?? ''}, ${statusWords(block, saving)}`
      : `${label}, Booked`;
    const node = el('button', {
      type: 'button',
      class: `block${block.conflict ? ' conflict' : ''}${ownBlock ? '' : ' other'}`,
      'aria-label': name,
      'data-booking': block.id,
    });
    node.textContent = ownBlock ? `${label} \u00b7 ${statusWords(block, saving)}` : `${label} \u00b7 Booked`;
    if (station.kind === 'hourly') {
      node.style.left = `${positionOf(block.localStart ?? '00:00')}px`;
      node.style.width = `${Math.max(
        44,
        positionOf(block.localEnd ?? '00:00') - positionOf(block.localStart ?? '00:00'),
      )}px`;
    }
    if (ownBlock) {
      on(node, 'click', () => openBlockDetails(block, node));
    }
    return node;
  }

  function weekdayKey(date: string): string {
    const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
    const index = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
    return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][index]!;
  }

  function scrollToStartHour(): void {
    if (!board) return;
    const hour =
      board.date === board.today ? Number.parseInt(board.now.slice(11, 13), 10) : 5;
    lineBoard.scrollLeft = Math.max(0, hour * hourWidth - hourWidth);
  }

  /* ---------- rail ---------- */

  function drawRail(): void {
    clear(rail);
    if (isMember) {
      for (const ticket of tickets) rail.appendChild(ticketElement(ticket));
      return;
    }
    if (inHand) rail.appendChild(movingTicket(inHand));
    if (!board) return;
    for (const block of board.blocks) {
      if (!block.conflict) continue;
      if (inHand && block.id === inHand.booking.id) continue;
      rail.appendChild(conflictTicket(block));
    }
  }

  function ticketElement(ticket: Ticket): HTMLElement {
    const label = labelOf(
      { ...ticket.booking, stationName: stationName(ticket.booking.stationId) },
      stationName(ticket.booking.stationId),
    );
    const confirm = el('button', { type: 'button', text: 'Confirm' });
    const discard = el('button', { type: 'button', text: 'Discard' });
    const expiry = ticket.booking.holdExpiresAt
      ? ticket.booking.holdExpiresAt.slice(11, 16)
      : '';
    const quote =
      `${formatMoney(ticket.booking.chargeCents ?? 0)} \u00b7 ` +
      `${formatHours(ticket.booking.hours ?? 0)} h \u00b7 ` +
      `${formatHours(ticket.booking.peakHours ?? 0)} h peak`;
    const group = el(
      'div',
      {
        role: 'group',
        'aria-label': `Ticket ${label}`,
        class: `ticket${ticket.label ? ` ticket-${ticket.label}` : ''}`,
        'data-booking': ticket.booking.id,
      },
      [
        el('p', { class: 'ticket-held', text: `Held until ${expiry}` }),
        el('p', { class: 'ticket-quote', text: quote }),
        ticket.label ? el('p', { class: 'ticket-flag', text: ticket.label }) : null,
        el('div', { class: 'ticket-actions' }, [confirm, discard]),
      ],
    );
    on(confirm, 'click', () => void runDrop(ticket, confirm));
    on(discard, 'click', () => void runDiscard(ticket));
    return group;
  }

  function conflictTicket(block: Booking): HTMLElement {
    const label = labelOf({ ...block }, stationName(block.stationId));
    const move = el('button', { type: 'button', text: 'Move' });
    const release = el('button', { type: 'button', text: 'Release' });
    const reason =
      board?.outOfService.find((window) => window.stationId === block.stationId)?.reason ?? '';
    const group = el(
      'div',
      {
        role: 'group',
        'aria-label': `Conflict ${label}`,
        class: 'ticket conflict-ticket',
        'data-booking': block.id,
      },
      [el('p', { text: `Conflict: ${reason}` }), el('div', { class: 'ticket-actions' }, [move, release])],
    );
    on(move, 'click', () => pickUp(block));
    on(release, 'click', () => openRelease(block, release));
    return group;
  }

  function movingTicket(hand: InHand): HTMLElement {
    return el(
      'div',
      { role: 'group', 'aria-label': `Moving ${hand.originLabel}`, class: 'ticket moving-ticket' },
      el('p', { text: 'Moving' }),
    );
  }

  /* ---------- hour-bank roll ---------- */

  let rollTimer: number | null = null;

  function rollToTarget(): void {
    if (!board?.hourBank) return;
    if (rollTimer !== null) {
      window.clearInterval(rollTimer);
      rollTimer = null;
    }
    if (reducedMotion()) {
      showBalance();
      return;
    }
    const target = targetBalance();
    let shown = board.hourBank.balanceHours;
    const steps = Math.min(8, Math.max(1, Math.abs(Math.round((target - shown) * 4))));
    let step = 0;
    const direction = target > shown ? 0.25 : -0.25;
    rollTimer = window.setInterval(() => {
      step += 1;
      shown = step === steps ? target : shown + direction;
      context.setHourBank({ ...board!.hourBank!, balanceHours: Math.max(0, shown) });
      if (step >= steps) {
        window.clearInterval(rollTimer!);
        rollTimer = null;
      }
    }, 180);
  }

  /* ---------- claims ---------- */

  async function runDrop(ticket: Ticket, confirmButton: HTMLElement): Promise<void> {
    const label = labelOf({ ...ticket.booking }, stationName(ticket.booking.stationId));
    const hours = ticket.booking.hours ?? 0;
    pressCounter += 1;
    const pressSeq = pressCounter;
    hoursInFlight += hours;
    pendingActions += 1;
    confirmButton.setAttribute('disabled', '');
    confirmButton.setAttribute('aria-busy', 'true');
    context.announce(`Confirming ${label}\u2026`);
    rollToTarget();

    try {
      const result = await writeAction<{ bookings: Booking[]; hourBank: HourBank }>(
        `/api/bookings/${ticket.booking.id}/confirm`,
        {},
      );
      hoursInFlight = Math.max(0, hoursInFlight - hours);
      tickets = tickets.filter((candidate) => candidate.booking.id !== ticket.booking.id);
      const confirmed = result.body.bookings.find((item) => item.id === ticket.booking.id);
      if (pressSeq > lastBalanceSetter) {
        lastBalanceSetter = pressSeq;
        drawnBalance = result.body.hourBank.balanceHours;
      }
      if (pressSeq > lastAnnouncedDrop) {
        lastAnnouncedDrop = pressSeq;
        context.announce(dropSuccessCopy(confirmed ?? ticket.booking, result));
      }
      bumpOwnAction();
      rollToTarget();
      drawRail();
      await finishAction();
      if (confirmed) ringLandedBlock(confirmed.id);
      if (result.status === 202) void context.refreshBanner();
    } catch (error) {
      hoursInFlight = Math.max(0, hoursInFlight - hours);
      confirmButton.removeAttribute('disabled');
      confirmButton.removeAttribute('aria-busy');
      if (error instanceof AbandonedError) return;
      if (error instanceof ApiError) {
        if (error.code === 'block_taken') {
          markTicket(ticket.booking.id, 'taken');
        } else if (error.code === 'hold_expired') {
          markTicket(ticket.booking.id, 'expired');
        }
        context.showAlert(
          error.status === 422 ? error.firstFieldMessage() ?? error.copy : error.copy,
        );
      } else if (error instanceof NetworkError) {
        context.showAlert(networkCopy);
      }
      bumpOwnAction();
      rollToTarget();
      drawRail();
      await finishAction();
    }
  }

  function dropSuccessCopy(
    booking: Booking,
    result: { status: number; body: { bookings: Booking[]; hourBank: HourBank } },
  ): string {
    const station = stationName(booking.stationId);
    let copy: string;
    if (booking.kind === 'shelf') {
      copy = `${labelOf({ ...booking }, station)} booked`;
    } else {
      const hoursLeft = result.body.hourBank.balanceHours;
      const hourWord = hoursLeft === 1 ? 'hour' : 'hours';
      copy =
        `${station}, ${booking.localStart} to ${booking.localEnd} booked, ` +
        `${formatHours(hoursLeft)} ${hourWord} left`;
      const peak = booking.peakHours ?? 0;
      if (peak > 0) {
        copy += `, ${formatHours(peak)} ${peak === 1 ? 'hour' : 'hours'} at peak`;
      }
    }
    const others = result.body.bookings.length - 1;
    if (others > 0) copy += ` and ${others} more ${others === 1 ? 'week' : 'weeks'}`;
    if (result.status === 202) copy += '. Billing is pending.';
    return copy;
  }

  /** The landing ring: one second around the block that has just dropped. */
  function ringLandedBlock(bookingId: string): void {
    const node = lanes.querySelector<HTMLElement>(`[data-booking="${bookingId}"]`);
    if (!node) return;
    node.classList.add('landing-ring');
    window.setTimeout(() => node.classList.remove('landing-ring'), 1000);
  }

  function markTicket(bookingId: string, label: 'taken' | 'expired'): void {
    tickets = tickets.map((ticket) =>
      ticket.booking.id === bookingId ? { ...ticket, label } : ticket,
    );
  }

  async function runDiscard(ticket: Ticket): Promise<void> {
    if (ticket.label === 'expired') {
      discardedTickets.add(ticket.booking.id);
      tickets = tickets.filter((candidate) => candidate.booking.id !== ticket.booking.id);
      drawRail();
      return;
    }
    discardedTickets.add(ticket.booking.id);
    pendingActions += 1;
    context.announce('Releasing hold\u2026');
    try {
      await writeAction(`/api/bookings/${ticket.booking.id}/cancel`, {});
      tickets = tickets.filter((candidate) => candidate.booking.id !== ticket.booking.id);
      context.announce('Hold released.');
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (error instanceof ApiError) context.showAlert(error.copy);
      else if (error instanceof NetworkError) context.showAlert(networkCopy);
    } finally {
      bumpOwnAction();
      drawRail();
      await finishAction();
    }
  }

  async function finishAction(): Promise<void> {
    pendingActions = Math.max(0, pendingActions - 1);
    if (pendingActions === 0) await load(false);
  }

  /* ---------- new booking ---------- */

  function openNewBooking(
    prefill:
      | { stationId: string; date: string; start?: string; end?: string; days?: number }
      | null,
    opener: HTMLElement | null,
  ): void {
    if (!board) return;
    const stationSelect = el('select', {}, board.stations.map((station) =>
      el('option', { value: station.id, text: station.name }),
    ));
    stationSelect.setAttribute('aria-label', 'Station');
    const dateInput = el('input', { type: 'text', value: prefill?.date ?? board.date });
    const startInput = el('input', { type: 'text', value: prefill?.start ?? '' });
    const endInput = el('input', { type: 'text', value: prefill?.end ?? '' });
    const daysInput = el('input', { type: 'number', min: '1', max: '31', value: String(prefill?.days ?? 1) });
    const repeatInput = el('input', { type: 'number', min: '1', max: '12', value: '1' });
    const notesInput = el('input', { type: 'text', value: '' });
    const errors = {
      date: fieldError(),
      start: fieldError(),
      end: fieldError(),
      days: fieldError(),
      repeatWeeks: fieldError(),
      notes: fieldError(),
    };
    if (prefill) stationSelect.value = prefill.stationId;

    const holdButton = el('button', { type: 'button', text: 'Hold block' });
    const closeButton = el('button', { type: 'button', text: 'Close' });

    const shelfFields = el('div', {}, labelled('Days', daysInput, errors.days));
    const hourlyFields = el('div', {}, [
      labelled('Start', startInput, errors.start),
      labelled('End', endInput, errors.end),
      labelled('Repeat weekly', repeatInput, errors.repeatWeeks),
    ]);

    const syncKind = (): void => {
      const station = stationOf(stationSelect.value);
      const shelf = station?.kind === 'shelf';
      shelfFields.hidden = !shelf;
      hourlyFields.hidden = shelf;
    };
    on(stationSelect, 'change', syncKind);

    const handle = openDialog({
      label: 'New booking',
      opener,
      className: 'new-booking',
      content: [
        labelled('Station', stationSelect),
        labelled('Date', dateInput, errors.date),
        hourlyFields,
        shelfFields,
        labelled('Notes', notesInput, errors.notes),
        el('div', { class: 'dialog-actions' }, [holdButton, closeButton]),
      ],
      firstFocus: () => stationSelect,
      onClosed: () => {
        openBoardDialog = null;
      },
    });
    openBoardDialog = handle;
    syncKind();

    on(closeButton, 'click', () => handle.close());

    on(holdButton, 'click', () => {
      void (async () => {
        for (const holder of Object.values(errors)) {
          holder.hidden = true;
          holder.textContent = '';
        }
        const station = stationOf(stationSelect.value);
        const shelf = station?.kind === 'shelf';
        const body: Record<string, unknown> = {
          stationId: stationSelect.value,
          date: dateInput.value.trim(),
        };
        if (shelf) {
          body['days'] = Number.parseInt(daysInput.value, 10);
        } else {
          body['start'] = startInput.value.trim();
          body['end'] = endInput.value.trim();
          const weeks = Number.parseInt(repeatInput.value, 10);
          if (Number.isFinite(weeks) && weeks !== 1) body['repeatWeeks'] = weeks;
        }
        if (notesInput.value.length > 0) body['notes'] = notesInput.value;

        holdButton.setAttribute('disabled', '');
        holdButton.setAttribute('aria-busy', 'true');
        pendingActions += 1;
        context.announce(`Holding ${holdLabel(body, station?.name ?? '')}\u2026`);
        try {
          const result = await writeAction<{ bookings: Booking[]; seriesId: string | null }>(
            '/api/bookings',
            body,
          );
          const first = result.body.bookings[0]!;
          const expiry = first.holdExpiresAt?.slice(11, 16) ?? '';
          context.announce(
            `Held ${labelOf({ ...first }, stationName(first.stationId))} until ${expiry}.`,
          );
          handle.close();
          bumpOwnAction();
          if (first.localDate !== board?.date) {
            context.navigate(`/board?date=${first.localDate}`);
            return;
          }
          tickets = [...tickets, { booking: first, label: null }];
          drawRail();
          focusTicketConfirm(first.id);
          await finishAction();
        } catch (error) {
          holdButton.removeAttribute('disabled');
          holdButton.removeAttribute('aria-busy');
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) {
            if (error.status === 422) {
              const fields = error.fieldErrors();
              let focused = false;
              for (const [key, holder] of Object.entries(errors)) {
                const message = fields[key];
                if (!message) continue;
                const control =
                  key === 'date'
                    ? dateInput
                    : key === 'start'
                      ? startInput
                      : key === 'end'
                        ? endInput
                        : key === 'days'
                          ? daysInput
                          : key === 'repeatWeeks'
                            ? repeatInput
                            : notesInput;
                setFieldError(control, holder, message);
                if (!focused) {
                  control.focus();
                  focused = true;
                }
              }
              context.showAlert(error.firstFieldMessage() ?? error.copy);
            } else {
              context.showAlert(error.copy);
            }
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
          bumpOwnAction();
          await finishAction();
        }
      })();
    });
  }

  function holdLabel(body: Record<string, unknown>, station: string): string {
    if (typeof body['days'] === 'number') {
      return blockLabel({
        kind: 'shelf',
        stationName: station,
        localDate: String(body['date']),
        days: body['days'],
      });
    }
    return blockLabel({
      kind: 'hourly',
      stationName: station,
      localDate: String(body['date']),
      localStart: String(body['start'] ?? ''),
      localEnd: String(body['end'] ?? ''),
    });
  }

  function focusTicketConfirm(bookingId: string): void {
    const group = rail.querySelector<HTMLElement>(`[data-booking="${bookingId}"]`);
    const confirm = group?.querySelector<HTMLElement>('button');
    group?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    confirm?.focus();
  }

  /* ---------- block details and status actions ---------- */

  function openBlockDetails(block: Booking, opener: HTMLElement): void {
    const label = labelOf({ ...block }, stationName(block.stationId));
    const actions = block.actions ?? [];
    const buttons: HTMLElement[] = [];
    const add = (action: string, text: string, run: () => void): void => {
      if (!actions.includes(action)) return;
      const button = el('button', { type: 'button', text });
      on(button, 'click', run);
      buttons.push(button);
    };
    const closeButton = el('button', { type: 'button', text: 'Close' });

    let handle: DialogHandle;
    add('check_in', 'Check in', () => {
      handle.close();
      void runStatus(block, 'check-in', opener);
    });
    add('check_out', 'Check out', () => {
      handle.close();
      void runStatus(block, 'check-out', opener);
    });
    add('no_show', 'Mark no-show', () => {
      handle.close();
      void runStatus(block, 'no-show', opener);
    });
    add('move', 'Pick up to move', () => {
      handle.close();
      pickUp(block);
    });
    add('cancel', 'Cancel booking', () => {
      handle.close();
      openCancel(block, opener);
    });
    buttons.push(closeButton);

    handle = openDialog({
      label: 'Block details',
      opener,
      content: [
        el('p', { class: 'display', text: label }),
        el('p', { text: `Charge ${formatMoney(block.chargeCents ?? 0)}` }),
        el('div', { class: 'dialog-actions' }, buttons),
      ],
      onClosed: () => {
        openBoardDialog = null;
      },
    });
    openBoardDialog = handle;
    on(closeButton, 'click', () => handle.close());
  }

  async function runStatus(
    block: Booking,
    action: 'check-in' | 'check-out' | 'no-show',
    opener: HTMLElement,
  ): Promise<void> {
    savingBlocks.add(block.id);
    drawLanes();
    pendingActions += 1;
    context.announce('Saving\u2026');
    try {
      const result = await post<{ booking: Booking }>(`/api/bookings/${block.id}/${action}`, {});
      savingBlocks.delete(block.id);
      replaceBlock(result.body.booking);
      const business = result.body.booking.businessName ?? '';
      context.announce(
        action === 'check-in'
          ? `Checked in ${business}.`
          : action === 'check-out'
            ? `Checked out ${business}.`
            : `Marked ${business} as no-show.`,
      );
      bumpOwnAction();
      await finishAction();
    } catch (error) {
      savingBlocks.delete(block.id);
      if (error instanceof AbandonedError) return;
      if (error instanceof ApiError) {
        const current = error.body['current'] as Booking | undefined;
        if (current) replaceBlock(current);
        else drawLanes();
        context.showAlert(
          error.status === 422 ? error.firstFieldMessage() ?? error.copy : error.copy,
        );
      } else if (error instanceof NetworkError) {
        drawLanes();
        context.showAlert(networkCopy);
      }
      focusBlock(block.id, opener);
      bumpOwnAction();
      await finishAction();
    }
  }

  function replaceBlock(booking: Booking): void {
    if (!board) return;
    const shows = ['held', 'confirmed', 'checked_in', 'completed', 'no_show'].includes(
      booking.status,
    );
    board.blocks = board.blocks.filter((block) => block.id !== booking.id);
    if (shows) board.blocks.push(booking);
    drawLanes();
    drawRail();
  }

  function focusBlock(bookingId: string, fallback: HTMLElement): void {
    const node = lanes.querySelector<HTMLElement>(`[data-booking="${bookingId}"]`);
    (node ?? fallback).focus();
  }

  function openCancel(block: Booking, opener: HTMLElement): void {
    const fee = block.penaltyCents ?? 0;
    const startMs = Date.parse(block.start);
    const nowMs = board ? Date.parse(board.now) : Date.now();
    const late = nowMs > startMs - 48 * 3600 * 1000;
    const amount = late ? Math.round((block.chargeCents ?? 0) / 2) : fee;
    const feeLine = late
      ? `Late cancellation fee: ${formatMoney(amount)}`
      : 'No cancellation fee';
    const confirmButton = el('button', { type: 'button', text: 'Confirm cancellation' });
    const keepButton = el('button', { type: 'button', text: 'Keep booking' });
    const handle = openDialog({
      label: 'Cancel booking',
      opener,
      content: [
        el('p', { text: feeLine }),
        el('div', { class: 'dialog-actions' }, [confirmButton, keepButton]),
      ],
      onClosed: () => {
        openBoardDialog = null;
      },
    });
    openBoardDialog = handle;
    on(keepButton, 'click', () => handle.close());
    on(confirmButton, 'click', () => {
      handle.close();
      void (async () => {
        savingBlocks.add(block.id);
        drawLanes();
        pendingActions += 1;
        context.announce('Cancelling\u2026');
        try {
          const result = await writeAction<{ booking: Booking; hourBank: HourBank }>(
            `/api/bookings/${block.id}/cancel`,
            {},
          );
          savingBlocks.delete(block.id);
          replaceBlock(result.body.booking);
          const penalty = result.body.booking.penaltyCents ?? 0;
          context.announce(
            penalty > 0
              ? `Cancelled. Late cancellation fee: ${formatMoney(penalty)}.`
              : 'Cancelled. No cancellation fee.',
          );
          drawnBalance = result.body.hourBank.balanceHours;
          showBalance();
          bumpOwnAction();
          await finishAction();
        } catch (error) {
          savingBlocks.delete(block.id);
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) {
            const current = error.body['current'] as Booking | undefined;
            if (current) replaceBlock(current);
            else drawLanes();
            context.showAlert(error.copy);
          } else if (error instanceof NetworkError) {
            drawLanes();
            context.showAlert(networkCopy);
          }
          bumpOwnAction();
          await finishAction();
        }
      })();
    });
  }

  function openRelease(block: Booking, opener: HTMLElement): void {
    const label = labelOf({ ...block }, stationName(block.stationId));
    const releaseButton = el('button', { type: 'button', text: 'Release' });
    const keepButton = el('button', { type: 'button', text: 'Keep' });
    const handle = openDialog({
      label: 'Release block',
      opener,
      content: [
        el('p', { text: `Release ${label} free of charge?` }),
        el('div', { class: 'dialog-actions' }, [releaseButton, keepButton]),
      ],
      onClosed: () => {
        openBoardDialog = null;
      },
    });
    openBoardDialog = handle;
    on(keepButton, 'click', () => handle.close());
    on(releaseButton, 'click', () => {
      handle.close();
      void (async () => {
        pendingActions += 1;
        context.announce('Releasing\u2026');
        try {
          const result = await post<{ booking: Booking }>(`/api/bookings/${block.id}/release`, {});
          replaceBlock(result.body.booking);
          context.announce(`Released ${label}. No cancellation fee.`);
        } catch (error) {
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) {
            const current = error.body['current'] as Booking | undefined;
            if (current) replaceBlock(current);
            context.showAlert(error.copy);
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
        } finally {
          bumpOwnAction();
          await finishAction();
        }
      })();
    });
  }

  /* ---------- out of service ---------- */

  function openOutOfService(opener: HTMLElement): void {
    if (!board) return;
    const stationSelect = el('select', {}, board.stations.map((station) =>
      el('option', { value: station.id, text: station.name }),
    ));
    stationSelect.setAttribute('aria-label', 'Station');
    const dateInput = el('input', { type: 'text', value: board.date });
    const startInput = el('input', { type: 'text', value: '' });
    const endInput = el('input', { type: 'text', value: '' });
    const reasonInput = el('input', { type: 'text', value: '' });
    const errors = {
      date: fieldError(),
      start: fieldError(),
      end: fieldError(),
      reason: fieldError(),
    };
    const saveButton = el('button', { type: 'button', text: 'Save window' });
    const closeButton = el('button', { type: 'button', text: 'Close' });

    const handle = openDialog({
      label: 'Out of service',
      opener,
      content: [
        labelled('Station', stationSelect),
        labelled('Date', dateInput, errors.date),
        labelled('Start', startInput, errors.start),
        labelled('End', endInput, errors.end),
        labelled('Reason', reasonInput, errors.reason),
        el('div', { class: 'dialog-actions' }, [saveButton, closeButton]),
      ],
      onClosed: () => {
        openBoardDialog = null;
      },
    });
    openBoardDialog = handle;
    on(closeButton, 'click', () => handle.close());
    on(saveButton, 'click', () => {
      void (async () => {
        for (const holder of Object.values(errors)) {
          holder.hidden = true;
          holder.textContent = '';
        }
        saveButton.setAttribute('disabled', '');
        saveButton.setAttribute('aria-busy', 'true');
        context.announce('Saving\u2026');
        pendingActions += 1;
        try {
          const result = await post<{ window: OutOfServiceWindow; conflicts: string[] }>(
            '/api/out-of-service',
            {
              stationId: stationSelect.value,
              date: dateInput.value.trim(),
              start: startInput.value.trim(),
              end: endInput.value.trim(),
              reason: reasonInput.value,
            },
          );
          const window = result.body.window;
          context.announce(
            `${stationName(window.stationId)} out of service ${window.localDate} ` +
              `${window.localStart}\u2013${window.localEnd}. ` +
              `${result.body.conflicts.length} blocks need moving.`,
          );
          handle.close();
        } catch (error) {
          saveButton.removeAttribute('disabled');
          saveButton.removeAttribute('aria-busy');
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) {
            if (error.status === 422) {
              const fields = error.fieldErrors();
              for (const [key, holder] of Object.entries(errors)) {
                const message = fields[key];
                if (!message) continue;
                const control =
                  key === 'date'
                    ? dateInput
                    : key === 'start'
                      ? startInput
                      : key === 'end'
                        ? endInput
                        : reasonInput;
                setFieldError(control, holder, message);
              }
            }
            context.showAlert(
              error.status === 422 ? error.firstFieldMessage() ?? error.copy : error.copy,
            );
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
        } finally {
          bumpOwnAction();
          await finishAction();
        }
      })();
    });
  }

  /* ---------- keyboard move ---------- */

  function ghostLabel(hand: InHand): string {
    return labelOf(
      {
        kind: stationOf(hand.stationId)?.kind,
        localDate: hand.localDate,
        localStart: hand.localStart,
        localEnd: hand.localEnd,
        days: hand.days,
      },
      stationName(hand.stationId),
    );
  }

  function pickUp(block: Booking): void {
    const station = stationOf(block.stationId);
    inHand = {
      booking: block,
      originLabel: labelOf({ ...block }, stationName(block.stationId)),
      stationId: block.stationId,
      localDate: block.localDate,
      localStart: block.localStart,
      localEnd: block.localEnd,
      days: station?.kind === 'shelf' ? block.days ?? 1 : null,
      saving: false,
    };
    drawLanes();
    drawRail();
    context.announce(
      `Picked up ${inHand.originLabel}. Arrow keys move it, Enter places it, Escape puts it back.`,
    );
    ghostElement?.focus();
  }

  function putBack(): void {
    if (!inHand) return;
    const label = inHand.originLabel;
    const bookingId = inHand.booking.id;
    inHand = null;
    drawLanes();
    drawRail();
    context.announce(`Put back ${label}.`);
    const node = lanes.querySelector<HTMLElement>(`[data-booking="${bookingId}"]`);
    node?.focus();
  }

  function ghostOccupancy(hand: InHand): 'free' | 'occupied' | 'out_of_service' {
    if (!board) return 'free';
    const station = stationOf(hand.stationId);
    if (station?.kind === 'shelf') {
      const occupying = board.blocks.filter(
        (block) =>
          block.stationId === hand.stationId &&
          block.status !== 'expired' &&
          block.id !== hand.booking.id,
      ).length;
      if (occupying >= (station.capacity ?? 0)) return 'occupied';
      return 'free';
    }
    const start = minutesOfDay(hand.localStart ?? '00:00');
    const end = minutesOfDay(hand.localEnd ?? '00:00');
    const clash = board.blocks.some(
      (block) =>
        block.stationId === hand.stationId &&
        block.id !== hand.booking.id &&
        block.status !== 'expired' &&
        block.localStart !== null &&
        minutesOfDay(block.localStart) < end &&
        minutesOfDay(block.localEnd ?? '24:00') > start,
    );
    if (clash) return 'occupied';
    const blocked = board.outOfService.some(
      (window) =>
        window.stationId === hand.stationId &&
        minutesOfDay(window.localStart) < end &&
        minutesOfDay(window.localEnd) > start,
    );
    return blocked ? 'out_of_service' : 'free';
  }

  function drawGhost(): void {
    ghostElement = null;
    if (!inHand || !board) return;
    const laneIndex = board.stations.findIndex((station) => station.id === inHand!.stationId);
    const lane = lanes.children[laneIndex];
    if (!lane) return;
    const track = lane.querySelector<HTMLElement>('.lane-track');
    if (!track) return;
    const occupancy = ghostOccupancy(inHand);
    const marker =
      inHand.saving
        ? 'Moving\u2026'
        : occupancy === 'occupied'
          ? 'Occupied'
          : occupancy === 'out_of_service'
            ? 'Out of service'
            : '';
    const ghost = el('div', {
      role: 'group',
      'aria-label': `Moving to ${ghostLabel(inHand)}`,
      class: `ghost${occupancy === 'free' ? '' : ' not-free'}`,
      tabindex: '0',
    });
    ghost.textContent = marker.length > 0 ? `${ghostLabel(inHand)} \u00b7 ${marker}` : ghostLabel(inHand);
    const station = stationOf(inHand.stationId);
    if (station?.kind === 'hourly') {
      ghost.style.left = `${positionOf(inHand.localStart ?? '00:00')}px`;
      ghost.style.width = `${Math.max(
        44,
        positionOf(inHand.localEnd ?? '00:00') - positionOf(inHand.localStart ?? '00:00'),
      )}px`;
    }
    track.appendChild(ghost);
    ghostElement = ghost;
  }

  function stepGhost(event: KeyboardEvent): void {
    if (!inHand || !board || inHand.saving) return;
    const station = stationOf(inHand.stationId);
    const key = event.key;
    let moved = false;
    let edge = false;

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const direction = key === 'ArrowLeft' ? -1 : 1;
      if (station?.kind === 'shelf') {
        const next = addDays(inHand.localDate, direction);
        if (next < board.today) edge = true;
        else {
          inHand.localDate = next;
          moved = true;
        }
      } else {
        const stepMinutes = (event.shiftKey ? 60 : 15) * direction;
        const start = minutesOfDay(inHand.localStart ?? '00:00') + stepMinutes;
        const end = minutesOfDay(inHand.localEnd ?? '00:00') + stepMinutes;
        if (start < 0 || end > 1440) edge = true;
        else {
          inHand.localStart = timeFromMinutes(start);
          inHand.localEnd = timeFromMinutes(end);
          moved = true;
        }
      }
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      const sameKind = board.stations.filter((candidate) => candidate.kind === station?.kind);
      const index = sameKind.findIndex((candidate) => candidate.id === inHand!.stationId);
      const target = sameKind[index + (key === 'ArrowUp' ? -1 : 1)];
      if (!target) edge = true;
      else {
        inHand.stationId = target.id;
        moved = true;
      }
    } else if (key === 'Enter') {
      const occupancy = ghostOccupancy(inHand);
      if (occupancy !== 'free') {
        context.announce(`${ghostLabel(inHand)} is not free. Choose free time.`);
      } else {
        openMoveDialog();
      }
      event.preventDefault();
      return;
    } else if (key === 'Escape') {
      putBack();
      event.preventDefault();
      return;
    } else {
      return;
    }

    event.preventDefault();
    drawLanes();
    ghostElement?.focus();
    if (edge) {
      context.announce(`${ghostLabel(inHand)}. Edge of the board.`);
      return;
    }
    if (moved) {
      const occupancy = ghostOccupancy(inHand);
      context.announce(
        occupancy === 'occupied'
          ? `${ghostLabel(inHand)}. Occupied.`
          : occupancy === 'out_of_service'
            ? `${ghostLabel(inHand)}. Out of service.`
            : `${ghostLabel(inHand)}.`,
      );
    }
  }

  function openMoveDialog(): void {
    if (!inHand) return;
    const hand = inHand;
    const confirmButton = el('button', { type: 'button', text: 'Confirm move' });
    const putBackButton = el('button', { type: 'button', text: 'Put back' });
    const handle = openDialog({
      label: 'Move block',
      content: [
        el('p', { text: `From ${hand.originLabel} to ${ghostLabel(hand)}` }),
        el('p', { text: `New charge ${formatMoney(hand.booking.chargeCents ?? 0)}` }),
        el('div', { class: 'dialog-actions' }, [confirmButton, putBackButton]),
      ],
      firstFocus: () => confirmButton,
      onEscape: () => {
        handle.close();
        putBack();
      },
      onClosed: () => {
        openBoardDialog = null;
      },
    });
    openBoardDialog = handle;
    on(putBackButton, 'click', () => {
      handle.close();
      putBack();
    });
    on(confirmButton, 'click', () => {
      handle.close();
      void runMove(hand);
    });
  }

  async function runMove(hand: InHand): Promise<void> {
    hand.saving = true;
    savingBlocks.add(hand.booking.id);
    drawLanes();
    ghostElement?.focus();
    pendingActions += 1;
    context.announce('Moving\u2026');
    const station = stationOf(hand.stationId);
    const body: Record<string, unknown> =
      station?.kind === 'shelf'
        ? {
            stationId: hand.stationId,
            date: hand.localDate,
            days: hand.days ?? 1,
            version: hand.booking.version,
          }
        : {
            stationId: hand.stationId,
            date: hand.localDate,
            start: hand.localStart,
            end: hand.localEnd,
            version: hand.booking.version,
          };
    try {
      const result = await post<{ booking: Booking }>(
        `/api/bookings/${hand.booking.id}/move`,
        body,
      );
      savingBlocks.delete(hand.booking.id);
      inHand = null;
      replaceBlock(result.body.booking);
      context.announce(
        `Moved to ${labelOf({ ...result.body.booking }, stationName(result.body.booking.stationId))}.`,
      );
      focusBlockOrLane(result.body.booking.id);
    } catch (error) {
      savingBlocks.delete(hand.booking.id);
      inHand = null;
      if (error instanceof AbandonedError) return;
      if (error instanceof ApiError) {
        const current = error.body['current'] as Booking | undefined;
        if (current) replaceBlock(current);
        else drawLanes();
        context.showAlert(
          error.status === 422 ? error.firstFieldMessage() ?? error.copy : error.copy,
        );
        focusBlockOrLane(current?.id ?? hand.booking.id);
      } else if (error instanceof NetworkError) {
        drawLanes();
        drawRail();
        context.showAlert(networkCopy);
      }
    } finally {
      bumpOwnAction();
      await finishAction();
    }
  }

  function focusBlockOrLane(bookingId: string): void {
    const node = lanes.querySelector<HTMLElement>(`[data-booking="${bookingId}"]`);
    if (node) {
      node.focus();
      return;
    }
    lanes.querySelector<HTMLElement>('.lane')?.focus();
  }

  const keyHandler = (event: KeyboardEvent): void => {
    if (!inHand) return;
    if (openBoardDialog?.isOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    const inside = rail.contains(target) || lineBoard.contains(target);
    if (!inside) return;
    stepGhost(event);
  };
  document.addEventListener('keydown', keyHandler);

  const resizeHandler = (): void => {
    applyScale();
    drawLanes();
  };
  window.addEventListener('resize', resizeHandler);

  void load(true);
  refreshTimer = window.setInterval(() => void load(false), 12000);

  return {
    element,
    onResize: resizeHandler,
    destroy: () => {
      destroyed = true;
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
      if (rollTimer !== null) window.clearInterval(rollTimer);
      document.removeEventListener('keydown', keyHandler);
      window.removeEventListener('resize', resizeHandler);
      openBoardDialog?.close();
    },
  };
}
