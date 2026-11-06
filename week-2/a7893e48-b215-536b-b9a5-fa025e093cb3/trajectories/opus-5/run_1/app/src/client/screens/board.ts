import type {
  ApiErrorBody,
  Booking,
  DayView,
  Hold,
  PackLedger,
  RenterSummary,
} from '../../shared/types.js';
import { api, firstFieldMessage, idempotencyKey } from '../api.js';
import { delayedLabel, onStatusChange, state } from '../app.js';
import { copy, hours, money } from '../copy.js';
import { clear, el, setStatus, statusRegion } from '../dom.js';
import { icon } from '../ui/icons.js';
import { StationDial, type Selection } from '../dial.js';
import { reducedMotion, tweenNumber } from '../motion.js';
import { localStamp, siteZone, ticketListItem, type TicketContext } from '../ticket.js';
import { openDialog, type DialogHandle } from '../ui/dialog.js';

const QUARTER = 15;

interface BoardModel {
  siteId: string;
  date: string;
  renterId: string | null;
  repeatWeeks: number;
  day: DayView | null;
  hold: Hold | null;
  bookings: Booking[];
  renters: RenterSummary[];
  packAvailableMinutes: number;
}

function todayIn(zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '01';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function dueByLabel(zone: string, startAtIso: string): string {
  const stamp = localStamp(zone, startAtIso);
  const [date, time, abbrev] = stamp.split(' ') as [string, string, string];
  return `${shiftDate(date, -2)} ${time} ${abbrev}`;
}

export function boardScreen(host: HTMLElement): void {
  const user = state.user;
  if (user === null) return;
  const firstSite = state.sites[0];
  if (firstSite === undefined) {
    host.append(el('p', {}, ['No sites are available for your account.']));
    return;
  }
  const isRenter = user.role === 'renter';
  const model: BoardModel = {
    siteId: firstSite.id,
    date: todayIn(firstSite.time_zone),
    renterId: user.renter_id,
    repeatWeeks: 1,
    day: null,
    hold: null,
    bookings: [],
    renters: [],
    packAvailableMinutes: 0,
  };

  const dialStatus = statusRegion('Dial status');
  const summaryHours = el('span', { class: 'summary-hours mono' }, ['0.00 h']);
  const summaryAmount = el('span', { class: 'summary-amount mono' }, ['$0.00']);
  const summaryPack = el('span', { class: 'summary-pack mono' }, ['Pack 0.00 h']);
  const summaryCard = el('span', { class: 'summary-card mono' }, ['Card 0.00 h']);
  const summaryBalance = el('span', { class: 'summary-balance mono' }, ['Pack balance 0.00 h']);
  const summary = el('div', { role: 'region', 'aria-label': 'Selection summary', class: 'dial-centre' }, [
    summaryHours,
    summaryAmount,
    summaryPack,
    summaryCard,
    summaryBalance,
  ]);
  const holdTimer = el('p', { role: 'timer', 'aria-label': 'Hold time left', class: 'hold-timer mono' });
  const holdTimerIcon = icon('clock');
  const stationColumn = el('div', { class: 'station-column' });
  const rail = el('ul', { class: 'ticket-rail', 'aria-label': 'Booking tickets' });
  const checkoutSlot = el('div', { class: 'checkout-slot' });
  const checkoutButton = el('button', { type: 'button', class: 'button primary checkout-open' }, [
    'Checkout',
  ]);
  let checkout: DialogHandle | null = null;
  let lastSummaryMinutes = 0;

  const context: TicketContext = {
    status: dialStatus,
    refresh: async () => {
      await Promise.all([loadDay(), loadBookings()]);
    },
  };

  const site = (): { id: string; time_zone: string; stations: { id: string; name: string; rate_cents: number }[] } => {
    const found = state.sites.find((entry) => entry.id === model.siteId);
    return found ?? firstSite;
  };

  const rateOf = (stationId: string): number =>
    site().stations.find((station) => station.id === stationId)?.rate_cents ?? 0;

  function renderSummary(selection: Selection | null): void {
    const minutes = selection === null ? 0 : selection.endMinute - selection.startMinute;
    const packCover = Math.min(
      Math.floor(model.packAvailableMinutes / QUARTER) * QUARTER,
      minutes,
    );
    const cardMinutes = minutes - packCover;
    const rate = selection === null ? 0 : rateOf(selection.stationId);
    tweenNumber(summaryHours, lastSummaryMinutes / 60, minutes / 60, (value) => `${value.toFixed(2)} h`);
    tweenNumber(
      summaryAmount,
      0,
      (cardMinutes * rate) / 6000,
      (value) => `$${value.toFixed(2)}`,
    );
    lastSummaryMinutes = minutes;
    summaryPack.textContent = `Pack ${hours(packCover)} h`;
    summaryCard.textContent = `Card ${hours(cardMinutes)} h`;
    summaryBalance.textContent = `Pack balance ${hours(model.packAvailableMinutes)} h`;
  }

  const dial = new StationDial({
    onSelection: (selection) => renderSummary(selection),
    onAnnounce: (message) => setStatus(dialStatus, message),
    claimRefusal: () => (model.renterId === null ? copy.chooseRenter : null),
    onPlace: (selection) => void placeHold(selection),
  });

  function renderStationButtons(): void {
    clear(stationColumn);
    stationColumn.append(el('h2', { class: 'column-title' }, ['Stations']));
    for (const station of site().stations) {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'station-button',
          'aria-label': station.name,
          'aria-pressed': dial.focusedStationId() === station.id ? 'true' : 'false',
        },
        [
          el('span', { class: 'station-name' }, [station.name]),
          el('span', { class: 'station-rate mono' }, [`${money(station.rate_cents)}/h`]),
        ],
      );
      button.addEventListener('click', () => {
        dial.focusStation(station.id);
        renderStationButtons();
      });
      stationColumn.append(button);
    }
  }

  let railCount = 0;

  function renderRail(): void {
    clear(rail);
    for (const booking of model.bookings) rail.append(ticketListItem(booking, context));
    if (model.bookings.length === 0) {
      rail.append(el('li', { class: 'rail-empty', role: 'listitem' }, ['No tickets yet.']));
    }
    if (model.bookings.length > railCount) {
      rail.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'end' });
    }
    railCount = model.bookings.length;
  }

  function renderHoldTimer(): void {
    const hold = model.hold;
    if (hold === null) {
      holdTimer.textContent = '';
      if (checkoutSlot.contains(checkoutButton)) checkoutButton.remove();
      return;
    }
    if (!checkoutSlot.contains(checkoutButton)) checkoutSlot.append(checkoutButton);
    const left = Date.parse(hold.expires_at) - Date.now();
    if (left <= 0) {
      model.hold = null;
      dial.setHold(null);
      dial.setSelection(null);
      holdTimer.textContent = '';
      checkoutButton.remove();
      checkout?.close();
      checkout = null;
      setStatus(dialStatus, copy.holdExpiredNotice);
      void context.refresh();
      return;
    }
    const until = localStamp(siteZone(model.siteId), hold.expires_at).split(' ')[1] ?? '';
    const seconds = Math.floor(left / 1000);
    holdTimer.textContent = reducedMotion()
      ? `Held until ${until}`
      : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    holdTimer.prepend(holdTimerIcon);
  }

  async function loadDay(): Promise<void> {
    const result = await api.get<DayView>(
      `/api/sites/${model.siteId}/day?date=${model.date}`,
    );
    if (!result.ok) return;
    model.day = result.data;
    if (result.data.pack_minutes_available !== null) {
      model.packAvailableMinutes = result.data.pack_minutes_available;
    }
    dial.setDay(result.data);
    renderSummary(null);
  }

  async function loadBookings(): Promise<void> {
    const path =
      isRenter
        ? '/api/bookings'
        : `/api/bookings?site_id=${model.siteId}&date=${model.date}`;
    const result = await api.get<{ bookings: Booking[] }>(path);
    if (!result.ok) return;
    model.bookings =
      model.renterId === null || isRenter
        ? result.data.bookings
        : result.data.bookings.filter((booking) => booking.renter_id === model.renterId);
    renderRail();
  }

  async function loadRenterPack(): Promise<void> {
    if (isRenter || model.renterId === null) return;
    const result = await api.get<PackLedger>(`/api/renters/${model.renterId}/pack`);
    if (!result.ok) return;
    model.packAvailableMinutes = result.data.available_minutes;
    renderSummary(null);
  }

  async function placeHold(selection: Selection): Promise<void> {
    setStatus(dialStatus, copy.placingHold);
    const body: Record<string, unknown> =
      model.repeatWeeks > 1
        ? {
            station_id: selection.stationId,
            date: model.date,
            start: dial.localLabel(selection.startMinute),
            end: dial.localLabel(selection.endMinute),
            repeat_weeks: model.repeatWeeks,
          }
        : {
            station_id: selection.stationId,
            start_at: dial.instantAt(selection.startMinute),
            end_at: dial.instantAt(selection.endMinute),
          };
    if (!isRenter) body.renter_id = model.renterId;
    const result = await api.post<{ hold: Hold }>('/api/holds', body);
    if (!result.ok) {
      if (result.status === 409 && result.error.blocker !== undefined) {
        const label = result.error.blocker.label;
        dial.retractSelection(() => {
          void loadDay();
        });
        setStatus(dialStatus, copy.slotTaken(label));
        return;
      }
      dial.retractSelection();
      setStatus(
        dialStatus,
        result.status === 422 ? copy.holdInvalid(firstFieldMessage(result.error)) : result.error.message,
      );
      return;
    }
    model.hold = result.data.hold;
    dial.setHold({
      startMinute: selection.startMinute,
      createdAt: Date.parse(result.data.hold.created_at),
      expiresAt: Date.parse(result.data.hold.expires_at),
    });
    const heldUntil = localStamp(siteZone(model.siteId), result.data.hold.expires_at).split(' ')[1] ?? '';
    setStatus(dialStatus, copy.holdPlaced(heldUntil));
    renderHoldTimer();
    await loadDay();
    dial.setSelection(selection);
    openCheckout();
  }

  function openCheckout(): void {
    const hold = model.hold;
    if (hold === null) return;
    checkout?.close();
    const zone = siteZone(model.siteId);
    const usePack = el('input', {
      type: 'checkbox',
      class: 'checkbox',
      'aria-label': 'Use pack hours',
      checked: hold.quote.pack_minutes > 0,
    });
    const payNow = el('input', {
      type: 'radio',
      name: 'card-payment',
      class: 'radio',
      'aria-label': 'Pay now',
      checked: true,
    });
    const payLater = el('input', {
      type: 'radio',
      name: 'card-payment',
      class: 'radio',
      'aria-label': 'Pay later',
    });
    const firstOccurrence = hold.occurrences[0];
    const dueBy = firstOccurrence === undefined ? '' : dueByLabel(zone, firstOccurrence.start_at);
    const status = statusRegion('Checkout status');
    const confirm = el('button', { type: 'button', class: 'button primary' }, ['Confirm booking']);
    const letGo = el('button', { type: 'button', class: 'button quiet' }, ['Let hold go']);
    const noticeHours = policyNoticeOf(model.siteId);
    const occurrenceList = el(
      'ul',
      { class: 'occurrence-list' },
      hold.occurrences.map((occurrence) =>
        el('li', { class: 'mono' }, [
          `${occurrence.date} ${occurrence.start}–${occurrence.end} · ${hours(occurrence.minutes)} h`,
        ]),
      ),
    );
    checkout = openDialog(
      { label: 'Checkout', className: 'checkout-dialog', host: checkoutSlot, onClose: () => (checkout = null) },
      [
        occurrenceList,
        el('dl', { class: 'quote-grid' }, [
          el('dt', {}, ['Pack hours']),
          el('dd', { class: 'mono' }, [`${hours(hold.quote.pack_minutes)} h`]),
          el('dt', {}, ['Card hours']),
          el('dd', { class: 'mono' }, [`${hours(hold.quote.card_minutes)} h`]),
          el('dt', {}, ['Card total']),
          el('dd', { class: 'mono' }, [money(hold.quote.card_cents)]),
          el('dt', {}, ['Deposit']),
          el('dd', { class: 'mono' }, [money(hold.quote.deposit_cents)]),
        ]),
        el('label', { class: 'checkbox-row' }, [
          usePack,
          el('span', {}, [`Use pack hours (${hours(hold.quote.pack_minutes_available)} h available)`]),
        ]),
        el('div', { role: 'radiogroup', 'aria-label': 'Card payment', class: 'radio-group' }, [
          el('label', { class: 'radio-row' }, [payNow, el('span', {}, [delayedLabel('Pay now')])]),
          el('label', { class: 'radio-row' }, [
            payLater,
            el('span', {}, [`Pay later (due by ${dueBy})`]),
          ]),
        ]),
        el('p', { class: 'terms' }, [
          `Free cancellation until ${noticeHours} hours before start. Later cancellations keep the time charge and the deposit.`,
        ]),
        el('p', { class: 'held-until mono' }, [
          `Held until ${localStamp(zone, hold.expires_at)}`,
        ]),
        el('div', { class: 'dialog-actions' }, [confirm, letGo]),
        status,
      ],
    );
    confirm.addEventListener('click', () => {
      setStatus(status, copy.confirming);
      void api
        .post<{ bookings: Booking[] }>(
          `/api/holds/${hold.id}/confirm`,
          { use_pack: usePack.checked, pay_now: payNow.checked },
          idempotencyKey(),
        )
        .then(async (result) => {
          if (!result.ok) {
            setStatus(status, confirmFailure(result.status, result.error));
            if (result.status === 410) {
              model.hold = null;
              dial.setHold(null);
              await context.refresh();
            }
            return;
          }
          setStatus(status, copy.confirmed);
          confirm.remove();
          letGo.remove();
          model.hold = null;
          dial.setHold(null);
          dial.setSelection(null);
          renderHoldTimer();
          await context.refresh();
        });
    });
    letGo.addEventListener('click', () => {
      setStatus(status, copy.releasing);
      void api.delete(`/api/holds/${hold.id}`).then(async (result) => {
        if (!result.ok) {
          setStatus(status, result.error.message);
          return;
        }
        model.hold = null;
        dial.setHold(null);
        dial.setSelection(null);
        renderHoldTimer();
        checkout?.close();
        checkout = null;
        setStatus(dialStatus, copy.released);
        await context.refresh();
      });
    });
  }

  function confirmFailure(status: number, error: ApiErrorBody): string {
    if (status === 410) return copy.confirmGone;
    if (status === 503) return copy.billingDelayedConfirm;
    if (error.error === 'certificate_required') return copy.certificateRequired(error.dates ?? []);
    if (error.error === 'pay_now_required') return copy.payNowRequired;
    if (error.error === 'pack_insufficient') return copy.packInsufficient;
    return error.message;
  }

  const sitePicker = el(
    'select',
    { class: 'select', 'aria-label': 'Site' },
    state.sites.map((entry) =>
      el('option', { value: entry.id, selected: entry.id === model.siteId }, [entry.name]),
    ),
  );
  sitePicker.addEventListener('change', () => {
    model.siteId = sitePicker.value;
    model.date = todayIn(siteZone(model.siteId));
    dayInput.value = model.date;
    renderStationButtons();
    void context.refresh();
  });

  const previousDay = el('button', { type: 'button', class: 'button icon', 'aria-label': 'Previous day' }, [
    icon('chevron-left'),
  ]);
  const nextDay = el('button', { type: 'button', class: 'button icon', 'aria-label': 'Next day' }, [
    icon('chevron-right'),
  ]);
  const dayInput = el('input', { type: 'text', class: 'input day-input mono', 'aria-label': 'Day', value: model.date });
  previousDay.addEventListener('click', () => {
    model.date = shiftDate(model.date, -1);
    dayInput.value = model.date;
    void context.refresh();
  });
  nextDay.addEventListener('click', () => {
    model.date = shiftDate(model.date, 1);
    dayInput.value = model.date;
    void context.refresh();
  });
  dayInput.addEventListener('change', () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayInput.value)) return;
    model.date = dayInput.value;
    void context.refresh();
  });

  const repeatWeeks = el('input', {
    type: 'number',
    class: 'input repeat-input mono',
    'aria-label': 'Repeat weeks',
    min: 1,
    max: 12,
    value: 1,
  });
  repeatWeeks.addEventListener('change', () => {
    const value = Number(repeatWeeks.value);
    model.repeatWeeks = Number.isFinite(value) ? Math.min(12, Math.max(1, Math.round(value))) : 1;
    repeatWeeks.value = String(model.repeatWeeks);
  });

  const controls = el('div', { class: 'board-controls' }, [
    el('div', { class: 'field inline' }, [el('label', { class: 'field-label' }, ['Site']), sitePicker]),
    el('div', { class: 'day-controls' }, [
      previousDay,
      el('div', { class: 'field inline' }, [el('label', { class: 'field-label' }, ['Day']), dayInput]),
      nextDay,
    ]),
    el('div', { class: 'field inline' }, [
      el('label', { class: 'field-label' }, ['Repeat weeks']),
      repeatWeeks,
    ]),
  ]);

  if (!isRenter) {
    const renterPicker = el('select', { class: 'select', 'aria-label': 'Renter' }, [
      el('option', { value: '' }, ['Choose a renter']),
    ]);
    renterPicker.addEventListener('change', () => {
      model.renterId = renterPicker.value === '' ? null : renterPicker.value;
      void loadRenterPack();
      void loadBookings();
    });
    controls.append(
      el('div', { class: 'field inline' }, [
        el('label', { class: 'field-label' }, ['Renter']),
        renterPicker,
      ]),
    );
    model.renterId = null;
    void api.get<{ renters: RenterSummary[] }>('/api/renters').then((result) => {
      if (!result.ok) return;
      model.renters = result.data.renters;
      for (const renter of result.data.renters) {
        renterPicker.append(el('option', { value: renter.id }, [renter.business]));
      }
    });
  }

  const legend = el('ul', { class: 'dial-legend', 'aria-label': 'Dial legend' }, [
    el('li', {}, [el('span', { class: 'swatch state-free', 'aria-hidden': 'true' }), 'Free']),
    el('li', {}, [el('span', { class: 'swatch state-held', 'aria-hidden': 'true' }), 'Held']),
    el('li', {}, [el('span', { class: 'swatch state-booked', 'aria-hidden': 'true' }), 'Booked']),
    el('li', {}, [el('span', { class: 'swatch state-yours_booked', 'aria-hidden': 'true' }), 'Yours']),
  ]);

  checkoutButton.addEventListener('click', () => openCheckout());

  host.append(
    controls,
    el('div', { class: 'board-layout' }, [
      stationColumn,
      el('div', { class: 'dial-area' }, [
        el('div', { class: 'dial-wrap' }, [dial.element, summary, holdTimer]),
        legend,
        dialStatus,
      ]),
      checkoutSlot,
    ]),
    el('section', { class: 'rail-section' }, [el('h2', { class: 'column-title' }, ['Tickets']), rail]),
  );

  renderStationButtons();
  renderRail();
  void context.refresh();
  window.setInterval(() => renderHoldTimer(), 1000);
  window.setInterval(() => void loadDay(), 10_000);
  onStatusChange(() => renderRail());
}

function policyNoticeOf(siteId: string): number {
  return state.sites.find((entry) => entry.id === siteId)?.policy_notice_hours ?? 24;
}
