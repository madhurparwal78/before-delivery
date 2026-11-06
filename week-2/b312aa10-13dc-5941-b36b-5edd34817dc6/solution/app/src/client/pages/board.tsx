// The line board: date bar, ticket rail, station lanes against the kitchen-time hour ruler, the
// rail-to-line drop and keyboard, mouse and touch moves. Every result is drawn from the server's
// answer; a refusal redraws only its own block from the `current` booking in the body.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ApiFailure, boardRead, get, post, postOnce, serverNow } from "../api.js";
import { navigate, useAddress, withQuery } from "../router.js";
import { announce, announcement, bank, clearError, context, reducedMotion, rollBank, setBank, showClaimError, showError, showRefreshError, useStore } from "../store.js";
import { Dialog } from "../dialog.js";
import { Button, Empty, Icon, errorCopy, fieldErrorCopy, useAction } from "../ui.js";
import { CancelDialog, MoveDialog, NewBookingDialog, OutOfServiceDialog, ReleaseDialog, currentBooking, labelFor, type NewBookingPreset } from "./dialogs.js";
import { isBooked, type Board, type BoardBlock, type Booking, type HourBank, type OutOfService, type Station, type StationInfo } from "../types.js";
import { STATUS_WORDS, blockLabel, hoursText, money, quartersOf, type BlockShape } from "../../shared/format.js";
import { OCCUPYING, endMinutes, priceHourly, priceShelf, rateFor, type HourlyRate, type ShelfRate, type OfferedAction } from "../../shared/rules.js";
import { addDays, daysBetween, isLocalDate, localTimeOf, longDate, minutesOf, monthOf, startOfDay, timeOf, weekdayKey, zonedInstant } from "../../shared/time.js";

const STRIP_DAYS = 24;
const GHOST = ".ghost-hand";
const IN_HAND_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " ", "Escape"]);
const REFRESH_MS = 15_000;
const TRAVEL_MS = 360;
const RING_MS = 1000;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

interface Ticket { key: string; bookings: Booking[]; flag: "taken" | "expired" | null; confirming: boolean; landed: boolean }

/**
 * The shelf records of one date, from that date's board: the board response carries only the shelf
 * bookings covering its own date, so a shelf ghost stepping onto later days reads those dates' boards.
 */
interface DayRecords { blocks: BoardBlock[]; outOfService: OutOfService[] }
type Strip = Readonly<Record<string, DayRecords>>;

const dayRecords = (b: Board): DayRecords => ({ blocks: b.blocks.filter((x) => x.days !== null), outOfService: b.outOfService });

async function fetchDays(days: string[]): Promise<Strip> {
  return Object.fromEntries(await Promise.all(days.map(async (d) => [d, dayRecords((await get<Board>(`/api/board?date=${d}`)).data)])));
}

const coversDay = (b: Pick<BlockShape, "localDate" | "days">, day: string): boolean =>
  b.days !== null && b.localDate <= day && day < addDays(b.localDate, b.days);

const shelfDaysOf = (localDate: string, days: number): string[] => Array.from({ length: days }, (_, i) => addDays(localDate, i));

/** A block in hand: its booking as picked up, and the ghost's position. */
interface InHand { booking: Booking; stationId: string; date: string; start: number; days: number | null; saving: boolean }

type DialogState =
  | { kind: "new"; preset: NewBookingPreset | null }
  | { kind: "details"; block: BoardBlock; booking: Booking | null; now: number }
  | { kind: "cancel"; booking: Booking; now: number }
  | { kind: "move" }
  | { kind: "release"; booking: Booking }
  | { kind: "oos" };

type Marker = "Occupied" | "Out of service" | null;

const plural = (quarters: number, word: string): string => `${hoursText(quarters)} ${quarters === 4 ? word : `${word}s`}`;

function dropCopy(b: Booking, bankLeft: HourBank, weeks: number, pending: boolean): string {
  let copy = b.kind === "shelf"
    ? `${labelFor(b)} booked`
    : `${b.stationName}, ${b.localStart} to ${b.localEnd} booked, ${plural(quartersOf(bankLeft.balanceHours), "hour")} left`
      + (b.peakHours > 0 ? `, ${plural(quartersOf(b.peakHours), "hour")} at peak` : "");
  if (weeks > 1) copy += ` and ${weeks - 1} more ${weeks - 1 === 1 ? "week" : "weeks"}`;
  if (pending) copy += ". Billing is pending.";
  return copy;
}

/** Status word, then Conflict, then the billing mark, then the pending marker. */
function statusWords(b: Booking, saving: boolean): string {
  const words = [STATUS_WORDS[b.status]];
  if (b.conflict) words.push("Conflict");
  if (b.billingStatus !== "not_billed") words.push(b.billingStatus === "billed" ? "Billed" : "Pending billing");
  if (saving) words.push("Saving…");
  return words.join(", ");
}

/** Position in ruler hours (hourly lanes) or strip days (shelf lanes). */
function span(b: Pick<BlockShape, "localDate" | "localStart" | "localEnd" | "days">, boardDate: string): [number, number] | null {
  if (b.days === null) return b.localDate === boardDate ? [minutesOf(b.localStart!) / 60, endMinutes(b.localEnd!) / 60] : null;
  const from = Math.max(0, daysBetween(boardDate, b.localDate));
  const to = Math.min(STRIP_DAYS, daysBetween(boardDate, b.localDate) + b.days);
  return to > from ? [from, to] : null;
}

/** Statuses the board draws in a lane (members' own expired tickets live on the rail only). */
const IN_LANE = (b: BoardBlock): boolean => b.status === "booked" || OCCUPYING.includes(b.status);

/** The Billed mark is cold blue (brief: Visual design › Colour roles). */
const WORD_CLASS: Record<string, string> = { Billed: "billed" };

const pos = (from: number, to: number) => ({ left: `calc(var(--hour) * ${from})`, width: `calc(var(--hour) * ${to - from})` });

function hourWidth(): number {
  return document.querySelector(".ruler li")?.getBoundingClientRect().width ?? 80;
}

