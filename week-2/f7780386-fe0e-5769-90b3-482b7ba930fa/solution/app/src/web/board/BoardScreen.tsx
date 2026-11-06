// The line board: stations as rows, 15-minute cells from 05:00 to 24:00, painting holds by pointer,
// touch or keyboard, the ticket rail and the right-hand drawer.

import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Board, Booking, Hold, Segment } from "../../shared/api.js";
import { BOARD_OPENS, CELL_MINUTES, clock, costSplit, formatDuration, formatHours, formatMoney } from "../../shared/rules.js";
import { addDays, kitchenMinute, longDate } from "../../shared/zone.js";
import type { Session } from "../App.js";
import { ApiFailure, call, get, post, serverNow, syncServerClock } from "../api.js";
import { announce, complain, NO_RESPONSE, perform, type Refusal } from "../feedback.js";
import { moneyCents } from "../format.js";
import { CalendarCheck, ChevronLeft, ChevronRight } from "../icons.js";
import { CostTag } from "./CostTag.js";
import { Drawer, type DrawerTarget, type HoldDetails } from "./Drawer.js";
import { animate, DRAWER_MS, DRAWER_OUT, EXPIRE_MS, FADE_MS, FLIGHT_MS, LOSS_EDGE_MS, reducedMotion, SHAKE_MS } from "./motion.js";
import { COLUMNS, columnOf, fitBand, minuteOf, minutesOf, runs, stationCells, type BoardCell, type CellState } from "./model.js";
import { Rail, type Ticket } from "./Rail.js";

const POLL_MS = 5000;
const TOUCH_HOLD_MS = 500;

interface Paint {
  row: number;
  anchor: number;
  pointer: number;
}

interface Band {
  row: number;
  start: number;
  end: number;
  tailEnd: number;
}

interface StationView {
  id: string;
  name: string;
  rateCents: number;
  tailCells: number;
  segments: Segment[];
  cells: BoardCell[];
}

const PLACE_REASONS: Record<string, string> = {
  in_the_past: "It starts in the past.",
  too_far_ahead: "Bookings open 28 days ahead.",
  outside_board_hours: "The cleaning turnover must finish by 24:00.",
  not_on_grid: "Pick whole 15-minute cells.",
  end_before_start: "Pick whole 15-minute cells.",
};

function documentsCopy(date: string): string {
  return `Your liability insurance is not approved and current for ${date}. Renew it on Documents before booking.`;
}

function validationReason(failure: ApiFailure): string {
  const codes = Object.values(failure.body.errors ?? {});
  const known = codes.map((code) => PLACE_REASONS[code]).find((reason) => reason !== undefined);
  return `That slot can't be held. ${known ?? "Pick whole 15-minute cells."}`;
}

function initialDate(today: string): string {
  const requested = new URLSearchParams(window.location.search).get("date");
  return requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
}

