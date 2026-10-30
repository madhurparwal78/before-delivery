import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiFailure, serverNow } from "../api.js";
import { Live, Select, useApp, type Message } from "../app.js";
import { clock, hours, isDate, localDate, money, shiftDate } from "../format.js";
import { overlaps, packSplit, timeCents } from "../../shared/pricing.js";
import { MOTION, tween, useReducedMotion, useTweened } from "../tween.js";
import type { Booking, DayView, Hold, Pack, Renter, Segment } from "../types.js";
import { BookingDetails } from "./BookingDetails.js";
import { Checkout } from "./Checkout.js";
import { Dial, type ArcView, type DialTick, type Span } from "./Dial.js";
import { TicketList } from "./Tickets.js";

interface Selection { stationId: string; start: number; end: number; anchor: number }
interface Drag { stationId: string; anchor: number; cumulative: number; last: number; blocked: string | null }

const QUARTER = 15;
const MAX_MINUTES = 720;
const snap = (minute: number): number => Math.round(minute / QUARTER) * QUARTER;

/** "Booked 06:30–09:45" → its word and its two times. */
function labelParts(label: string): { word: string; from: string; to: string } {
  const found = /^(.*) (\d\d:\d\d)–(\d\d:\d\d)$/.exec(label);
  return { word: found?.[1] ?? label, from: found?.[2] ?? "", to: found?.[3] ?? "" };
}

const LEGEND: { word: string; kind: string }[] = [
  { word: "Free", kind: "free" }, { word: "Held", kind: "held" }, { word: "Booked", kind: "booked" }, { word: "Yours", kind: "yours" },
];

