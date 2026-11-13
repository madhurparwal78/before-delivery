import { request } from '../api';
import { anchorServerTime, kitchenIsoFor, kitchenToday, serverNowMs } from '../clock';
import { el, focusElement, setAttr, setText } from '../dom';
import { icon } from '../icons';
import { COUNTDOWN_MS, DOOR_MS, FLOOR_MS, Refreshes } from '../refresh';
import { announce, heading, kitchen, navigate, type Screen, type ScreenContext } from '../shell';
import { newIdempotencyKey, session } from '../state';
import * as copy from '../copy';
import {
  addDays,
  formatDateLabel,
  formatDuration,
  isCalendarDate,
  isHalfHourHhmm,
  isoDate,
  isoTime,
  minutesOfHhmm,
} from '../../shared/format';
import { MINIMUM_BOOKING_MINUTES } from '../../shared/copy';
import { createDoorColumn } from './door';
import { createPlan } from './plan';
import { createRail } from './rail';
import { createSlab } from './iso';
import type { Booking, FloorResponse, SpanStatus, Station } from '../../shared/types';

type HintKind = 'length' | 'started' | 'horizon' | null;

interface TicketCard {
  booking: Booking;
  article: HTMLElement;
  titleLine: HTMLElement;
  statusLine: HTMLElement;
  pairLine: HTMLElement;
  cancelLine: HTMLElement;
  refusalLine: HTMLElement;
  outcomeLine: HTMLElement;
  buttons: HTMLElement;
  cancelStep: HTMLElement | null;
  confirmPending: boolean;
  cancelPending: boolean;
  movePending: boolean;
  refusal: string;
  outcome: string;
  expiredShown: boolean;
  confirmFailedAtZero: boolean;
}

const DEFAULT_FROM = '09:00';
const DEFAULT_TO = '12:00';

