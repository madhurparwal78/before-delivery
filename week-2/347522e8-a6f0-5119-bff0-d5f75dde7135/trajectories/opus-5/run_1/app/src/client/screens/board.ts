/**
 * The Board: every station as a rail across the selected kitchen day, with
 * bookings, holds, buffers and maintenance blocks hanging below it, and a
 * docket beside it.
 *
 * The shown day comes only from the address. Every time-dependent thing on
 * screen follows the server's clock. The 15-second refresh keeps an open
 * dialog, the docket selection, a draft, focus and the countdown.
 */

import { api, ApiError, inBackground, messageFor } from '../api.js';
import { serverNow } from '../clock.js';
import * as copy from '../../shared/copy.js';
import { EN_DASH, formatHours } from '../../shared/format.js';
import {
  SLOT_MINUTES,
  addDays,
  kitchenDate,
  kitchenInstant,
  kitchenZoneAbbrev,
  weekdayName,
} from '../../shared/kitchenTime.js';
import { MAX_REPEAT_WEEKS } from '../../shared/pricing.js';
import type {
  Booking,
  BookingsResponse,
  RenterSummary,
  Station,
  StationBlock,
  StationsResponse,
} from '../../shared/types.js';
import { clear, el, isPhoneBand, prefersReducedMotion } from '../dom.js';
import { navigate, replaceAddressOnly, type Cleanup, type ScreenContext } from '../router.js';
import { currentUser } from '../session.js';
import { openDialog, type DialogHandle } from '../ui/dialog.js';
import {
  CELLS,
  DAY_MINUTES,
  bufferEndHhmm,
  draftLimits,
  hhmmOfMinute,
  instantOfMinute,
  minuteOnDay,
  placeBlocks,
  seriesMinutes,
  skippedMinutes,
  ticketHeight,
  type DraftLimits,
} from './boardModel.js';

const REFRESH_MS = 15_000;
const DEFAULT_CELL_MINUTE = 6 * 60;
const PHONE_CELL_PX = 44;

type DraftMode = 'sweeping' | 'settled' | 'pending' | 'offered';
type SweepSource = 'pointer' | 'keyboard';

interface Draft {
  stationId: string;
  startMinute: number;
  endMinute: number;
  mode: DraftMode;
  source: SweepSource;
  /** The last stop already spoken, so a reason is announced once. */
  spokenStop: string | null;
}

interface Selection {
  bookingId: string;
  booking: Booking | null;
  businessName: string | null;
}

interface BoardState {
  date: string;
  stations: StationsResponse | null;
  renter: RenterSummary | null;
  holds: Booking[];
  /** The renter's own bookings on the shown day, for each ticket's hour readout. */
  ownBookings: Booking[];
  liveHold: Booking | null;
  selection: Selection | null;
  draft: Draft | null;
  repeatWeeks: number;
  activeCell: Record<string, number>;
  /** Own booking ids seen on the shown day, to notice one going away. */
  ownOnDay: Set<string>;
  cancelDialog: DialogHandle | null;
  busy: boolean;
}

