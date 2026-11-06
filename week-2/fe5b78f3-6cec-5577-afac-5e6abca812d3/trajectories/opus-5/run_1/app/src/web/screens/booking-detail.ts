import type { BookingBody, CoachPlan, PassengerBody, StatusBody } from '../api';
import { ApiRequestError, api, newIdempotencyKey } from '../api';
import { readSeenStatuses, writeSeenStatuses } from '../app-state';
import { CoachPlanView, annotateBooking } from '../coachplan';
import { LiveRegion, Modal, ribbonStopsFromTrain, statusChip } from '../components';
import { clear, h, isPhoneWidth, prefersReducedMotion } from '../dom';
import {
  BAND_LABEL,
  TICKET_KIND_LABEL,
  announcementLine,
  formatMoney,
  hourMinute,
  longDate,
} from '../format';
import type { Screen, ScreenContext } from '../screen';
import { BOOKING_RESULT_KEY } from './booking';

const POLL_MS = 20_000;
const COUNT_MS = 320;
const LANE_MS = 320;
const MORPH_MS = 420;
const GAP_MS = 120;

interface Change {
  readonly number: number;
  readonly from: StatusBody;
  readonly to: StatusBody;
}

function diffStatuses(
  before: Readonly<Record<string, string>>,
  passengers: readonly PassengerBody[],
): Change[] {
  const changes: Change[] = [];
  for (const passenger of passengers) {
    const seen = before[String(passenger.number)];
    if (seen === undefined || seen === passenger.current_status.label) continue;
    changes.push({
      number: passenger.number,
      from: parseLabel(seen),
      to: passenger.current_status,
    });
  }
  return changes;
}

/** Rebuilds the shape of a status from the label this device last showed. */
function parseLabel(label: string): StatusBody {
  const cnf = /^CNF (\S+) (\d+) (LB|MB|UB|SL|SU)$/.exec(label);
  if (cnf !== null) {
    return {
      status: 'CNF',
      position: null,
      coach: cnf[1],
      berth: Number(cnf[2]),
      berth_type: cnf[3] as StatusBody['berth_type'],
      label,
    };
  }
  const rac = /^RAC (\d+) (\S+) (\d+) SL$/.exec(label);
  if (rac !== null) {
    return {
      status: 'RAC',
      position: Number(rac[1]),
      coach: rac[2],
      berth: Number(rac[3]),
      berth_type: 'SL',
      label,
    };
  }
  const queued = /^(GNWL|RLWL|PQWL|TQWL) (\d+)$/.exec(label);
  if (queued !== null) {
    return {
      status: queued[1],
      position: Number(queued[2]),
      coach: null,
      berth: null,
      berth_type: null,
      label,
    };
  }
  const settled = label === 'NOT CNF' ? 'CHART_NOT_CONFIRMED' : label;
  return { status: settled, position: null, coach: null, berth: null, berth_type: null, label };
}