export async function mountBoard(ctx: ScreenContext): Promise<Screen> {
  const user = ctx.user;
  if (user === null) return { unmount: () => undefined };
  const isTenant = user.role === 'tenant';

  const level1 = heading('Board');
  const dateGroup = el('div', {
    className: 'kitchen-date',
    attrs: { role: 'group', 'aria-label': 'Kitchen date' },
  });
  const previousButton = el('button', { text: 'Previous day', className: 'button', attrs: { type: 'button' } });
  const nextButton = el('button', { text: 'Next day', className: 'button', attrs: { type: 'button' } });
  const todayButton = el('button', { text: 'Today', className: 'button', attrs: { type: 'button' } });
  const dateText = el('p', { className: 'date-text' });
  previousButton.prepend(icon('chevron-left'));
  nextButton.prepend(icon('chevron-right'));
  todayButton.prepend(icon('calendar-days'));
  dateGroup.append(previousButton, nextButton, todayButton, dateText);

  const column = el('section', {
    className: 'ticket-column',
    attrs: { role: 'region', 'aria-label': 'Your tickets' },
  });
  const slabButton = el('button', {
    className: 'slab-button',
    attrs: { type: 'button', 'aria-pressed': 'false' },
  });
  const slabHint = el('p', { className: 'span-hint' });
  const slabRefusalLine = el('p', { className: 'refusal-copy' });
  const slabOutcome = el('p', { className: 'outcome-copy' });
  const cardList = el('div', { className: 'card-grid' });
  const doorColumn = isTenant ? null : createDoorColumn();

  const slabArea = el('div', { className: 'slab-area' });
  if (isTenant) {
    slabArea.append(slabButton, slabHint, slabRefusalLine, slabOutcome);
    column.append(cardList);
  } else {
    slabArea.append(slabOutcome);
  }

  const plan = createPlan({ onStationActivate: (stationId) => onStationActivate(stationId) });
  const rail = createRail({
    onSpanChange: (nextFrom, nextTo) => {
      from = nextFrom;
      to = nextTo;
      writeUrl(true);
      clearRefusals();
      void loadFloor('settle');
    },
  });

  const stationDialog = el('dialog', { className: 'dialog station-dialog' });
  const dialogList = el('div', { className: 'dialog-list', attrs: { role: 'list', 'aria-label': 'Bookings in span' } });
  const shelfSelect = el('select', { className: 'field-input', attrs: { 'aria-label': 'Walk-in shelf' } });
  const dialogClaimButton = el('button', { className: 'button claim', attrs: { type: 'button' } });
  const dialogHint = el('p', { className: 'span-hint' });
  const dialogRefusal = el('p', { className: 'refusal-copy' });
  const dialogClose = el('button', { text: 'Close', className: 'button quiet', attrs: { type: 'button' } });
  stationDialog.append(dialogList);
  if (isTenant) stationDialog.append(shelfSelect, dialogClaimButton, dialogHint, dialogRefusal);
  stationDialog.append(dialogClose);

  const boardLayout = el('div', { className: 'board-layout' });
  boardLayout.append(rail.node, slabArea, plan.node, isTenant ? column : doorColumn?.node ?? column);
  ctx.root.append(level1, dateGroup, boardLayout, stationDialog);
  focusElement(level1);

  let date = kitchenToday();
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  let floor: FloorResponse | null = null;
  let floorToken = 0;
  let mutationSeq = 0;
  let lifted: { kind: 'slab' } | { kind: 'move'; bookingId: string } | null = null;
  let dialogStationId: string | null = null;
  const cards = new Map<string, TicketCard>();
  const refreshes = new Refreshes();

  const kitchenInfo = kitchen();
  const holdSeconds = kitchenInfo?.holdSeconds ?? 90;
  const minimumMinutes = kitchenInfo?.minimumBookingMinutes ?? MINIMUM_BOOKING_MINUTES;

  function readUrl(query: URLSearchParams): void {
    const rawDate = query.get('date');
    const rawFrom = query.get('from');
    const rawTo = query.get('to');
    date = rawDate !== null && isCalendarDate(rawDate) ? rawDate : kitchenToday();
    const spanGiven = rawFrom !== null && rawTo !== null;
    const spanValid =
      spanGiven &&
      isHalfHourHhmm(rawFrom) &&
      isHalfHourHhmm(rawTo) &&
      minutesOfHhmm(rawFrom) >= minutesOfHhmm('05:00') &&
      minutesOfHhmm(rawTo) <= minutesOfHhmm('23:00') &&
      minutesOfHhmm(rawFrom) < minutesOfHhmm(rawTo);
    from = spanValid && rawFrom !== null ? rawFrom : DEFAULT_FROM;
    to = spanValid && rawTo !== null ? rawTo : DEFAULT_TO;
    const needsRewrite =
      rawDate === null || !isCalendarDate(rawDate) || (spanGiven ? !spanValid : rawFrom !== null || rawTo !== null);
    if (needsRewrite || !spanGiven) writeUrl(true);
    rail.setSpan(from, to);
    setText(dateText, formatDateLabel(date));
  }

  function writeUrl(replace: boolean): void {
    const target = `/board?date=${date}&from=${from}&to=${to}`;
    if (replace) window.history.replaceState({}, '', target);
    else window.history.pushState({}, '', target);
  }

  function spanMinutes(): number {
    return minutesOfHhmm(to) - minutesOfHhmm(from);
  }

  function spanStatus(): SpanStatus | null {
    return floor?.spanStatus ?? null;
  }

  function hintKind(): HintKind {
    if (spanMinutes() < minimumMinutes) return 'length';
    const status = spanStatus();
    if (status === 'started') return 'started';
    if (status === 'beyond_horizon') return 'horizon';
    return null;
  }

  function hintText(kind: HintKind): string {
    if (kind === 'length') return copy.spanHint.length;
    if (kind === 'started') return copy.spanHint.started;
    if (kind === 'horizon') return copy.spanHint.horizon;
    return '';
  }

  function applyHints(): void {
    const kind = hintKind();
    const text = hintText(kind);
    setText(slabHint, text);
    setText(dialogHint, text);
    if (kind === null) {
      slabButton.removeAttribute('aria-disabled');
      dialogClaimButton.removeAttribute('aria-disabled');
    } else {
      slabButton.setAttribute('aria-disabled', 'true');
      dialogClaimButton.setAttribute('aria-disabled', 'true');
    }
    for (const card of cards.values()) paintCard(card);
  }

  function stationById(stationId: string): Station | undefined {
    return floor?.stations.find((station) => station.id === stationId);
  }

  function clearRefusals(): void {
    setText(slabRefusalLine, '');
    setText(dialogRefusal, '');
    for (const card of cards.values()) {
      card.refusal = '';
      card.outcome = '';
      setText(card.refusalLine, '');
      setText(card.outcomeLine, '');
    }
  }

  function paintSlab(): void {
    setText(slabButton, `${from}${copy.DASH}${to} ${formatDuration(spanMinutes())}`);
    setAttr(slabButton, 'aria-label', `Slab ${from}${copy.DASH}${to}`);
    setAttr(slabButton, 'aria-pressed', lifted?.kind === 'slab' ? 'true' : 'false');
  }

  /** The held countdown follows the server clock as estimated from its responses. */
  function secondsLeft(booking: Booking): number {
    if (booking.holdExpiresAt === null) return 0;
    const remaining = Math.ceil((Date.parse(booking.holdExpiresAt) - serverNowMs()) / 1000);
    return Math.max(0, Math.min(holdSeconds, remaining));
  }

  function paintCard(card: TicketCard): void {
    const booking = card.booking;
    const seconds = secondsLeft(booking);
    setText(card.statusLine, copy.ticketStatus(booking, seconds, card.confirmPending));
    const pendingCopy = card.cancelPending
      ? copy.cancelBooking.pending
      : card.movePending
        ? copy.moveBooking.pending(copy.stationsName(booking.stationName, booking.shelfName))
        : null;
    const title = `${booking.stationName} ${formatDateLabel(isoDate(booking.start))} ${isoTime(booking.start)}${copy.DASH}${isoTime(booking.end)}`;
    setText(card.titleLine, title);
    setAttr(card.article, 'aria-label', title);
    setText(card.pairLine, booking.shelfName === null ? '' : `+ ${booking.shelfName}`);
    setText(
      card.cancelLine,
      booking.status === 'confirmed' ? copy.cancellationLine(booking) : '',
    );
    setText(card.refusalLine, card.refusal);
    setText(card.outcomeLine, pendingCopy ?? card.outcome);
    card.article.classList.toggle('held', booking.status === 'held' && seconds > 0);

    if (card.cancelStep !== null) return;

    const focusedLabel =
      card.buttons.contains(document.activeElement) && document.activeElement !== null
        ? document.activeElement.textContent
        : null;
    card.buttons.textContent = '';
    const busy = card.confirmPending || card.cancelPending || card.movePending;
    if (booking.status === 'held' && seconds > 0 && !card.cancelPending) {
      const confirmButton = el('button', {
        text: 'Confirm booking',
        className: 'button primary',
        attrs: { type: 'button' },
      });
      if (busy) confirmButton.setAttribute('aria-disabled', 'true');
      confirmButton.addEventListener('click', () => {
        if (confirmButton.getAttribute('aria-disabled') === 'true') return;
        void confirmCard(card);
      });
      card.buttons.append(confirmButton);
    }
    if (booking.movable) {
      const moveButton = el('button', {
        text: 'Move booking',
        className: 'button',
        attrs: {
          type: 'button',
          'aria-pressed': lifted?.kind === 'move' && lifted.bookingId === booking.id ? 'true' : 'false',
        },
      });
      if (hintKind() !== null || busy) moveButton.setAttribute('aria-disabled', 'true');
      moveButton.addEventListener('click', () => {
        if (moveButton.getAttribute('aria-disabled') === 'true') return;
        if (lifted?.kind === 'move' && lifted.bookingId === booking.id) {
          returnLifted();
          return;
        }
        liftMove(booking.id);
      });
      card.buttons.append(moveButton);
    }
    if (booking.status === 'held' || booking.status === 'confirmed') {
      const cancelButton = el('button', {
        text: 'Cancel booking',
        className: 'button',
        attrs: { type: 'button' },
      });
      if (busy) cancelButton.setAttribute('aria-disabled', 'true');
      cancelButton.addEventListener('click', () => {
        if (cancelButton.getAttribute('aria-disabled') === 'true') return;
        openCancelStep(card, cancelButton);
      });
      card.buttons.append(cancelButton);
    }
    if (
      booking.status === 'confirmed' ||
      booking.status === 'checked_in' ||
      booking.status === 'completed' ||
      booking.status === 'no_show'
    ) {
      const receipt = el('a', {
        text: 'Receipt',
        className: 'link',
        attrs: { href: `/receipt/${booking.id}` },
      });
      receipt.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(`/receipt/${booking.id}`);
      });
      card.buttons.append(receipt);
    }
    if (focusedLabel !== null) {
      const again = [...card.buttons.children].find((child) => child.textContent === focusedLabel);
      if (again instanceof HTMLElement) again.focus({ preventScroll: true });
    }
  }

  function cardFor(booking: Booking): TicketCard {
    let card = cards.get(booking.id);
    if (card === undefined) {
      const article = el('article', { className: 'ticket-card', attrs: { tabindex: '0' } });
      const titleLine = el('p', { className: 'ticket-title' });
      const statusLine = el('p', { className: 'ticket-status' });
      const pairLine = el('p', { className: 'ticket-pair' });
      const cancelLine = el('p', { className: 'ticket-cancel-line' });
      const refusalLine = el('p', { className: 'refusal-copy' });
      const outcomeLine = el('p', { className: 'outcome-copy' });
      const buttons = el('div', { className: 'ticket-buttons' });
      article.append(titleLine, statusLine, pairLine, cancelLine, outcomeLine, refusalLine, buttons);
      cardList.append(article);
      card = {
        booking,
        article,
        titleLine,
        statusLine,
        pairLine,
        cancelLine,
        refusalLine,
        outcomeLine,
        buttons,
        cancelStep: null,
        confirmPending: false,
        cancelPending: false,
        movePending: false,
        refusal: '',
        outcome: '',
        expiredShown: false,
        confirmFailedAtZero: false,
      };
      cards.set(booking.id, card);
    }
    card.booking = booking;
    return card;
  }

  function orderCards(): void {
    const sorted = [...cards.values()].sort(
      (left, right) => Date.parse(left.booking.start) - Date.parse(right.booking.start),
    );
    for (const card of sorted) cardList.append(card.article);
  }

  function openCancelStep(card: TicketCard, returnTo: HTMLElement): void {
    if (card.cancelStep !== null) return;
    const group = el('div', {
      className: 'cancel-step',
      attrs: { role: 'group', 'aria-label': 'Cancel this booking?' },
    });
    const title = el('p', { text: 'Cancel this booking?', className: 'cancel-step-title' });
    const description = copy.cancelStepDescription(card.booking);
    const keep = el('button', { text: 'Keep it', className: 'button', attrs: { type: 'button' } });
    const confirm = el('button', {
      text: 'Yes, cancel',
      className: 'button primary',
      attrs: { type: 'button' },
    });
    group.append(title);
    if (description !== null) {
      const descriptionNode = el('p', {
        text: description,
        className: 'cancel-step-description',
        attrs: { id: `cancel-step-${card.booking.id}` },
      });
      group.append(descriptionNode);
      group.setAttribute('aria-describedby', descriptionNode.id);
    }
    group.append(keep, confirm);
    card.buttons.textContent = '';
    card.buttons.append(group);
    card.cancelStep = group;

    const close = (): void => {
      card.cancelStep = null;
      paintCard(card);
      focusElement(returnTo.isConnected ? returnTo : card.article);
    };
    keep.addEventListener('click', close);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    confirm.addEventListener('click', () => {
      keep.setAttribute('aria-disabled', 'true');
      confirm.setAttribute('aria-disabled', 'true');
      void cancelCard(card);
    });
    focusElement(keep);
  }

  async function confirmCard(card: TicketCard): Promise<void> {
    card.confirmPending = true;
    paintCard(card);
    announce(copy.confirmBooking.pending);
    const result = await request<Booking>('POST', `/api/bookings/${card.booking.id}/confirm`);
    card.confirmPending = false;
    if (result.kind === 'stale') return;
    mutationSeq += 1;

    if (result.kind === 'ok') {
      card.booking = result.body;
      card.refusal = '';
      card.outcome = '';
      paintCard(card);
      announce(
        copy.confirmBooking.success(
          copy.stationsName(result.body.stationName, result.body.shelfName),
          isoDate(result.body.start),
          isoTime(result.body.start),
          isoTime(result.body.end),
          result.body.debitedMinutes ?? 0,
        ),
      );
      focusElement(card.article);
      await loadFloor('refresh');
      return;
    }
    if (result.kind === 'network') {
      card.outcome = '';
      card.refusal = copy.generic;
      card.confirmFailedAtZero = true;
      paintCard(card);
      announce(copy.generic);
      focusElement(card.article);
      return;
    }
    await rereadBooking(card);
    let message = copy.confirmBooking.other;
    if (result.error === 'hold_expired') {
      message = copy.confirmBooking.expired(card.booking.stationName);
    } else if (result.error === 'documents_not_valid') {
      message = copy.claim.documents(isoDate(card.booking.start));
    }
    card.refusal = message;
    paintCard(card);
    announce(message);
    focusElement(card.article);
  }

  async function cancelCard(card: TicketCard): Promise<void> {
    const wasHeld = card.booking.status === 'held';
    card.cancelPending = true;
    announce(copy.cancelBooking.pending);
    const result = await request<Booking>('POST', `/api/bookings/${card.booking.id}/cancel`);
    card.cancelPending = false;
    card.cancelStep = null;
    if (result.kind === 'stale') return;
    mutationSeq += 1;

    if (result.kind === 'ok') {
      card.booking = result.body;
      const credited = result.body.refundedMinutes ?? 0;
      const message = wasHeld
        ? copy.cancelBooking.hold
        : credited > 0
          ? copy.cancelBooking.refunded(credited)
          : copy.cancelBooking.late;
      card.outcome = message;
      card.refusal = '';
      paintCard(card);
      announce(message);
      focusElement(card.article);
      await loadFloor('refresh');
      return;
    }
    if (result.kind === 'network') {
      card.refusal = copy.generic;
      paintCard(card);
      announce(copy.generic);
      focusElement(card.article);
      return;
    }
    await rereadBooking(card);
    card.outcome = '';
    card.refusal = copy.cancelBooking.blocked;
    paintCard(card);
    announce(copy.cancelBooking.blocked);
    focusElement(card.article);
  }

  async function rereadBooking(card: TicketCard): Promise<void> {
    const result = await request<Booking>('GET', `/api/bookings/${card.booking.id}`);
    if (result.kind === 'ok') {
      card.booking = result.body;
      paintCard(card);
    }
  }

  function shapeRefusal(fields: Record<string, string>): string {
    for (const name of ['stationId', 'shelfId', 'start', 'end']) {
      const message = fields[name];
      if (message !== undefined) return message;
    }
    return copy.generic;
  }

  async function claim(stationId: string, shelfId: string | null, source: 'slab' | 'dialog'): Promise<void> {
    if (hintKind() !== null) return;
    const station = stationById(stationId);
    const shelf = shelfId === null ? null : stationById(shelfId);
    if (station === undefined) return;
    const stations = copy.stationsName(station.name, shelf?.name ?? null);
    clearRefusals();
    setText(slabOutcome, copy.claim.pending(stations));
    announce(copy.claim.pending(stations));
    plan.dropSlab(shelfId === null ? [stationId] : [stationId, shelfId], `${from}${copy.DASH}${to}`);

    const body: Record<string, unknown> = {
      stationId,
      start: kitchenIsoFor(date, from),
      end: kitchenIsoFor(date, to),
    };
    if (shelfId !== null) body.shelfId = shelfId;
    const result = await request<Booking>('POST', '/api/bookings', {
      body,
      idempotencyKey: newIdempotencyKey(),
    });
    if (result.kind === 'stale') return;
    mutationSeq += 1;
    returnLifted();

    if (result.kind === 'ok') {
      plan.removeSlabs();
      setText(slabOutcome, '');
      const card = cardFor(result.body);
      paintCard(card);
      orderCards();
      if (stationDialog.open) stationDialog.close();
      const message = copy.claim.success(stations, from, to, secondsLeft(result.body));
      announce(message);
      focusElement(card.article);
      await loadFloor('refresh');
      return;
    }

    if (result.kind === 'error' && result.error === 'slot_taken') {
      plan.liftSlabsOff();
      setText(slabOutcome, '');
      await loadFloor('refresh');
      plan.markJustTaken(shelfId === null ? [stationId] : [stationId, shelfId]);
      const message = copy.claim.taken(stations);
      if (source === 'dialog') setText(dialogRefusal, message);
      else setText(slabRefusalLine, message);
      announce(message);
      focusElement(plan.buttonFor(stationId));
      return;
    }

    plan.slideSlabsBack();
    setText(slabOutcome, '');
    let message = copy.generic;
    if (result.kind === 'network') {
      message = copy.claim.network;
    } else if (result.error === 'tenant_not_approved') {
      const tenant = session.user?.tenant ?? null;
      message = copy.claim.notApproved(
        tenant === null ? 'Applied' : copy.tenantStatusLabel(tenant.status, tenant.suspendedReason),
      );
    } else if (result.error === 'documents_not_valid') {
      message = copy.claim.documents(date);
    } else if (result.error === 'insufficient_hours') {
      message = copy.claim.hours(spanMinutes() * (shelfId === null ? 1 : 2));
    } else if (result.error === 'rate_limited') {
      message = copy.claim.rateLimited(result.retryAfterSeconds ?? 60);
    } else if (result.status === 422) {
      message = shapeRefusal(result.fields);
    }
    if (source === 'dialog') {
      setText(dialogRefusal, message);
      announce(message);
      focusElement(dialogClaimButton);
    } else {
      setText(slabRefusalLine, message);
      announce(message);
      focusElement(slabButton);
    }
  }

  async function moveBooking(bookingId: string, stationId: string): Promise<void> {
    const card = cards.get(bookingId);
    const station = stationById(stationId);
    if (card === undefined || station === undefined) return;
    const booking = card.booking;
    const shelfId = booking.shelfId;
    const stations = copy.stationsName(station.name, booking.shelfName);
    clearRefusals();
    card.movePending = true;
    paintCard(card);
    announce(copy.moveBooking.pending(stations));
    plan.dropSlab(shelfId === null ? [stationId] : [stationId, shelfId], `${from}${copy.DASH}${to}`);

    const body: Record<string, unknown> = {
      stationId,
      start: kitchenIsoFor(date, from),
      end: kitchenIsoFor(date, to),
    };
    if (shelfId !== null) body.shelfId = shelfId;
    const previousMinutes = booking.debitedMinutes ?? 0;
    const result = await request<Booking>('POST', `/api/bookings/${bookingId}/move`, {
      body,
      idempotencyKey: newIdempotencyKey(),
    });
    card.movePending = false;
    if (result.kind === 'stale') return;
    mutationSeq += 1;
    returnLifted();

    if (result.kind === 'ok') {
      plan.removeSlabs();
      card.booking = result.body;
      card.refusal = '';
      card.outcome = '';
      paintCard(card);
      orderCards();
      announce(
        copy.moveBooking.success(
          copy.stationsName(result.body.stationName, result.body.shelfName),
          isoDate(result.body.start),
          isoTime(result.body.start),
          isoTime(result.body.end),
          (result.body.debitedMinutes ?? 0) - previousMinutes,
        ),
      );
      focusElement(card.article);
      await loadFloor('refresh');
      return;
    }

    if (result.kind === 'error' && result.error === 'slot_taken') {
      plan.liftSlabsOff();
      await loadFloor('refresh');
      plan.markJustTaken([stationId]);
      const message = copy.claim.taken(stations);
      card.refusal = message;
      paintCard(card);
      announce(message);
      focusElement(plan.buttonFor(stationId));
      return;
    }

    plan.slideSlabsBack();
    let message = copy.generic;
    let rereadNeeded = false;
    if (result.kind === 'network') {
      message = copy.generic;
    } else if (
      result.error === 'invalid_transition' ||
      result.error === 'past_cutoff' ||
      result.error === 'move_limit_reached'
    ) {
      message = copy.moveBooking.blocked;
      rereadNeeded = true;
    } else if (result.error === 'insufficient_hours') {
      message = copy.moveBooking.hours(
        spanMinutes() * (shelfId === null ? 1 : 2) - previousMinutes,
      );
      rereadNeeded = true;
    } else if (result.error === 'tenant_not_approved') {
      const tenant = session.user?.tenant ?? null;
      message = copy.claim.notApproved(
        tenant === null ? 'Applied' : copy.tenantStatusLabel(tenant.status, tenant.suspendedReason),
      );
      rereadNeeded = true;
    } else if (result.error === 'documents_not_valid') {
      message = copy.claim.documents(date);
      rereadNeeded = true;
    } else if (result.status === 422) {
      message = shapeRefusal(result.fields);
    }
    if (rereadNeeded) await rereadBooking(card);
    card.refusal = message;
    paintCard(card);
    announce(message);
    const moveButton = [...card.buttons.querySelectorAll('button')].find(
      (button) => button.textContent === 'Move booking',
    );
    focusElement(moveButton ?? card.article);
  }

  function liftSlab(): void {
    if (hintKind() !== null) return;
    lifted = { kind: 'slab' };
    paintSlab();
    plan.setDropTarget(firstDropTarget());
    announce(copy.slabLifted);
  }

  function liftMove(bookingId: string): void {
    if (hintKind() !== null) return;
    const card = cards.get(bookingId);
    if (card === undefined) return;
    lifted = { kind: 'move', bookingId };
    plan.setDropTarget(firstDropTarget());
    paintCard(card);
    announce(
      copy.moveLifted(card.booking.stationName, isoTime(card.booking.start), isoTime(card.booking.end)),
    );
  }

  function returnLifted(announceReturn = false): void {
    const wasLifted = lifted;
    lifted = null;
    plan.setDropTarget(null);
    paintSlab();
    if (wasLifted?.kind === 'move') {
      const card = cards.get(wasLifted.bookingId);
      if (card !== undefined) paintCard(card);
    }
    if (announceReturn && wasLifted !== null) announce(copy.slabReturned);
  }

  function firstDropTarget(): string | null {
    const stations = floor?.stations ?? [];
    const free = stations.find((station) => (station.occupiedMinutes ?? 0) === 0);
    return (free ?? stations[0])?.id ?? null;
  }

  function stepDropTarget(key: string): void {
    const stations = floor?.stations ?? [];
    const currentId = plan.dropTarget();
    const current = stations.find((station) => station.id === currentId);
    if (current === undefined) return;
    let next: Station | undefined;
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const wantedCol = current.col + (key === 'ArrowRight' ? 1 : -1);
      next = stations.find((station) => station.row === current.row && station.col === wantedCol);
    } else {
      const wantedRow = current.row + (key === 'ArrowDown' ? 1 : -1);
      const inRow = stations.filter((station) => station.row === wantedRow);
      let best: Station | undefined;
      for (const station of inRow) {
        if (best === undefined) {
          best = station;
          continue;
        }
        const bestDistance = Math.abs(best.col - current.col);
        const distance = Math.abs(station.col - current.col);
        if (distance < bestDistance || (distance === bestDistance && station.col < best.col)) {
          best = station;
        }
      }
      next = best;
    }
    if (next === undefined) return;
    plan.setDropTarget(next.id);
    announce(copy.dropTargetMove(next.name, plan.labelFor(next.id)));
  }

  function dropOnTarget(): void {
    const target = plan.dropTarget();
    const current = lifted;
    if (target === null || current === null) return;
    if (current.kind === 'slab') void claim(target, null, 'slab');
    else void moveBooking(current.bookingId, target);
  }

  slabButton.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (slabButton.getAttribute('aria-disabled') === 'true') return;
      if (lifted?.kind === 'slab') dropOnTarget();
      else liftSlab();
    }
  });
  slabButton.addEventListener('click', (event) => {
    event.preventDefault();
  });

  /** Focus leaving the lifted control returns it, unless it only moved to a station or back. */
  function returnOnFocusLoss(event: FocusEvent): void {
    if (lifted === null || dragging) return;
    const next = event.relatedTarget;
    if (next instanceof HTMLElement && next.closest('[data-station-id]') !== null) return;
    window.setTimeout(() => {
      const current = lifted;
      if (current === null || dragging) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        if (active.closest('[data-station-id]') !== null) return;
        if (current.kind === 'slab' && active === slabButton) return;
        if (current.kind === 'move' && cardList.contains(active)) return;
      }
      returnLifted(true);
    }, 0);
  }
  slabButton.addEventListener('focusout', returnOnFocusLoss);
  cardList.addEventListener('focusout', (event) => {
    if (lifted?.kind !== 'move') return;
    returnOnFocusLoss(event);
  });

  window.addEventListener('keydown', onWindowKeyDown);
  function onWindowKeyDown(event: KeyboardEvent): void {
    if (lifted === null) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      stepDropTarget(event.key);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      returnLifted(true);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target !== slabButton) {
      event.preventDefault();
      dropOnTarget();
    }
  }

  let dragging = false;

  function startPointerDrag(event: PointerEvent, kind: { kind: 'slab' } | { kind: 'move'; bookingId: string }): void {
    if (hintKind() !== null) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const ghost = el('div', { className: 'drag-ghost' });
    ghost.append(createSlab(`${from}${copy.DASH}${to}`));

    const move = (moveEvent: PointerEvent): void => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!dragging && distance < 8) return;
      if (!dragging) {
        dragging = true;
        lifted = kind;
        paintSlab();
        document.body.append(ghost);
      }
      moveEvent.preventDefault();
      ghost.style.setProperty('left', `${moveEvent.clientX - 48}px`);
      ghost.style.setProperty('top', `${moveEvent.clientY - 24}px`);
      const stationId = plan.stationAt({ x: moveEvent.clientX, y: moveEvent.clientY });
      plan.setDropTarget(stationId);
    };
    const finish = (upEvent: PointerEvent): void => {
      stopListening();
      ghost.remove();
      if (!dragging) {
        dragging = false;
        returnLifted();
        return;
      }
      dragging = false;
      const stationId = plan.stationAt({ x: upEvent.clientX, y: upEvent.clientY });
      if (stationId === null) {
        returnLifted();
        return;
      }
      plan.setDropTarget(stationId);
      dropOnTarget();
    };
    const cancel = (): void => {
      stopListening();
      ghost.remove();
      dragging = false;
      returnLifted();
    };
    const escape = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      cancel();
    };
    function stopListening(): void {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape);
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape);
  }

  slabButton.addEventListener('pointerdown', (event) => {
    if (slabButton.getAttribute('aria-disabled') === 'true') return;
    startPointerDrag(event, { kind: 'slab' });
  });
  cardList.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.textContent !== 'Move booking' || target.getAttribute('aria-disabled') === 'true') return;
    const article = target.closest('article');
    const entry = [...cards.values()].find((card) => card.article === article);
    if (entry === undefined) return;
    startPointerDrag(event, { kind: 'move', bookingId: entry.booking.id });
  });

  function onStationActivate(stationId: string): void {
    const current = lifted;
    if (current !== null) {
      plan.setDropTarget(stationId);
      dropOnTarget();
      return;
    }
    openStationDialog(stationId);
  }

  function openStationDialog(stationId: string): void {
    const station = stationById(stationId);
    if (station === undefined) return;
    dialogStationId = stationId;
    setAttr(stationDialog, 'aria-label', station.name);
    dialogList.textContent = '';
    for (const interval of station.intervals) {
      const mine = 'mine' in interval && interval.mine;
      const owner = 'tenantName' in interval ? ` ${interval.tenantName}` : mine ? ' Yours' : '';
      const held = 'status' in interval && interval.status === 'held';
      dialogList.append(
        el('p', {
          className: held ? 'dialog-row held' : 'dialog-row',
          attrs: { role: 'listitem' },
          text: `Booked ${isoTime(interval.start)}${copy.DASH}${isoTime(interval.end)}${owner}`,
        }),
      );
      dialogList.append(
        el('p', {
          className: 'dialog-row',
          attrs: { role: 'listitem' },
          text: `Cleanup ${isoTime(interval.end)}${copy.DASH}${isoTime(interval.bufferEnd)}`,
        }),
      );
    }

    if (isTenant) {
      shelfSelect.textContent = '';
      const isShelf = station.kind === 'cooler_shelf';
      shelfSelect.append(el('option', { text: 'No shelf', attrs: { value: '' } }));
      if (!isShelf) {
        const shelves = floor?.stations.filter((entry) => entry.kind === 'cooler_shelf') ?? [];
        for (const shelf of shelves) {
          const option = el('option', {
            text: `${shelf.name}, ${copy.stationLabel(shelf.freeMinutes ?? 0, spanMinutes())}`,
            attrs: { value: shelf.id },
          });
          if ((shelf.freeMinutes ?? 0) < spanMinutes()) option.setAttribute('disabled', '');
          shelfSelect.append(option);
        }
      }
      shelfSelect.value = '';
      shelfSelect.classList.toggle('hidden', isShelf);
      paintDialogClaimButton(station);
      setText(dialogRefusal, '');
    }
    stationDialog.showModal();
    focusElement(isTenant ? dialogClaimButton : dialogClose);
  }

  function paintDialogClaimButton(station: Station): void {
    const shelfId = shelfSelect.value;
    const shelf = shelfId === '' ? undefined : stationById(shelfId);
    const label =
      shelf === undefined
        ? `Claim ${station.name} ${from}${copy.DASH}${to}`
        : `Claim ${station.name} and ${shelf.name} ${from}${copy.DASH}${to}`;
    setText(dialogClaimButton, label);
    setAttr(dialogClaimButton, 'aria-label', label);
    if (hintKind() !== null) dialogClaimButton.setAttribute('aria-disabled', 'true');
    else dialogClaimButton.removeAttribute('aria-disabled');
  }

  shelfSelect.addEventListener('change', () => {
    const station = dialogStationId === null ? undefined : stationById(dialogStationId);
    if (station !== undefined) paintDialogClaimButton(station);
  });
  dialogClaimButton.addEventListener('click', () => {
    if (dialogClaimButton.getAttribute('aria-disabled') === 'true') return;
    if (dialogStationId === null) return;
    const shelfId = shelfSelect.value === '' ? null : shelfSelect.value;
    void claim(dialogStationId, shelfId, 'dialog');
  });
  const closeStationDialog = (): void => {
    const stationId = dialogStationId;
    stationDialog.close();
    dialogStationId = null;
    focusElement(stationId === null ? null : plan.buttonFor(stationId));
  };
  dialogClose.addEventListener('click', closeStationDialog);
  stationDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeStationDialog();
  });

  async function loadFloor(kind: 'settle' | 'refresh'): Promise<void> {
    floorToken += 1;
    const token = floorToken;
    const mutationAtSend = mutationSeq;
    const result = await request<FloorResponse>(
      'GET',
      `/api/floor?date=${date}&from=${from}&to=${to}`,
    );
    if (token !== floorToken || mutationAtSend !== mutationSeq) return;
    if (result.kind !== 'ok') {
      if (kind === 'refresh' || kind === 'settle') setText(slabOutcome, copy.floorReloadFailed);
      return;
    }
    floor = result.body;
    anchorServerTime(result.body.now);
    plan.draw(result.body.stations, spanMinutes());
    const shelves = result.body.stations.filter((station) => station.kind === 'cooler_shelf');
    const freeAllSpan = shelves.filter(
      (shelf) => (shelf.freeMinutes ?? 0) >= spanMinutes() && spanMinutes() > 0,
    ).length;
    rail.setCooler(result.body.coolerFree, freeAllSpan, shelves.length);
    applyHints();
    paintSlab();
    if (lifted !== null && plan.dropTarget() === null) plan.setDropTarget(firstDropTarget());
  }

  async function readBookings(kind: 'settle' | 'refresh'): Promise<void> {
    const mutationAtSend = mutationSeq;
    const result = await request<{ bookings: Booking[] }>('GET', '/api/bookings');
    if (mutationAtSend !== mutationSeq) return;
    if (result.kind !== 'ok') return;
    const byId = new Map(result.body.bookings.map((booking) => [booking.id, booking]));

    if (kind === 'settle') {
      for (const [id, card] of cards) {
        card.article.remove();
        cards.delete(id);
      }
      for (const booking of result.body.bookings) {
        const listed = isoDate(booking.start) >= date || booking.movable;
        if (!listed) continue;
        paintCard(cardFor(booking));
      }
      orderCards();
      return;
    }

    for (const [id, card] of cards) {
      const fresh = byId.get(id);
      if (fresh === undefined) continue;
      if (card.confirmPending || card.cancelPending || card.movePending) continue;
      card.booking = fresh;
      if (card.cancelStep === null) paintCard(card);
      else {
        setText(card.cancelLine, fresh.status === 'confirmed' ? copy.cancellationLine(fresh) : '');
      }
      if (card.expiredShown) {
        const hadFocus = card.article.contains(document.activeElement);
        card.article.remove();
        cards.delete(id);
        if (hadFocus) focusElement(slabButton);
      }
    }
    orderCards();
  }

  function tickCountdowns(): void {
    for (const card of cards.values()) {
      if (card.booking.status !== 'held') continue;
      if (card.confirmPending || card.cancelPending) continue;
      const seconds = secondsLeft(card.booking);
      setText(card.statusLine, copy.ticketStatus(card.booking, seconds, false));
      if (seconds <= 0) {
        if (!card.expiredShown) {
          card.expiredShown = true;
          paintCard(card);
          if (card.confirmFailedAtZero) void rereadBooking(card);
        }
      }
    }
  }

  async function settle(): Promise<void> {
    setText(dateText, formatDateLabel(date));
    await loadFloor('settle');
    if (isTenant) await readBookings('settle');
    else await doorColumn?.load(date, 'settle');
  }

  previousButton.addEventListener('click', () => {
    date = addDays(date, -1);
    writeUrl(false);
    void settle();
  });
  nextButton.addEventListener('click', () => {
    date = addDays(date, 1);
    writeUrl(false);
    void settle();
  });
  todayButton.addEventListener('click', () => {
    date = kitchenToday();
    writeUrl(false);
    void settle();
  });

  readUrl(ctx.query);
  paintSlab();
  await settle();

  refreshes.every(FLOOR_MS, () => {
    void (async () => {
      await loadFloor('refresh');
      if (isTenant) await readBookings('refresh');
    })();
  });
  if (!isTenant) {
    refreshes.every(DOOR_MS, () => {
      void doorColumn?.load(date, 'refresh');
    });
  }
  refreshes.every(COUNTDOWN_MS, tickCountdowns);

  return {
    unmount: () => {
      refreshes.stop();
      window.removeEventListener('keydown', onWindowKeyDown);
    },
    updateQuery: (query: URLSearchParams) => {
      const previousDate = date;
      const previousSpan = `${from}-${to}`;
      readUrl(query);
      if (previousDate !== date || previousSpan !== `${from}-${to}`) {
        clearRefusals();
        void settle();
      }
    },
  };
}