function trackOf(stationId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.lane-track[data-station="${stationId}"]`);
}

/** The screen rectangle of a slot in a lane, after scrolling the board frame so it is in view. */
function slotRect(stationId: string, from: number, to: number): DOMRect | null {
  const track = trackOf(stationId);
  const frame = document.querySelector<HTMLElement>(".board-frame");
  if (!track || !frame) return null;
  const w = hourWidth();
  const label = document.querySelector(".lane-label")?.getBoundingClientRect().width ?? 0;
  const visible = frame.clientWidth - label;
  const slotLeft = from * w;
  if (slotLeft < frame.scrollLeft || slotLeft + (to - from) * w > frame.scrollLeft + visible) {
    frame.scrollLeft = Math.max(0, slotLeft - w);
  }
  const t = track.getBoundingClientRect();
  return new DOMRect(t.left + from * w, t.top + 4, (to - from) * w, t.height - 8);
}

/** Lifts a ticket out of its rail slot so its own box can travel; the slot keeps its size. */
function lift(ticket: HTMLElement): DOMRect {
  const from = ticket.getBoundingClientRect();
  Object.assign(ticket.parentElement!.style, { width: `${from.width}px`, height: `${from.height}px` });
  Object.assign(ticket.style, {
    position: "fixed", zIndex: "1000", overflow: "hidden", pointerEvents: "none", minHeight: "0",
    left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
  });
  return from;
}

/** Puts a lifted ticket back into its rail slot. */
function seat(ticket: HTMLElement): void {
  ticket.getAnimations().forEach((a) => a.cancel());
  ticket.removeAttribute("style");
  ticket.parentElement?.removeAttribute("style");
}

/** Travels a box from one rectangle to another on a gentle curve in 360ms. */
function travel(el: HTMLElement, from: DOMRect, to: DOMRect): Promise<unknown> {
  const frame = (r: DOMRect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const mid = new DOMRect(from.left + (to.left - from.left) * 0.35, from.top + (to.top - from.top) * 0.7,
    (from.width + to.width) / 2, (from.height + to.height) / 2);
  el.getAnimations().forEach((a) => a.cancel());
  return el.animate([frame(from), { ...frame(mid), offset: 0.5 }, frame(to)], { duration: TRAVEL_MS, easing: EASE, fill: "forwards" }).finished;
}

/** The real instants a block shape covers, for overlap checks against the board. */
function instantsOf(t: BlockShape, zone: string): [number, number] | null {
  if (t.days !== null) return [startOfDay(t.localDate, zone), startOfDay(addDays(t.localDate, t.days), zone)];
  const start = zonedInstant(t.localDate, t.localStart!, zone);
  const end = t.localEnd === "24:00" ? startOfDay(addDays(t.localDate, 1), zone) : zonedInstant(t.localDate, t.localEnd!, zone);
  return start === null || end === null ? null : [start, end];
}

function targetOf(h: InHand, stationName: string): BlockShape {
  if (h.days !== null) return { stationName, localDate: h.date, localStart: null, localEnd: null, days: h.days };
  const length = endMinutes(h.booking.localEnd!) - minutesOf(h.booking.localStart!);
  return { stationName, localDate: h.date, localStart: timeOf(h.start), localEnd: timeOf(h.start + length), days: null };
}

const inHandOf = (b: Booking): InHand => ({
  booking: b, stationId: b.stationId, date: b.localDate, start: b.localStart ? minutesOf(b.localStart) : 0, days: b.days, saving: false,
});

export function BoardScreen() {
  const ctx = useStore(context)!;
  const { session, kitchen } = ctx;
  const role = session.user.role;
  const staff = role !== "member";
  const zone = kitchen.timeZone;
  const address = useAddress();
  const raw = address.query.get("date");
  const valid = raw !== null && isLocalDate(raw);
  /** The `today` of the latest board response; the browser's clock and zone are never read for it. */
  const [today, setToday] = useState<string>(kitchen.today);
  const date = valid ? raw : today;

  const [board, setBoard] = useState<Board | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [inHand, setInHand] = useState<InHand | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [ring, setRing] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [strip, setStripState] = useState<Strip>({});
  const stripRef = useRef<Strip>({});
  const setStrip = (next: Strip): void => {
    stripRef.current = next;
    setStripState(next);
  };
  const drops = useRef(0);
  /**
   * Interactions › Confirming: the drawn balance (from the latest board drawn, or the returned
   * balance of the latest-pressed drop that has answered, `by` being its press number) and the
   * quarters of each drop pressed and not yet answered. The figures aim at drawn minus in flight.
   */
  const drawn = useRef<{ month: string | null; quarters: number | null; by: number }>({ month: null, quarters: null, by: 0 });
  const inFlight = useRef(new Map<number, number>());
  const pressed = useRef(0);
  const announcedBy = useRef(0);
  const aimBank = (): void => {
    const { month, quarters } = drawn.current;
    if (month === null || quarters === null) return;
    let flying = 0;
    for (const q of inFlight.current.values()) flying += q;
    const target = Math.max(0, quarters - flying);
    const shown = bank.get();
    if (shown.month !== month || shown.quarters === null) setBank(month, target);
    else rollBank(target);
  };
  const dismissed = useRef(new Set<string>());
  /** A hold made for another date: its ticket goes to the right end of the rail once that date's board is read. */
  const heldKey = useRef<string | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const action = useAction();

  // Without a date the board opens on the server's today, read from a board response.
  useEffect(() => {
    if (raw === null) {
      get<Board>("/api/board").then(({ data }) => {
        setToday(data.today);
        if (new URLSearchParams(location.search).get("date") === null && location.pathname === "/board") {
          navigate(withQuery("/board", { date: data.date }), true);
        }
      }, (error) => showRefreshError(errorCopy(error)));
    } else if (!valid) showError("Use a date in the form YYYY-MM-DD.");
  }, [raw]);

  const load = async (): Promise<Board | null> => {
    if (!valid) return null;
    // Interactions › Refresh: a response to a read sent before the person's latest own board action
    // answered (or while one was in flight) is discarded when it arrives, however late.
    const drawable = boardRead();
    try {
      const { data } = await get<Board>(`/api/board?date=${date}`);
      if (!drawable()) return null;
      if (new URLSearchParams(location.search).get("date") !== data.date) return null;
      setToday(data.today);
      setBoard(data);
      if (data.hourBank) {
        drawn.current = { month: data.hourBank.month, quarters: quartersOf(data.hourBank.balanceHours), by: 0 };
        if (inFlight.current.size === 0) setBank(data.hourBank.month, drawn.current.quarters!);
        else aimBank();
      }
      setTickets((current) => {
        const merged = mergeTickets(current, data, session.user.memberId, dismissed.current);
        const key = heldKey.current;
        const held = key ? merged.find((t) => t.key === key) : undefined;
        if (!held) return merged;
        heldKey.current = null;
        return [...merged.filter((t) => t !== held), held];
      });
      void loadStrip(data);
      return data;
    } catch (error) {
      // A refresh never changes the alert of a refused claim.
      showRefreshError(errorCopy(error));
      return null;
    }
  };

  /** Each strip date's shelf records, the board date's from the board just read. */
  const loadStrip = async (data: Board): Promise<void> => {
    const drawable = boardRead();
    try {
      const later = await fetchDays(Array.from({ length: STRIP_DAYS - 1 }, (_, i) => addDays(data.date, i + 1)));
      if (!drawable() || new URLSearchParams(location.search).get("date") !== data.date) return;
      setStrip({ ...later, [data.date]: dayRecords(data) });
    } catch {
      // The board date's own records still stand; the later cells refresh with the next board read.
    }
  };

  /** Loads the shelf records of any of these dates not yet read, and returns the strip with them. */
  const ensureDays = async (days: string[]): Promise<Strip> => {
    const missing = days.filter((d) => !stripRef.current[d]);
    if (missing.length === 0) return stripRef.current;
    const merged = { ...stripRef.current, ...(await fetchDays(missing)) };
    setStrip(merged);
    return merged;
  };

  useEffect(() => {
    setBoard(null);
    setStrip({});
    setInHand(null);
    setTickets([]);
    dismissed.current.clear();
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [date, valid]);

  useEffect(() => {
    if (staff) get<{ stations: Station[] }>("/api/stations").then(({ data }) => setStations(data.stations), () => undefined);
  }, []);

  // Open on the current kitchen-local hour today, 05:00 on any other day.
  useLayoutEffect(() => {
    if (!board || scrolledFor.current === board.date) return;
    scrolledFor.current = board.date;
    const frame = document.querySelector<HTMLElement>(".board-frame");
    if (!frame) return;
    // The response's own `now` carries the kitchen offset, so its hour is the kitchen-local hour.
    const hour = board.date === board.today ? Math.max(0, Number(board.now.slice(11, 13)) - 1) : 5;
    const mark = frame.querySelectorAll<HTMLElement>(".ruler li")[hour];
    const corner = frame.querySelector<HTMLElement>(".corner");
    if (mark && corner) frame.scrollLeft += mark.getBoundingClientRect().left - corner.getBoundingClientRect().right;
  }, [board]);

  useEffect(() => {
    if (!focusTarget) return;
    // Alternatives separated by "||" are tried in order (a block, else its lane).
    const el = focusTarget.split("||").map((sel) => document.querySelector<HTMLElement>(sel)).find(Boolean);
    if (el) {
      // A ticket is brought whole into view inside the rail strip, which scrolls by itself (a jump, never a glide).
      const ticket = el.closest<HTMLElement>(".rail .ticket-slot");
      if (ticket) ticket.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      el.focus({ preventScroll: !!ticket });
      setFocusTarget(null);
    }
  });

  const go = (d: string): void => {
    clearError();
    navigate(withQuery("/board", { date: d }));
  };
  const base = valid ? date : today;

  const markSaving = (id: string, on: boolean): void =>
    setSaving((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Redraws one block from a booking the server returned; it leaves its lane when the board does not show it. */
  const redraw = (b: Booking): void => {
    if (b.days !== null) {
      const next: Record<string, DayRecords> = {};
      for (const [d, r] of Object.entries(stripRef.current)) next[d] = { ...r, blocks: r.blocks.filter((x) => x.id !== b.id) };
      setStrip(next);
    }
    setBoard((current) => {
      if (!current) return current;
      const others = current.blocks.filter((x) => x.id !== b.id);
      return { ...current, blocks: IN_LANE(b) && span(b, current.date) ? [...others, b] : others };
    });
  };

  /** Focus on a block where it now stands, or on its lane group when it has left the board. */
  const focusBlock = (b: Pick<Booking, "id" | "stationId">): void =>
    setFocusTarget(`[data-block="${b.id}"]||.lane[data-station="${b.stationId}"]`);

  // ------------------------------------------------------------- rail

  const onHeld = (result: { bookings: Booking[]; seriesId: string | null }): void => {
    // One ticket per week, each on its own date: the hold's ticket is the week on the requested date.
    const sorted = [...result.bookings].sort((a, b) => a.start.localeCompare(b.start));
    const first = sorted[0]!;
    const key = first.id;
    setDialog(null);
    if (first.localDate !== date) {
      // The board moves to the hold's date first (one history entry); the ticket arrives with that date's board.
      heldKey.current = key;
      clearError();
      navigate(withQuery("/board", { date: first.localDate }));
    } else {
      setTickets((current) => [...current.filter((t) => t.key !== key), { key, bookings: [first], flag: null, confirming: false, landed: false }]);
    }
    setFocusTarget(`[data-ticket="${key}"] .ticket-confirm`);
    announce(`Held ${labelFor(first)} until ${localTimeOf(Date.parse(first.holdExpiresAt!), zone)}.`);
    void load();
  };

  const confirmTicket = async (ticket: Ticket): Promise<void> => {
    const first = ticket.bookings[0]!;
    const label = labelFor(first);
    clearError();
    const pending = `Confirming ${label}…`;
    announce(pending);
    setTickets((ts) => ts.map((t) => (t.key === ticket.key ? { ...t, confirming: true, flag: null } : t)));
    drops.current += 1;
    // The press adds the ticket's hours in the bank's month to the hours in flight.
    const seq = ++pressed.current;
    const used = ticket.bookings.filter((b) => monthOf(b.localDate) === drawn.current.month).reduce((n, b) => n + quartersOf(b.hours), 0);
    inFlight.current.set(seq, used);
    aimBank();
    const motion = !reducedMotion();
    // The ticket's own box travels to its lane slot; if the server has not answered by then, the
    // lane shows a dashed ghost in that slot until it does.
    const ticketEl = document.querySelector<HTMLElement>(`[data-ticket="${ticket.key}"]`);
    const slot = span(first, date);
    const to = motion && slot ? slotRect(first.stationId, slot[0], slot[1]) : null;
    const from = to && ticketEl ? lift(ticketEl) : null;
    const arrived = from && to ? travel(ticketEl!, from, to) : Promise.resolve();
    let answered = false;
    if (from && to) {
      void arrived.then(() => {
        if (!answered) setTickets((ts) => ts.map((t) => (t.key === ticket.key ? { ...t, landed: true } : t)));
      });
    }
    const settle = (): void => {
      drops.current -= 1;
      if (drops.current === 0) void load();
    };
    try {
      const { status, data } = await postOnce<{ bookings: Booking[]; hourBank: HourBank }>(`/api/bookings/${first.id}/confirm`, {});
      answered = true;
      // The moment the answer arrives: out of the hours in flight, and its balance is drawn unless a
      // drop pressed after it has already drawn its own.
      inFlight.current.delete(seq);
      if (data.hourBank.month === drawn.current.month && drawn.current.by < seq) {
        drawn.current = { month: data.hourBank.month, quarters: quartersOf(data.hourBank.balanceHours), by: seq };
      }
      aimBank();
      await arrived;
      for (const b of data.bookings) redraw(b);
      setTickets((ts) => ts.filter((t) => t.key !== ticket.key));
      if (!motion) {
        setRing(first.id);
        setTimeout(() => setRing(null), RING_MS);
      }
      setFocusTarget(`[data-block="${first.id}"]`);
      // Announced only when no drop pressed after it has already announced its success.
      if (seq > announcedBy.current) {
        announcedBy.current = seq;
        announce(dropCopy(data.bookings.find((b) => b.id === first.id) ?? first, data.hourBank, data.bookings.length, status === 202));
      }
      settle();
    } catch (error) {
      answered = true;
      inFlight.current.delete(seq);
      aimBank();
      const code = error instanceof ApiFailure ? error.code : null;
      // A refused claim's copy shows as its answer arrives, so the last refusal to arrive is the one
      // shown; nothing but the person's next press or a later refusal changes it.
      if (code === "validation_failed" || code === "block_taken" || code === "hold_expired") showClaimError(fieldErrorCopy(error));
      else showError(errorCopy(error));
      await arrived;
      const flag = code === "block_taken" ? "taken" : code === "hold_expired" ? "expired" : null;
      setTickets((ts) => ts.map((t) => (t.key === ticket.key ? { ...t, landed: false } : t)));
      if (from && to) await travel(ticketEl!, to, ticketEl!.parentElement!.getBoundingClientRect());
      if (ticketEl) seat(ticketEl);
      setTickets((ts) => ts.map((t) => (t.key === ticket.key ? { ...t, confirming: false, flag: flag ?? t.flag } : t)));
      if (announcement.get().text === pending) announce("");
      settle();
    }
  };

  const discard = (ticket: Ticket): void => {
    // Once Discard is pressed the ticket is never drawn again, whatever board answer arrives later.
    for (const b of ticket.bookings) dismissed.current.add(b.id);
    if (ticket.flag === "expired") {
      // Nothing is held: the ticket leaves the rail until the board is next opened, with no request.
      setTickets((ts) => ts.filter((t) => t.key !== ticket.key));
      setFocusTarget(".new-booking");
      return;
    }
    void action.run(`discard-${ticket.key}`, "Releasing hold…", async () => {
      await postOnce(`/api/bookings/${ticket.bookings[0]!.id}/cancel`, {});
      setTickets((ts) => ts.filter((t) => t.key !== ticket.key));
      setFocusTarget(".new-booking");
      void load();
      return "Hold released.";
    });
  };

  // ------------------------------------------------------------- block details and line actions

  const openDetails = async (block: BoardBlock): Promise<void> => {
    if (isBooked(block)) {
      setDialog({ kind: "details", block, booking: null, now: serverNow() });
      return;
    }
    // The board already carries the full booking: the dialog opens at once from it, and the read
    // below (which applies any lapse that is due) redraws it only when the booking has changed.
    setDialog({ kind: "details", block, booking: block, now: serverNow() });
    // Its buttons are fixed at this moment; a changed booking redraws only its block in the lane.
    try {
      const { data } = await get<{ booking: Booking }>(`/api/bookings/${block.id}`);
      if (data.booking.version === block.version) return;
      redraw(data.booking);
    } catch (error) {
      showError(errorCopy(error));
    }
  };

  /** A refused board action: only its block redraws, from the booking in the body. */
  const refused = (error: unknown): boolean => {
    const current = currentBooking(error);
    if (!current) return false;
    redraw(current);
    setDialog(null);
    focusBlock(current);
    return false;
  };

  const lineAction = (b: Booking, path: string, copy: (done: Booking) => string): void => {
    markSaving(b.id, true);
    void action.run(path, "Saving…", async () => {
      const { data } = await post<{ booking: Booking }>(`/api/bookings/${b.id}/${path}`);
      redraw(data.booking);
      setDialog(null);
      focusBlock(data.booking);
      void load();
      return copy(data.booking);
    }, (error) => {
      // A 422 (such as check-in refused on documents) leaves the block exactly as it was.
      if (error instanceof ApiFailure && error.code === "validation_failed") {
        setDialog(null);
        focusBlock(b);
        showError(fieldErrorCopy(error));
        return true;
      }
      return refused(error);
    }).finally(() => markSaving(b.id, false));
  };

  const pickUp = (b: Booking): void => {
    setDialog(null);
    setInHand(inHandOf(b));
    setFocusTarget(GHOST);
    announce(`Picked up ${labelFor(b)}. Arrow keys move it, Enter places it, Escape puts it back.`);
  };

  const putBack = (): void => {
    const b = inHand?.booking;
    setInHand(null);
    setDialog(null);
    if (b) {
      announce(`Put back ${labelFor(b)}.`);
      setFocusTarget(`[data-block="${b.id}"]`);
    }
  };

  const stationName = (id: string): string => board?.stations.find((s) => s.id === id)?.name ?? "";
  const target = inHand ? targetOf(inHand, stationName(inHand.stationId)) : null;

  /** The occupying shelf bookings on a station covering a day; a block the board redrew wins over the day's records. */
  const shelfOn = (stationId: string, day: string, data: Strip): BoardBlock[] => {
    const fresh = board!.blocks.filter((b) => b.stationId === stationId);
    const older = (data[day]?.blocks ?? []).filter((b) => b.stationId === stationId && !fresh.some((f) => f.id === b.id));
    return [...fresh, ...older].filter((b) => IN_LANE(b) && coversDay(b, day));
  };

  /** Every out-of-service window on a station known from the board and the strip, once each. */
  const windowsOn = (stationId: string, data: Strip): OutOfService[] => {
    const all = new Map<string, OutOfService>();
    for (const w of [...board!.outOfService, ...Object.values(data).flatMap((r) => r.outOfService)]) if (w.stationId === stationId) all.set(w.id, w);
    return [...all.values()];
  };

  /**
   * Occupied when an hourly ghost overlaps another block in a lane, or when some day of a shelf ghost
   * is full without the moving booking; out of service when it overlaps a band.
   */
  const markerFor = (h: InHand, data: Strip = strip): Marker => {
    if (!board) return null;
    const at = instantsOf(targetOf(h, stationName(h.stationId)), zone);
    if (!at) return null;
    const hits = (start: string, end: string): boolean => Date.parse(start) < at[1] && at[0] < Date.parse(end);
    if (h.days !== null) {
      const capacity = board.stations.find((s) => s.id === h.stationId)?.capacity ?? 0;
      if (shelfDaysOf(h.date, h.days).some((d) => shelfOn(h.stationId, d, data).filter((b) => b.id !== h.booking.id).length >= capacity)) return "Occupied";
    } else if (board.blocks.some((b) => b.id !== h.booking.id && b.stationId === h.stationId && IN_LANE(b) && hits(b.start, b.end))) {
      return "Occupied";
    }
    if (windowsOn(h.stationId, data).some((w) => hits(w.start, w.end))) return "Out of service";
    return null;
  };
  const marker = inHand ? markerFor(inHand) : null;

  /** A shelf cell's occupying bookings covering the board date, in order of first day then booking time. */
  const cellBlocks = (stationId: string): BoardBlock[] =>
    shelfOn(stationId, date, strip).sort((a, b) => a.localDate.localeCompare(b.localDate));

  const quote = (): number | null => {
    if (!inHand || !target || !board) return null;
    const station = stations.find((s) => s.id === inHand.stationId);
    if (!station) return null;
    const at = instantsOf(target, zone);
    const rate = at === null ? null : rateFor(station.rates, at[0]);
    if (!rate) return null;
    return target.days !== null
      ? priceShelf(target.days, rate as ShelfRate)
      : priceHourly(target.localDate, target.localStart!, target.localEnd!, rate as HourlyRate, board.peakWindows).chargeCents;
  };

  const confirmMove = async (): Promise<void> => {
    if (!inHand || !target) return;
    const hand = inHand;
    const b = hand.booking;
    setDialog(null);
    clearError();
    announce("Moving…");
    setInHand({ ...hand, saving: true });
    // The saving ghost holds focus until the answer.
    setFocusTarget(GHOST);
    markSaving(b.id, true);
    const body = target.days !== null
      ? { stationId: hand.stationId, date: target.localDate, days: target.days, version: b.version }
      : { stationId: hand.stationId, date: target.localDate, start: target.localStart, end: target.localEnd, version: b.version };
    // The Moving ticket travels from the rail to the target slot, as the drop does, and waits there.
    const motion = !reducedMotion();
    const ticketEl = document.querySelector<HTMLElement>(".ticket-moving");
    const slot = span(target, date);
    const to = motion && ticketEl && slot ? slotRect(hand.stationId, slot[0], slot[1]) : null;
    const from = to ? lift(ticketEl!) : null;
    const arrived = from && to ? travel(ticketEl!, from, to) : Promise.resolve();
    try {
      const { data } = await post<{ booking: Booking; hourBank: HourBank }>(`/api/bookings/${b.id}/move`, body);
      await arrived;
      setInHand(null);
      redraw(data.booking);
      focusBlock(data.booking);
      announce(`Moved to ${labelFor(data.booking)}.`);
      void load();
    } catch (error) {
      await arrived;
      if (from && to) await travel(ticketEl!, to, from);
      setInHand(null);
      const current = currentBooking(error);
      if (current) redraw(current);
      focusBlock(current ?? b);
      showError(fieldErrorCopy(error));
      announce("");
    } finally {
      markSaving(b.id, false);
    }
  };

  // Keyboard while a block is in hand: the ghost jumps straight to each new position. The keys act
  // on the ghost only while focus is on it or on another control inside the rail or the lanes (and
  // never also on that control); elsewhere they keep their normal meaning and the block stays in hand.
  useEffect(() => {
    if (!inHand || dialog || !board) return;
    const kind = inHand.days === null ? "hourly" : "shelf";
    const lanes = board.stations.filter((s) => s.kind === kind);
    const inScope = (): boolean => !!(document.activeElement as HTMLElement | null)?.closest?.(".rail, .board-frame");
    const say = (h: InHand, suffix = "", data: Strip = strip): void => {
      const m = markerFor(h, data);
      announce(`${blockLabel(targetOf(h, stationName(h.stationId)))}.${suffix || (m ? ` ${m}.` : "")}`);
    };
    // A shelf ghost's days are read first, so its marker words and its announcement change together.
    const step = async (next: InHand | null): Promise<void> => {
      setFocusTarget(GHOST);
      if (!next) {
        say(inHand, " Edge of the board.");
        return;
      }
      const data = next.days !== null ? await ensureDays(shelfDaysOf(next.date, next.days)) : strip;
      setInHand(next);
      setFocusTarget(GHOST);
      say(next, "", data);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!IN_HAND_KEYS.has(e.key) || !inScope()) return;
      e.preventDefault();
      e.stopPropagation();
      // While the move is saving the keys do nothing.
      if (inHand.saving) return;
      if (e.key === "Escape") {
        putBack();
      } else if (e.key === "Enter" || e.key === " ") {
        if (e.repeat) return;
        if (markerFor(inHand)) {
          setFocusTarget(GHOST);
          announce(`${blockLabel(targetOf(inHand, stationName(inHand.stationId)))} is not free. Choose free time.`);
        } else setDialog({ kind: "move" });
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (inHand.days !== null) {
          const next = addDays(inHand.date, dir);
          void step(next < board.today ? null : { ...inHand, date: next });
        } else {
          const length = endMinutes(inHand.booking.localEnd!) - minutesOf(inHand.booking.localStart!);
          const start = inHand.start + dir * (e.shiftKey ? 60 : 15);
          void step(start < 0 || start + length > 1440 ? null : { ...inHand, start });
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const next = lanes[lanes.findIndex((s) => s.id === inHand.stationId) + (e.key === "ArrowUp" ? -1 : 1)];
        void step(next ? { ...inHand, stationId: next.id } : null);
      }
    };
    // A button activates on Space at keyup: inside the rail and the lanes that is swallowed too.
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === " " && inScope()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
    };
  }, [inHand, dialog, board, strip]);

  // The board jumps so the keyboard ghost stays in view at each new position (a dragged ghost follows the pointer).
  useLayoutEffect(() => {
    if (!inHand || inHand.days !== null || drag.current?.active) return;
    const length = endMinutes(inHand.booking.localEnd!) - minutesOf(inHand.booking.localStart!);
    slotRect(inHand.stationId, inHand.start / 60, (inHand.start + length) / 60);
    document.querySelector(".ghost[role=group]")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [inHand?.stationId, inHand?.start, inHand?.days]);

  // Mouse drag of a confirmed block (staff).
  const drag = useRef<{ booking: Booking; x: number; y: number; grab: number; active: boolean } | null>(null);
  const pointerTarget = (x: number, y: number, b: Booking, grab: number): Partial<InHand> | null => {
    const track = document.elementsFromPoint(x, y).map((el) => el.closest<HTMLElement>(".lane-track")).find(Boolean);
    if (!track || track.dataset.kind !== b.kind) return null;
    const units = (x - track.getBoundingClientRect().left) / hourWidth() - grab;
    if (b.days !== null) return { stationId: track.dataset.station!, date: addDays(date, Math.max(0, Math.round(units))) };
    const length = endMinutes(b.localEnd!) - minutesOf(b.localStart!);
    return { stationId: track.dataset.station!, date, start: Math.min(1440 - length, Math.max(0, Math.round((units * 60) / 15) * 15)) };
  };
  const onBlockPointerDown = (e: PointerEvent, b: BoardBlock): void => {
    if (!staff || isBooked(b) || b.status !== "confirmed" || e.pointerType === "touch" || e.button !== 0 || inHand) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag.current = { booking: b, x: e.clientX, y: e.clientY, grab: (e.clientX - rect.left) / hourWidth(), active: false };
  };
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
        d.active = true;
        setInHand(inHandOf(d.booking));
      }
      if (d.active) {
        const next = pointerTarget(e.clientX, e.clientY, d.booking, d.grab);
        if (next) setInHand((h) => (h ? { ...h, ...next } : h));
      }
    };
    const up = (): void => {
      const d = drag.current;
      drag.current = null;
      if (d?.active) setDialog({ kind: "move" });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
  }, [date]);

  const onCell = (station: StationInfo, index: number): void => {
    if (inHand) {
      if (inHand.saving || station.kind !== (inHand.days === null ? "hourly" : "shelf")) return;
      const length = inHand.days === null ? endMinutes(inHand.booking.localEnd!) - minutesOf(inHand.booking.localStart!) : 0;
      const next = station.kind === "shelf" ? { ...inHand, stationId: station.id, date: addDays(date, index) }
        : { ...inHand, stationId: station.id, date, start: Math.min(index * 15, 1440 - length) };
      setInHand(next);
      if (markerFor(next)) announce(`${blockLabel(targetOf(next, station.name))} is not free. Choose free time.`);
      else setDialog({ kind: "move" });
      return;
    }
    if (staff) return;
    setDialog({
      kind: "new",
      preset: station.kind === "shelf" ? { stationId: station.id, date: addDays(date, index), days: 1 }
        : { stationId: station.id, date, start: timeOf(index * 15), end: timeOf(Math.min(index * 15 + 60, 1440)) },
    });
  };

  // ------------------------------------------------------------- render

  // While a ticket is confirming, its own box is the block on its way: the held block leaves the lane
  // so the board shows it once, and the block returns from the server's answer.
  const travelling = new Set(tickets.filter((t) => t.confirming).flatMap((t) => t.bookings.map((b) => b.id)));
  const waiting = new Set(tickets.filter((t) => t.landed).flatMap((t) => t.bookings.slice(0, 1).map((b) => b.id)));
  const conflicts = staff && board
    ? board.blocks.filter((b): b is Booking => !isBooked(b) && b.conflict && IN_LANE(b) && b.id !== inHand?.booking.id)
    : [];
  const reasonFor = (b: Booking): string =>
    board?.outOfService.find((w) => w.stationId === b.stationId && Date.parse(w.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(w.end))?.reason ?? "";

  return (
    <div class="board-screen">
      <section class="datebar">
        <div class="datebar-title">
          <h1>{valid || raw === null ? longDate(date) : "Line board"}</h1>
          <p class="zone">Kitchen time: {zone}</p>
        </div>
        <div class="datebar-controls">
          <Button onClick={() => go(addDays(base, -1))} aria-label="Previous day"><Icon name="chevron-left" /><span class="btn-text">Previous day</span></Button>
          <Button onClick={() => go(today)}>Today</Button>
          <Button onClick={() => go(addDays(base, 1))} aria-label="Next day"><span class="btn-text">Next day</span><Icon name="chevron-right" /></Button>
          {staff
            ? <Button variant="primary" class="new-booking" onClick={() => setDialog({ kind: "oos" })}>Mark out of service</Button>
            : <Button variant="primary" class="new-booking" onClick={() => setDialog({ kind: "new", preset: null })}>New booking</Button>}
        </div>
      </section>

      <section class="rail" role="region" aria-label="Ticket rail">
        {!staff && tickets.map((t) => {
          const first = t.bookings[0]!;
          return (
            <div class="ticket-slot" key={t.key}>
              <div role="group" aria-label={`Ticket ${labelFor(first)}`} data-ticket={t.key}
                class={`ticket ticket-held${t.confirming ? " ticket-confirming" : ""}${t.landed ? " ticket-landed" : ""}${t.flag ? " ticket-flagged" : ""}`}>
                <p class="ticket-label">{labelFor(first)}</p>
                <p class="ticket-state">
                  {t.confirming ? "Confirming…" : first.holdExpiresAt ? `Held until ${localTimeOf(Date.parse(first.holdExpiresAt), zone)}` : ""}
                  {t.flag && <span class="ticket-flag">{t.flag}</span>}
                </p>
                <p class="ticket-meta">
                  {first.kind === "shelf" ? `${money(first.chargeCents)} · ${first.days} ${first.days === 1 ? "day" : "days"}`
                    : `${money(first.chargeCents)} · ${hoursText(quartersOf(first.hours))} h · ${hoursText(quartersOf(first.peakHours))} h peak`}
                </p>
                <div class="ticket-actions">
                  <Button class="ticket-confirm" variant="primary" busy={t.confirming} onClick={() => void confirmTicket(t)}>Confirm</Button>
                  <Button busy={action.busy === `discard-${t.key}`} disabled={t.confirming} onClick={() => discard(t)}>Discard</Button>
                </div>
              </div>
            </div>
          );
        })}
        {conflicts.map((b) => (
          <div class="ticket-slot" key={b.id}>
            <div role="group" aria-label={`Conflict ${labelFor(b)}`} class="ticket ticket-conflict">
              <p class="ticket-label">{labelFor(b)}</p>
              <p class="ticket-state">Conflict: {reasonFor(b)}</p>
              <p class="ticket-meta">{b.businessName}</p>
              <div class="ticket-actions">
                <Button variant="primary" disabled={!!inHand} onClick={() => pickUp(b)}>Move</Button>
                <Button disabled={!!inHand} onClick={() => setDialog({ kind: "release", booking: b })}>Release</Button>
              </div>
            </div>
          </div>
        ))}
        {inHand && target && (
          <div class="ticket-slot" key="moving">
            <div role="group" aria-label={`Moving ${labelFor(inHand.booking)}`} class="ticket ticket-moving" tabIndex={-1}>
              <p class="ticket-label">{labelFor(inHand.booking)}</p>
              <p class="ticket-state">Moving</p>
              <p class="ticket-meta">{inHand.booking.businessName}</p>
            </div>
          </div>
        )}
        {!inHand && (staff ? conflicts.length === 0 : tickets.length === 0) && (
          <Empty>{staff ? "No conflicts on the rail. Blocks that clash with an out-of-service window land here." : "No tickets on the rail. Held blocks wait here until you confirm them."}</Empty>
        )}
      </section>

      {/* tabIndex -1: the scrolling frame is a focus target (a block that left its lane) but never a Tab stop. */}
      <section class="board-frame" role="region" aria-label="Line board" tabIndex={-1}>
        {!valid ? null : !board ? <p class="loading">Loading the line…</p> : (
          <div class="board-grid">
            <div class="ruler-row">
              <div class="corner" aria-hidden="true" />
              <ol class="ruler" aria-label="Hour ruler">
                {Array.from({ length: 24 }, (_, h) => <li aria-label={timeOf(h * 60)}><span>{timeOf(h * 60)}</span></li>)}
              </ol>
            </div>
            {board.stations.map((station) => (
              <Lane
                key={station.id}
                station={station}
                board={board}
                shelfBlocks={station.kind === "shelf" ? cellBlocks(station.id) : []}
                windows={board.outOfService.filter((w) => w.stationId === station.id)}
                travelling={travelling}
                waiting={waiting}
                ring={ring}
                saving={saving}
                ghost={inHand && target && inHand.stationId === station.id
                  ? { label: blockLabel(target), span: span(target, date), marker, saving: inHand.saving, bookingId: inHand.booking.id } : null}
                inHandId={inHand?.booking.id ?? null}
                onBlock={(b) => void openDetails(b)}
                onBlockPointerDown={onBlockPointerDown}
                onCell={(i) => onCell(station, i)}
              />
            ))}
          </div>
        )}
      </section>

      {dialog?.kind === "new" && board && (
        <NewBookingDialog stations={board.stations} preset={dialog.preset} onHeld={onHeld} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "oos" && board && (
        <OutOfServiceDialog stations={board.stations} date={date} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void load(); }} />
      )}
      {dialog?.kind === "details" && (
        <BlockDetails
          state={dialog}
          blockText={blockLabel({ stationName: stationName(dialog.block.stationId), ...dialog.block })}
          busy={action.busy}
          onClose={() => setDialog(null)}
          onAction={lineAction}
          onPickUp={pickUp}
          onCancel={(b) => setDialog({ kind: "cancel", booking: b, now: dialog.now })}
        />
      )}
      {dialog?.kind === "cancel" && (
        <CancelDialog
          booking={dialog.booking}
          now={dialog.now}
          returnTo={() => document.querySelector<HTMLElement>(`[data-block="${dialog.booking.id}"]`) ?? document.querySelector<HTMLElement>(`.lane[data-station="${dialog.booking.stationId}"]`)}
          onClose={() => setDialog(null)}
          onPending={(on) => markSaving(dialog.booking.id, on)}
          onDone={(b) => { redraw(b); setDialog(null); focusBlock(b); void load(); }}
          onRefused={(current) => { redraw(current); setDialog(null); focusBlock(current); }}
        />
      )}
      {dialog?.kind === "release" && (
        <ReleaseDialog
          booking={dialog.booking}
          onClose={() => setDialog(null)}
          onDone={(b) => { redraw(b); setDialog(null); setFocusTarget(".rail .ticket button, .datebar .btn-primary"); void load(); }}
          onRefused={(current) => { redraw(current); setDialog(null); focusBlock(current); }}
        />
      )}
      {dialog?.kind === "move" && inHand && target && (
        <MoveDialog from={labelFor(inHand.booking)} to={blockLabel(target)} chargeCents={quote()} onConfirm={() => void confirmMove()} onPutBack={putBack} />
      )}
    </div>
  );
}

/**
 * The member's rail: held tickets (a series is one ticket) and expired ones for the board date.
 * Tickets already on the rail keep their place and state; new ones join at the right.
 */
function mergeTickets(current: Ticket[], board: Board, memberId: string | null, dismissed: ReadonlySet<string>): Ticket[] {
  if (!memberId) return [];
  const own = board.blocks.filter((b): b is Booking => !isBooked(b) && b.memberId === memberId && !dismissed.has(b.id));
  // One ticket per held or expired booking on the board date: a series week shows on its own date,
  // a shelf booking on each of its days, and an earlier lapsed hold stays an expired ticket beside a fresh hold.
  const groups = new Map<string, Booking[]>();
  for (const b of own) if (b.status === "held" || b.status === "expired") groups.set(b.id, [b]);
  const next: Ticket[] = [];
  for (const t of current) {
    const fresh = groups.get(t.key);
    groups.delete(t.key);
    if (t.confirming) next.push(t);
    else if (fresh) {
      const expired = fresh.every((b) => b.status === "expired");
      next.push({ ...t, bookings: fresh, flag: expired ? (t.flag ?? "expired") : t.flag });
    }
  }
  for (const [key, bookings] of groups) {
    const sorted = bookings.sort((a, b) => a.start.localeCompare(b.start));
    next.push({ key, bookings: sorted, flag: sorted.every((b) => b.status === "expired") ? "expired" : null, confirming: false, landed: false });
  }
  return next;
}

// ------------------------------------------------------------- lanes

interface Ghost { label: string; span: [number, number] | null; marker: Marker; saving: boolean; bookingId: string }

interface LaneProps {
  station: StationInfo; board: Board; shelfBlocks: BoardBlock[]; windows: OutOfService[]; ring: string | null; saving: ReadonlySet<string>;
  ghost: Ghost | null; travelling: ReadonlySet<string>; waiting: ReadonlySet<string>;
  /** The block in hand: the ghost takes its place in the Tab order. */
  inHandId: string | null;
  onBlock: (b: BoardBlock) => void; onBlockPointerDown: (e: PointerEvent, b: BoardBlock) => void; onCell: (index: number) => void;
}

function Lane({ station, board, shelfBlocks, windows, ring, saving, ghost, inHandId, travelling, waiting, onBlock, onBlockPointerDown, onCell }: LaneProps) {
  const shelf = station.kind === "shelf";
  const capacity = station.capacity ?? 0;
  const occupying = shelf ? shelfBlocks : board.blocks
    .filter((b) => b.stationId === station.id && IN_LANE(b))
    .sort((a, b) => a.start.localeCompare(b.start));
  const shown = occupying.filter((b) => !travelling.has(b.id));
  // The shelf cell stacks one slot row per occupying booking covering the board date.
  const rows = shelf ? new Map(occupying.map((b, i) => [b.id, i])) : null;
  const free = capacity - occupying.length;
  return (
    <div role="group" aria-label={station.name} class={`lane lane-${station.kind}`} data-station={station.id} tabIndex={-1}
      style={shelf ? { "--slots": String(capacity) } : undefined}>
      <div class="lane-label" aria-hidden="true">{station.name}</div>
      <TrackSpan shelf={shelf}>
        <div
          class="lane-track" data-station={station.id} data-kind={station.kind}
          style={shelf ? { width: `calc(var(--hour) * ${Math.max(1, ghost?.span?.[1] ?? 1)})` } : undefined}
          onClick={(e) => {
            const cell = (e.target as HTMLElement).closest<HTMLElement>(".cell");
            if (cell) onCell(Number(cell.dataset.index));
          }}
        >
          {shelf
            ? (
              <div role="group" aria-label={`${station.name} ${board.date}`} class={`cell cell-day${free === 0 ? " cell-full" : ""}`} data-index={0}>
                <span class="cell-free"><span><span class="cell-count">{free} of {capacity}</span> free</span></span>
              </div>
            )
            : Array.from({ length: 96 }, (_, i) => <div class={`cell cell-q${i % 4}`} data-index={i} aria-hidden="true" />)}
          {windows.map((w) => <OutOfServiceBand window={w} board={board} shelf={shelf} />)}
          {shown.map((b) => {
            const s: [number, number] | null = shelf ? [0, 1] : span(b, board.date);
            if (!s) return null;
            const label = blockLabel({ stationName: station.name, localDate: b.localDate, localStart: b.localStart, localEnd: b.localEnd, days: b.days });
            const rest = isBooked(b) ? "Booked" : `${b.businessName}, ${statusWords(b, saving.has(b.id))}`;
            const cls = isBooked(b) ? "booked" : b.status;
            const words = isBooked(b) ? [] : rest.slice(b.businessName.length + 2).split(", ");
            return (
              <button
                type="button"
                key={b.id}
                data-block={b.id}
                tabIndex={inHandId === b.id ? -1 : undefined}
                class={`block block-${cls}${!isBooked(b) && b.conflict ? " block-conflict" : ""}${ring === b.id ? " block-landed" : ""}${!shelf && peakAtStart(b, board) ? " block-peak-start" : ""}`}
                style={rows ? { ...pos(s[0], s[1]), top: `calc(${rows.get(b.id) ?? 0} * var(--slot) + 2px)` } : pos(s[0], s[1])}
                aria-label={`${label}, ${rest}`}
                onClick={() => onBlock(b)}
                onPointerDown={(e) => onBlockPointerDown(e, b)}
              >
                {!shelf && <PeakBands block={b} board={board} />}
                <span class="block-line">{label},</span>
                <span class="block-who">
                  {isBooked(b) ? rest : (
                    <>
                      <span class="block-business">{b.businessName},</span>{" "}
                      <span class="block-words">
                        {words.map((word, i) => <>{i > 0 && " "}<span class={WORD_CLASS[word] ?? ""}>{word}{i < words.length - 1 && ","}</span></>)}
                      </span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
          {occupying.filter((b) => waiting.has(b.id)).map((b) => {
            const s: [number, number] | null = shelf ? [0, 1] : span(b, board.date);
            if (!s) return null;
            const label = blockLabel({ stationName: station.name, localDate: b.localDate, localStart: b.localStart, localEnd: b.localEnd, days: b.days });
            return (
              <div key={b.id} class="ghost ghost-slot" style={rows ? { ...pos(s[0], s[1]), top: `calc(${rows.get(b.id) ?? 0} * var(--slot) + 2px)` } : pos(s[0], s[1])}>
                <span class="ghost-word">Confirming…</span>
                <span class="ghost-label">{label}</span>
              </div>
            );
          })}
          {ghost?.span && (
            <div role="group" aria-label={`Moving to ${ghost.label}`} tabIndex={0}
              class={`ghost ghost-hand${ghost.marker && !ghost.saving ? " ghost-blocked" : ""}`} style={pos(ghost.span[0], ghost.span[1])}>
              {ghost.saving ? <span class="ghost-word">Moving…</span> : ghost.marker && <span class="ghost-word">{ghost.marker}</span>}
              <span class="ghost-label">{ghost.label}</span>
            </div>
          )}
        </div>
      </TrackSpan>
    </div>
  );
}

/**
 * A shelf lane's track is a strip pinned beside the station name inside the ruler-wide lane, so the
 * board date's cell stays in view wherever the board is scrolled; it widens to follow a ghost onto later days.
 */
function TrackSpan({ shelf, children }: { shelf: boolean; children: ComponentChildren }) {
  return shelf ? <div class="shelf-span">{children}</div> : <>{children}</>;
}

/** Whether a peak window covers the block's first quarter hour (its "peak" word then sits under the label's start). */
function peakAtStart(block: BoardBlock, board: Board): boolean {
  const day = weekdayKey(block.localDate);
  const start = minutesOf(block.localStart!);
  return board.peakWindows.some((w) => w.days.includes(day) && minutesOf(w.start) <= start && start < endMinutes(w.end));
}

function PeakBands({ block, board }: { block: BoardBlock; board: Board }) {
  const day = weekdayKey(block.localDate);
  const start = minutesOf(block.localStart!);
  const end = endMinutes(block.localEnd!);
  const length = end - start;
  return (
    <>
      {board.peakWindows.filter((w) => w.days.includes(day)).map((w) => {
        const from = Math.max(start, minutesOf(w.start));
        const to = Math.min(end, endMinutes(w.end));
        if (to <= from) return null;
        return (
          <span class="peak" aria-hidden="true" style={{ left: `${((from - start) / length) * 100}%`, width: `${((to - from) / length) * 100}%` }}>
            <span class="peak-word">peak</span>
          </span>
        );
      })}
    </>
  );
}

function OutOfServiceBand({ window: w, board, shelf }: { window: OutOfService; board: Board; shelf: boolean }) {
  let from: number;
  let to: number;
  if (shelf) {
    from = Math.max(0, daysBetween(board.date, w.localDate));
    to = Math.min(STRIP_DAYS, from + 1);
  } else {
    from = w.localDate === board.date ? minutesOf(w.localStart) / 60 : 0;
    to = endMinutes(w.localEnd) / 60;
  }
  return <div class="oos" style={pos(from, to)}><span>Out of service: {w.reason}</span></div>;
}

// ------------------------------------------------------------- block details

function BlockDetails({ state, blockText, busy, onClose, onAction, onPickUp, onCancel }: {
  state: Extract<DialogState, { kind: "details" }>; blockText: string; busy: string | null;
  onClose: () => void; onAction: (b: Booking, path: string, copy: (done: Booking) => string) => void;
  onPickUp: (b: Booking) => void; onCancel: (b: Booking) => void;
}) {
  const b = state.booking;
  // Exactly the booking's offered actions from the response the board held when the dialog opened.
  const offered = (action: OfferedAction): boolean => !!b && b.actions.includes(action);
  return (
    <Dialog title="Block details" onClose={onClose}>
      {b ? (
        <>
          <p class="dialog-lede">{labelFor(b)}</p>
          <p class="dialog-fee">Charge {money(b.chargeCents)}</p>
          <dl class="details">
            <dt>Business</dt><dd>{b.businessName}</dd>
            <dt>Status</dt><dd>{statusWords(b, false)}</dd>
            {b.kind === "hourly" && (<><dt>Hours</dt><dd>{hoursText(quartersOf(b.hours))} h · {hoursText(quartersOf(b.peakHours))} h peak</dd></>)}
            {b.notes && (<><dt>Notes</dt><dd>{b.notes}</dd></>)}
          </dl>
        </>
      ) : (
        <p class="dialog-lede">{blockText} · Booked</p>
      )}
      <div class="actions actions-wrap">
        {b && offered("check_in") && <Button variant="primary" busy={busy === "check-in"} onClick={() => onAction(b, "check-in", (x) => `Checked in ${x.businessName}.`)}>Check in</Button>}
        {b && offered("check_out") && <Button variant="primary" busy={busy === "check-out"} onClick={() => onAction(b, "check-out", (x) => `Checked out ${x.businessName}.`)}>Check out</Button>}
        {b && offered("no_show") && <Button busy={busy === "no-show"} onClick={() => onAction(b, "no-show", (x) => `Marked ${x.businessName} as no-show.`)}>Mark no-show</Button>}
        {b && offered("move") && <Button onClick={() => onPickUp(b)}>Pick up to move</Button>}
        {b && offered("cancel") && <Button onClick={() => onCancel(b)}>Cancel booking</Button>}
        <Button class="btn-quiet" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