export function boardScreen(context: ScreenContext): Cleanup {
  const user = currentUser();
  if (user === null) return () => undefined;
  const isRenter = user.role === 'renter';
  const renterId = isRenter ? user.renter_id : null;

  const state: BoardState = {
    date: context.query.get('date') ?? '',
    stations: null,
    renter: null,
    holds: [],
    ownBookings: [],
    liveHold: null,
    selection: null,
    draft: null,
    repeatWeeks: 1,
    activeCell: {},
    ownOnDay: new Set(),
    cancelDialog: null,
    busy: false,
  };

  // ---------- regions ----------

  const heading = el('h1', { text: 'Board', attrs: { tabindex: '-1' } });
  const dayLine = el('p', { class: 'board__day' });
  const previousDay = el('button', { class: 'btn', text: 'Previous day', attrs: { type: 'button' } });
  const todayButton = el('button', { class: 'btn', text: 'Today', attrs: { type: 'button' } });
  const nextDay = el('button', { class: 'btn', text: 'Next day', attrs: { type: 'button' } });

  const railsBox = el('div', { class: 'rails' });
  const railsRegion = el('div', {
    class: 'rails-region',
    attrs: { role: 'region', 'aria-label': 'Rails' },
  }, [railsBox]);

  const announcer = el('p', {
    class: 'visually-hidden',
    attrs: { role: 'status', 'aria-label': 'Sweep announcer', 'aria-live': 'polite' },
  });
  const bookingStatus = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Booking status', 'aria-live': 'polite' },
  });
  const docketBody = el('div', { class: 'docket--grid' });
  const docket = el('aside', {
    class: 'docket',
    attrs: { role: 'complementary', 'aria-label': 'Docket' },
  }, [docketBody]);

  const layout = el('div', { class: 'board' }, [
    el('div', { class: 'board__rails' }, [
      el('div', { class: 'board__head' }, [
        heading,
        el('div', { class: 'daybar' }, [previousDay, todayButton, nextDay]),
        dayLine,
      ]),
      railsRegion,
      announcer,
    ]),
    el('div', { class: 'board__docket' }, [docket]),
  ]);
  context.root.append(layout);

  // ---------- derived ----------

  const stationById = (id: string): Station | null =>
    state.stations?.stations.find((station) => station.id === id) ?? null;

  const balanceMinutes = (): number => state.renter?.balance_minutes ?? 0;

  const draftPrice = (draft: Draft): number => {
    const station = stationById(draft.stationId);
    if (station === null) return 0;
    return (
      seriesMinutes(
        {
          date: state.date,
          station,
          startMinute: draft.startMinute,
          repeatWeeks: state.repeatWeeks,
          balanceMinutes: balanceMinutes(),
          placed: [],
        },
        draft.endMinute,
      ) ?? 0
    );
  };

  /** The docket balance: projected while a draft is live, plain otherwise. */
  const shownBalanceMinutes = (): number => {
    const draft = state.draft;
    if (draft === null || draft.mode === 'offered') return balanceMinutes();
    return balanceMinutes() - draftPrice(draft);
  };

  const limitsFor = (stationId: string, startMinute: number): DraftLimits | null => {
    const station = stationById(stationId);
    if (station === null) return null;
    return draftLimits({
      date: state.date,
      station,
      startMinute,
      repeatWeeks: state.repeatWeeks,
      balanceMinutes: balanceMinutes(),
      placed: placeBlocks(state.date, station),
    });
  };

  const say = (message: string): void => {
    announcer.textContent = message;
  };

  const speakStep = (draft: Draft): void => {
    const station = stationById(draft.stationId);
    if (station === null) return;
    say(
      copy.sweepStep(
        station.name,
        hhmmOfMinute(draft.startMinute),
        hhmmOfMinute(draft.endMinute),
        formatHours(draftPrice(draft)),
        bufferEndHhmm(state.date, draft.endMinute, station.buffer_minutes),
      ),
    );
  };

  const speakStop = (draft: Draft, limits: DraftLimits): void => {
    if (limits.reason === null) return;
    const text = copy.sweepStop(hhmmOfMinute(limits.maxEndMinute), limits.reason);
    if (draft.spokenStop === text) return;
    draft.spokenStop = text;
    say(text);
  };

  // ---------- data ----------

  async function loadAll(): Promise<void> {
    const stations = await api.get<StationsResponse>(
      `/api/stations?date=${encodeURIComponent(state.date)}`,
    );
    state.stations = stations;
    if (renterId !== null) {
      const [renterAnswer, holdsAnswer, dayAnswer] = await Promise.all([
        api.get<{ renter: RenterSummary }>(`/api/renters/${renterId}`),
        api.get<BookingsResponse>('/api/bookings?status=hold'),
        api.get<BookingsResponse>(`/api/bookings?date=${encodeURIComponent(state.date)}`),
      ]);
      state.renter = renterAnswer.renter;
      state.holds = holdsAnswer.bookings;
      state.ownBookings = dayAnswer.bookings;
      state.liveHold =
        [...state.holds].sort((a, b) =>
          (a.hold_expires_at ?? '') < (b.hold_expires_at ?? '') ? 1 : -1,
        )[0] ?? null;
    }
  }

  // ---------- rails ----------

  function cellId(stationId: string, minute: number): string {
    return `cell-${stationId}-${minute}`;
  }

  function activeMinute(stationId: string): number {
    return state.activeCell[stationId] ?? DEFAULT_CELL_MINUTE;
  }

  function percent(minutes: number): string {
    return `${(minutes / DAY_MINUTES) * 100}%`;
  }

  function ticketLabel(station: Station, block: StationBlock): HTMLElement {
    const from = hhmmOfMinute(minuteOnDay(state.date, block.starts_at));
    const to = hhmmOfMinute(minuteOnDay(state.date, block.ends_at));
    const times = `${block.start}${EN_DASH}${block.end}`;
    const startMinute = minuteOnDay(state.date, block.starts_at);
    const endMinute = minuteOnDay(state.date, block.ends_at);
    const geometry = {
      left: percent(Math.max(0, startMinute)),
      width: percent(Math.min(DAY_MINUTES, endMinute) - Math.max(0, startMinute)),
      height: `${ticketHeight(endMinute - startMinute)}px`,
    };
    const style = `left:${geometry.left};width:${geometry.width};height:${geometry.height}`;

    if (block.kind === 'maintenance') {
      return el(
        'div',
        {
          class: 'ticket ticket--maintenance',
          attrs: { role: 'img', 'aria-label': `Maintenance ${from} to ${to}`, style },
        },
        [el('span', { class: 'ticket__who', text: 'Maintenance' }), el('span', { class: 'ticket__time', text: times })],
      );
    }

    if (!block.mine) {
      if (isRenter) {
        return el(
          'div',
          {
            class: 'ticket ticket--other',
            attrs: { role: 'img', 'aria-label': `Booked ${from} to ${to}`, style },
          },
          [el('span', { class: 'ticket__who', text: 'Booked' }), el('span', { class: 'ticket__time', text: times })],
        );
      }
      const staffButton = el(
        'button',
        {
          class: 'ticket ticket--button ticket--other',
          attrs: {
            type: 'button',
            'aria-label': `${block.renter_business_name ?? ''} ${station.name} ${from} to ${to}`,
            style,
          },
        },
        [
          el('span', { class: 'ticket__who', text: block.renter_business_name ?? '' }),
          el('span', { class: 'ticket__time', text: times }),
        ],
      );
      staffButton.addEventListener('click', () => {
        selectBooking(block.booking_id, block.renter_business_name);
      });
      return staffButton;
    }

    const isHold = block.kind === 'hold';
    const hours = ownBookingHours(block.booking_id);
    const button = el(
      'button',
      {
        class: `ticket ticket--button${isHold ? ' ticket--hold' : ''}`,
        attrs: {
          type: 'button',
          'aria-label': `${isHold ? 'Hold' : 'Booking'} ${station.name} ${from} to ${to}`,
          style,
        },
      },
      isHold
        ? [
            el('span', { class: 'ticket__label' }, [
              el('span', { class: 'ticket__flag', text: 'HOLD' }),
              el('span', { class: 'ticket__time', text: times }),
              el('span', { class: 'ticket__hours', text: `${hours} h` }),
            ]),
          ]
        : [
            el('span', { class: 'ticket__time', text: times }),
            el('span', { class: 'ticket__hours', text: `${hours} h` }),
          ],
    );
    button.dataset['bookingId'] = block.booking_id ?? '';
    button.addEventListener('click', () => {
      selectBooking(block.booking_id, block.renter_business_name);
    });
    return button;
  }

  /** The price of one of the renter's own tickets, which is what its mono readout shows. */
  function ownBookingHours(bookingId: string | null): string {
    const own =
      state.ownBookings.find((booking) => booking.id === bookingId) ??
      state.holds.find((booking) => booking.id === bookingId);
    return own ? formatHours(own.minutes_debited) : '';
  }

  function renderRuler(): HTMLElement {
    const track = el('div', { class: 'ruler__track' });
    for (let hour = 0; hour <= 24; hour += 1) {
      track.append(
        el('span', {
          class: 'ruler__mark',
          text: `${String(hour).padStart(2, '0')}:00`,
          attrs: { style: `left:${percent(Math.min(hour * 60, DAY_MINUTES - 1))}`, 'aria-hidden': 'true' },
        }),
      );
    }
    return el('div', { class: 'ruler' }, [track]);
  }

  function renderStation(station: Station, skipped: Set<number>): HTMLElement {
    const row = el('div', { class: 'rail__row', attrs: { role: 'row' } });
    const active = activeMinute(station.id);
    for (let index = 0; index < CELLS; index += 1) {
      const minute = index * SLOT_MINUTES;
      const cell = el('div', {
        class: 'rail__cell',
        attrs: {
          role: 'gridcell',
          'aria-label': `${station.name} ${hhmmOfMinute(minute)}`,
          tabindex: minute === active ? '0' : '-1',
          id: cellId(station.id, minute),
        },
      });
      cell.dataset['minute'] = String(minute);
      cell.dataset['station'] = station.id;
      row.append(cell);
    }

    const rail = el('div', {
      class: 'rail',
      attrs: { role: 'grid', 'aria-label': `${station.name} schedule` },
    }, [row]);

    const hangar = el('div', { class: 'hangar' });
    const placed = placeBlocks(state.date, station);
    // The hangar is as deep as its deepest slip, so one station's tickets never
    // hang over the next station's rail.
    let deepest = 0;
    for (const item of placed) {
      deepest = Math.max(deepest, ticketHeight(item.endMinute - item.startMinute));
    }
    const ownDraft = state.draft;
    if (ownDraft !== null && ownDraft.stationId === station.id) {
      deepest = Math.max(deepest, ticketHeight(ownDraft.endMinute - ownDraft.startMinute));
    }
    hangar.setAttribute('style', `height:${Math.max(34, deepest + 6)}px`);
    for (const item of placed) {
      if (item.block.kind !== 'maintenance') {
        const bufferStart = Math.max(0, item.endMinute);
        const bufferEnd = Math.min(DAY_MINUTES, item.bufferEndMinute);
        if (bufferEnd > bufferStart) {
          hangar.append(
            el('div', {
              class: 'buffer',
              attrs: {
                role: 'img',
                'aria-label': `Buffer until ${hhmmOfMinute(item.bufferEndMinute)}`,
                style: `left:${percent(bufferStart)};width:${percent(bufferEnd - bufferStart)}`,
              },
            }),
          );
        }
      }
      hangar.append(ticketLabel(station, item.block));
    }

    const draft = state.draft;
    if (draft !== null && draft.stationId === station.id) {
      hangar.append(renderDraft(station, draft));
      const limits = limitsFor(station.id, draft.startMinute);
      if (limits?.notchMinute !== null && limits?.notchMinute !== undefined) {
        rail.append(
          el('div', {
            class: 'notch',
            attrs: {
              role: 'img',
              'aria-label': 'Conflict notch',
              style: `left:${percent(limits.notchMinute)}`,
            },
          }),
        );
      }
    }

    const track = el('div', { class: 'track' }, [rail, hangar]);
    track.dataset['track'] = station.id;

    // The skipped minutes of a spring-forward day are drawn as one gap.
    if (skipped.size > 0) {
      const skippedStart = Math.min(...skipped);
      track.append(
        el('div', {
          class: 'skipped',
          attrs: {
            role: 'img',
            'aria-label': 'Skipped hour',
            style: `left:${percent(skippedStart)};width:${percent(skipped.size * SLOT_MINUTES)}`,
          },
        }),
      );
    }

    if (state.date === kitchenDate(serverNow())) {
      const nowMinute = minuteOnDay(state.date, new Date(serverNow()).toISOString());
      if (nowMinute >= 0 && nowMinute <= DAY_MINUTES) {
        track.append(
          el('div', {
            class: 'nowline',
            attrs: { role: 'img', 'aria-label': 'Now', style: `left:${percent(nowMinute)}` },
          }),
        );
      }
    }

    return el('div', { class: 'station' }, [
      el('div', { class: 'station__name', text: station.name }),
      el('div', { class: 'station__body' }, [track]),
    ]);
  }

  function renderDraft(station: Station, draft: Draft): HTMLElement {
    const span = draft.endMinute - draft.startMinute;
    const style =
      `left:${percent(draft.startMinute)};width:${percent(span)};` +
      `height:${ticketHeight(span)}px`;
    const from = hhmmOfMinute(draft.startMinute);
    const to = hhmmOfMinute(draft.endMinute);
    const hours = formatHours(draftPrice(draft));
    return el(
      'div',
      {
        class: 'ticket',
        attrs: { role: 'img', 'aria-label': `Draft ticket ${from} to ${to}`, style },
      },
      [
        el('span', { class: 'ticket__time', text: `${from}${EN_DASH}${to}` }),
        el('span', { class: 'ticket__hours', text: `${hours} h` }),
        state.repeatWeeks > 1
          ? el('span', { class: 'ticket__hours', text: `\u00d7 ${state.repeatWeeks} weeks` })
          : null,
        el('div', {
          class: 'buffer',
          attrs: {
            role: 'img',
            'aria-label': `Buffer until ${bufferEndHhmm(state.date, draft.endMinute, station.buffer_minutes)}`,
            style: `left:100%;width:${(station.buffer_minutes / span) * 100}%`,
          },
        }),
      ],
    );
  }

  function renderRails(): void {
    const data = state.stations;
    if (data === null) return;
    const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    const scrollLeft = railsRegion.scrollLeft;
    const skipped = skippedMinutes(state.date);

    clear(railsBox);
    railsBox.append(renderRuler());
    if (!data.stations.some((station) => station.blocks.length > 0)) {
      railsBox.append(el('p', { class: 'empty', text: copy.EMPTY_BOARD }));
    }
    for (const station of data.stations) railsBox.append(renderStation(station, skipped));

    if (focusedId !== '') document.getElementById(focusedId)?.focus();
    railsRegion.scrollLeft =
      scrollLeft === 0 && isPhoneBand() ? (DEFAULT_CELL_MINUTE / SLOT_MINUTES) * PHONE_CELL_PX : scrollLeft;
  }

  // ---------- docket ----------

  const balanceStatus = el('p', {
    class: 'docket__balance',
    attrs: { role: 'status', 'aria-label': 'Hour balance', 'aria-live': 'polite' },
  });
  const holdLine = el('p', { class: 'docket__hold' });
  const pendingLine = el('p', { class: 'mono' });
  const countdown = el('p', {
    class: 'docket__countdown',
    attrs: { role: 'timer', 'aria-label': 'Hold countdown' },
  });
  const repeatInput = el('input', {
    attrs: {
      type: 'number',
      min: '1',
      max: String(MAX_REPEAT_WEEKS),
      step: '1',
      value: '1',
      role: 'spinbutton',
      'aria-label': 'Repeat weekly for',
      id: 'repeat-weeks',
    },
  });
  const confirmButton = el('button', {
    class: 'btn btn--primary',
    text: 'Confirm booking',
    attrs: { type: 'button' },
  });
  const releaseButton = el('button', {
    class: 'btn',
    text: 'Release hold',
    attrs: { type: 'button' },
  });
  const cancelButton = el('button', {
    class: 'btn',
    text: 'Cancel booking',
    attrs: { type: 'button' },
  });
  const complianceLine = el('p', { class: 'docket__compliance' });
  const selectionLine = el('p', { class: 'mono' });

  function buildDocket(): void {
    clear(docketBody);
    if (isRenter) {
      docketBody.append(
        el('div', {}, [
          el('p', { class: 'docket__label', text: 'Hour balance' }),
          balanceStatus,
          pendingLine,
        ]),
        el('div', {}, [
          el('div', { class: 'docket__row' }, [holdLine, countdown]),
          el('div', { class: 'docket__row' }, [selectionLine]),
          el('div', { class: 'docket__row' }, [
            el('label', { text: 'Repeat weekly for', attrs: { for: 'repeat-weeks' } }),
            el('span', { class: 'repeat' }, [repeatInput, el('span', { text: 'week(s)' })]),
          ]),
          el('div', { class: 'docket__row docket__actions' }, [
            confirmButton,
            releaseButton,
            cancelButton,
          ]),
          el('div', { class: 'docket__row' }, [complianceLine, bookingStatus]),
        ]),
      );
      return;
    }
    docketBody.append(
      el('div', {}, [
        el('p', { class: 'docket__label', text: 'Selected ticket' }),
        selectionLine,
        bookingStatus,
      ]),
    );
  }

  function renderDocket(): void {
    if (!isRenter) {
      const selection = state.selection;
      selectionLine.textContent =
        selection === null
          ? 'No ticket selected.'
          : `${selection.businessName ?? ''}${
              selection.booking
                ? ` ${selection.booking.station_name} ${selection.booking.date} ${selection.booking.start}${EN_DASH}${selection.booking.end}`
                : ''
            }`;
      return;
    }

    balanceStatus.textContent = `${formatHours(shownBalanceMinutes())} h`;

    const held = state.renter?.held_minutes ?? 0;
    pendingLine.textContent = held > 0 ? copy.pendingDebit(formatHours(held)) : '';

    const hold = state.liveHold;
    if (hold !== null) {
      holdLine.textContent = copy.liveHoldLine(
        hold.station_name,
        hold.date,
        hold.start,
        hold.end,
      );
    } else {
      holdLine.textContent = '';
    }
    renderCountdown();

    const selection = state.selection;
    selectionLine.textContent =
      selection?.booking === null || selection === null
        ? ''
        : `${selection.booking.station_name} ${selection.booking.date} ${selection.booking.start}${EN_DASH}${selection.booking.end} \u00b7 ${formatHours(selection.booking.minutes_debited)} h`;

    confirmButton.disabled = state.busy || hold === null;
    releaseButton.disabled = state.busy || hold === null;
    cancelButton.disabled =
      state.busy || selection?.booking == null || selection.booking.status !== 'confirmed';

    const compliance = state.renter?.compliance;
    if (compliance !== undefined) {
      const expiring = [compliance.coi_expires_on, compliance.card_expires_on]
        .filter((value): value is string => value !== null)
        .sort()[0] ?? null;
      complianceLine.textContent = copy.complianceLine(compliance.state, expiring);
    }
  }

  function renderCountdown(): void {
    const hold = state.liveHold;
    if (hold === null || hold.hold_expires_at === null) {
      countdown.textContent = '';
      return;
    }
    const remaining = Date.parse(hold.hold_expires_at) - serverNow();
    if (remaining <= 0) {
      countdown.textContent = '';
      return;
    }
    if (prefersReducedMotion()) {
      countdown.textContent = copy.minutesLeft(Math.ceil(remaining / 60_000));
      return;
    }
    const seconds = Math.floor(remaining / 1000);
    countdown.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
      seconds % 60,
    ).padStart(2, '0')}`;
  }

  function renderAll(): void {
    const data = state.stations;
    if (data === null) return;
    const noonZone = kitchenZoneAbbrev(kitchenInstant(state.date, '12:00'));
    dayLine.textContent = `${weekdayName(state.date)} ${state.date} \u00b7 ${noonZone}`;
    renderRails();
    renderDocket();
  }
  // ---------- sweep ----------

  /** Clamps a draft end to the last legal step and announces the stop once. */
  function setDraftEnd(draft: Draft, wantedEnd: number): void {
    const limits = limitsFor(draft.stationId, draft.startMinute);
    if (limits === null) return;
    const capped = Math.min(wantedEnd, limits.maxEndMinute);
    const atLeast = Math.max(capped, draft.startMinute + SLOT_MINUTES);
    const next = Math.min(atLeast, Math.max(limits.maxEndMinute, draft.startMinute + SLOT_MINUTES));
    const stopped = wantedEnd > limits.maxEndMinute;
    draft.endMinute = next;
    renderAll();
    if (stopped) speakStop(draft, limits);
    else {
      draft.spokenStop = null;
      speakStep(draft);
    }
  }

  function startDraft(stationId: string, minute: number, source: SweepSource): boolean {
    const station = stationById(stationId);
    if (station === null) return false;
    if (skippedMinutes(state.date).has(minute)) {
      say(copy.SWEEP_TAKEN);
      return false;
    }
    const startMs = instantOfMinute(state.date, minute);
    if (startMs === null || startMs <= serverNow()) {
      say(copy.SWEEP_TAKEN);
      return false;
    }
    const placed = placeBlocks(state.date, station);
    const occupied = placed.some((item) => {
      const from = Date.parse(item.block.starts_at);
      const until = Date.parse(item.block.buffer_ends_at);
      return startMs >= from && startMs < until;
    });
    if (occupied) {
      say(copy.SWEEP_TAKEN);
      return false;
    }
    const limits = limitsFor(stationId, minute);
    if (limits === null || limits.maxEndMinute <= minute) {
      say(copy.SWEEP_TAKEN);
      return false;
    }
    state.draft = {
      stationId,
      startMinute: minute,
      endMinute: minute + SLOT_MINUTES,
      mode: source === 'pointer' ? 'sweeping' : 'settled',
      source,
      spokenStop: null,
    };
    state.activeCell[stationId] = minute;
    renderAll();
    speakStep(state.draft);
    return true;
  }

  function discardDraft(): void {
    state.draft = null;
    renderAll();
  }

  /**
   * The rails are rebuilt on every render, so the sweep listens on the region
   * itself and looks the live track up by station. A stale node can therefore
   * never be measured.
   */
  function liveTrack(stationId: string): HTMLElement | null {
    return railsBox.querySelector<HTMLElement>(`[data-track="${stationId}"]`);
  }

  function minuteFromPointer(stationId: string, clientX: number): number {
    const track = liveTrack(stationId);
    if (track === null) return 0;
    const box = track.getBoundingClientRect();
    if (box.width === 0) return 0;
    const ratio = (clientX - box.left) / box.width;
    const raw = Math.round((ratio * DAY_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES;
    return Math.max(0, Math.min(DAY_MINUTES, raw));
  }

  function installSweep(): void {
    if (!isRenter) return;

    let holdTimer = 0;

    const onMove = (event: PointerEvent): void => {
      const draft = state.draft;
      if (draft === null || draft.mode !== 'sweeping') return;
      event.preventDefault();
      setDraftEnd(draft, minuteFromPointer(draft.stationId, event.clientX));
    };

    const onUp = (): void => {
      window.clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const draft = state.draft;
      if (draft === null || draft.mode !== 'sweeping') return;
      void placeHold(draft);
    };

    railsBox.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const stationId = target.closest<HTMLElement>('[data-track]')?.dataset['track'];
      if (stationId === undefined) return;

      const offered = state.draft;
      if (
        offered !== null &&
        offered.mode === 'offered' &&
        target.closest('.ticket') !== null &&
        offered.stationId === stationId
      ) {
        void placeHold(offered);
        return;
      }
      if (!target.classList.contains('rail__cell')) return;

      const minute = minuteFromPointer(stationId, event.clientX);
      const begin = (): void => {
        if (!startDraft(stationId, minute, 'pointer')) return;
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp);
      };

      if (event.pointerType === 'touch') {
        // A quick swipe scrolls the rails; half a second starts a sweep.
        holdTimer = window.setTimeout(begin, 500);
        window.addEventListener('pointerup', onUp, { once: true });
        return;
      }
      event.preventDefault();
      begin();
    });

    railsBox.addEventListener('keydown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('rail__cell')) return;
      const stationId = target.dataset['station'];
      if (stationId === undefined) return;
      const minute = Number(target.dataset['minute']);
      const draft = state.draft;

      const moveTo = (nextMinute: number, nextStation?: string): void => {
        event.preventDefault();
        const target2 = nextStation ?? stationId;
        state.activeCell[target2] = nextMinute;
        renderAll();
        document.getElementById(cellId(target2, nextMinute))?.focus();
      };

      switch (event.key) {
        case 'ArrowRight':
          if (event.shiftKey) {
            event.preventDefault();
            if (draft !== null && draft.stationId === stationId) {
              setDraftEnd(draft, draft.endMinute + SLOT_MINUTES);
            } else {
              startDraft(stationId, minute, 'keyboard');
            }
            return;
          }
          if (minute + SLOT_MINUTES < DAY_MINUTES) moveTo(minute + SLOT_MINUTES);
          return;
        case 'ArrowLeft':
          if (event.shiftKey) {
            event.preventDefault();
            if (draft === null || draft.stationId !== stationId) return;
            if (draft.endMinute - SLOT_MINUTES <= draft.startMinute) discardDraft();
            else setDraftEnd(draft, draft.endMinute - SLOT_MINUTES);
            return;
          }
          if (minute - SLOT_MINUTES >= 0) moveTo(minute - SLOT_MINUTES);
          return;
        case 'Home':
          moveTo(0);
          return;
        case 'End':
          moveTo(DAY_MINUTES - SLOT_MINUTES);
          return;
        case 'ArrowUp':
        case 'ArrowDown': {
          const stations = state.stations?.stations ?? [];
          const index = stations.findIndex((item) => item.id === stationId);
          const nextIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
          const next = stations[nextIndex];
          if (next) moveTo(minute, next.id);
          return;
        }
        case 'Enter':
          if (draft !== null && draft.stationId === stationId) {
            event.preventDefault();
            void placeHold(draft);
          }
          return;
        case 'Escape':
          if (draft !== null && draft.stationId === stationId) {
            event.preventDefault();
            discardDraft();
            document.getElementById(cellId(stationId, draft.startMinute))?.focus();
          }
          return;
        default:
          return;
      }
    });
  }

  // ---------- actions ----------

  async function placeHold(draft: Draft): Promise<void> {
    const station = stationById(draft.stationId);
    if (station === null) return;
    draft.mode = 'pending';
    state.busy = true;
    renderAll();
    say(copy.HOLD_PENDING);

    try {
      const answer = await api.post<BookingsResponse>('/api/bookings', {
        station_id: draft.stationId,
        date: state.date,
        start: hhmmOfMinute(draft.startMinute),
        end: hhmmOfMinute(draft.endMinute),
        repeat_weeks: state.repeatWeeks,
      });
      const first = answer.bookings[0];
      state.draft = null;
      state.busy = false;
      await refresh();
      say(copy.holdPlaced(station.name, first.start, first.end));
      if (draft.source === 'keyboard') confirmButton.focus();
    } catch (error) {
      state.busy = false;
      if (error instanceof ApiError && error.code === 'slot_conflict') {
        const legalEnd = error.body['legal_end'];
        if (typeof legalEnd === 'string') {
          draft.endMinute =
            legalEnd === '24:00' ? DAY_MINUTES : Number(legalEnd.slice(0, 2)) * 60 + Number(legalEnd.slice(3, 5));
          draft.mode = 'offered';
          await refresh();
          say(copy.lostClaimShrunk(legalEnd));
        } else {
          state.draft = null;
          await refresh();
          say(copy.LOST_CLAIM_REMOVED);
        }
        return;
      }
      state.draft = null;
      if (error instanceof ApiError && error.code === 'insufficient_hours') {
        const needed = Number(error.body['needed_minutes'] ?? 0);
        const balance = Number(error.body['balance_minutes'] ?? 0);
        renderAll();
        say(copy.shortOfHours(formatHours(needed), formatHours(balance)));
        return;
      }
      renderAll();
      say(
        messageFor(error, {
          compliance_lapsed: copy.COMPLIANCE_LAPSED,
          renter_not_active: copy.RENTER_NOT_ACTIVE,
        }),
      );
    }
  }

  async function selectBooking(bookingId: string | null, businessName: string | null): Promise<void> {
    if (bookingId === null) return;
    state.selection = { bookingId, booking: null, businessName };
    renderDocket();
    try {
      const answer = await api.get<{ booking: Booking }>(`/api/bookings/${bookingId}`);
      state.selection = { bookingId, booking: answer.booking, businessName };
    } catch {
      state.selection = null;
    }
    renderDocket();
  }

  async function confirmHold(): Promise<void> {
    const hold = state.liveHold;
    if (hold === null) return;
    state.busy = true;
    renderDocket();
    bookingStatus.textContent = copy.CONFIRM_PENDING;
    try {
      await api.post(`/api/bookings/${hold.id}/confirm`);
      state.busy = false;
      await refresh();
      bookingStatus.textContent = copy.CONFIRM_SUCCESS;
      const ticket = railsBox.querySelector<HTMLElement>(`[data-booking-id="${hold.id}"]`);
      (ticket ?? heading).focus();
    } catch (error) {
      state.busy = false;
      await refresh();
      bookingStatus.textContent = messageFor(error, { hold_expired: copy.HOLD_RAN_OUT });
    }
  }

  async function releaseHold(): Promise<void> {
    const hold = state.liveHold;
    if (hold === null) return;
    const startMinute = minuteOnDay(state.date, hold.starts_at);
    const stationId = hold.station_id;
    state.busy = true;
    renderDocket();
    bookingStatus.textContent = copy.RELEASE_PENDING;
    try {
      await api.post(`/api/bookings/${hold.id}/release`);
      state.busy = false;
      await refresh();
      bookingStatus.textContent = copy.releaseSuccess(formatHours(hold.minutes_debited));
      (document.getElementById(cellId(stationId, startMinute)) ?? heading).focus();
    } catch (error) {
      state.busy = false;
      await refresh();
      bookingStatus.textContent = messageFor(error, { hold_expired: copy.HOLD_RAN_OUT });
    }
  }

  function openCancelDialog(): void {
    const booking = state.selection?.booking;
    if (booking === undefined || booking === null) return;
    const credited = serverNow() < Date.parse(booking.cancellation_cutoff_at);
    const hours = formatHours(booking.minutes_debited);
    const outcome = el('p', {
      text: credited ? copy.cancelOutcomeReturns(hours) : copy.cancelOutcomeForfeits(hours),
    });
    const yes = el('button', { class: 'btn btn--primary', text: 'Yes, cancel', attrs: { type: 'button' } });
    const keep = el('button', { class: 'btn', text: 'Keep booking', attrs: { type: 'button' } });

    const dialog = openDialog({
      role: 'alertdialog',
      label: 'Cancel booking',
      opener: cancelButton,
      body: [
        el('h2', { text: 'Cancel booking' }),
        el('p', {
          class: 'mono',
          text: `${booking.station_name} ${booking.date} ${booking.start}${EN_DASH}${booking.end}`,
        }),
        outcome,
        el('div', { class: 'dialog__actions' }, [yes, keep]),
      ],
      onClose: () => {
        state.cancelDialog = null;
      },
    });
    state.cancelDialog = dialog;

    keep.addEventListener('click', () => dialog.close());
    yes.addEventListener('click', () => {
      yes.disabled = true;
      bookingStatus.textContent = copy.CANCEL_PENDING;
      void (async () => {
        try {
          const answer = await api.post<{ outcome: string; minutes: number }>(
            `/api/bookings/${booking.id}/cancel`,
          );
          const startMinute = minuteOnDay(state.date, booking.starts_at);
          state.selection = null;
          dialog.close({ focus: null });
          await refresh();
          bookingStatus.textContent =
            answer.outcome === 'credited'
              ? copy.cancelCredited(formatHours(answer.minutes))
              : copy.cancelForfeited(formatHours(answer.minutes));
          (document.getElementById(cellId(booking.station_id, startMinute)) ?? heading).focus();
        } catch (error) {
          yes.disabled = false;
          bookingStatus.textContent = messageFor(error);
        }
      })();
    });
  }

  // ---------- refresh ----------

  function ownIdsOnDay(): Set<string> {
    const ids = new Set<string>();
    for (const station of state.stations?.stations ?? []) {
      for (const block of station.blocks) {
        if (block.mine && block.booking_id !== null) ids.add(block.booking_id);
      }
    }
    return ids;
  }

  async function refresh(options: { quiet?: boolean } = {}): Promise<void> {
    const previousOwn = state.ownOnDay;
    const previousSelection = state.selection?.bookingId ?? null;
    const previousHold = state.liveHold?.id ?? null;
    await loadAll();
    const nextOwn = ownIdsOnDay();

    const gone = [...previousOwn].filter((id) => !nextOwn.has(id));
    const selectionGone = previousSelection !== null && !nextOwn.has(previousSelection);
    const holdGone =
      previousHold !== null && !state.holds.some((booking) => booking.id === previousHold);

    if ((gone.length > 0 || selectionGone || holdGone) && !options.quiet) {
      const changed = gone[0] ?? previousSelection ?? previousHold;
      if (changed !== null && changed !== undefined) await announceOwnTicketGone(changed);
    }
    if (selectionGone) {
      state.selection = null;
      state.cancelDialog?.close({ focus: null });
    }
    state.ownOnDay = nextOwn;
    renderAll();
  }

  async function announceOwnTicketGone(bookingId: string): Promise<void> {
    try {
      const answer = await api.get<{ booking: Booking }>(`/api/bookings/${bookingId}`);
      const booking = answer.booking;
      if (booking.status === 'displaced') {
        bookingStatus.textContent = copy.displacedCopy(
          booking.station_name,
          booking.start,
          booking.end,
          formatHours(booking.minutes_debited),
        );
        const startMinute = minuteOnDay(state.date, booking.starts_at);
        if (document.activeElement !== null && docket.contains(document.activeElement)) {
          document.getElementById(cellId(booking.station_id, startMinute))?.focus();
        }
        return;
      }
      if (booking.status === 'expired') {
        bookingStatus.textContent = copy.HOLD_RAN_OUT;
        return;
      }
      bookingStatus.textContent = copy.NO_LONGER_ACTIVE;
    } catch {
      bookingStatus.textContent = copy.NO_LONGER_ACTIVE;
    }
  }

  // ---------- wiring ----------

  previousDay.addEventListener('click', () => navigate(`/board?date=${addDays(state.date, -1)}`));
  nextDay.addEventListener('click', () => navigate(`/board?date=${addDays(state.date, 1)}`));
  todayButton.addEventListener('click', () =>
    navigate(`/board?date=${kitchenDate(serverNow())}`),
  );
  confirmButton.addEventListener('click', () => void confirmHold());
  releaseButton.addEventListener('click', () => void releaseHold());
  cancelButton.addEventListener('click', () => openCancelDialog());
  repeatInput.addEventListener('input', () => {
    const wanted = Number(repeatInput.value);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > MAX_REPEAT_WEEKS) return;
    state.repeatWeeks = wanted;
    const draft = state.draft;
    if (draft === null) {
      renderDocket();
      return;
    }
    const limits = limitsFor(draft.stationId, draft.startMinute);
    if (limits !== null && limits.maxEndMinute <= draft.startMinute) {
      state.draft = null;
      renderAll();
      say(copy.sweepStop(hhmmOfMinute(draft.startMinute), {
        kind: 'balance',
        hours: formatHours(balanceMinutes()),
      }));
      return;
    }
    draft.spokenStop = null;
    setDraftEnd(draft, draft.endMinute);
  });

  buildDocket();
  installSweep();

  let refreshTimer = 0;
  let tickTimer = 0;

  inBackground(async () => {
    if (state.date === '' || Number.isNaN(Date.parse(`${state.date}T00:00:00Z`))) {
      const probe = await api.get<StationsResponse>('/api/stations');
      state.date = probe.date;
      state.stations = probe;
      replaceAddressOnly(`/board?date=${state.date}`);
    }
    await refresh({ quiet: true });
    state.ownOnDay = ownIdsOnDay();
    renderAll();

    refreshTimer = window.setInterval(() => {
      if (state.draft?.mode === 'sweeping' || state.busy) return;
      inBackground(() => refresh());
    }, REFRESH_MS);

    tickTimer = window.setInterval(() => {
      const hold = state.liveHold;
      if (hold !== null && hold.hold_expires_at !== null) {
        if (Date.parse(hold.hold_expires_at) - serverNow() <= 0) {
          state.liveHold = null;
          state.holds = state.holds.filter((booking) => booking.id !== hold.id);
          bookingStatus.textContent = copy.HOLD_RAN_OUT;
          renderAll();
          return;
        }
      }
      renderCountdown();
    }, 1_000);
  });

  return () => {
    window.clearInterval(refreshTimer);
    window.clearInterval(tickTimer);
    state.cancelDialog?.close({ focus: null });
  };


}