function statusesOf(booking: BookingBody): Record<string, string> {
  const map: Record<string, string> = {};
  for (const passenger of booking.passengers) {
    map[String(passenger.number)] = passenger.current_status.label;
  }
  return map;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renderBookingDetail(
  context: ScreenContext,
  pnr: string,
): Promise<Screen> {
  const { main, router, state } = context;
  if (state.account === null) {
    router.go(`/signin?next=${encodeURIComponent(`/bookings/${pnr}`)}`, true);
    return { ribbon: [] };
  }

  let booking: BookingBody;
  try {
    booking = await api.booking(pnr);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      router.go(`/signin?next=${encodeURIComponent(`/bookings/${pnr}`)}`, true);
      return { ribbon: [] };
    }
    main.appendChild(h('div', { class: 'panel' }, [
      h('h1', {}, ['Booking not found']),
      h('p', {}, ['No booking with that PNR belongs to this account.']),
    ]));
    return { ribbon: [] };
  }

  let painted = booking;
  let paintedVersion = booking.version;
  let coaches: readonly CoachPlan[] = [];
  let cancelDialog: Modal | null = null;
  let heldChanges: Change[] = [];
  let heldBody: BookingBody | null = null;
  let animating: Promise<void> = Promise.resolve();
  let lastRefreshAt = state.clock.ready ? state.clock.now() : Date.now();

  const pnrUpdates = new LiveRegion('PNR updates', 'status');
  const bookingResult = new LiveRegion('Booking result', 'status');
  const cancellationResult = new LiveRegion('Cancellation result', 'status');
  const ticketProblem = new LiveRegion('Ticket problem', 'alert', 'alert');
  const whatChangedHost = h('div');
  const headingHost = h('div');
  const summaryHost = h('div');
  const passengerList = h('ul', { class: 'plain-list', 'aria-label': 'Passengers' });
  const wlLane = h('div', { class: 'lane', role: 'region', 'aria-label': 'WL lane' });
  const racLane = h('div', { class: 'lane', role: 'region', 'aria-label': 'RAC lane' });
  const ticketList = h('ul', { class: 'plain-list ticket-list', 'aria-label': 'E-tickets' });
  const refundList = h('ul', { class: 'plain-list refund-list', 'aria-label': 'Refunds' });
  const cancelButton = h('button', { type: 'button', class: 'btn' }, ['Cancel passengers']);
  const planView = new CoachPlanView({
    vertical: isPhoneWidth(),
    annotations: new Map(),
    onPick: null,
    note: false,
  });

  const storedResult = sessionStorage.getItem(BOOKING_RESULT_KEY);
  if (storedResult !== null) {
    sessionStorage.removeItem(BOOKING_RESULT_KEY);
    bookingResult.say(storedResult);
  }

  function chartRefundStatus(): 'pending' | 'issued' | null {
    const refund = painted.refunds.find((entry) => entry.reason === 'chart');
    return refund === undefined ? null : refund.status;
  }

  function paintHeading(): void {
    clear(headingHost);
    headingHost.appendChild(h('h1', {}, [`PNR ${painted.pnr}`]));
    if (painted.chart_prepared) {
      headingHost.appendChild(h('div', { class: 'chart-block' }, [
        h('h2', {}, ['Chart prepared']),
        h('p', {}, ['Statuses are final. Berths no longer move.']),
      ]));
    }
  }

  function paintSummary(): void {
    clear(summaryHost);
    summaryHost.appendChild(h('dl', { class: 'summary-grid' }, [
      h('dt', {}, ['Train']),
      h('dd', {}, [`${painted.train.number} ${painted.train.name}`]),
      h('dt', {}, ['Journey']),
      h('dd', {}, [`${painted.from} to ${painted.to}`]),
      h('dt', {}, ['Departs']),
      h('dd', {}, [
        `${hourMinute(painted.departure_at)} IST, ${longDate(painted.departure_at)}`,
      ]),
      h('dt', {}, ['Class']),
      h('dd', {}, [painted.class]),
      h('dt', {}, ['Total']),
      h('dd', {}, [formatMoney(painted.total_paise)]),
    ]));
    if (!painted.chart_prepared) {
      summaryHost.appendChild(h('p', { class: 'num' }, [
        `Chart at ${hourMinute(painted.chart_at)} IST, ${longDate(painted.chart_at)}`,
      ]));
    }
  }

  function paintPassengers(): void {
    clear(passengerList);
    for (const passenger of painted.passengers) {
      const row = h('li', { class: 'passenger-row' }, [
        h('span', { class: 'num' }, [`Passenger ${passenger.number}`]),
        h('span', { class: 'passenger-row__name' }, [`${passenger.name}, ${passenger.age}`]),
        statusChip(passenger.current_status, passenger.number),
      ]);
      if (passenger.current_status.status === 'CHART_NOT_CONFIRMED') {
        const refund = chartRefundStatus();
        row.appendChild(h('span', { class: 'passenger-note' }, [
          `Not confirmed — refund ${refund === 'issued' ? 'issued' : 'pending'}`,
        ]));
      }
      passengerList.appendChild(row);
    }
  }

  function paintLanes(): void {
    clear(wlLane);
    clear(racLane);
    wlLane.appendChild(h('h3', {}, ['WL lane']));
    racLane.appendChild(h('h3', {}, ['RAC lane']));
    const wlItems = h('div', { class: 'lane__items' });
    const racItems = h('div', { class: 'lane__items' });
    for (const passenger of painted.passengers) {
      const status = passenger.current_status;
      if (status.status === 'RAC') racItems.appendChild(statusChip(status, passenger.number));
      else if (/WL$/.test(status.status)) wlItems.appendChild(statusChip(status, passenger.number));
    }
    wlLane.appendChild(wlItems);
    racLane.appendChild(racItems);
  }

  function paintPlan(): void {
    planView.setOptions({
      vertical: isPhoneWidth(),
      annotations: annotateBooking(painted.passengers),
      onPick: null,
      note: false,
    });
  }

  function paintTickets(): void {
    clear(ticketList);
    for (const ticket of painted.tickets) {
      const label = `Download e-ticket v${ticket.version} (${TICKET_KIND_LABEL[ticket.kind]})`;
      const link = h('a', {
        href: `/api/bookings/${painted.pnr}/tickets/${ticket.version}`,
      }, [label]);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void downloadTicket(ticket.version);
      });
      ticketList.appendChild(h('li', {}, [link]));
    }
  }

  async function downloadTicket(version: number): Promise<void> {
    ticketProblem.say('');
    const response = await fetch(`/api/bookings/${painted.pnr}/tickets/${version}`, {
      credentials: 'same-origin',
    }).catch(() => null);
    if (response === null || !response.ok) {
      ticketProblem.say("E-tickets can't be downloaded right now. Try again in a few minutes.");
      return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `e-ticket-${painted.pnr}-v${version}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  function paintRefunds(): void {
    clear(refundList);
    for (const refund of painted.refunds) {
      refundList.appendChild(h('li', {}, [
        h('span', { class: 'num' }, [formatMoney(refund.refund_paise)]),
        h('span', {}, [refund.status === 'issued' ? 'Refund issued' : 'Refund pending']),
      ]));
    }
  }

  function paintAll(): void {
    paintHeading();
    paintSummary();
    paintPassengers();
    paintLanes();
    paintPlan();
    paintTickets();
    paintRefunds();
    cancelButton.disabled = painted.passengers.every(
      (passenger) => passenger.current_status.status === 'CAN'
        || passenger.current_status.status === 'CHART_NOT_CONFIRMED',
    );
  }

  function chipFor(number: number): HTMLElement | null {
    return passengerList.querySelector<HTMLElement>(`[data-chip-passenger="${number}"]`);
  }

  function berthCell(coach: string, berth: number): HTMLElement | null {
    planView.showCoach(coach);
    return planView.element.querySelector<HTMLElement>(
      `button[data-coach="${coach}"][data-berth="${berth}"]`,
    );
  }

  async function countDown(chip: HTMLElement, from: number, to: number, list: string): Promise<void> {
    const steps = Math.abs(from - to);
    if (steps === 0) return;
    const perStep = Math.min(Math.max(COUNT_MS / steps, 8), 60);
    const direction = to < from ? -1 : 1;
    for (let value = from + direction; ; value += direction) {
      chip.textContent = `${list} ${value}`.toUpperCase();
      await delay(perStep);
      if (value === to) break;
    }
  }

  async function flyTo(chip: HTMLElement, target: HTMLElement, duration: number): Promise<void> {
    const start = chip.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const clone = chip.cloneNode(true) as HTMLElement;
    clone.classList.add('flying');
    clone.style.left = `${start.left}px`;
    clone.style.top = `${start.top}px`;
    clone.style.width = `${start.width}px`;
    clone.style.height = `${start.height}px`;
    document.body.appendChild(clone);
    chip.style.visibility = 'hidden';
    const animation = clone.animate(
      [
        { transform: 'translate(0, 0) scale(1)' },
        {
          transform: `translate(${end.left - start.left}px, ${end.top - start.top}px) `
            + `scale(${Math.max(end.width / Math.max(start.width, 1), 0.4)}, 1)`,
        },
      ],
      { duration, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'forwards' },
    );
    await animation.finished.catch(() => undefined);
    clone.remove();
    chip.style.visibility = '';
  }

  async function playChartDrop(changes: readonly Change[]): Promise<void> {
    const lines = [...changes]
      .sort((a, b) => a.number - b.number)
      .map((change) => announcementLine(change.number, change.from, change.to));
    pnrUpdates.say(lines.join('\n'));
    if (prefersReducedMotion()) {
      clear(whatChangedHost);
      const list = h('ul', { class: 'plain-list' });
      for (const line of lines) list.appendChild(h('li', {}, [line]));
      whatChangedHost.appendChild(h('div', {
        class: 'panel',
        role: 'region',
        'aria-label': 'What changed',
      }, [h('h3', {}, ['What changed']), list]));
      return;
    }
    for (const change of [...changes].sort((a, b) => a.number - b.number)) {
      const chip = chipFor(change.number);
      if (chip === null) continue;
      if (change.from.position !== null) {
        const listName = change.from.status === 'RAC' ? 'RAC' : change.from.status;
        const target = change.to.position ?? 1;
        await countDown(chip, change.from.position, target, listName);
      }
      if (change.to.coach !== null && change.to.berth !== null) {
        const cell = berthCell(change.to.coach, change.to.berth);
        if (cell !== null) {
          await flyTo(chip, cell, change.to.status === 'RAC' ? LANE_MS : MORPH_MS);
        }
      }
      await delay(GAP_MS);
    }
  }

  function queueBatch(next: BookingBody, changes: readonly Change[]): void {
    animating = animating.then(async () => {
      await playChartDrop(changes);
      painted = next;
      paintAll();
    });
  }

  function apply(next: BookingBody, force = false): void {
    if (!force && next.version <= paintedVersion) return;
    paintedVersion = next.version;
    const seen = readSeenStatuses(pnr) ?? statusesOf(painted);
    const changes = diffStatuses(seen, next.passengers);
    writeSeenStatuses(pnr, statusesOf(next));
    if (cancelDialog !== null) {
      heldBody = next;
      heldChanges = [...heldChanges, ...changes];
      pruneDialog(next);
      if (changes.length > 0) void refreshDialogQuote();
      return;
    }
    if (changes.length === 0) {
      painted = next;
      paintAll();
      return;
    }
    queueBatch(next, changes);
  }

  function releaseHeld(): void {
    if (heldBody === null) return;
    const next = heldBody;
    const changes = heldChanges;
    heldBody = null;
    heldChanges = [];
    if (changes.length === 0) {
      painted = next;
      paintAll();
      return;
    }
    queueBatch(next, changes);
  }

  /* ---- cancel dialog ---- */

  let ticked = new Set<number>();
  let previewList = h('ul', { class: 'plain-list', 'aria-label': 'Refund preview' });
  let confirmButton = h('button', { type: 'button', class: 'btn' }, ['Cancel and refund ₹0.00']);
  let keepButton = h('button', { type: 'button', class: 'btn--quiet btn' }, ['Keep booking']);
  let quoteToken = 0;
  const checkboxRows = new Map<number, HTMLElement>();

  function isCancellable(status: StatusBody): boolean {
    return status.status !== 'CAN' && status.status !== 'CHART_NOT_CONFIRMED';
  }

  function cancellable(): PassengerBody[] {
    return painted.passengers.filter(
      (passenger) => isCancellable(passenger.current_status),
    );
  }

  /** A passenger who can no longer be cancelled leaves the open dialog. */
  function pruneDialog(next: BookingBody): void {
    let removedFocus = false;
    let removed = false;
    for (const passenger of next.passengers) {
      if (isCancellable(passenger.current_status)) continue;
      const row = checkboxRows.get(passenger.number);
      if (row === undefined) continue;
      if (row.contains(document.activeElement)) removedFocus = true;
      row.remove();
      checkboxRows.delete(passenger.number);
      ticked.delete(passenger.number);
      removed = true;
    }
    if (removedFocus) keepButton.focus();
    if (removed) void refreshDialogQuote();
  }

  async function refreshDialogQuote(): Promise<void> {
    if (cancelDialog === null) return;
    const numbers = [...ticked].sort((a, b) => a - b);
    const mine = (quoteToken += 1);
    clear(previewList);
    if (numbers.length === 0) {
      confirmButton.textContent = `Cancel and refund ${formatMoney(0)}`;
      return;
    }
    const quote = await api.cancellationQuote(pnr, numbers).catch(() => null);
    if (mine !== quoteToken || quote === null || cancelDialog === null) return;
    clear(previewList);
    for (const entry of quote.passengers) {
      const band = BAND_LABEL[entry.band] ?? entry.band;
      const line = entry.gst_paise > 0
        ? `Passenger ${entry.number}: ${band}, deduction ${formatMoney(entry.deduction_paise)} `
          + `incl. GST ${formatMoney(entry.gst_paise)}, refund ${formatMoney(entry.refund_paise)}`
        : `Passenger ${entry.number}: ${band}, deduction ${formatMoney(entry.deduction_paise)}, `
          + `refund ${formatMoney(entry.refund_paise)}`;
      previewList.appendChild(h('li', {}, [line]));
    }
    confirmButton.textContent = `Cancel and refund ${formatMoney(quote.refund_paise)}`;
  }

  function openCancelDialog(): void {
    ticked = new Set();
    previewList = h('ul', { class: 'plain-list', 'aria-label': 'Refund preview' });
    confirmButton = h('button', { type: 'button', class: 'btn' }, [
      `Cancel and refund ${formatMoney(0)}`,
    ]);
    keepButton = h('button', { type: 'button', class: 'btn--quiet btn' }, ['Keep booking']);
    const keep = keepButton;
    const boxes = h('div', { class: 'stack' });
    checkboxRows.clear();
    for (const passenger of cancellable()) {
      const id = `cancel-${passenger.number}`;
      const input = h('input', { type: 'checkbox', id });
      input.addEventListener('change', () => {
        if (input.checked) ticked.add(passenger.number);
        else ticked.delete(passenger.number);
        void refreshDialogQuote();
      });
      const row = h('span', { class: 'check' }, [
        input,
        h('label', { for: id }, [`Passenger ${passenger.number}`]),
      ]);
      checkboxRows.set(passenger.number, row);
      boxes.appendChild(row);
    }
    cancelDialog = new Modal({
      label: 'Cancel passengers',
      onClose: () => {
        cancelDialog = null;
        releaseHeld();
      },
      initialFocus: () => boxes.querySelector<HTMLElement>('input'),
    }, [
      h('h2', {}, ['Cancel passengers']),
      boxes,
      previewList,
      h('div', { class: 'dialog__actions' }, [confirmButton, keep]),
    ]);
    keep.addEventListener('click', () => cancelDialog?.close());
    confirmButton.addEventListener('click', () => {
      const numbers = [...ticked].sort((a, b) => a - b);
      if (numbers.length === 0) return;
      confirmButton.disabled = true;
      cancellationResult.say('Cancelling');
      void api.cancel(pnr, numbers, newIdempotencyKey())
        .then((body) => {
          cancellationResult.say(body.refund === null || body.refund.refund_paise === 0
            ? 'Cancelled. No refund is due.'
            : `Cancelled. Refund of ${formatMoney(body.refund.refund_paise)} recorded.`);
          cancelDialog?.close();
          apply(body.booking);
        })
        .catch((error: unknown) => {
          confirmButton.disabled = false;
          if (!(error instanceof ApiRequestError)) throw error;
          if (error.payload.error === 'already_cancelled') {
            cancellationResult.say('That passenger is already cancelled.');
          } else if (error.payload.error === 'journey_complete') {
            cancellationResult.say('This journey is complete. It can no longer be cancelled.');
          } else {
            cancellationResult.say(error.payload.message);
          }
          cancelDialog?.close();
        });
    });
  }

  cancelButton.addEventListener('click', openCancelDialog);

  /* ---- layout ---- */

  const passengerPane = h('div', { class: 'panel stack' }, [
    headingHost,
    summaryHost,
    pnrUpdates.element,
    bookingResult.element,
    cancellationResult.element,
    ticketProblem.element,
    passengerList,
    cancelButton,
  ]);
  const planPane = h('div', { class: 'panel' }, [whatChangedHost, planView.element]);
  const queuePane = h('div', {
    class: 'panel lanes',
    role: 'region',
    'aria-label': 'Queue',
  }, [wlLane, racLane]);
  const filesPane = h('div', { class: 'panel stack' }, [
    h('h2', {}, ['E-tickets']),
    ticketList,
    h('h2', {}, ['Refunds']),
    refundList,
  ]);

  main.appendChild(h('div', { class: 'layout layout--detail' }, [
    passengerPane,
    planPane,
    queuePane,
  ]));
  main.appendChild(filesPane);

  const query = new URLSearchParams({
    class: booking.class,
    from: booking.from,
    to: booking.to,
  }).toString();
  const plan = await api.coaches(booking.train.number, booking.run_date, query).catch(() => null);
  if (plan !== null) {
    coaches = plan.coaches;
    planView.setCoaches(coaches);
  }

  const trainQuery = new URLSearchParams({
    from: booking.from,
    to: booking.to,
    date: booking.departure_at.slice(0, 10),
    quota: booking.quota,
    class: booking.class,
  }).toString();
  const trains = await api.trains(trainQuery).catch(() => null);
  const trainEntry = trains?.trains.find((entry) => entry.number === booking.train.number) ?? null;

  paintAll();
  apply(booking, true);

  const timer = window.setInterval(() => {
    const active = painted.state !== 'journey_complete'
      || painted.refunds.some((refund) => refund.status === 'pending');
    if (!active) return;
    void api.booking(pnr)
      .then((next) => {
        lastRefreshAt = state.clock.ready ? state.clock.now() : Date.now();
        apply(next);
      })
      .catch(() => {
        pnrUpdates.say(
          `Can't reach Pakka right now. Showing status from `
          + `${hourMinute(new Date(lastRefreshAt + 330 * 60_000).toISOString())} IST.`,
        );
      });
  }, POLL_MS);

  const onResize = (): void => paintPlan();
  window.addEventListener('resize', onResize);

  return {
    ribbon: trainEntry === null
      ? []
      : ribbonStopsFromTrain(trainEntry.stops, booking.from, booking.to),
    cleanup: () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', onResize);
      cancelDialog?.close();
    },
  };
}
