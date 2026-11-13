// The Board: ticket column (tenant) or door list (staff), the isometric floor plan and the hour rail.
// Pending actions, refusal copy and lifted pieces live here, so no refresh can undo what the user is doing.

import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Booking, DoorAction, DoorEntry, DoorList, Floor, Interval } from "../../shared/api.js";
import { clockText, dateLabel, MINUTE_MS } from "../../shared/clock.js";
import { bookingMinutes, duration } from "../../shared/format.js";
import { bandHeight, coolerFreeRows, extrusion, stationMetrics, stationState } from "../../shared/metrics.js";
import { api, newKey } from "../api.js";
import type { Session } from "../App.js";
import { Shell } from "../App.js";
import { DoorCard, TicketCard, type CheckOutFinish, type TicketPending } from "../board/Cards.js";
import { CheckOutDialog, StationDialog, type CheckOutOutcome, type ShelfChoice } from "../board/Dialogs.js";
import { FloorPlan, type SlabDrop, type StationModel } from "../board/FloorPlan.js";
import { stepTarget } from "../board/grid.js";
import { HourRail } from "../board/HourRail.js";
import { boardUrl, doorEntryFrom, expiredHold, firstFieldSentence, listed, readView, withInterval, withoutInterval, type View } from "../board/model.js";
import {
  bookingDate, cancelCopy, claimCopy, confirmCopy, coolerLine, doorCopy, FLOOR_STALE, GENERIC, meStatusLabel, moveCopy, SLAB, spanHint, spanText,
  stationsText,
} from "../copy.js";
import { holdSecondsLeft, instantAt, isoAt, kitchenToday } from "../kitchen.js";
import { navigate, type Screen } from "../router.js";
import { useRefresh } from "../refresh.js";
import { announce, Icon, Notice, ScreenHeading, tell, TicketStub, type NoticeState } from "../ui.js";
import { DateGroup } from "./DateGroup.js";

const FLOOR_EVERY_MS = 10_000;
const DOOR_EVERY_MS = 15_000;
const JUST_TAKEN_MS = 5_000;
const TAP_SLOP_PX = 8;
const SLAB_SOURCE = "slab";

interface OpenStation {
  id: string;
  name: string;
  claimShelves: readonly ShelfChoice[] | null;
  intervals: readonly Interval[];
  opener: SVGGElement;
}

/** What is lifted off the Board: the claim slab, or one booking's Move booking. `press` lifts accept a click on a station as the drop. */
type Lift = { kind: "slab"; via: "key" } | { kind: "move"; id: string; via: "key" | "press" };

interface Drag {
  x: number;
  y: number;
  over: string | null;
  label: string;
  /** The extra text on the ghost: the span's length, or nothing for a booking. */
  detail: string;
}

/** Where focus goes once the next commit has drawn it. */
type FocusTarget = { card: string } | { station: string } | { move: string } | { slab: true } | null;

type NoteKind = "refusal" | "result";
interface Note {
  kind: NoteKind;
  notice: NoticeState;
}