export function BoardScreen({ session }: { session: Session }) {
  const { kitchen, user } = session;
  const member = user.role === "member";
  const [today, setToday] = useState(kitchen.today);
  const [date, setDate] = useState(() => initialDate(kitchen.today));
  const [board, setBoard] = useState<Board | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [paint, setPaint] = useState<Paint | null>(null);
  const [placing, setPlacing] = useState<Band | null>(null);
  const [loss, setLoss] = useState<(Band & { key: number }) | null>(null);
  const [cursor, setCursor] = useState({ row: 0, col: 0 });
  const [drawer, setDrawer] = useState<{ target: DrawerTarget; focus: "confirm" | "cancel" | "title" } | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(serverNow());
  const [fading, setFading] = useState<string[]>([]);
  const frameRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const drawerOpener = useRef<HTMLElement | null>(null);
  const flight = useRef<{ holdId: string; from: DOMRect } | null>(null);
  const paintRef = useRef<Paint | null>(null);
  const dateRef = useRef(date);
  const loadSeq = useRef(0);
  const scrolledFor = useRef<string | null>(null);
  const announcedExpiry = useRef(new Set<string>());
  paintRef.current = paint;
  dateRef.current = date;

  const load = async (shown: string) => {
    const seq = ++loadSeq.current;
    try {
      const [fresh, me] = await Promise.all([
        get<Board>(`/api/board?date=${shown}`),
        member ? get<{ balance_minutes: number | null }>("/api/me") : Promise.resolve(null),
      ]);
      if (seq !== loadSeq.current) return;
      syncServerClock(fresh.now);
      setNow(serverNow());
      setToday(fresh.today);
      setBoard(fresh);
      if (me) setBalance(me.balance_minutes);
    } catch {
      // The next poll retries; actions report their own failures.
    }
  };

  useLayoutEffect(() => {
    void load(date);
    const url = date === today ? "/board" : `/board?date=${date}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [date]);

  useLayoutEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(dateRef.current);
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(serverNow()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  const zone = kitchen.time_zone;
  const nowMinute = kitchenMinute(now, zone);
  // A cell is past when its start instant is before now: holds start at or after now.
  const intoMinute = Math.floor(now / 1000) % 60 > 0 ? 1 : 0;
  const pastBefore = date < today ? Number.POSITIVE_INFINITY : date > today ? 0 : nowMinute + intoMinute;

  const views: StationView[] = useMemo(
    () =>
      kitchen.stations.map((station) => {
        const segments = board && board.date === date ? (board.stations.find((s) => s.id === station.id)?.segments ?? []) : [];
        const visible = segments.filter((s) => s.kind === "occupied" || !fading.includes(s.id));
        return {
          id: station.id,
          name: station.name,
          rateCents: moneyCents(station.hourly_rate),
          tailCells: station.cleaning_minutes / CELL_MINUTES,
          segments: visible,
          cells: stationCells(visible, user.role, pastBefore),
        };
      }),
    [board, date, pastBefore, fading],
  );

  const fit = paint ? fitBand(views[paint.row].cells, paint.anchor, paint.pointer, views[paint.row].tailCells) : null;

  // Holds whose server expiry has passed fade out and leave the rail within a second.
  useLayoutEffect(() => {
    if (!board || !member) return;
    for (const station of board.stations) {
      for (const segment of station.segments) {
        if (segment.kind !== "hold" || Date.parse(segment.expires_at) > now || announcedExpiry.current.has(segment.id)) continue;
        announcedExpiry.current.add(segment.id);
        const name = kitchen.stations.find((s) => s.id === station.id)?.name ?? station.name;
        for (const element of document.querySelectorAll(`[data-ticket="${segment.id}"], [data-span="${segment.id}"]`)) {
          animate(element, [{ opacity: 1 }, { opacity: 0 }], { duration: EXPIRE_MS, fill: "forwards" });
        }
        window.setTimeout(() => {
          setFading((ids) => [...ids, segment.id]);
          announce(`Your hold on ${name}, ${segment.start}–${segment.end} expired.`);
          if (drawer?.target.id === segment.id) setDrawer(null);
          void load(dateRef.current);
        }, reducedMotion() ? 0 : EXPIRE_MS);
      }
    }
  }, [now, board]);

  // On first showing a date: scroll to the hour containing now on today, else to 05:00; place the cursor.
  useLayoutEffect(() => {
    if (!board || board.date !== date || scrolledFor.current === date) return;
    scrolledFor.current = date;
    const frame = frameRef.current;
    const firstCell = gridRef.current?.querySelector<HTMLElement>('[role="gridcell"]');
    const cellWidth = firstCell?.getBoundingClientRect().width ?? 24;
    let startCol = 0;
    if (date === today) {
      const hourCol = Math.max(0, columnOf(Math.max(BOARD_OPENS, nowMinute - (nowMinute % 60))));
      if (frame) frame.scrollLeft = Math.min(hourCol, COLUMNS - 1) * cellWidth;
      const firstFree = views[0].cells.findIndex((cell) => cell.state === "free");
      startCol = firstFree < 0 ? 0 : firstFree;
    } else if (frame) {
      frame.scrollLeft = 0;
    }
    setCursor({ row: 0, col: startCol });
  }, [board, date]);

  // The band lifts into its rail slot once the ticket exists.
  useLayoutEffect(() => {
    const pending = flight.current;
    if (!pending) return;
    const ticket = document.querySelector<HTMLElement>(`[data-ticket="${pending.holdId}"]`);
    if (!ticket) return;
    flight.current = null;
    if (reducedMotion()) return;
    const to = ticket.getBoundingClientRect();
    const clone = document.createElement("div");
    clone.className = "band-flight";
    clone.setAttribute("aria-hidden", "true");
    Object.assign(clone.style, { left: `${pending.from.left}px`, top: `${pending.from.top}px`, width: `${pending.from.width}px`, height: `${pending.from.height}px` });
    document.body.append(clone);
    const dx = to.left - pending.from.left;
    const dy = to.top - pending.from.top;
    const sx = to.width / Math.max(1, pending.from.width);
    const sy = to.height / Math.max(1, pending.from.height);
    const lift = animate(clone, [{ transform: "translate(0, 0) scale(1, 1)", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.9 }], {
      duration: FLIGHT_MS,
      fill: "forwards",
    });
    animate(ticket, [{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: FLIGHT_MS });
    if (lift) lift.onfinish = () => clone.remove();
    else clone.remove();
  });

  const station = (row: number) => views[row];

  const cellElement = (row: number, col: number) => gridRef.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`) ?? null;

  const focusCell = (row: number, col: number) => {
    const r = Math.max(0, Math.min(views.length - 1, row));
    const c = Math.max(0, Math.min(COLUMNS - 1, col));
    setCursor({ row: r, col: c });
    cellElement(r, c)?.focus();
  };

  const holdSegment = (id: string) => {
    for (const s of board?.stations ?? []) {
      const found = s.segments.find((segment) => segment.kind === "hold" && segment.id === id);
      if (found && found.kind === "hold") return { segment: found, stationId: s.id };
    }
    return null;
  };

  const holdDetails = (id: string): HoldDetails | null => {
    const found = holdSegment(id);
    if (!found) return null;
    const view = views.find((v) => v.id === found.stationId);
    if (!view) return null;
    return {
      kind: "hold",
      id,
      stationName: view.name,
      rateCents: view.rateCents,
      date,
      start: found.segment.start,
      end: found.segment.end,
      tailEnd: found.segment.tail_end,
      bookedMinutes: minutesOf(found.segment.end) - minutesOf(found.segment.start),
      expiresAt: Date.parse(found.segment.expires_at),
    };
  };

  const openDrawer = (kind: "hold" | "booking", id: string, opener: HTMLElement | null, focus: "confirm" | "cancel" | "title") => {
    drawerOpener.current = opener;
    setClosing(false);
    if (kind === "hold") {
      const details = holdDetails(id);
      if (details) setDrawer({ target: details, focus });
      return;
    }
    get<{ booking: Booking }>(`/api/bookings/${id}`)
      .then(({ booking }) => setDrawer({ target: { kind: "booking", id, booking }, focus }))
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure && error.status === 401)) complain(NO_RESPONSE);
      });
  };

  const closeDrawer = () => {
    const element = document.querySelector<HTMLElement>(".drawer");
    const opener = drawerOpener.current;
    const finish = () => {
      setDrawer(null);
      setClosing(false);
      if (opener && opener.isConnected) opener.focus();
      else cellElement(cursor.row, cursor.col)?.focus();
    };
    const out = element ? animate(element, DRAWER_OUT, { duration: DRAWER_MS, fill: "forwards" }) : null;
    if (out) {
      setClosing(true);
      out.onfinish = finish;
    } else finish();
  };

  const bandRect = (band: Band): DOMRect | null => {
    const first = cellElement(band.row, band.start)?.getBoundingClientRect();
    const last = cellElement(band.row, band.end - 1)?.getBoundingClientRect();
    if (!first || !last) return null;
    return new DOMRect(first.left, first.top, last.right - first.left, first.height);
  };

  const placeHold = async (band: Band) => {
    const view = station(band.row);
    const start = clock(minuteOf(band.start));
    const end = clock(minuteOf(band.end));
    const from = bandRect(band);
    setPaint(null);
    setPlacing(band);
    setLoss(null);
    const lost = (): Refusal => {
      setLoss({ ...band, key: Date.now() });
      return { text: `Another member took ${view.name} at ${start}. Your hold was not placed.`, polite: true };
    };
    const result = await perform(
      "Placing hold…",
      () => post<{ hold: Hold }>("/api/holds", { station_id: view.id, date, start, end }),
      () => `Hold placed: ${view.name}, ${start}–${end}. Confirm it before the timer runs out.`,
      (failure) => {
        if (failure.body.error === "slot_taken") return lost();
        if (failure.body.error === "documents_not_current") return { text: documentsCopy(date) };
        if (failure.status === 422) return { text: validationReason(failure) };
        return null;
      },
    );
    if (result) {
      const { hold } = result;
      const segment: Segment = { kind: "hold", id: hold.id, start: hold.start, end: hold.end, tail_end: hold.tail_end, status: hold.status, expires_at: hold.expires_at };
      setBoard((current) =>
        current && current.date === hold.date ? { ...current, stations: current.stations.map((s) => (s.id === hold.station_id ? { ...s, segments: [...s.segments, segment] } : s)) } : current,
      );
      if (from) flight.current = { holdId: hold.id, from };
    }
    setPlacing(null);
    void load(dateRef.current);
  };

  const resizeHold = async (holdId: string, deltaCells: number) => {
    const found = holdSegment(holdId);
    if (!found) return;
    const endMinute = minutesOf(found.segment.end) + deltaCells * CELL_MINUTES;
    if (endMinute <= minutesOf(found.segment.start)) return;
    const end = clock(endMinute);
    const result = await perform(
      "Updating hold…",
      () => call<{ hold: Hold }>("PATCH", `/api/holds/${holdId}`, { end }),
      () => `Hold now ends at ${end}.`,
      (failure) => {
        if (failure.body.error === "slot_taken") return { text: "That change collides with another booking. The hold is unchanged." };
        if (failure.body.error === "hold_expired") return { text: "This hold has expired." };
        if (failure.status === 422) return { text: validationReason(failure) };
        return null;
      },
    );
    if (result) {
      const { hold } = result;
      setBoard((current) =>
        current
          ? {
              ...current,
              stations: current.stations.map((s) => ({
                ...s,
                segments: s.segments.map((seg) => (seg.kind === "hold" && seg.id === hold.id ? { ...seg, end: hold.end, tail_end: hold.tail_end } : seg)),
              })),
            }
          : current,
      );
    }
    void load(dateRef.current);
  };

  const releaseHold = async (holdId: string) => {
    setBusy("release");
    const released = await perform(
      "Releasing hold…",
      () => call<"released">("DELETE", `/api/holds/${holdId}`).then(() => "released" as const),
      () => "Hold released.",
      (failure) => (failure.body.error === "hold_expired" ? { text: "This hold has expired." } : null),
    );
    setBusy(null);
    if (released) {
      setBoard((current) => (current ? { ...current, stations: current.stations.map((s) => ({ ...s, segments: s.segments.filter((seg) => !("id" in seg) || seg.id !== holdId) })) } : current));
      if (drawer?.target.id === holdId) setDrawer(null);
    }
    void load(dateRef.current);
  };

  const confirmHold = async (hold: HoldDetails) => {
    setBusy("confirm");
    const result = await perform(
      "Confirming booking…",
      () => post<{ booking: Booking }>(`/api/holds/${hold.id}/confirm`),
      ({ booking }) =>
        `Booking confirmed: ${hold.stationName}, ${booking.date} ${booking.start}–${booking.end}.` + (booking.payment === "payment_pending" ? " Payment pending until billing records it." : ""),
      (failure) => {
        if (failure.body.error === "hold_expired") return { text: "This hold expired before it was confirmed. Paint the slot again." };
        if (failure.body.error === "documents_not_current") return { text: documentsCopy(hold.date) };
        return null;
      },
    );
    setBusy(null);
    if (result) {
      const { booking } = result;
      const segment: Segment = { kind: "booking", id: booking.id, start: booking.start, end: booking.end, tail_end: booking.tail_end, status: booking.status, payment: booking.payment };
      setBoard((current) =>
        current
          ? {
              ...current,
              stations: current.stations.map((s) => ({ ...s, segments: [...s.segments.filter((seg) => !("id" in seg) || seg.id !== hold.id), ...(s.id === booking.station_id ? [segment] : [])] })),
            }
          : current,
      );
      setDrawer({ target: { kind: "booking", id: booking.id, booking }, focus: "title" });
    }
    void load(dateRef.current);
  };

  const cancelBooking = async (booking: Booking) => {
    setBusy("cancel");
    const result = await perform(
      "Cancelling booking…",
      () => post<{ booking: Booking }>(`/api/bookings/${booking.id}/cancel`),
      ({ booking: done }) =>
        done.fee
          ? `Booking cancelled. ${formatHours(done.prepaid_minutes)} h returned; late-cancellation fee $${done.fee.amount}.`
          : `Booking cancelled. ${formatHours(done.prepaid_minutes)} h returned to your prepaid balance.`,
      (failure) => (failure.body.error === "booking_started" ? { text: "This booking has already started and can no longer be cancelled." } : null),
    );
    setBusy(null);
    if (result) {
      setBoard((current) => (current ? { ...current, stations: current.stations.map((s) => ({ ...s, segments: s.segments.filter((seg) => !("id" in seg) || seg.id !== booking.id) })) } : current));
      setDrawer(null);
      cellElement(cursor.row, cursor.col)?.focus();
    }
    void load(dateRef.current);
  };

  // Pointer and touch painting.
  const endPaint = (commit: boolean) => {
    const current = paintRef.current;
    window.removeEventListener("pointermove", movePaint);
    window.removeEventListener("pointerup", upPaint);
    window.removeEventListener("pointercancel", cancelPaint);
    window.removeEventListener("touchmove", blockScroll);
    if (!current) return;
    const view = station(current.row);
    const fitted = fitBand(view.cells, current.anchor, current.pointer, view.tailCells);
    if (commit && fitted.band) void placeHold({ row: current.row, start: fitted.band.start, end: fitted.band.end, tailEnd: fitted.tailEnd });
    else setPaint(null);
  };

  function columnAt(row: number, clientX: number): number {
    const first = cellElement(row, 0)?.getBoundingClientRect();
    if (!first) return 0;
    return Math.max(0, Math.min(COLUMNS - 1, Math.floor((clientX - first.left) / first.width)));
  }

  function movePaint(event: PointerEvent) {
    const current = paintRef.current;
    if (!current) return;
    const column = columnAt(current.row, event.clientX);
    if (column !== current.pointer) setPaint({ ...current, pointer: column });
  }

  function upPaint() {
    endPaint(true);
  }

  function cancelPaint() {
    endPaint(false);
  }

  function blockScroll(event: TouchEvent) {
    if (paintRef.current) event.preventDefault();
  }

  const beginPaint = (row: number, col: number) => {
    setLoss(null);
    setPaint({ row, anchor: col, pointer: col });
    window.addEventListener("pointermove", movePaint);
    window.addEventListener("pointerup", upPaint);
    window.addEventListener("pointercancel", cancelPaint);
    window.addEventListener("touchmove", blockScroll, { passive: false });
  };

  const pointerDown = (event: PointerEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!target || event.button !== 0) return;
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    const cell = views[row].cells[col];
    if (cell.ownerId && cell.ownerKind) {
      event.preventDefault();
      setCursor({ row, col });
      openDrawer(cell.ownerKind, cell.ownerId, target, "title");
      return;
    }
    if (!member || cell.state !== "free" || placing) return;
    if (event.pointerType === "touch") {
      const startX = event.clientX;
      const startY = event.clientY;
      const timer = window.setTimeout(() => {
        window.removeEventListener("pointermove", abandon);
        window.removeEventListener("pointerup", clear);
        window.removeEventListener("pointercancel", clear);
        beginPaint(row, col);
      }, TOUCH_HOLD_MS);
      const clear = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", abandon);
        window.removeEventListener("pointerup", clear);
        window.removeEventListener("pointercancel", clear);
      };
      const abandon = (move: PointerEvent) => {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) > 8) clear();
      };
      window.addEventListener("pointermove", abandon);
      window.addEventListener("pointerup", clear);
      window.addEventListener("pointercancel", clear);
      return;
    }
    event.preventDefault();
    setCursor({ row, col });
    target.focus({ preventScroll: true });
    beginPaint(row, col);
  };

  // Keyboard painting: the same band, holds and server results as the pointer.
  const keyDown = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!target) return;
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    const cell = views[row].cells[col];
    const selection = paintRef.current;
    const horizontal = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (horizontal && event.shiftKey) {
      event.preventDefault();
      if (!member) return;
      if (!selection && cell.ownerKind === "hold" && cell.ownerId) {
        void resizeHold(cell.ownerId, horizontal);
        return;
      }
      if (!selection) {
        if (cell.state !== "free" || placing) return;
        const pointer = Math.max(0, Math.min(COLUMNS - 1, col + horizontal));
        setLoss(null);
        setPaint({ row, anchor: col, pointer });
        focusCell(row, pointer);
        return;
      }
      const pointer = Math.max(0, Math.min(COLUMNS - 1, selection.pointer + horizontal));
      setPaint({ ...selection, pointer });
      focusCell(row, pointer);
      return;
    }
    if (horizontal || event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (selection) setPaint(null);
      const vertical = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      focusCell(row + vertical, col + horizontal);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (selection) {
        const view = station(selection.row);
        const fitted = fitBand(view.cells, selection.anchor, selection.pointer, view.tailCells);
        if (fitted.band) void placeHold({ row: selection.row, start: fitted.band.start, end: fitted.band.end, tailEnd: fitted.tailEnd });
        else setPaint(null);
        return;
      }
      if (cell.ownerKind && cell.ownerId) openDrawer(cell.ownerKind, cell.ownerId, target, cell.ownerKind === "hold" ? "confirm" : "cancel");
      return;
    }
    if (event.key === "Escape") {
      if (selection) {
        event.preventDefault();
        setPaint(null);
      } else if (member && cell.ownerKind === "hold" && cell.ownerId) {
        event.preventDefault();
        void releaseHold(cell.ownerId);
      }
    }
  };

  // The loss shake, or its static red edge under reduced motion.
  const ghostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!loss) return;
    const ghost = ghostRef.current;
    if (!ghost) return;
    if (reducedMotion()) {
      const timer = window.setTimeout(() => setLoss((current) => (current && current.key === loss.key ? null : current)), LOSS_EDGE_MS);
      return () => window.clearTimeout(timer);
    }
    animate(ghost, [{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(7px)" }, { transform: "translateX(-5px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], {
      duration: SHAKE_MS,
    });
    animate(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, delay: SHAKE_MS, fill: "forwards" });
    return undefined;
  }, [loss?.key]);

  const shownBand: Band | null = placing ?? (fit?.band && paint ? { row: paint.row, start: fit.band.start, end: fit.band.end, tailEnd: fit.tailEnd } : null);
  const tagText = (() => {
    if (!paint || !fit?.band) return null;
    const view = station(paint.row);
    const split = costSplit((fit.band.end - fit.band.start) * CELL_MINUTES, balance ?? 0, view.rateCents);
    return `${formatDuration(split.bookedMinutes)} · ${formatHours(split.prepaidMinutes)} h prepaid + $${formatMoney(split.overageCents)}`;
  })();

  const stateOf = (row: number, col: number, cell: BoardCell): CellState => {
    if (paint && paint.row === row && fit) {
      if (fit.band && col >= fit.band.start && col < fit.band.end) return "painting";
      if (fit.band && col >= fit.band.end && col < fit.tailEnd) return "cleaning tail";
      if (fit.conflicts.has(col)) return "conflict";
    }
    if (placing && placing.row === row) {
      if (col >= placing.start && col < placing.end) return "painting";
      if (col >= placing.end && col < placing.tailEnd) return "cleaning tail";
    }
    return cell.state;
  };

  const tickets: Ticket[] = [];
  if (member && board && board.date === date) {
    for (const s of board.stations) {
      const name = kitchen.stations.find((k) => k.id === s.id)?.name ?? s.name;
      for (const segment of s.segments) {
        if (segment.kind === "occupied" || fading.includes(segment.id)) continue;
        tickets.push({
          kind: segment.kind,
          id: segment.id,
          stationName: name,
          date,
          start: segment.start,
          end: segment.end,
          state: segment.kind === "hold" ? "hold" : segment.payment === "payment_pending" ? "payment pending" : "confirmed",
          expiresAt: segment.kind === "hold" ? Date.parse(segment.expires_at) : null,
        });
      }
    }
  }

  const drawerTarget = drawer?.target.kind === "hold" ? (holdDetails(drawer.target.id) ?? drawer.target) : drawer?.target;
  const hours = Array.from({ length: 19 }, (_, i) => 5 + i);
  // Before the board opens the now line waits at its 05:00 edge, still reading the kitchen time.
  const showNow = date === today;
  const billingDown = board?.billing === "down";

  return (
    <section class="board-screen">
      <header class="board-head">
        <div class="board-head__title">
          <h1>Line board</h1>
          <p class="board-date">{longDate(date)}</p>
        </div>
        <div class="board-head__nav">
          <button type="button" class="button" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft />
            <span>Previous day</span>
          </button>
          <button type="button" class="button" onClick={() => setDate(today)} aria-current={date === today ? "date" : undefined}>
            <CalendarCheck />
            <span>Today</span>
          </button>
          <button type="button" class="button" onClick={() => setDate(addDays(date, 1))}>
            <span>Next day</span>
            <ChevronRight />
          </button>
        </div>
      </header>
      {billingDown && (
        <p role="status" aria-label="Billing status" class="banner">
          Billing is unreachable. Bookings that need a charge are confirmed with payment pending and settle automatically.
        </p>
      )}
      {member && (
        <Rail
          tickets={tickets}
          balanceMinutes={balance}
          now={now}
          onOpen={(ticket, opener) => openDrawer(ticket.kind, ticket.id, opener, "title")}
        />
      )}
      <div class={drawer ? "board-body has-drawer" : "board-body"}>
        <div class="board-frame" ref={frameRef}>
          <div class={showNow ? "board-canvas board-canvas--today" : "board-canvas"}>
            <div class="board-hours" aria-hidden="true">
              {hours.map((hour) => (
                <span key={hour} class="board-hour num" style={{ "--col": String(columnOf(hour * 60)) }}>
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            <div role="grid" aria-label="Line board" aria-rowcount={views.length} aria-colcount={COLUMNS + 1} class={member ? "grid grid--paintable" : "grid"} ref={gridRef} onPointerDown={pointerDown} onKeyDown={keyDown}>
              {views.map((view, row) => (
                <div role="row" key={view.id} class="row" aria-rowindex={row + 1}>
                  <div role="rowheader" class="rowheader">
                    <span class="rowheader__name">{view.name}</span>
                    <span class="rowheader__meta num">
                      ${formatMoney(view.rateCents)}/h · {view.tailCells * CELL_MINUTES} min clean
                    </span>
                  </div>
                  {view.cells.map((cell, col) => {
                    const state = stateOf(row, col, cell);
                    const minute = minuteOf(col);
                    return (
                      <div
                        key={col}
                        role="gridcell"
                        data-row={row}
                        data-col={col}
                        tabIndex={cursor.row === row && cursor.col === col ? 0 : -1}
                        aria-label={`${view.name}, ${clock(minute)}, ${state}`}
                        class={`cell cell--${state.replace(" ", "-")}${minute % 60 === 45 ? " cell--hour-end" : ""}`}
                      />
                    );
                  })}
                  <SpanLayer view={view} row={row} role={user.role} fit={paint && paint.row === row ? fit : null} band={shownBand && shownBand.row === row ? shownBand : null} pending={placing !== null && placing.row === row} cursorCol={cursor.row === row ? cursor.col : null} />
                  {loss && loss.row === row && (
                    <div class="row__layer" aria-hidden="true">
                      <div ref={ghostRef} key={loss.key} class={reducedMotion() ? "band band--lost band--lost-static" : "band band--lost"} style={{ "--start": String(loss.start), "--len": String(loss.end - loss.start) }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {showNow && (
              <div class="now-line" style={{ "--col-exact": String(Math.max(0, nowMinute - BOARD_OPENS) / CELL_MINUTES) }}>
                <span class="now-line__label num">Now {clock(nowMinute)}</span>
              </div>
            )}
            {tagText && paint && fit?.band && <CostTag text={tagText} row={paint.row} column={fit.tailEnd} above={paint.row === views.length - 1} />}
          </div>
        </div>
        {drawer && drawerTarget && (
          <div class={closing ? "drawer-slot is-closing" : "drawer-slot"}>
            <Drawer
              target={drawerTarget}
              focus={drawer.focus}
              balanceMinutes={balance ?? 0}
              now={now}
              timeZone={zone}
              busy={busy}
              canCancel={member}
              onClose={closeDrawer}
              onConfirm={(hold) => void confirmHold(hold)}
              onRelease={(hold) => void releaseHold(hold.id)}
              onCancel={(booking) => void cancelBooking(booking)}
            />
          </div>
        )}
      </div>
    </section>
  );
}

interface LayerProps {
  view: StationView;
  row: number;
  role: Session["user"]["role"];
  fit: ReturnType<typeof fitBand> | null;
  band: Band | null;
  pending: boolean;
  cursorCol: number | null;
}

/** Below this many cells a hold's label is only its time range; the yellow frame already says hold. */
const SHORT_SPAN_CELLS = 6;

/** Spans, the painted band with its tail, and conflict runs, drawn over the row's cells. */
function SpanLayer({ view, role, fit, band, pending, cursorCol }: LayerProps) {
  const conflictWithin = (start: number, end: number) => fit !== null && [...fit.conflicts.keys()].some((column) => column >= start && column < end);
  return (
    <div class="row__layer" aria-hidden="true">
      {view.segments.map((segment, index) => {
        const start = columnOf(minutesOf(segment.start));
        if (segment.kind === "occupied" || role === "operator") {
          const end = columnOf(minutesOf(segment.kind === "occupied" ? segment.end : segment.tail_end));
          const label = segment.kind !== "occupied" ? segment.business_name ?? "" : "";
          const pendingPay = segment.kind === "booking" && segment.payment === "payment_pending";
          return (
            <div key={`o${index}`} class={role === "operator" && segment.kind !== "occupied" ? `span span--named span--${segment.kind}` : "span span--occupied"} style={{ "--start": String(start), "--len": String(end - start) }}>
              {label && !conflictWithin(start, end) && <span class="span__label">{label}</span>}
              {pendingPay && <span class="stamp stamp--small">Payment pending</span>}
            </div>
          );
        }
        const bodyEnd = columnOf(minutesOf(segment.end));
        const tailEnd = columnOf(minutesOf(segment.tail_end));
        return (
          <div key={segment.id} data-span={segment.id} class={`span-group span-group--${segment.kind}`} style={{ "--start": String(start), "--len": String(tailEnd - start), "--body": String(bodyEnd - start) }}>
            <div class={`span span--${segment.kind}`} style={{ "--start": "0", "--len": String(bodyEnd - start) }}>
              {!conflictWithin(start, tailEnd) && (
                <span class={bodyEnd - start < SHORT_SPAN_CELLS ? "span__label span__label--short num" : "span__label num"}>
                  {segment.kind === "hold" && bodyEnd - start >= SHORT_SPAN_CELLS ? "Hold " : ""}
                  {segment.start}–{segment.end}
                </span>
              )}
              {segment.kind === "booking" && segment.payment === "payment_pending" && <span class="stamp stamp--small stamp--inverse">Payment pending</span>}
            </div>
            {tailEnd > bodyEnd && <div class="span span--tail" style={{ "--start": String(bodyEnd - start), "--len": String(tailEnd - bodyEnd) }} />}
          </div>
        );
      })}
      {band && (
        <>
          <div class={pending ? "band band--pending" : "band"} style={{ "--start": String(band.start), "--len": String(band.end - band.start) }} />
          {band.tailEnd > band.end && <div class="band-tail" style={{ "--start": String(band.end), "--len": String(band.tailEnd - band.end) }} />}
        </>
      )}
      {fit &&
        runs(fit.conflicts).map((run) => (
          // The label starts after the cursor's cell so the cursor frame never cuts it.
          <div
            key={`c${run.start}`}
            class="conflict"
            style={{ "--start": String(run.start), "--len": String(run.end - run.start), "--label-at": String(cursorCol !== null && cursorCol >= run.start && cursorCol < run.end ? cursorCol + 1 - run.start : 0) }}
          >
            <span class="conflict__label">{run.value}</span>
          </div>
        ))}
    </div>
  );
}