function Swatch({ kind }: { kind: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 20" width="40" height="20" className={`swatch swatch-${kind}`}>
      <defs><pattern id={`swatch-hatch-${kind}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="hatch-line" /></pattern></defs>
      <rect x="1.5" y="1.5" width="37" height="17" className="swatch-fill" />
      {kind === "booked" ? <rect x="1.5" y="1.5" width="37" height="17" fill={`url(#swatch-hatch-${kind})`} /> : null}
      {kind === "free" ? <path d="M10 1.5v6M20 1.5v6M30 1.5v6" className="swatch-tick" /> : null}
    </svg>
  );
}

export function Board() {
  const { user, sites } = useApp();
  const staff = user.role !== "renter";
  const reduced = useReducedMotion();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const site = sites.find((candidate) => candidate.id === siteId) ?? sites[0];
  const zone = site?.time_zone ?? "UTC";
  const [date, setDate] = useState(() => localDate(zone, serverNow()));
  const [dayText, setDayText] = useState(date);
  const [view, setView] = useState<DayView | null>(null);
  const [extra, setExtra] = useState<Map<string, Segment[]>>(new Map());
  const [renters, setRenters] = useState<Renter[]>([]);
  const [renterId, setRenterId] = useState("");
  const [renterPack, setRenterPack] = useState<number | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [dialMessage, setDialMessage] = useState<Message | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [arcView, setArcView] = useState<ArcView | null>(null);
  const [note, setNote] = useState<{ stationId: string; minute: number; text: string } | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [now, setNow] = useState(serverNow());
  const rings = useRef(new Map<string, SVGGElement>());
  const drag = useRef<Drag | null>(null);
  const selected = useRef<Selection | null>(null);
  const shownArc = useRef<ArcView | null>(null);
  const stopArc = useRef<() => void>(() => undefined);
  const placing = useRef(false);
  const current = useRef("");
  const checkoutButton = useRef<HTMLButtonElement>(null);

  const announce = useCallback((text: string, tone: Message["tone"] = "success") => setDialMessage({ text, tone }), []);

  const loadDay = useCallback(async (): Promise<void> => {
    const ask = `${siteId}/${date}`;
    current.current = ask;
    const day = await api<DayView>("GET", `/api/sites/${siteId}/day?date=${date}`);
    if (current.current !== ask) return;
    setView(day);
    setExtra(new Map());
  }, [siteId, date]);

  const loadRail = useCallback(async (): Promise<void> => {
    const result = await api<{ bookings: Booking[] }>("GET", staff ? `/api/bookings?site_id=${siteId}&date=${date}` : "/api/bookings");
    setBookings(result.bookings);
  }, [staff, siteId, date]);

  useEffect(() => {
    void loadDay();
    const timer = window.setInterval(() => void loadDay(), 10000);
    return () => window.clearInterval(timer);
  }, [loadDay]);
  useEffect(() => { void loadRail(); }, [loadRail]);
  useEffect(() => {
    if (staff) void api<{ renters: Renter[] }>("GET", "/api/renters?q=").then((result) => setRenters(result.renters));
  }, [staff]);
  const loadRenterPack = useCallback(async (): Promise<void> => {
    if (!staff || !renterId) { setRenterPack(null); return; }
    setRenterPack((await api<Pack>("GET", `/api/renters/${renterId}/pack`)).available_minutes);
  }, [staff, renterId]);
  useEffect(() => { void loadRenterPack(); }, [loadRenterPack]);

  const dayStart = view ? Date.parse(view.ticks[0]?.at ?? "") : 0;
  const dayMinutes = view ? view.hours * 60 : 1440;
  const at = useCallback((minute: number): number => dayStart + minute * 60000, [dayStart]);
  const hm = useCallback((minute: number): string => clock(zone, at(minute)), [zone, at]);

  const spans = useMemo(() => {
    const map = new Map<string, Span[]>();
    for (const station of view?.stations ?? []) {
      const segments = [...station.segments, ...(extra.get(station.id) ?? [])];
      map.set(station.id, segments.map((segment) => ({
        start: (Date.parse(segment.start_at) - dayStart) / 60000, end: (Date.parse(segment.end_at) - dayStart) / 60000, segment,
      })).sort((a, b) => a.start - b.start));
    }
    return map;
  }, [view, extra, dayStart]);

  const ticks: DialTick[] = useMemo(() => (view?.ticks ?? []).map((tick, _index, all) => ({
    minute: (Date.parse(tick.at) - dayStart) / 60000, label: tick.label, zone: tick.zone,
    repeated: all.filter((other) => other.label === tick.label).length > 1,
  })), [view, dayStart]);

  // A renter's live hold shows on the dial as "Your hold"; pick it up after a reload.
  useEffect(() => {
    if (staff || hold?.status === "held" || !view) return;
    const mine = view.stations.flatMap((station) => station.segments).find((segment) => segment.state === "yours_held" && segment.hold_id);
    if (mine?.hold_id) void api<{ hold: Hold }>("GET", `/api/holds/${mine.hold_id}`).then((result) => { if (result.hold.status === "held") setHold(result.hold); });
  }, [view, staff, hold]);

  const live = hold !== null && hold.status === "held" && Date.parse(hold.expires_at) > now;
  useEffect(() => {
    if (!hold || hold.status !== "held") return undefined;
    const timer = window.setInterval(() => setNow(serverNow()), 1000);
    return () => window.clearInterval(timer);
  }, [hold]);
  useEffect(() => {
    if (!hold || hold.status !== "held" || Date.parse(hold.expires_at) > now) return;
    void api<{ hold: Hold }>("GET", `/api/holds/${hold.id}`).then((result) => {
      if (result.hold.status !== "expired") return;
      setHold(result.hold);
      announce("Your hold ran out and the time was released.");
      void loadDay();
    });
  }, [hold, now, announce, loadDay]);

  const animateArc = useCallback((target: ArcView, duration: number, done?: () => void) => {
    stopArc.current();
    const from = shownArc.current && shownArc.current.stationId === target.stationId ? shownArc.current : target;
    stopArc.current = tween(duration, (progress) => {
      const next = {
        stationId: target.stationId, start: from.start + (target.start - from.start) * progress,
        end: from.end + (target.end - from.end) * progress, fill: from.fill + (target.fill - from.fill) * progress,
      };
      shownArc.current = next;
      setArcView(next);
    }, done);
  }, []);

  const clearSelection = useCallback(() => {
    stopArc.current();
    selected.current = null;
    shownArc.current = null;
    setSelection(null);
    setArcView(null);
    setNote(null);
  }, []);

  const choose = (next: Selection | null): void => {
    selected.current = next;
    setSelection(next);
  };

  // The server decides contested time; the dial only uses the same half-open test to stop the arc.
  const overlapping = (stationId: string, start: number, end: number): Span | undefined =>
    spans.get(stationId)?.find((span) => overlaps(span.start, span.end, start, end));

  const retract = (chosen: Selection): void => {
    animateArc({ stationId: chosen.stationId, start: chosen.anchor, end: chosen.anchor, fill: 0.16 }, MOTION.large, clearSelection);
  };

  const placeHold = async (chosen: Selection): Promise<void> => {
    if (placing.current) return;
    placing.current = true;
    announce("Placing hold…", "pending");
    try {
      const result = await api<{ hold: Hold }>("POST", "/api/holds", {
        station_id: chosen.stationId, start_at: new Date(at(chosen.start)).toISOString(), end_at: new Date(at(chosen.end)).toISOString(),
        ...(staff ? { renter_id: renterId } : {}),
      });
      setHold(result.hold);
      setNow(serverNow());
      announce(`Held until ${clock(zone, result.hold.expires_at)}. Finish checkout to keep it.`);
      setNote(null);
      animateArc({ stationId: chosen.stationId, start: chosen.start, end: chosen.end, fill: 1 }, MOTION.large, clearSelection);
      setCheckoutOpen(true);
      void loadDay();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "slot_taken") {
        const blocker = error.body.blocker as Segment;
        announce(`Another renter just took this time. ${blocker.label}`, "error");
        setExtra((previous) => new Map(previous).set(chosen.stationId, [...(previous.get(chosen.stationId) ?? []), { ...blocker, booking_id: null, hold_id: null, renter_business: null }]));
        void loadDay();
      } else if (error instanceof ApiFailure && error.status === 422) {
        announce(`That time can't be held: ${error.detail}`, "error");
      } else {
        announce(error instanceof ApiFailure ? error.detail : "Placing the hold failed. Try again.", "error");
      }
      retract(chosen);
    } finally {
      placing.current = false;
    }
  };

  const needsRenter = (): boolean => {
    if (staff && !renterId) {
      announce("Choose a renter in the Renter picker before claiming time.", "error");
      return true;
    }
    return false;
  };

  const onRingDown = (stationId: string, raw: number): boolean => {
    setFocused(stationId);
    if (!view || placing.current || needsRenter()) return false;
    const blocked = overlapping(stationId, raw, raw + 0.001);
    if (blocked) {
      announce(blocked.segment.label, "pending");
      return false;
    }
    const anchor = Math.min(dayMinutes - QUARTER, Math.max(0, snap(raw)));
    drag.current = { stationId, anchor, cumulative: raw, last: raw, blocked: null };
    stopArc.current();
    shownArc.current = { stationId, start: anchor, end: anchor, fill: 0.16 };
    setArcView(shownArc.current);
    setNote(null);
    choose({ stationId, start: anchor, end: anchor, anchor });
    return true;
  };

  const onMove = (raw: number): void => {
    const active = drag.current;
    if (!active) return;
    let delta = raw - active.last;
    if (delta > dayMinutes / 2) delta -= dayMinutes;
    if (delta < -dayMinutes / 2) delta += dayMinutes;
    active.last = raw;
    active.cumulative += delta;
    const target = snap(active.cumulative);
    const forward = target >= active.anchor;
    let start = Math.max(0, Math.min(active.anchor, target));
    let end = Math.max(active.anchor, target);
    if (end - start > MAX_MINUTES) {
      if (forward) end = start + MAX_MINUTES;
      else start = end - MAX_MINUTES;
    }
    const ring = spans.get(active.stationId) ?? [];
    const blocker = forward
      ? ring.filter((span) => span.start >= active.anchor && span.start < end).sort((a, b) => a.start - b.start)[0]
      : ring.filter((span) => span.end <= active.anchor && span.end > start).sort((a, b) => b.end - a.end)[0];
    const chosen = { stationId: active.stationId, start: blocker && !forward ? blocker.end : start, end: blocker && forward ? blocker.start : end, anchor: active.anchor };
    const previous = selected.current;
    choose(chosen);
    if (blocker) {
      const key = `${blocker.segment.start_at}-${forward ? "end" : "start"}`;
      if (active.blocked === key) return;
      active.blocked = key;
      const parts = labelParts(blocker.segment.label);
      const boundary = forward ? blocker.start : blocker.end;
      announce(`Stopped at ${blocker.segment.label}`, "error");
      setNote({ stationId: active.stationId, minute: boundary, text: `${parts.word} ${forward ? parts.from : parts.to}` });
      const overshoot = Math.min((6 / 360) * dayMinutes, Math.abs(active.cumulative - boundary)) * (forward ? 1 : -1);
      const sprung = { stationId: chosen.stationId, start: forward ? chosen.start : chosen.start + overshoot, end: forward ? chosen.end + overshoot : chosen.end, fill: 0.16 };
      animateArc(sprung, 0);
      animateArc({ ...sprung, start: chosen.start, end: chosen.end }, MOTION.large);
      return;
    }
    active.blocked = null;
    setNote(null);
    if (previous && previous.start === chosen.start && previous.end === chosen.end) return;
    animateArc({ stationId: chosen.stationId, start: chosen.start, end: chosen.end, fill: 0.16 }, MOTION.snap);
  };

  const onUp = (): void => {
    drag.current = null;
    const chosen = selected.current;
    if (!chosen || chosen.end - chosen.start < QUARTER) {
      clearSelection();
      return;
    }
    void placeHold(chosen);
  };

  const defaultStart = (): number => {
    const today = view && localDate(zone, serverNow()) === view.date;
    return today ? Math.min(dayMinutes - QUARTER, Math.ceil((serverNow() - dayStart) / 60000 / QUARTER) * QUARTER) : 0;
  };

  const onKey = (stationId: string, event: KeyboardEvent<SVGGElement>): void => {
    if (!["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Enter", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (needsRenter()) return;
    const chosen = selected.current && selected.current.stationId === stationId && selected.current.end > selected.current.start ? selected.current : null;
    if (event.key === "Escape") {
      clearSelection();
      announce("Selection cleared.", "pending");
      return;
    }
    if (event.key === "Enter") {
      if (!chosen) { announce("Use the arrow keys to choose a quarter hour first.", "pending"); return; }
      const taken = overlapping(stationId, chosen.start, chosen.end);
      if (taken) { announce(`That time is taken: ${taken.segment.label}`, "error"); return; }
      void placeHold(chosen);
      return;
    }
    const forward = event.key === "ArrowRight" || event.key === "ArrowUp";
    let next: Selection;
    if (!chosen) {
      const start = defaultStart();
      next = { stationId, start, end: start + QUARTER, anchor: start };
    } else if (event.shiftKey) {
      const end = chosen.end + (forward ? QUARTER : -QUARTER);
      if (end - chosen.start < QUARTER || end - chosen.start > MAX_MINUTES) { announce("A booking lasts 15 minutes to 12 hours.", "pending"); return; }
      const taken = forward ? overlapping(stationId, chosen.end, end) : undefined;
      if (taken) {
        announce(`Stopped at ${taken.segment.label}`, "error");
        setNote({ stationId, minute: taken.start, text: `${labelParts(taken.segment.label).word} ${labelParts(taken.segment.label).from}` });
        return;
      }
      next = { ...chosen, end };
    } else {
      const shift = forward ? QUARTER : -QUARTER;
      if (chosen.start + shift < 0 || chosen.end + shift > dayMinutes) { announce("That's the edge of the day.", "pending"); return; }
      next = { stationId, start: chosen.start + shift, end: chosen.end + shift, anchor: chosen.start + shift };
    }
    choose(next);
    setNote(null);
    animateArc({ stationId, start: next.start, end: next.end, fill: 0.16 }, MOTION.snap);
    const taken = overlapping(stationId, next.start, next.end);
    announce(taken
      ? `${hm(next.start)}–${hm(next.end)} is taken: ${taken.segment.label}`
      : `Selection ${hm(next.start)}–${hm(next.end)}, ${hours(next.end - next.start)} h. Free quarter hours.`, "pending");
  };

  const valueText = (stationId: string): string =>
    selection && selection.stationId === stationId && selection.end > selection.start
      ? `Selection ${hm(selection.start)}–${hm(selection.end)}, ${hours(selection.end - selection.start)} h`
      : "No selection";

  const applyDay = (text: string): void => {
    if (isDate(text)) { setDate(text); setDayText(text); clearSelection(); }
    else announce("Enter the day as YYYY-MM-DD.", "error");
  };
  const step = (days: number): void => applyDay(shiftDate(date, days));

  const station = view?.stations.find((candidate) => candidate.id === (selection?.stationId ?? hold?.station_id));
  const packAvailable = staff ? renterPack ?? 0 : view?.pack_minutes_available ?? 0;
  const draft = selection && selection.end > selection.start ? selection : null;
  const draftMinutes = draft ? draft.end - draft.start : 0;
  const draftPack = packSplit([draftMinutes], packAvailable)[0] ?? 0;
  const holdMinutes = hold && live ? hold.occurrences.reduce((sum, occurrence) => sum + occurrence.minutes, 0) : 0;
  const summary = draft
    ? { minutes: draftMinutes, pack: draftPack, card: draftMinutes - draftPack, cents: timeCents(draftMinutes - draftPack, station?.rate_cents ?? 0) }
    : hold && live
      ? { minutes: holdMinutes, pack: hold.quote.pack_minutes, card: hold.quote.card_minutes, cents: hold.quote.card_cents }
      : { minutes: 0, pack: 0, card: 0, cents: 0 };
  const shownMinutes = useTweened(summary.minutes, MOTION.numeral);
  const shownCents = useTweened(summary.cents, MOTION.numeral);
  const shownPack = useTweened(summary.pack, MOTION.numeral);
  const shownCard = useTweened(summary.card, MOTION.numeral);

  const remaining = hold && live ? Date.parse(hold.expires_at) - now : 0;
  const lifetime = hold ? Date.parse(hold.expires_at) - Date.parse(hold.created_at) : 1;
  const holdHere = hold && live && hold.site_id === siteId ? hold.occurrences.find((occurrence) => localDate(zone, occurrence.start_at) === date) : undefined;
  const countdown = live && !reduced ? { fromMinute: holdHere ? (Date.parse(holdHere.start_at) - dayStart) / 60000 : 0, fraction: Math.max(0, remaining / lifetime) } : null;
  const timerText = reduced && hold ? `Held until ${clock(zone, hold.expires_at)}` : `${String(Math.floor(remaining / 60000)).padStart(2, "0")}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
  const firstTick = view?.ticks[0];
  const lastTick = view?.ticks[view.ticks.length - 1];
  const changeDay = view && view.hours !== 24 && firstTick && lastTick ? `${view.hours}-hour day · clocks ${view.hours > 24 ? "fall back" : "spring forward"} (${firstTick.zone} → ${lastTick.zone})` : null;
  const holdSite = sites.find((candidate) => candidate.id === hold?.site_id);
  const holdStation = holdSite?.stations.find((candidate) => candidate.id === hold?.station_id);

  return (
    <main className="page board" id="main">
      <div className="board-grid">
        <div className="board-controls">
          <Select label="Site" inline value={siteId} onChange={(value) => { setSiteId(value); clearSelection(); }}>
            {sites.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </Select>
          <div className="day-controls">
            <button type="button" className="icon-button" aria-label="Previous day" onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></button>
            <label className="field field-inline field-day">
              <span>Day</span>
              <input type="text" inputMode="numeric" className="mono" value={dayText} onChange={(event) => setDayText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") applyDay(dayText); }} onBlur={() => { if (dayText !== date) applyDay(dayText); }} />
            </label>
            <button type="button" className="icon-button" aria-label="Next day" onClick={() => step(1)}><ChevronRight aria-hidden="true" /></button>
          </div>
          {staff ? (
            <Select label="Renter" inline value={renterId} onChange={setRenterId}>
              <option value="">Choose a renter</option>
              {renters.map((renter) => <option key={renter.id} value={renter.id}>{renter.business}</option>)}
            </Select>
          ) : null}
          {changeDay ? <p className="day-info"><strong>{changeDay}</strong></p> : null}
        </div>

        <section className="stations" aria-labelledby="stations-heading">
          <h2 id="stations-heading" className="caption">Stations</h2>
          <ul>
            {(view?.stations ?? site?.stations ?? []).map((candidate, index) => (
              <li key={candidate.id} className="station">
                <button type="button" className="station-button" aria-label={candidate.name} aria-pressed={focused === candidate.id}
                  onClick={() => { setFocused(candidate.id); rings.current.get(candidate.id)?.focus(); }}>
                  {candidate.name}
                </button>
                <span className="station-ring mono" aria-hidden="true">{index + 1}</span>
                <span className="station-rate mono">{money(candidate.rate_cents)}/h</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dial-area" aria-label="Day dial">
          {view ? (
            <Dial
              stations={view.stations}
              spans={spans}
              dayMinutes={dayMinutes}
              ticks={ticks}
              arc={arcView}
              claimed={staff && live ? hold?.id ?? null : null}
              focused={focused}
              note={note}
              countdown={countdown}
              valueText={valueText}
              valueNow={(stationId) => (selection && selection.stationId === stationId ? selection.start : 0)}
              ringRef={(stationId, element) => { if (element) rings.current.set(stationId, element); else rings.current.delete(stationId); }}
              onRingDown={onRingDown}
              onMove={onMove}
              onUp={onUp}
              onKey={onKey}
              onFocusRing={(stationId) => { if (stationId) setFocused(stationId); }}
            >
              <div className="summary" role="region" aria-label="Selection summary">
                <p className="summary-hours mono">{hours(shownMinutes)} h</p>
                <p className="summary-money mono">{money(Math.round(shownCents))}</p>
                <p className="summary-split"><span className="mono">Pack {hours(shownPack)} h</span> <span className={`mono summary-card${summary.card > 0 ? " summary-card-due" : ""}`}>Card {hours(shownCard)} h</span></p>
                <p className="summary-balance mono">Pack balance<br />{hours(packAvailable)} h</p>
              </div>
            </Dial>
          ) : <div className="dial-frame dial-loading" aria-busy="true" />}
          <Live label="Dial status" message={dialMessage} className="dial-status" />
        </section>

        <aside className="board-side" aria-label="Hold and legend">
          {hold && live ? (
            <div className="hold-bar">
              <Clock aria-hidden="true" size={18} />
              <span role="timer" aria-label="Hold time left" className="mono hold-timer">{timerText}</span>
              <button ref={checkoutButton} type="button" className="button button-primary" onClick={() => setCheckoutOpen(true)}>Checkout</button>
            </div>
          ) : null}
          {hold && checkoutOpen ? (
            <Checkout
              key={hold.id}
              hold={hold}
              zone={holdSite?.time_zone ?? zone}
              stationName={holdStation?.name ?? ""}
              siteName={holdSite?.name ?? ""}
              onClose={() => { setCheckoutOpen(false); checkoutButton.current?.focus(); }}
              onConfirmed={() => { setHold({ ...hold, status: "confirmed" }); announce("Booking confirmed. Your ticket is on the rail."); void loadRail(); void loadDay(); void loadRenterPack(); }}
              onReleased={() => { setHold({ ...hold, status: "expired" }); void loadDay(); }}
              onExpired={() => { setHold({ ...hold, status: "expired" }); void loadDay(); }}
            />
          ) : null}
          <ul className="legend" aria-label="Dial legend">
            {LEGEND.map((item) => <li key={item.word}><Swatch kind={item.kind} /><span>{item.word}</span></li>)}
          </ul>
          <section className="callouts" aria-labelledby="callouts-heading">
            <h2 id="callouts-heading" className="caption">On the dial</h2>
            {view && view.stations.some((candidate) => (spans.get(candidate.id) ?? []).length > 0) ? (
              <ol>
                {view.stations.map((candidate, index) => (spans.get(candidate.id) ?? []).length > 0 ? (
                  <li key={candidate.id}>
                    <span className="callout-station"><span className="station-ring mono" aria-hidden="true">{index + 1}</span>{candidate.name}</span>
                    <ul>
                      {(spans.get(candidate.id) ?? []).map((span) => (
                        <li key={`${span.segment.start_at}-${span.segment.state}`} className={`callout callout-${span.segment.state}`}>
                          <span className="callout-label mono">{span.segment.label}</span>
                          {span.segment.renter_business ? <span className="callout-business">{span.segment.renter_business}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : null)}
              </ol>
            ) : <p className="empty-row">Every ring is free this day.</p>}
          </section>
        </aside>

        <section className="rail-area" aria-labelledby="rail-heading">
          <h2 id="rail-heading" className="caption">{staff ? "Tickets at this site today" : "Your tickets"}</h2>
          <TicketList
            bookings={bookings}
            className="rail"
            zoneOf={(id) => sites.find((candidate) => candidate.id === id)?.time_zone ?? zone}
            onOpen={(booking) => setDetails(booking.id)}
            empty={staff ? "No tickets at this site on this day." : "No tickets yet. Sweep an arc on a ring to hold time."}
          />
        </section>
      </div>
      {details ? (
        <BookingDetails
          bookingId={details}
          zone={zone}
          announce={setDialMessage}
          onChanged={() => { void loadRail(); void loadDay(); }}
          onClose={() => setDetails(null)}
        />
      ) : null}
    </main>
  );
}
