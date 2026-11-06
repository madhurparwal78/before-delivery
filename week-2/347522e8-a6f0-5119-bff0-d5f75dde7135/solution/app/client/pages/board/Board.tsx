// The Board: rails for the kitchen day in the address, the sweep, holds and the docket.
// It refreshes every 15 seconds without disturbing a draft, a dialog, the selection or focus.

import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BlockView, BookingView, BookingsResponse, CancelResponse, RenterView, StationView, StationsResponse } from "../../../shared/api.js";
import { type CancellationOutcome, cancellationOutcome } from "../../../shared/cancellation.js";
import { occupiesStation } from "../../../shared/bookingStatus.js";
import { formatHours } from "../../../shared/hours.js";
import {
  MINUTES_PER_DAY,
  SLOT_MINUTES,
  addDays,
  clockMinutes,
  clockTimeOf,
  formatHHMM,
  isIsoDate,
  kitchenDateOf,
  parseHHMM,
  wallClockInstant,
  wallMinutesFrom,
  weekdayName,
  zoneAtNoon,
} from "../../../shared/kitchenTime.js";
import { type ApiFailure, api } from "../../api.js";
import { serverNow, syncServerClock, useServerNow } from "../../clock.js";
import { type Message, StatusRegion, failure, info, success } from "../../components/Feedback.js";
import { Modal } from "../../components/Modal.js";
import { copy } from "../../copy.js";
import { prefersReducedMotion } from "../../motion.js";
import { navigate, usePlace } from "../../router.js";
import { useSession } from "../../session.js";
import { RenterDocket, type StaffSelection, StaffDocket } from "./Docket.js";
import { CELLS, type RailHandlers, Rails } from "./Rails.js";
import { type Draft, type SweepContext, canStart, draftPrice, fitBalance, stepToward, ticketHeight } from "./sweep.js";
import type { TicketProps } from "./Ticket.js";

const REFRESH_MS = 15_000;
const DEFAULT_CELL = 24;

type FocusTarget = { to: "confirm" } | { to: "ticket"; bookingId: string } | { to: "cell"; stationId: string; index: number } | { to: "heading" };

interface Overlay {
  added: { stationId: string; block: BlockView }[];
  kinds: Map<string, BlockView["kind"]>;
  gone: Set<string>;
}

const EMPTY_OVERLAY: Overlay = { added: [], kinds: new Map(), gone: new Set() };

interface Ghost {
  id: string;
  stationId: string;
  ticket: TicketProps;
}

function holdBlock(booking: BookingView): BlockView {
  return {
    kind: "hold",
    start: booking.start,
    end: booking.end,
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    buffer_ends_at: booking.buffer_ends_at,
    mine: true,
    booking_id: booking.id,
    renter_business_name: null,
  };
}

/** The live hold shown in the docket: the series with the latest expiry. */
function liveSeries(holds: BookingView[]): BookingView[] | null {
  const latest = [...holds].sort((a, b) => Date.parse(b.hold_expires_at) - Date.parse(a.hold_expires_at))[0];
  return latest ? holds.filter((hold) => hold.series_id === latest.series_id).sort((a, b) => a.date.localeCompare(b.date)) : null;
}

function bufferEndText(date: string, end: number, bufferMinutes: number): string {
  const at = wallClockInstant(date, end);
  return at === null ? formatHHMM(end) : clockTimeOf(at + bufferMinutes * 60_000);
}