function useWide(): boolean {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setWide(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return wide;
}

/** A notice shown without announcing it again (its message was announced where the request started). */
const quiet = (text: string): NoticeState => ({ text, tone: "info" });

export function Board({ session, screen, search }: { session: Session; screen: Screen; search: string }): JSX.Element {
  const { kitchen, me } = session;
  const tenant = me.role === "tenant";
  const { view, canonical } = readView(search, kitchenToday(kitchen));
  const { date, from, to } = view;
  const spanMinutes = to - from;
  const spanLabel = `${clockText(from)}–${clockText(to)}`;
  const wide = useWide();

  const [floor, setFloor] = useState<Floor | null>(null);
  const [floorStale, setFloorStale] = useState<NoticeState | null>(null);
  const [tickets, setTickets] = useState<Booking[]>([]);
  const [entering, setEntering] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Readonly<Record<string, TicketPending>>>({});
  const [notes, setNotes] = useState<Readonly<Record<string, Note>>>({});
  const [door, setDoorState] = useState<DoorEntry[]>([]);
  const [doorPending, setDoorPending] = useState<Readonly<Record<string, DoorAction>>>({});
  const [doorNotes, setDoorNotes] = useState<Readonly<Record<string, NoticeState>>>({});
  const [, setSecond] = useState(0);
  const [, redraw] = useState(0);
  const [justTaken, setJustTaken] = useState<ReadonlySet<string>>(new Set());
  const [lift, setLift] = useState<Lift | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [slab, setSlab] = useState<SlabDrop | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [slabNotice, setSlabNotice] = useState<NoticeState | null>(null);
  const [dialog, setDialog] = useState<OpenStation | null>(null);
  const [dialogNotice, setDialogNotice] = useState<NoticeState | null>(null);
  const [checkout, setCheckout] = useState<{ entry: DoorEntry; opener: HTMLButtonElement; finish: CheckOutFinish } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** The first floor and column reads have answered (either way); until then the board is laid out but not shown, so nothing on it moves when they land. */
  const [firstRead, setFirstRead] = useState({ floor: false, column: false });

  const liftRef = useRef<Lift | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean; source: string; cancelled: boolean } | null>(null);
  const swallowClick = useRef(false);
  const serial = useRef(0);
  const epoch = useRef(0);
  const focusWant = useRef<FocusTarget>(null);
  const pendingRef = useRef<Record<string, TicketPending>>({});
  const doorPendingRef = useRef<Record<string, DoorAction>>({});
  const doorRef = useRef<DoorEntry[]>([]);
  const doorDate = useRef<string | null>(null);
  const summaryDue = useRef<string | null>(null);
  const listedDate = useRef<string | null>(null);
  const rereadAtZero = useRef(new Set<string>());
  const ticketsRef = useRef<Booking[]>([]);
  const slabRef = useRef<HTMLButtonElement>(null);
  const claimButton = useRef<HTMLButtonElement>(null);
  const planBox = useRef<HTMLDivElement>(null);
  ticketsRef.current = tickets;

  // ---- Small state helpers ------------------------------------------------------------

  const setDoor = (next: DoorEntry[]): void => {
    doorRef.current = next;
    setDoorState(next);
  };

  const setPendingOf = (id: string, value: TicketPending | null): void => {
    const next = { ...pendingRef.current };
    if (value) next[id] = value;
    else delete next[id];
    pendingRef.current = next;
    setPending(next);
  };

  const setDoorPendingOf = (id: string, value: DoorAction | null): void => {
    const next = { ...doorPendingRef.current };
    if (value) next[id] = value;
    else delete next[id];
    doorPendingRef.current = next;
    setDoorPending(next);
  };

  const setNote = (id: string, kind: NoteKind, notice: NoticeState): void => setNotes((prev) => ({ ...prev, [id]: { kind, notice } }));

  const clearRefusals = (): void => setNotes((prev) => Object.fromEntries(Object.entries(prev).filter(([, note]) => note.kind !== "refusal")));

  const focusAfter = (want: FocusTarget): void => {
    focusWant.current = want;
    redraw((n) => n + 1);
  };

  /** Hands the next commit's focus to the element that should have it, once it exists. */
  useLayoutEffect(() => {
    const want = focusWant.current;
    if (!want) return;
    let el: HTMLElement | SVGElement | null = null;
    if ("card" in want) el = document.querySelector(`article[data-booking-id="${want.card}"]`);
    else if ("station" in want) el = document.querySelector(`[data-station-id="${want.station}"]`);
    else if ("move" in want) el = document.querySelector(`button[data-move="${want.move}"]`);
    else el = slabRef.current;
    if (!el) return;
    focusWant.current = null;
    el.focus();
  });

  useLayoutEffect(() => {
    if (!canonical) navigate(boardUrl(view), { replace: true });
  }, [search]);

  useLayoutEffect(() => {
    const box = planBox.current;
    if (!box) return;
    const measure = (): void => setSize({ width: Math.floor(box.clientWidth), height: Math.floor(box.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // A new date or span removes the refusal copy; a new date also forgets every card's outcome copy.
  useEffect(() => {
    setSlabNotice(null);
    setDialogNotice(null);
    clearRefusals();
  }, [date, from, to]);
  useEffect(() => {
    setNotes({});
    setDoorNotes({});
    setEntering(new Set());
    summaryDue.current = date;
  }, [date]);

  // ---- Reads: the floor, the ticket column and the door list ---------------------------------

  const reloadFloor = useRefresh(async (current) => {
    const ask = view;
    const sent = epoch.current;
    const result = await api<Floor>("GET", `/api/floor?date=${ask.date}&from=${clockText(ask.from)}&to=${clockText(ask.to)}`);
    setFirstRead((r) => (r.floor ? r : { ...r, floor: true }));
    if (!current() || sent !== epoch.current) return;
    if (result.ok) {
      setFloor(result.data);
      setFloorStale(null);
    } else if (result.status !== 401) {
      setFloorStale(tell(FLOOR_STALE, "outage"));
    }
  }, FLOOR_EVERY_MS, [date, from, to]);

  /** Lists the column afresh when the date changed; otherwise keeps every card already there and updates it. */
  useRefresh(async (current) => {
    if (!tenant) return;
    const sent = epoch.current;
    const result = await api<{ bookings: Booking[] }>("GET", "/api/bookings");
    setFirstRead((r) => (r.column ? r : { ...r, column: true }));
    if (!current() || sent !== epoch.current || !result.ok) return;
    const fresh = result.data.bookings;
    const afresh = listedDate.current !== date;
    listedDate.current = date;
    const before = ticketsRef.current;
    const kept = new Set(afresh ? [] : before.map((b) => b.id));
    const next = fresh.filter((b) => !expiredHold(b) && (listed(b, date) || kept.has(b.id)))
      .map((b) => (pendingRef.current[b.id] ? before.find((x) => x.id === b.id) ?? b : b));
    const holding = document.activeElement?.closest("article[data-booking-id]")?.getAttribute("data-booking-id");
    if (holding && !next.some((b) => b.id === holding) && before.some((b) => b.id === holding)) focusWant.current = { slab: true };
    setTickets(next);
    setEntering(new Set());
  }, FLOOR_EVERY_MS, [date]);

  /** Reads one booking again after a refusal and puts the truth on its card. */
  const reread = async (id: string): Promise<Booking | null> => {
    const sent = epoch.current;
    const result = await api<Booking>("GET", `/api/bookings/${id}`);
    if (!result.ok || sent !== epoch.current) return null;
    setTickets((prev) => prev.map((b) => (b.id === id ? result.data : b)));
    return result.data;
  };

  const reloadDoor = useRefresh(async (current) => {
    if (tenant) return;
    const ask = date;
    const sent = epoch.current;
    const result = await api<DoorList>("GET", `/api/door?date=${ask}`);
    setFirstRead((r) => (r.column ? r : { ...r, column: true }));
    if (!current() || sent !== epoch.current) return;
    if (!result.ok) {
      if (result.status !== 401) setFloorStale(tell(FLOOR_STALE, "outage"));
      return;
    }
    const fresh = result.data.entries;
    const before = doorRef.current;
    if (summaryDue.current === ask) {
      summaryDue.current = null;
      announce(doorCopy.summary(result.data.date, fresh));
    } else if (doorDate.current === ask) {
      for (const entry of fresh) {
        const drawn = before.find((x) => x.bookingId === entry.bookingId);
        if (drawn && drawn.status !== entry.status && !doorPendingRef.current[entry.bookingId]) announce(doorCopy.change(entry));
      }
    }
    doorDate.current = ask;
    setDoor(fresh.map((entry) => (doorPendingRef.current[entry.bookingId] ? before.find((x) => x.bookingId === entry.bookingId) ?? entry : entry)));
  }, DOOR_EVERY_MS, [date]);

  /** The door entry as the server reads it now, after a refused door action. */
  const refetchEntry = async (id: string): Promise<void> => {
    const result = await api<DoorList>("GET", `/api/door?date=${date}`);
    const entry = result.ok ? result.data.entries.find((e) => e.bookingId === id) : undefined;
    if (entry) setDoor(doorRef.current.map((x) => (x.bookingId === id ? entry : x)));
  };

  // The held countdown ticks every second; a confirm that ended in a network failure re-reads at zero.
  useEffect(() => {
    if (!tenant) return undefined;
    const tick = window.setInterval(() => {
      setSecond((n) => n + 1);
      for (const id of [...rereadAtZero.current]) {
        const b = ticketsRef.current.find((x) => x.id === id);
        if (!b) rereadAtZero.current.delete(id);
        else if (!pendingRef.current[id] && holdSecondsLeft(b.holdExpiresAt, kitchen.holdSeconds) === 0) {
          rereadAtZero.current.delete(id);
          void reread(id);
        }
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  // ---- The stack ---------------------------------------------------------------------------

  // Until the chosen date's floor arrives the last stack stays, following the span on its own date.
  const floorDate = floor?.date ?? date;
  const spanStart = instantAt(kitchen, floorDate, from);
  const spanEnd = instantAt(kitchen, floorDate, to);
  const spanOf = Math.round((spanEnd - spanStart) / MINUTE_MS);
  const hint = spanHint(spanMinutes, kitchen.minimumBookingMinutes, floor?.date === date ? floor.spanStatus : null);
  const models: StationModel[] = (floor?.stations ?? []).map((s) => {
    const metrics = stationMetrics(s.intervals.map((i) => ({ start: Date.parse(i.start), end: Date.parse(i.end), bufferEnd: Date.parse(i.bufferEnd) })), spanStart, spanEnd);
    const taken = justTaken.has(s.id);
    return {
      id: s.id, name: s.name, kind: s.kind, col: s.col, row: s.row,
      state: taken ? "taken" : stationState(metrics),
      label: taken ? "just taken" : metrics.freeMinutes > 0 ? `${duration(metrics.freeMinutes)} free of ${duration(spanOf)}` : "full",
      extrusion: extrusion(metrics),
      bandPx: bandHeight(metrics),
      freeMinutes: metrics.freeMinutes,
    };
  });
  const shelves = models.filter((m) => m.kind === "cooler_shelf");
  const coolerRows = floor
    ? coolerFreeRows(floor.stations.filter((s) => s.kind === "cooler_shelf").map((s) => s.intervals.map((i) => ({ start: Date.parse(i.start), end: Date.parse(i.end), bufferEnd: Date.parse(i.bufferEnd) }))), floor.date, kitchen.timeZone)
    : null;
  const shelvesFree = shelves.filter((m) => m.freeMinutes === spanOf).length;

  const setView = (next: View, push: boolean): void => navigate(boardUrl(next), { replace: !push });

  const markTaken = (ids: readonly string[]): void => {
    setJustTaken((prev) => new Set([...prev, ...ids]));
    window.setTimeout(() => setJustTaken((prev) => new Set([...prev].filter((id) => !ids.includes(id)))), JUST_TAKEN_MS);
  };

  const showFloor = (change: (stations: Floor["stations"]) => Floor["stations"]): void =>
    setFloor((prev) => prev && { ...prev, stations: change(prev.stations) });

  // ---- Lifting and dropping ----------------------------------------------------------------

  const startLift = (next: Lift): void => {
    liftRef.current = next;
    setLift(next);
    setTarget((models.find((m) => m.state === "free") ?? models[0])?.id ?? null);
    announce(next.kind === "slab" ? SLAB.lift : (() => {
      const b = ticketsRef.current.find((x) => x.id === next.id);
      return b ? SLAB.moveLift(b.stationName, spanText(b)) : SLAB.lift;
    })());
  };

  const clearLift = (): void => {
    liftRef.current = null;
    setLift(null);
    setTarget(null);
  };

  const returnLift = (): void => {
    if (!liftRef.current) return;
    clearLift();
    announce(SLAB.returned);
  };

  /** Claims a station for the span, alone or with a walk-in shelf; `origin` decides where focus and copy go. */
  const claim = async (stationId: string, origin: "pointer" | "keyboard" | "dialog", shelfId: string | null = null): Promise<void> => {
    const station = models.find((m) => m.id === stationId);
    const shelf = shelfId ? models.find((m) => m.id === shelfId) : undefined;
    if (!station || hint !== null || claiming) return;
    const names = stationsText(station.name, shelf?.name ?? null);
    const occupied = shelf ? [stationId, shelf.id] : [stationId];
    const show = (notice: NoticeState): void => (origin === "dialog" ? setDialogNotice(notice) : setSlabNotice(notice));
    clearLift();
    clearRefusals();
    setSlabNotice(null);
    setClaiming(true);
    const mine = ++serial.current;
    setSlab({ stationIds: occupied, phase: "resting", text: spanLabel, serial: mine });
    show(tell(claimCopy.pending(names)));
    const result = await api<Booking>("POST", "/api/bookings", {
      json: { stationId, start: isoAt(kitchen, date, from), end: isoAt(kitchen, date, to), shelfId }, key: newKey(),
    });
    epoch.current++;
    setClaiming(false);
    if (result.ok) {
      const held = result.data;
      showFloor((stations) => withInterval(stations, floorDate, held));
      setSlab(null);
      setDialog(null);
      setTickets((prev) => [held, ...prev.filter((b) => b.id !== held.id)]);
      setEntering((prev) => new Set(prev).add(held.id));
      focusAfter({ card: held.id });
      setSlabNotice(tell(claimCopy.held(names, spanLabel, holdSecondsLeft(held.holdExpiresAt, kitchen.holdSeconds))));
      void reloadFloor();
      return;
    }
    const code = result.error?.error;
    if (result.status === 409 && code === "slot_taken") {
      setSlab((current) => (current && current.serial === mine ? { ...current, phase: "lifting" } : current));
      markTaken(occupied);
      setDialog(null);
      setSlabNotice(tell(claimCopy.taken(names), "conflict"));
      await reloadFloor();
      focusAfter({ station: stationId });
      return;
    }
    setSlab((current) => (current && current.serial === mine ? { ...current, phase: "returning" } : current));
    if (result.status === 401) return;
    if (result.status === 409 && code === "tenant_not_approved") {
      const fresh = await session.refreshMe();
      show(tell(claimCopy.notApproved(meStatusLabel(fresh ?? me)), "conflict"));
    } else if (result.status === 409 && code === "documents_not_valid") {
      show(tell(claimCopy.documents(dateLabel(date)), "conflict"));
    } else if (result.status === 409 && code === "insufficient_hours") {
      show(tell(claimCopy.hours(bookingMinutes(spanMinutes, occupied.length)), "conflict"));
    } else if (result.status === 429) {
      show(tell(claimCopy.limit(result.retryAfter ?? 1), "conflict"));
    } else if (result.status === 422) {
      show(tell(firstFieldSentence(result.error?.fields) ?? claimCopy.network, "conflict"));
    } else {
      show(tell(claimCopy.network, "outage"));
    }
    if (origin === "dialog") claimButton.current?.focus();
    else focusAfter({ slab: true });
  };

  /** Moves a confirmed booking to a station for the rail's span and date, keeping its shelf. */
  const move = async (booking: Booking, stationId: string): Promise<void> => {
    const station = models.find((m) => m.id === stationId);
    if (!station || hint !== null || pendingRef.current[booking.id]) return;
    const names = stationsText(station.name, booking.shelfName);
    const occupied = booking.shelfId ? [stationId, booking.shelfId] : [stationId];
    clearLift();
    clearRefusals();
    setPendingOf(booking.id, "move");
    const mine = ++serial.current;
    setSlab({ stationIds: occupied, phase: "resting", text: spanLabel, serial: mine });
    setNote(booking.id, "refusal", tell(moveCopy.pending(names)));
    const result = await api<Booking>("POST", `/api/bookings/${booking.id}/move`, {
      json: { stationId, start: isoAt(kitchen, date, from), end: isoAt(kitchen, date, to), shelfId: booking.shelfId }, key: newKey(),
    });
    epoch.current++;
    setPendingOf(booking.id, null);
    if (result.ok) {
      const moved = result.data;
      showFloor((stations) => withInterval(withoutInterval(stations, floorDate, booking), floorDate, moved));
      setSlab(null);
      setTickets((prev) => prev.map((b) => (b.id === moved.id ? moved : b)));
      setNote(booking.id, "result", tell(moveCopy.done(moved, (moved.debitedMinutes ?? 0) - (booking.debitedMinutes ?? 0))));
      focusAfter({ card: moved.id });
      void reloadFloor();
      return;
    }
    const code = result.error?.error;
    if (result.status === 409 && code === "slot_taken") {
      setSlab((current) => (current && current.serial === mine ? { ...current, phase: "lifting" } : current));
      markTaken([stationId]);
      setNote(booking.id, "refusal", tell(claimCopy.taken(names), "conflict"));
      await reloadFloor();
      focusAfter({ station: stationId });
      return;
    }
    setSlab((current) => (current && current.serial === mine ? { ...current, phase: "returning" } : current));
    if (result.status === 401) return;
    const showMove = (text: string, tone: "conflict" | "outage" = "conflict"): void => setNote(booking.id, "refusal", tell(text, tone));
    if (result.status === 409) {
      const truth = await reread(booking.id);
      if (code === "invalid_transition" || code === "past_cutoff" || code === "move_limit_reached") showMove(moveCopy.refused);
      else if (code === "insufficient_hours") showMove(moveCopy.hours(bookingMinutes(spanMinutes, occupied.length) - (booking.debitedMinutes ?? 0)));
      else if (code === "tenant_not_approved") showMove(claimCopy.notApproved(meStatusLabel((await session.refreshMe()) ?? me)));
      else if (code === "documents_not_valid") showMove(claimCopy.documents(dateLabel(date)));
      else showMove(moveCopy.refused);
      focusAfter(truth?.movable === true ? { move: booking.id } : { card: booking.id });
    } else if (result.status === 422) {
      showMove(firstFieldSentence(result.error?.fields) ?? GENERIC);
      focusAfter({ move: booking.id });
    } else {
      showMove(GENERIC, "outage");
      focusAfter({ move: booking.id });
    }
  };

  const confirmBooking = async (booking: Booking): Promise<void> => {
    setPendingOf(booking.id, "confirm");
    setNote(booking.id, "result", tell(confirmCopy.pending));
    const result = await api<Booking>("POST", `/api/bookings/${booking.id}/confirm`);
    epoch.current++;
    setPendingOf(booking.id, null);
    focusAfter({ card: booking.id });
    if (result.ok) {
      setTickets((prev) => prev.map((b) => (b.id === booking.id ? result.data : b)));
      setNote(booking.id, "result", tell(confirmCopy.done(result.data)));
      void reloadFloor();
      return;
    }
    if (result.status === 401) return;
    if (result.status === 0 || result.status >= 500) {
      setNote(booking.id, "result", tell(GENERIC, "outage"));
      rereadAtZero.current.add(booking.id);
      return;
    }
    const truth = await reread(booking.id);
    if (truth && expiredHold(truth)) setNote(booking.id, "result", tell(confirmCopy.expired(booking.stationName), "conflict"));
    else if (result.error?.error === "documents_not_valid") setNote(booking.id, "result", tell(claimCopy.documents(bookingDate(booking)), "conflict"));
    else setNote(booking.id, "result", tell(confirmCopy.other, "conflict"));
    void reloadFloor();
  };

  const cancel = async (booking: Booking): Promise<void> => {
    setPendingOf(booking.id, "cancel");
    setNote(booking.id, "result", tell(cancelCopy.pending));
    const result = await api<Booking>("POST", `/api/bookings/${booking.id}/cancel`);
    epoch.current++;
    setPendingOf(booking.id, null);
    focusAfter({ card: booking.id });
    if (result.ok) {
      showFloor((stations) => withoutInterval(stations, floorDate, booking));
      setTickets((prev) => prev.map((b) => (b.id === booking.id ? result.data : b)));
      setNote(booking.id, "result", tell(cancelCopy.done(result.data)));
      void reloadFloor();
      return;
    }
    if (result.status === 401) return;
    if (result.status === 0 || result.status >= 500) {
      setNote(booking.id, "result", tell(GENERIC, "outage"));
      return;
    }
    const truth = await reread(booking.id);
    setNote(booking.id, "result", tell(truth && expiredHold(truth) ? confirmCopy.expired(booking.stationName) : cancelCopy.refused, "conflict"));
    void reloadFloor();
  };

  const dropLift = (stationId: string, origin: "pointer" | "keyboard"): void => {
    const current = liftRef.current;
    if (!current) return;
    if (current.kind === "slab") {
      void claim(stationId, origin);
      return;
    }
    const booking = ticketsRef.current.find((b) => b.id === current.id);
    if (booking) void move(booking, stationId);
    else clearLift();
  };

  // ---- Keyboard and pointer handling for the slab and Move booking --------------------------

  const liftedKeys = (event: KeyboardEvent): boolean => {
    if (!liftRef.current) return false;
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const next = stepTarget(models, target ?? models[0]?.id ?? "", event.key);
      const model = models.find((m) => m.id === next);
      setTarget(next);
      if (model) announce(SLAB.target(model.name, model.label));
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      swallowClick.current = true;
      if (target) dropLift(target, "keyboard");
    } else if (event.key === "Escape") {
      event.preventDefault();
      returnLift();
    } else {
      return false;
    }
    return true;
  };

  const slabKeys = (event: KeyboardEvent): void => {
    if (liftedKeys(event)) return;
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (hint !== null || models.length === 0) return;
    startLift({ kind: "slab", via: "key" });
  };

  // While anything is lifted or dragged, Escape puts it back whatever has focus.
  useEffect(() => {
    if (!lift && !drag) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (dragRef.current) {
        dragRef.current.cancelled = true;
        setDrag(null);
      }
      returnLift();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lift !== null, drag !== null]);

  const stationAt = (x: number, y: number): string | null =>
    document.elementFromPoint(x, y)?.closest("[data-station-id]")?.getAttribute("data-station-id") ?? null;

  const endDrag = (): void => {
    dragRef.current = null;
    setDrag(null);
  };

  /** Pointer and finger drags for the slab and for Move booking; a press that never moves is a tap. */
  const dragHandlers = (source: string, enabled: boolean, label: string, detail: string): JSX.HTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (e) => {
      if (!enabled || e.button !== 0 || claiming) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { x: e.clientX, y: e.clientY, moved: false, source, cancelled: false };
    },
    onPointerMove: (e) => {
      const start = dragRef.current;
      if (!start || start.source !== source || start.cancelled) return;
      if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_SLOP_PX) return;
      start.moved = true;
      setDrag({ x: e.clientX, y: e.clientY, over: stationAt(e.clientX, e.clientY), label, detail });
    },
    onPointerUp: (e) => {
      const start = dragRef.current;
      endDrag();
      if (!start?.moved) return;
      swallowClick.current = true;
      window.setTimeout(() => {
        swallowClick.current = false;
      }, 0);
      const over = start.cancelled ? null : stationAt(e.clientX, e.clientY);
      if (!over) return;
      if (source === SLAB_SOURCE) void claim(over, "pointer");
      else {
        const booking = ticketsRef.current.find((b) => `move:${b.id}` === source);
        if (booking) void move(booking, over);
      }
    },
    onPointerCancel: endDrag,
  });

  const moveProps = (booking: Booking): JSX.HTMLAttributes<HTMLButtonElement> => {
    const mineLifted = lift?.kind === "move" && lift.id === booking.id;
    return {
      ...dragHandlers(`move:${booking.id}`, hint === null && !pendingRef.current[booking.id], `Moving ${booking.stationName}`, spanLabel),
      onClick: () => {
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        if (hint !== null || pendingRef.current[booking.id]) return;
        if (mineLifted) returnLift();
        else startLift({ kind: "move", id: booking.id, via: "press" });
      },
      onKeyDown: (e) => {
        if (mineLifted) {
          liftedKeys(e);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          swallowClick.current = true;
          if (hint === null && !pendingRef.current[booking.id]) startLift({ kind: "move", id: booking.id, via: "key" });
        }
      },
      onKeyUp: (e) => {
        if (swallowClick.current && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          window.setTimeout(() => {
            swallowClick.current = false;
          }, 0);
        }
      },
      onBlur: (e) => {
        const next = e.relatedTarget;
        if (!mineLifted || (lift.kind === "move" && lift.via === "press" && next instanceof Element && next.closest("[data-station-id]"))) return;
        returnLift();
      },
    };
  };

  // ---- Door actions --------------------------------------------------------------------------

  const updateEntry = (id: string, booking: Booking): void =>
    setDoor(doorRef.current.map((e) => (e.bookingId === id ? doorEntryFrom(e, booking) : e)));

  const setDoorNote = (id: string, notice: NoticeState): void => setDoorNotes((prev) => ({ ...prev, [id]: notice }));

  const doorAct = async (entry: DoorEntry, action: "check_in" | "no_show"): Promise<boolean> => {
    const id = entry.bookingId;
    setDoorPendingOf(id, action);
    setDoorNote(id, tell(action === "check_in" ? doorCopy.checkInPending : doorCopy.noShowPending));
    const result = await api<Booking>("POST", `/api/bookings/${id}/${action === "check_in" ? "check-in" : "no-show"}`);
    epoch.current++;
    if (result.ok) {
      updateEntry(id, result.data);
      setDoorNote(id, tell(action === "check_in" ? doorCopy.checkedIn(entry.tenantName, entry.stationName) : doorCopy.noShow));
      setDoorPendingOf(id, null);
      void reloadDoor();
      return true;
    }
    if (result.status === 401) return false;
    if (result.status === 0 || result.status >= 500) {
      setDoorNote(id, tell(GENERIC, "outage"));
      setDoorPendingOf(id, null);
      return false;
    }
    await refetchEntry(id);
    const code = result.error?.error;
    if (action === "no_show") setDoorNote(id, tell(code === "too_early" ? doorCopy.tooEarly : doorCopy.noShowOther, "conflict"));
    else if (code === "not_cleared") setDoorNote(id, tell(doorCopy.notCleared(entry.reason ?? "not_approved"), "conflict"));
    else if (code === "outside_check_in_window") setDoorNote(id, tell(doorCopy.window, "conflict"));
    else setDoorNote(id, tell(doorCopy.checkInOther, "conflict"));
    setDoorPendingOf(id, null);
    return false;
  };

  const checkOutBusy = (entry: DoorEntry, busy: boolean): void => {
    setDoorPendingOf(entry.bookingId, busy ? "check_out" : null);
    if (busy) setDoorNote(entry.bookingId, quiet(doorCopy.checkOutPending));
  };

  const checkOutDone = async (outcome: CheckOutOutcome): Promise<void> => {
    const current = checkout;
    if (!current) return;
    const id = current.entry.bookingId;
    epoch.current++;
    setCheckout(null);
    focusAfter({ card: id });
    if (outcome.kind === "done") {
      updateEntry(id, outcome.booking);
      setDoorNote(id, tell(doorCopy.checkedOut));
      setDoorPendingOf(id, null);
      current.finish(true);
      void reloadDoor();
      return;
    }
    await refetchEntry(id);
    setDoorNote(id, tell(doorCopy.checkOutOther, "conflict"));
    setDoorPendingOf(id, null);
    current.finish(false);
  };

  // ---- Opening a station ---------------------------------------------------------------------

  /** The dialog's bookings list and shelf options are worked out here and stay as they are while it is open. */
  const openStation = (id: string, opener: SVGGElement): void => {
    if (liftRef.current?.kind === "move" && liftRef.current.via === "press") {
      dropLift(id, "pointer");
      return;
    }
    const station = floor?.stations.find((s) => s.id === id);
    if (!station) return;
    setDialogNotice(null);
    setDialog({
      id, name: station.name, opener,
      intervals: station.intervals.filter((i) => Date.parse(i.start) < spanEnd && Date.parse(i.bufferEnd) > spanStart),
      claimShelves: station.kind === "cooler_shelf" ? null : shelves.map((m) => ({
        id: m.id, name: m.name, label: m.label, disabled: m.freeMinutes < spanMinutes,
      })),
    });
  };

  const closeDialog = (): void => {
    setDialog(null);
    setDialogNotice(null);
  };

  // ---- Rendering -----------------------------------------------------------------------------

  const ticketsView = (
    <section class="board__column" role="region" aria-label={tenant ? "Your tickets" : "Door list"}>
      <div class="rail-bar" aria-hidden="true" />
      <h2 class="column__title">{tenant ? "Your tickets" : "Door list"}</h2>
      <div class="cards">
        {tenant
          ? tickets.length === 0
            ? <TicketStub>No tickets from {dateLabel(date)}. Drag the slab onto a free station to claim it.</TicketStub>
            : tickets.map((b) => (
              <TicketCard key={b.id} booking={b} kitchen={kitchen} entering={entering.has(b.id)} pending={pending[b.id] ?? null}
                moveLifted={lift?.kind === "move" && lift.id === b.id} moveDisabled={hint !== null} moveProps={moveProps(b)}
                notice={notes[b.id]?.notice ?? null} onConfirm={() => void confirmBooking(b)} onCancel={() => cancel(b)} />
            ))
          : door.length === 0
            ? <TicketStub>No bookings on {dateLabel(date)}.</TicketStub>
            : door.map((entry) => (
              <DoorCard key={`${date}-${entry.bookingId}`} entry={entry} pending={doorPending[entry.bookingId] ?? null}
                notice={doorNotes[entry.bookingId] ?? null} onAct={(action) => doorAct(entry, action)}
                onCheckOut={(opener, finish) => setCheckout({ entry, opener, finish })} />
            ))}
      </div>
    </section>
  );

  const slabDisabled = hint !== null;
  return (
    <Shell session={session} screen={screen}
      tools={<><ScreenHeading>Board</ScreenHeading><DateGroup date={date} kitchen={kitchen} onDate={(d) => setView({ ...view, date: d }, true)} /></>}>
      <div class={`board board--${tenant ? "tenant" : "staff"}`} data-settling={firstRead.floor && firstRead.column ? undefined : "true"}>
        <section class="board__rail" aria-label="Span">
          <HourRail from={from} to={to} cooler={coolerRows} coolerLine={floor ? coolerLine(shelvesFree, shelves.length) : null}
            onChange={(f, t) => setView({ ...view, from: f, to: t }, false)} />
        </section>
        {tenant ? (
          <div class="board__slab">
            <div class="slab-wrap">
              <button type="button" ref={slabRef} class="slab" aria-label={`Slab ${spanLabel}`} aria-pressed={lift?.kind === "slab" ? "true" : "false"}
                aria-disabled={slabDisabled ? "true" : undefined} aria-describedby={slabDisabled ? "span-hint" : undefined}
                data-dragging={drag && dragRef.current?.source === SLAB_SOURCE ? "true" : undefined}
                onKeyDown={slabKeys}
                onBlur={() => {
                  if (liftRef.current?.kind === "slab") returnLift();
                }}
                {...dragHandlers(SLAB_SOURCE, !slabDisabled, spanLabel, duration(spanMinutes))}>
                <Icon name="grip-vertical" size={18} />
                <span class="slab__span mono">{spanLabel}</span>
              </button>
              <span class="slab__duration" aria-hidden="true">{duration(spanMinutes)}</span>
            </div>
            {hint !== null ? <p class="hint" id="span-hint">{hint}</p> : null}
            <Notice notice={slabNotice} />
          </div>
        ) : null}
        <section class="board__plan" aria-label="Kitchen floor">
          <Notice notice={floorStale} />
          <div class="plan" ref={planBox} role="region" aria-label="Floor plan">
            {floor && size.width > 0 ? (
              <FloorPlan stations={models} width={size.width} heightLimit={wide ? size.height : null}
                target={lift ? target : null} hover={drag?.over ?? null} slab={slab} slabHome={slabRef}
                onOpen={openStation}
                onSlabGone={(gone) => setSlab((current) => (current?.serial === gone ? null : current))} />
            ) : null}
          </div>
        </section>
        {ticketsView}
      </div>
      {drag ? (
        <div class="slab-ghost" aria-hidden="true" style={`transform:translate(${drag.x - 60}px, ${drag.y - 22}px)`}>
          <span class="mono">{drag.label}</span><span>{drag.detail}</span>
        </div>
      ) : null}
      {dialog ? (
        <StationDialog name={dialog.name} opener={dialog.opener} span={spanLabel} claimable={tenant} hint={hint}
          intervals={dialog.intervals} shelves={dialog.claimShelves}
          busy={claiming} notice={dialogNotice} claimButton={claimButton}
          onClaim={(shelfId) => void claim(dialog.id, "dialog", shelfId)}
          onClose={closeDialog} />
      ) : null}
      {checkout ? (
        <CheckOutDialog entry={checkout.entry} opener={checkout.opener}
          onBusy={(busy) => checkOutBusy(checkout.entry, busy)}
          onFinish={(outcome) => void checkOutDone(outcome)}
          onClose={() => setCheckout(null)} />
      ) : null}
    </Shell>
  );
}