export function Board() {
  const { user } = useSession();
  const renterId = user.role === "renter" ? user.renter_id : null;
  const { search } = usePlace();
  const requested = search.get("date");
  const date = requested !== null && isIsoDate(requested) ? requested : null;

  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [day, setDay] = useState<StationsResponse | null>(null);
  const [renter, setRenter] = useState<RenterView | null>(null);
  const [ownDay, setOwnDay] = useState<Map<string, BookingView>>(new Map());
  const [liveHold, setLiveHold] = useState<BookingView[] | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [settling, setSettling] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [weeksText, setWeeksText] = useState("1");
  const [weeks, setWeeks] = useState(1);
  const [announcement, setAnnouncement] = useState<Message | null>(null);
  const [status, setStatus] = useState<Message | null>(null);
  const [selected, setSelected] = useState<BookingView | null>(null);
  const [staffSelected, setStaffSelected] = useState<StaffSelection | null>(null);
  const [cancelling, setCancelling] = useState<{ booking: BookingView; outcome: CancellationOutcome } | null>(null);
  const [busy, setBusy] = useState<"confirm" | "release" | "cancel" | null>(null);
  const [activeCells, setActiveCells] = useState<Record<string, number>>({});
  const generation = useRef(0);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const lastStop = useRef<string | null>(null);
  const now = useServerNow(60_000);

  // Latest values for event handlers and the refresh.
  const state = useRef({ draft, ownDay, liveHold, selected, cancelling, date, day, renter, weeks });
  state.current = { draft, ownDay, liveHold, selected, cancelling, date, day, renter, weeks };

  useEffect(() => heading.current?.focus(), []);

  const say = useCallback((text: string, tone: Message["tone"] = "info") => setAnnouncement({ text, tone }), []);

  /** Re-reads the day's blocks, the renter's balance, own bookings and live holds. */
  const refresh = useCallback(async (): Promise<void> => {
    const shown = state.current.date;
    if (!shown) return;
    const startedAt = generation.current;
    const [stations, view, holds, own] = await Promise.all([
      api<StationsResponse>(`/api/stations?date=${shown}`),
      renterId ? api<{ renter: RenterView }>(`/api/renters/${renterId}`) : null,
      renterId ? api<BookingsResponse>("/api/bookings?status=hold") : null,
      renterId ? api<BookingsResponse>(`/api/bookings?date=${shown}`) : null,
    ]);
    if (startedAt !== generation.current || state.current.date !== shown || !stations.ok) return;
    syncServerClock(stations.data.server_now);
    const nextOwn = new Map((own?.ok ? own.data.bookings : []).map((booking) => [booking.id, booking]));
    const liveHolds = holds?.ok ? holds.data.bookings : [];
    const nextHold = liveSeries(liveHolds);

    const previous = state.current;
    const tracked = new Set<string>();
    for (const booking of previous.ownDay.values()) if (occupiesStation(booking.status)) tracked.add(booking.id);
    for (const hold of previous.liveHold ?? []) tracked.add(hold.id);
    if (previous.selected && occupiesStation(previous.selected.status)) tracked.add(previous.selected.id);
    const gone: BookingView[] = [];
    for (const id of tracked) {
      let found = nextOwn.get(id) ?? liveHolds.find((hold) => hold.id === id) ?? null;
      if (!found) {
        const read = await api<{ booking: BookingView }>(`/api/bookings/${id}`);
        found = read.ok ? read.data.booking : null;
      }
      if (found && !occupiesStation(found.status)) gone.push(found);
    }
    if (startedAt !== generation.current) return;

    setDay(stations.data);
    if (view?.ok) setRenter(view.data.renter);
    setOwnDay(nextOwn);
    setLiveHold(nextHold);
    setOverlay(EMPTY_OVERLAY);
    setSettling(new Set());
    const [first] = gone;
    if (!first) return;
    const goneIds = new Set(gone.map((booking) => booking.id));
    retract((ticket) => ticket.bookingId !== undefined && goneIds.has(ticket.bookingId));
    if (previous.cancelling && goneIds.has(previous.cancelling.booking.id)) setCancelling(null);
    if (previous.selected && goneIds.has(previous.selected.id)) setSelected(null);
    const focusInDocket = document.activeElement?.closest(".docket, .modal") !== null && document.activeElement !== document.body;
    if (focusInDocket && first.date === shown) pendingFocus.current = { to: "cell", stationId: first.station_id, index: clockMinutes(first.start) / SLOT_MINUTES };
    else if (focusInDocket) pendingFocus.current = { to: "heading" };
    setStatus(
      first.status === "displaced"
        ? failure(copy.booking.displaced(first.station_name, first.start, first.end, first.minutes_debited))
        : first.status === "expired"
          ? failure(copy.booking.expired)
          : failure(copy.booking.noLongerActive),
    );
  }, [renterId]);

  // Load the day in the address (or replace a missing/malformed day with the server's today).
  useEffect(() => {
    if (!date) {
      void api<StationsResponse>("/api/stations").then((result) => {
        if (!result.ok) return;
        syncServerClock(result.data.server_now);
        navigate(`/board?date=${result.data.date}`, { replace: true });
      });
      return;
    }
    generation.current += 1;
    setDay(null);
    setDraft(null);
    setOverlay(EMPTY_OVERLAY);
    setGhosts([]);
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [date, refresh]);

  // Phone band: the rails open scrolled to 06:00.
  const loaded = day !== null;
  useLayoutEffect(() => {
    const region = scroller.current;
    if (!loaded || !region || region.scrollWidth <= region.clientWidth + 1) return;
    const six = region.querySelector<HTMLElement>(`[data-index="${DEFAULT_CELL}"]`);
    const name = region.querySelector<HTMLElement>(".rail-row__name");
    if (!six) return;
    const offset = six.getBoundingClientRect().left - region.getBoundingClientRect().left + region.scrollLeft;
    region.scrollLeft = offset - (name?.getBoundingClientRect().width ?? 0);
  }, [loaded, date]);

  // Move focus where the last action said it should go, once the screen shows it.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    let element: HTMLElement | null = null;
    if (target.to === "confirm") element = document.querySelector<HTMLElement>('[data-focus="confirm"]');
    else if (target.to === "ticket") element = document.querySelector<HTMLElement>(`[data-booking="${target.bookingId}"]`);
    else if (target.to === "heading") element = heading.current;
    else {
      const station = state.current.day?.stations.find((s) => s.id === target.stationId);
      element = station ? document.querySelector<HTMLElement>(`[aria-label="${station.name} schedule"] [data-index="${target.index}"]`) : null;
      if (element) setActiveCells((cells) => ({ ...cells, [target.stationId]: target.index }));
    }
    if (element) {
      pendingFocus.current = null;
      element.focus();
    }
  });

  const today = now === null ? null : kitchenDateOf(now);
  const nowMinute = date && now !== null && today === date ? wallMinutesFrom(date, now) : null;

  // The blocks the screen shows: the server's, with this tab's own just-made changes laid over.
  const stations: StationView[] = useMemo(() => {
    if (!day) return [];
    return day.stations.map((station) => {
      const own = overlay.added.filter((entry) => entry.stationId === station.id).map((entry) => entry.block);
      const known = new Set(station.blocks.map((block) => block.booking_id).filter(Boolean));
      const blocks = [...station.blocks, ...own.filter((block) => !known.has(block.booking_id))]
        .filter((block) => !block.booking_id || !overlay.gone.has(block.booking_id))
        .map((block) => {
          const kind = block.booking_id ? overlay.kinds.get(block.booking_id) : undefined;
          return kind ? { ...block, kind } : block;
        });
      return { ...station, blocks };
    });
  }, [day, overlay]);

  const context = useCallback(
    (stationId: string): SweepContext | null => {
      const station = stations.find((s) => s.id === stationId);
      const current = state.current;
      if (!station || !current.date || !current.renter) return null;
      const nowAt = serverNow();
      const shownToday = nowAt === null ? null : kitchenDateOf(nowAt);
      const nowMin = nowAt === null || shownToday === null ? 0 : shownToday === current.date ? wallMinutesFrom(current.date, nowAt) : current.date < shownToday ? MINUTES_PER_DAY + 1 : -1;
      return { date: current.date, station, weeks: current.weeks, balance: current.renter.balance_minutes, nowMinute: nowMin };
    },
    [stations],
  );

  const stepCopy = (ctx: SweepContext, start: number, end: number): string =>
    copy.sweep.step(ctx.station.name, formatHHMM(start), formatHHMM(end), draftPrice(ctx, start, end) ?? 0, bufferEndText(ctx.date, end, ctx.station.buffer_minutes));

  /** Moves the draft's end edge toward `wanted` and speaks the step, or the stop once. */
  const sweepTo = (ctx: SweepContext, current: Draft, wanted: number): void => {
    const step = stepToward(ctx, current.start, wanted);
    const stopKey = step.stop ? `${step.end}:${step.stop.reason}` : null;
    if (step.end !== current.end || step.stop?.kind !== (current.notchAt === null ? undefined : "conflict")) {
      setDraft({ ...current, end: step.end, phase: "sweeping", notchAt: step.stop?.kind === "conflict" ? step.stop.notchAt : null });
    }
    if (step.stop) {
      if (stopKey !== lastStop.current) say(copy.sweep.stop(formatHHMM(step.end), step.stop.reason));
    } else if (step.end !== current.end || lastStop.current !== null) say(stepCopy(ctx, current.start, step.end));
    lastStop.current = stopKey;
  };

  const startDraft = (stationId: string, start: number): boolean => {
    const ctx = context(stationId);
    if (!ctx || state.current.draft?.phase === "pending") return false;
    const verdict = canStart(ctx, start);
    if (verdict === "taken") {
      say(copy.sweep.taken);
      return false;
    }
    if (verdict === "balance") {
      say(copy.sweep.stop(formatHHMM(start + SLOT_MINUTES), copy.sweep.reasons.balance(ctx.balance)));
      return false;
    }
    lastStop.current = null;
    setDraft({ stationId, start, end: start + SLOT_MINUTES, phase: "sweeping", notchAt: null });
    say(stepCopy(ctx, start, start + SLOT_MINUTES));
    return true;
  };

  const shownTickets = useRef<Map<string, TicketProps[]>>(new Map());
  const ghostCount = useRef(0);

  /** A ticket that leaves the rail slides up into it (not under reduced motion). */
  const retract = (match: (ticket: TicketProps) => boolean): void => {
    if (prefersReducedMotion()) return;
    const leaving: Ghost[] = [];
    for (const [stationId, list] of shownTickets.current) {
      for (const ticket of list) {
        if (!ticket.leaving && match(ticket)) {
          ghostCount.current += 1;
          leaving.push({ id: String(ghostCount.current), stationId, ticket: { ...ticket, leaving: true, onActivate: undefined, onPress: undefined } });
        }
      }
    }
    if (leaving.length) setGhosts((list) => [...list, ...leaving]);
  };

  const placeHold = async (input: "pointer" | "keyboard"): Promise<void> => {
    const current = state.current.draft;
    const shown = state.current.date;
    const ctx = current ? context(current.stationId) : null;
    if (!current || !shown || !ctx || current.phase === "pending") return;
    generation.current += 1;
    setDraft({ ...current, phase: "pending", notchAt: null });
    say(copy.hold.pending);
    const result = await api<BookingsResponse>("/api/bookings", {
      method: "POST",
      json: { station_id: current.stationId, date: shown, start: formatHHMM(current.start), end: formatHHMM(current.end), repeat_weeks: state.current.weeks },
    });
    generation.current += 1;
    if (result.ok) {
      syncServerClock(result.data.server_now);
      const series = result.data.bookings;
      const view = renterId ? await api<{ renter: RenterView }>(`/api/renters/${renterId}`) : null;
      if (view?.ok) setRenter(view.data.renter);
      setDraft(null);
      setOverlay((value) => ({ ...value, added: [...value.added, ...series.filter((b) => b.date === shown).map((b) => ({ stationId: b.station_id, block: holdBlock(b) }))] }));
      setSettling(new Set(series.map((booking) => booking.id)));
      setOwnDay((map) => new Map([...map, ...series.filter((b) => b.date === shown).map((b): [string, BookingView] => [b.id, b])]));
      setLiveHold(series);
      say(copy.hold.placed(ctx.station.name, formatHHMM(current.start), formatHHMM(current.end)), "success");
      if (input === "keyboard") pendingFocus.current = { to: "confirm" };
      void refresh();
      return;
    }
    const error: ApiFailure = result.error;
    if (error.error === "slot_conflict") {
      const legal = typeof error.legal_end === "string" ? parseHHMM(error.legal_end) : null;
      if (legal === null || legal <= current.start) {
        retract((ticket) => ticket.kind === "draft");
        setDraft(null);
        say(copy.hold.lostRemoved, "error");
      } else {
        setDraft({ ...current, end: legal, phase: "waiting", notchAt: null });
        say(copy.hold.lostShrunk(formatHHMM(legal)), "error");
      }
      void refresh();
      return;
    }
    setDraft(null);
    if (error.error === "insufficient_hours") say(copy.hold.short(Number(error.needed_minutes), Number(error.balance_minutes)), "error");
    else if (error.error === "compliance_lapsed") say(copy.hold.lapsed, "error");
    else if (error.error === "renter_not_active") say(copy.hold.notActive, "error");
    else if (error.error === "validation") say(Object.values(error.errors ?? {})[0] ?? copy.unexpected, "error");
    else say(copy.unexpected, "error");
    void refresh();
  };

  const handlers = useRef<RailHandlers | null>(null);
  handlers.current = {
    press: (stationId, minute) => {
      const current = state.current.draft;
      if (!renterId) return false;
      if (current?.phase === "waiting" && current.stationId === stationId && minute >= current.start && minute < current.end) {
        void placeHold("pointer");
        return false;
      }
      return startDraft(stationId, Math.min(minute, MINUTES_PER_DAY - SLOT_MINUTES));
    },
    drag: (minute) => {
      const current = state.current.draft;
      const ctx = current ? context(current.stationId) : null;
      if (!current || !ctx || current.phase !== "sweeping") return;
      sweepTo(ctx, current, Math.max(minute, current.start + SLOT_MINUTES));
    },
    release: () => {
      if (state.current.draft?.phase === "sweeping") void placeHold("pointer");
    },
    cancel: () => setDraft(null),
    focusCell: (stationId, index) => setActiveCells((cells) => (cells[stationId] === index ? cells : { ...cells, [stationId]: index })),
    key: (stationId, index, event: KeyboardEvent<HTMLElement>) => {
      const list = state.current.day?.stations ?? [];
      const row = list.findIndex((s) => s.id === stationId);
      const focusAt = (targetStation: string, targetIndex: number): void => {
        const station = list.find((s) => s.id === targetStation);
        setActiveCells((cells) => ({ ...cells, [targetStation]: targetIndex }));
        document.querySelector<HTMLElement>(`[aria-label="${station?.name ?? ""} schedule"] [data-index="${targetIndex}"]`)?.focus();
      };
      const current = state.current.draft;
      const ctx = context(stationId);
      if (event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        if (!renterId || !ctx) return;
        if (current && current.stationId === stationId && current.phase !== "pending") sweepTo(ctx, current, current.end + SLOT_MINUTES);
        else startDraft(stationId, index * SLOT_MINUTES);
        return;
      }
      if (event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        if (!current || current.stationId !== stationId || current.phase === "pending" || !ctx) return;
        if (current.end - SLOT_MINUTES <= current.start) {
          setDraft(null);
          lastStop.current = null;
          return;
        }
        sweepTo(ctx, current, current.end - SLOT_MINUTES);
        return;
      }
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          focusAt(stationId, Math.max(0, index - 1));
          return;
        case "ArrowRight":
          event.preventDefault();
          focusAt(stationId, Math.min(CELLS - 1, index + 1));
          return;
        case "Home":
          event.preventDefault();
          focusAt(stationId, 0);
          return;
        case "End":
          event.preventDefault();
          focusAt(stationId, CELLS - 1);
          return;
        case "ArrowUp":
        case "ArrowDown": {
          event.preventDefault();
          const next = list[row + (event.key === "ArrowUp" ? -1 : 1)];
          if (next) focusAt(next.id, index);
          return;
        }
        case "Enter":
          if (current && current.phase !== "pending") {
            event.preventDefault();
            void placeHold("keyboard");
          }
          return;
        case "Escape":
          if (current && current.phase !== "pending") {
            event.preventDefault();
            setDraft(null);
            lastStop.current = null;
          }
          return;
      }
    },
  };
  const stableHandlers = useMemo<RailHandlers>(
    () => ({
      press: (s, m) => handlers.current?.press(s, m) ?? false,
      drag: (m) => handlers.current?.drag(m),
      release: () => handlers.current?.release(),
      cancel: () => handlers.current?.cancel(),
      key: (s, i, e) => handlers.current?.key(s, i, e),
      focusCell: (s, i) => handlers.current?.focusCell(s, i),
    }),
    [],
  );

  /** Repeat weekly for: reprices the draft at once and shrinks it to what the balance covers. */
  const changeWeeks = (text: string): void => {
    setWeeksText(text);
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1 || value > 12) return;
    setWeeks(value);
    state.current.weeks = value;
    const current = state.current.draft;
    const ctx = current ? context(current.stationId) : null;
    if (!current || !ctx || current.phase === "pending") return;
    const fitted = fitBalance(ctx, current.start, current.end);
    if (fitted === null) {
      setDraft(null);
      say(copy.sweep.stop(formatHHMM(current.start + SLOT_MINUTES), copy.sweep.reasons.balance(ctx.balance)));
      return;
    }
    if (fitted < current.end) {
      setDraft({ ...current, end: fitted, notchAt: null });
      say(copy.sweep.stop(formatHHMM(fitted), copy.sweep.reasons.balance(ctx.balance)));
      lastStop.current = `${fitted}:balance`;
      return;
    }
    say(stepCopy(ctx, current.start, current.end));
  };

  const select = (booking: BookingView): void => setSelected(booking);

  const confirmHold = async (): Promise<void> => {
    const series = state.current.liveHold ?? [];
    const [first] = series;
    if (!first) return;
    generation.current += 1;
    setBusy("confirm");
    setStatus(info(copy.booking.confirming));
    const result = await api<BookingsResponse>(`/api/bookings/${first.id}/confirm`, { method: "POST", json: {} });
    generation.current += 1;
    setBusy(null);
    if (result.ok) {
      syncServerClock(result.data.server_now);
      const confirmed = result.data.bookings;
      setLiveHold(null);
      setAnnouncement(null);
      setOverlay((value) => ({ ...value, kinds: new Map([...value.kinds, ...confirmed.map((b): [string, BlockView["kind"]] => [b.id, "booking"])]) }));
      setOwnDay((map) => new Map([...map, ...confirmed.filter((b) => map.has(b.id)).map((b): [string, BookingView] => [b.id, b])]));
      setStatus(success(copy.booking.confirmed));
      const shownWeek = confirmed.find((b) => b.date === state.current.date);
      pendingFocus.current = shownWeek ? { to: "ticket", bookingId: shownWeek.id } : { to: "heading" };
    } else {
      const ids = series.map((b) => b.id);
      setLiveHold(null);
      setOverlay((value) => ({ ...value, gone: new Set([...value.gone, ...ids]) }));
      setStatus(failure(result.error.error === "hold_expired" ? copy.booking.expired : result.error.error === "invalid_transition" ? copy.booking.noLongerActive : copy.unexpected));
    }
    void refresh();
  };

  const release = async (): Promise<void> => {
    const series = state.current.liveHold ?? [];
    const [first] = series;
    if (!first) return;
    generation.current += 1;
    setBusy("release");
    setStatus(info(copy.booking.releasing));
    const result = await api<BookingsResponse>(`/api/bookings/${first.id}/release`, { method: "POST", json: {} });
    generation.current += 1;
    setBusy(null);
    const ids = series.map((b) => b.id);
    retract((ticket) => ticket.bookingId !== undefined && ids.includes(ticket.bookingId));
    setLiveHold(null);
    setAnnouncement(null);
    setOverlay((value) => ({ ...value, gone: new Set([...value.gone, ...ids]) }));
    setOwnDay((map) => new Map([...map].filter(([id]) => !ids.includes(id))));
    const shownWeek = series.find((b) => b.date === state.current.date);
    pendingFocus.current = shownWeek ? { to: "cell", stationId: shownWeek.station_id, index: clockMinutes(shownWeek.start) / SLOT_MINUTES } : { to: "heading" };
    if (result.ok) {
      setStatus(success(copy.booking.released(series.reduce((sum, booking) => sum + booking.minutes_debited, 0))));
    } else setStatus(failure(result.error.error === "hold_expired" ? copy.booking.expired : copy.unexpected));
    void refresh();
  };

  const openCancel = (): void => {
    const booking = state.current.selected;
    const at = serverNow();
    if (!booking || at === null) return;
    setCancelling({ booking, outcome: cancellationOutcome(Date.parse(booking.cancellation_cutoff_at), at) });
  };

  const cancel = async (): Promise<void> => {
    const target = state.current.cancelling?.booking;
    if (!target) return;
    generation.current += 1;
    setBusy("cancel");
    setStatus(info(copy.booking.cancelling));
    const result = await api<CancelResponse>(`/api/bookings/${target.id}/cancel`, { method: "POST", json: {} });
    generation.current += 1;
    setBusy(null);
    setCancelling(null);
    if (result.ok) {
      retract((ticket) => ticket.bookingId === target.id);
      setSelected(null);
      setOverlay((value) => ({ ...value, gone: new Set([...value.gone, target.id]) }));
      setOwnDay((map) => new Map([...map].filter(([id]) => id !== target.id)));
      const { outcome, minutes } = result.data;
      setStatus(success(outcome === "credited" ? copy.booking.cancelledCredited(minutes) : copy.booking.cancelledForfeited(minutes)));
      pendingFocus.current =
        target.date === state.current.date ? { to: "cell", stationId: target.station_id, index: clockMinutes(target.start) / SLOT_MINUTES } : { to: "heading" };
    } else setStatus(failure(result.error.error === "invalid_transition" ? copy.booking.noLongerActive : copy.unexpected));
    void refresh();
  };

  const holdRanOut = useCallback(() => {
    const series = state.current.liveHold;
    if (!series) return;
    const ids = series.map((b) => b.id);
    generation.current += 1;
    retract((ticket) => ticket.bookingId !== undefined && ids.includes(ticket.bookingId));
    setLiveHold(null);
    setOverlay((value) => ({ ...value, gone: new Set([...value.gone, ...ids]) }));
    setOwnDay((map) => new Map([...map].filter(([id]) => !ids.includes(id))));
    setStatus(failure(copy.booking.expired));
    void refresh();
  }, [refresh]);

  // Tickets per station, the draft included, and each rail's lane height.
  const { tickets, lanes } = useMemo(() => {
    const byStation = new Map<string, TicketProps[]>();
    const lanes = new Map<string, number>();
    if (!date) return { tickets: byStation, lanes };
    for (const station of stations) {
      const list: TicketProps[] = [];
      for (const block of station.blocks) {
        const left = wallMinutesFrom(date, Date.parse(block.starts_at));
        const right = wallMinutesFrom(date, Date.parse(block.ends_at));
        const height = ticketHeight(clockMinutes(block.start), clockMinutes(block.end));
        const times = `${block.start}–${block.end}`;
        const tail = block.kind === "maintenance" ? {} : { bufferRight: wallMinutesFrom(date, Date.parse(block.buffer_ends_at)), bufferLabel: `Buffer until ${clockTimeOf(Date.parse(block.buffer_ends_at))}` };
        const taken = (): void => say(copy.sweep.taken);
        if (block.kind === "maintenance") {
          list.push({ kind: "maintenance", left, right, height, label: `Maintenance ${block.start} to ${block.end}`, heading: "Maintenance", times, onPress: taken });
        } else if (block.mine && block.booking_id) {
          const booking = ownDay.get(block.booking_id);
          const id = block.booking_id;
          list.push({
            kind: block.kind === "hold" ? "hold" : "booking",
            left,
            right,
            height,
            label: `${block.kind === "hold" ? "Hold" : "Booking"} ${station.name} ${block.start} to ${block.end}`,
            heading: block.kind === "hold" ? "HOLD" : undefined,
            times,
            hours: booking ? `${formatHours(booking.minutes_debited)} h` : undefined,
            bookingId: id,
            selected: selected?.id === id,
            settling: settling.has(id),
            onActivate: () => {
              const fresh = state.current.ownDay.get(id);
              if (fresh) select(fresh);
            },
            onPress: taken,
            ...tail,
          });
        } else if (!renterId && block.booking_id) {
          const business = block.renter_business_name ?? "";
          list.push({
            kind: "staff",
            left,
            right,
            height,
            label: `${business} ${station.name} ${block.start} to ${block.end}`,
            heading: business,
            times,
            bookingId: block.booking_id,
            selected: staffSelected?.times === times && staffSelected.station === station.name && staffSelected.business === business,
            onActivate: () => setStaffSelected({ business, station: station.name, times, date }),
            ...tail,
          });
        } else {
          list.push({ kind: "other", left, right, height, label: `Booked ${block.start} to ${block.end}`, heading: "Booked", times, onPress: taken, ...tail });
        }
      }
      if (draft && renter && draft.stationId === station.id) {
        const ctx: SweepContext = { date, station, weeks, balance: renter.balance_minutes, nowMinute: 0 };
        const price = draftPrice(ctx, draft.start, draft.end);
        const end = bufferEndText(date, draft.end, station.buffer_minutes);
        list.push({
          kind: "draft",
          left: draft.start,
          right: draft.end,
          height: ticketHeight(draft.start, draft.end),
          label: `Draft ticket ${formatHHMM(draft.start)} to ${formatHHMM(draft.end)}`,
          times: `${formatHHMM(draft.start)}–${formatHHMM(draft.end)}`,
          hours: price === null ? undefined : `${formatHours(price)} h`,
          weeks: weeks > 1 ? `× ${weeks} weeks` : undefined,
          bufferRight: station.buffer_minutes ? draft.end + station.buffer_minutes : undefined,
          bufferLabel: `Buffer until ${end}`,
          waiting: draft.phase === "waiting",
          onPress: () => {
            if (state.current.draft?.phase !== "pending") void placeHold("pointer");
          },
        });
      }
      for (const entry of ghosts) {
        if (entry.stationId === station.id) {
          list.push({ ...entry.ticket, bookingId: `ghost-${entry.id}`, onLeft: () => setGhosts((all) => all.filter((g) => g.id !== entry.id)) });
        }
      }
      byStation.set(station.id, list);
      lanes.set(station.id, Math.max(28, ...list.filter((t) => !t.leaving).map((t) => t.height + 16)));
    }
    return { tickets: byStation, lanes };
  }, [stations, ownDay, draft, weeks, renter, renterId, selected, settling, ghosts, staffSelected, date, say]);

  shownTickets.current = tickets;

  const projected = draft && draft.phase !== "waiting" && renter && date ? (() => {
    const station = stations.find((s) => s.id === draft.stationId);
    if (!station) return null;
    const price = draftPrice({ date, station, weeks, balance: renter.balance_minutes, nowMinute: 0 }, draft.start, draft.end);
    return price === null ? null : renter.balance_minutes - price;
  })() : null;

  const skipped = useMemo(() => {
    if (!date) return null;
    let from: number | null = null;
    let to = 0;
    for (let minute = 0; minute < MINUTES_PER_DAY; minute += SLOT_MINUTES) {
      if (wallClockInstant(date, minute) === null) {
        from ??= minute;
        to = minute + SLOT_MINUTES;
      }
    }
    return from === null ? null : { from, to };
  }, [date]);

  const empty = day !== null && day.stations.every((station) => station.blocks.length === 0);
  // Until the first day arrives the grid stays laid out but unseen, so nothing visibly jumps when the rails fill.
  const firstDayLoaded = useRef(false);
  if (day !== null) firstDayLoaded.current = true;

  return (
    <div className="screen screen--board">
      <div className="board-head">
        <h1 ref={heading} tabIndex={-1} className="screen__title">
          Board
        </h1>
        <div className="board-head__controls">
          <button type="button" className="button button--icon" disabled={!date} onClick={() => date && navigate(`/board?date=${addDays(date, -1)}`)}>
            <ChevronLeft aria-hidden="true" className="icon" />
            Previous day
          </button>
          <button type="button" className="button" disabled={!today} onClick={() => today && navigate(`/board?date=${today}`)}>
            <CalendarDays aria-hidden="true" className="icon" />
            Today
          </button>
          <button type="button" className="button button--icon" disabled={!date} onClick={() => date && navigate(`/board?date=${addDays(date, 1)}`)}>
            Next day
            <ChevronRight aria-hidden="true" className="icon" />
          </button>
        </div>
        <p className="board-head__day mono">{date ? `${weekdayName(date)} ${date} · ${zoneAtNoon(date)}` : "\u00a0"}</p>
      </div>
      <div className={`board-grid${firstDayLoaded.current ? "" : " board-grid--loading"}`}>
        <div className="board-grid__rails">
          <Rails
            stations={stations}
            tickets={tickets}
            laneHeights={lanes}
            activeCells={activeCells}
            notch={draft && draft.notchAt !== null ? { stationId: draft.stationId, minute: draft.notchAt } : null}
            nowMinute={nowMinute}
            skipped={skipped}
            empty={empty}
            sweepable={renterId !== null}
            handlers={stableHandlers}
            scroller={scroller}
          />
          <StatusRegion name="Sweep announcer" message={announcement} className="announcer" />
        </div>
        {renterId ? (
          <RenterDocket
            balanceMinutes={renter ? (projected ?? renter.balance_minutes) : null}
            heldMinutes={renter?.held_minutes ?? 0}
            weeksText={weeksText}
            onWeeks={changeWeeks}
            liveHold={liveHold}
            selected={selected}
            compliance={renter?.compliance ?? null}
            busy={busy}
            onConfirm={() => void confirmHold()}
            onRelease={() => void release()}
            onCancel={openCancel}
            onExpired={holdRanOut}
            status={status}
          />
        ) : (
          <StaffDocket selected={staffSelected} status={status} />
        )}
      </div>
      {cancelling ? (
        <Modal title="Cancel booking" role="alertdialog" onClose={() => setCancelling(null)}>
          <p className="modal__lede">{`${cancelling.booking.station_name} · ${cancelling.booking.date} · ${cancelling.booking.start}–${cancelling.booking.end}`}</p>
          <p className="outcome">
            {cancelling.outcome === "credited" ? copy.booking.outcomeReturns(cancelling.booking.minutes_debited) : copy.booking.outcomeForfeits(cancelling.booking.minutes_debited)}
          </p>
          <div className="modal__actions">
            <button type="button" className="button button--primary" data-autofocus disabled={busy === "cancel"} onClick={() => void cancel()}>
              Yes, cancel
            </button>
            <button type="button" className="button" onClick={() => setCancelling(null)}>
              Keep booking
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
