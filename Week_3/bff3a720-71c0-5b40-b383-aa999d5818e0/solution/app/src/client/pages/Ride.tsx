import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type { Notice, Ride, RideChange, BookingWithChange } from "../../shared/api";
import { euros, plural, segmentPriceCents } from "../../shared/money";
import { MOTION_MS } from "../../shared/motion";
import { assignSeats, freeSeats } from "../../shared/seats";
import { brusselsInstant, hhmm, isoBrussels, localParts, shortDate } from "../../shared/time";
import { announce } from "../lib/announce";
import { kindLabel, ratingText } from "../lib/format";
import { ApiError, api, errorMessage, newKey } from "../lib/http";
import { useLive } from "../lib/live";
import { isReduced, useMotion } from "../lib/motion";
import { hasNavigated, Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { takeShutterSource, type ShutterSource } from "../lib/shutter";
import { useRequestOutcome } from "../lib/useBookingOutcome";
import { Alert, FieldError, StatusLine } from "../ui/Bits";
import { Dialog } from "../ui/Dialog";
import { LegSpan } from "../ui/LegSpan";
import { RequestPanel, RideUpdate } from "../ui/Panels";
import { Plate } from "../ui/Plate";
import { RollingPrice } from "../ui/RollingPrice";
import { Stepper } from "../ui/Stepper";
import { NotFoundPage } from "./NotFound";

const SEAT_TAKEN = "This seat was just taken. Choose another span or ride.";

interface Selection {
  from: number;
  to: number;
  cleared: boolean;
}

function initialSelection(ride: Ride, search: URLSearchParams): Selection {
  const cities = ride.stops.map((s) => s.city);
  const from = cities.indexOf(search.get("from") ?? "");
  const to = cities.indexOf(search.get("to") ?? "");
  return from >= 0 && to > from ? { from, to, cleared: false } : { from: 0, to: cities.length - 1, cleared: false };
}

function RidePlate({ ride, source, onRevealed }: { ride: Ride; source: ShutterSource | null; onRevealed: () => void }): ReactElement {
  const reduced = isReduced();
  const [state, setState] = useState<"running" | "done">(source && !reduced ? "running" : "done");
  const figure = useRef<HTMLElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const done = useRef(onRevealed);
  done.current = onRevealed;

  useLayoutEffect(() => {
    if (state !== "running" || !source || !canvas.current) return undefined;
    const target = canvas.current.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = "shutter-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const copy = document.createElement("canvas");
    copy.width = canvas.current.width;
    copy.height = canvas.current.height;
    copy.getContext("2d")?.drawImage(canvas.current, 0, 0);
    overlay.append(copy);
    document.body.append(overlay);
    const rect = (left: number, top: number, width: number, height: number): Record<string, string> => ({
      left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
    });
    const from = source.rect;
    const slit = 6;
    overlay.animate(
      [
        { ...rect(from.left, from.top, from.width, from.height), offset: 0, easing: "cubic-bezier(.5,0,.2,1)" },
        { ...rect(from.left + from.width / 2 - slit / 2, from.top, slit, from.height), offset: 0.33, easing: "cubic-bezier(.5,0,.2,1)" },
        { ...rect(target.left + target.width / 2 - slit / 2, target.top, slit, target.height), offset: 0.67, easing: "cubic-bezier(.2,.8,.2,1)" },
        { ...rect(target.left, target.top, target.width, target.height), offset: 1 },
      ],
      { duration: MOTION_MS["shutter-reveal"], fill: "forwards" },
    );
    const timer = window.setTimeout(() => {
      overlay.remove();
      setState("done");
      done.current();
    }, MOTION_MS["shutter-reveal"]);
    return () => {
      window.clearTimeout(timer);
      overlay.remove();
    };
  }, [state, source]);

  const first = ride.stops[0]?.city ?? "";
  const last = ride.stops[ride.stops.length - 1]?.city ?? "";
  return (
    <Plate
      seed={ride.id}
      ratio={1.25}
      className="ride-plate"
      figureRef={figure}
      canvasRef={canvas}
      hideDrawing={state === "running"}
      motion={{ name: "shutter-reveal", ms: reduced ? 0 : MOTION_MS["shutter-reveal"], state }}
      caption={`${first} to ${last}, the road as the driver sees it`}
    />
  );
}

export function RidePage({ id }: { id: string }): ReactElement {
  const session = useSession();
  const me = session.member;
  const { path, search } = useLocation();
  const [ride, setRide] = useState<Ride | null>(null);
  const [missing, setMissing] = useState(false);
  const [mine, setMine] = useState<BookingWithChange | null>(null);
  /** The booking this page placed itself: only then does the panel replace the Book button. */
  const [placed, setPlaced] = useState<string | null>(null);
  const [bookings, setBookings] = useState<BookingWithChange[]>([]);
  const [notices, setNotices] = useState<(Notice & { sent_at?: string | null })[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [seatCount, setSeatCount] = useState(() => Math.min(4, Math.max(1, Number(search.get("seats")) || 1)));
  const [pending, setPending] = useState(false);
  const [bookError, setBookError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const bookedHeading = useRef<HTMLHeadingElement | null>(null);
  const justBooked = useRef(false);
  const known = useRef<Map<string, string>>(new Map());
  const rideRef = useRef<Ride | null>(null);
  rideRef.current = ride;
  const confirmMotion = useMotion("booking-confirm");
  const [shutterSource] = useState(() => takeShutterSource());
  const shuttering = shutterSource !== null && !isReduced();

  const isDriver = !!me && !!ride && me.id === ride.driver.id;

  const loadNotices = useCallback(async () => {
    const reply = await api<{ notices: (Notice & { sent_at?: string | null })[] }>("GET", `/api/rides/${id}/notices`);
    setNotices(reply.notices);
  }, [id]);

  /** The queued-mail banner belongs to the last `Save new time`; it stays until that control sends again. */
  const [queued, setQueued] = useState(false);

  const load = useCallback(async () => {
    try {
      const fresh = await api<Ride>("GET", `/api/rides/${id}`);
      setRide(fresh);
      setSelection((current) => current ?? initialSelection(fresh, new URLSearchParams(window.location.search)));
      if (!me) return;
      if (me.id === fresh.driver.id) {
        const reply = await api<{ bookings: BookingWithChange[] }>("GET", `/api/rides/${id}/bookings`);
        setBookings(reply.bookings);
        known.current = new Map(reply.bookings.map((b) => [b.id, b.state]));
        await loadNotices();
      } else {
        let found: BookingWithChange | undefined;
        for (const tab of ["upcoming", "past"]) {
          if (found || (tab === "past" && (fresh.state === "published" || fresh.state === "changed"))) continue;
          const reply = await api<{ bookings: BookingWithChange[] }>("GET", `/api/me/bookings?tab=${tab}`);
          found = reply.bookings.find((b) => b.ride_id === fresh.id);
        }
        setMine(found ?? null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
    }
  }, [id, me, loadNotices]);

  useEffect(() => {
    void load();
  }, [load]);

  const driverBooking = useCallback(
    async (booking: BookingWithChange) => {
      const before = known.current.get(booking.id);
      known.current.set(booking.id, booking.state);
      setBookings((list) => (list.some((b) => b.id === booking.id) ? list.map((b) => (b.id === booking.id ? booking : b)) : [...list, booking]));
      const name = booking.passenger.display_name;
      if (booking.state === "requested" && before === undefined) {
        announce(`New request from ${name}: ${booking.boarding} to ${booking.alighting}.`);
      } else if (booking.state === "confirmed" && before !== "confirmed") {
        const fresh = await api<Ride>("GET", `/api/rides/${id}`);
        setRide(fresh);
        const cities = fresh.stops.map((s) => s.city);
        const left = freeSeats(fresh.seat_map, cities.indexOf(booking.boarding), cities.indexOf(booking.alighting)).length;
        announce(`Seat booked by ${name}: ${booking.boarding} to ${booking.alighting}. ${plural(left, "seat")} left.`);
      } else if (booking.state === "cancelled_by_passenger" && before !== "cancelled_by_passenger") {
        const ledger = await api<{ entries: { lines: { account: string; amount_cents: number }[] }[] }>("GET", `/api/bookings/${booking.id}/ledger`);
        const kept = ledger.entries
          .flatMap((e) => e.lines)
          .filter((l) => l.account === `earnings:${booking.driver.id}`)
          .reduce((sum, l) => sum + l.amount_cents, 0);
        announce(`${name} cancelled: ${booking.boarding} to ${booking.alighting}. You keep ${euros(kept)}.`);
        const fresh = await api<Ride>("GET", `/api/rides/${id}`);
        setRide(fresh);
      }
    },
    [id],
  );

  const { paused } = useLive({
    ride: id,
    onEvent: (event) => {
      switch (event.type) {
        case "hello":
        case "clock":
          void load();
          break;
        case "seat":
          if (event.data.ride_id === id) setRide((r) => (r ? { ...r, seat_map: event.data.seat_map } : r));
          break;
        case "ride":
          if (event.data.ride.id === id) setRide((r) => (!r || event.data.ride.version >= r.version ? event.data.ride : r));
          break;
        case "booking": {
          const booking = event.data.booking as BookingWithChange;
          if (booking.ride_id !== id) break;
          if (me && rideRef.current && me.id === rideRef.current.driver.id) void driverBooking(booking);
          else if (me && booking.passenger.id === me.id) setMine(booking);
          break;
        }
        case "notice":
          if (event.data.ride_id === id) void loadNotices();
          break;
        default:
          break;
      }
    },
  });

  useRequestOutcome(mine);

  const stops = ride?.stops ?? [];
  const legCount = Math.max(0, stops.length - 1);
  const sel = selection ?? { from: 0, to: Math.max(1, legCount), cleared: false };
  const free = ride ? freeSeats(ride.seat_map, sel.from, sel.to) : [];
  const chosen = Math.max(1, Math.min(seatCount, free.length));
  const segmentKm = ride ? (stops[sel.to]?.km ?? 0) - (stops[sel.from]?.km ?? 0) : 0;
  const unit = ride ? segmentPriceCents(ride.price_cents, segmentKm, ride.route_km) : 0;
  const total = unit * chosen;
  const assigned = ride ? (assignSeats(ride.seat_map, sel.from, sel.to, chosen) ?? []) : [];

  const active = mine && (mine.state === "held" || mine.state === "requested" || mine.state === "confirmed");

  useEffect(() => {
    if (!ride || !selection || selection.cleared || pending || active) return;
    if (freeSeats(ride.seat_map, selection.from, selection.to).length < seatCount) {
      setSelection({ ...selection, cleared: true });
      setBookError(SEAT_TAKEN);
    }
  }, [ride, selection, seatCount, pending, active]);

  useEffect(() => {
    if (mine?.state === "held" && !pending) setConfirmOpen(true);
    if (mine?.state !== "held") setConfirmOpen(false);
  }, [mine?.state, mine?.id, pending]);

  useLayoutEffect(() => {
    if (justBooked.current && mine?.state === "confirmed") {
      justBooked.current = false;
      bookedHeading.current?.focus();
      confirmMotion.play();
    }
  });

  useEffect(() => {
    if (heading.current && hasNavigated() && ride && !shuttering) heading.current.focus({ preventScroll: true });
    // the heading takes focus once, when the ride first appears; during the shutter reveal it waits for the end
  }, [ride?.id]);

  if (missing) return <NotFoundPage />;
  if (!ride) return <div className="ride-page" aria-busy="true" />;

  const first = stops[0]!;
  const lastStop = stops[stops.length - 1]!;
  const title = `${first.city} to ${lastStop.city}, ${shortDate(new Date(first.time))}`;
  const open = ride.state === "published" || ride.state === "changed";

  const move = (which: "from" | "to", index: number): void => {
    const next = { from: which === "from" ? index : sel.from, to: which === "to" ? index : sel.to, cleared: false };
    setSelection(next);
    setBookError("");
    const nextFree = freeSeats(ride.seat_map, next.from, next.to).length;
    const km = (stops[next.to]?.km ?? 0) - (stops[next.from]?.km ?? 0);
    const price = segmentPriceCents(ride.price_cents, km, ride.route_km) * Math.max(1, Math.min(seatCount, nextFree));
    announce(`${stops[next.from]?.city} to ${stops[next.to]?.city}, ${km} km, ${plural(nextFree, "seat")} free, ${euros(price)}`);
  };

  const book = async (): Promise<void> => {
    if (pending || sel.cleared || free.length === 0) return;
    if (!me) {
      navigate(`/sign-in?next=${encodeURIComponent(path + window.location.search)}`);
      return;
    }
    setPending(true);
    setBookError("");
    try {
      const booking = await api<BookingWithChange>("POST", `/api/rides/${ride.id}/bookings`, {
        body: { boarding: stops[sel.from]!.city, alighting: stops[sel.to]!.city, seats: chosen, ride_version: ride.version },
        key: newKey(),
      });
      setMine(booking);
      setPlaced(booking.id);
    } catch (e) {
      setBookError(errorMessage(e));
      if (e instanceof ApiError) {
        if (e.code === "seat_taken") {
          setSelection({ ...sel, cleared: true });
          const fresh = await api<Ride>("GET", `/api/rides/${id}`);
          setRide(fresh);
        } else if (e.code === "ride_changed" && e.ride) setRide(e.ride);
      }
    } finally {
      setPending(false);
    }
  };

  const release = async (): Promise<void> => {
    const booking = mine;
    setConfirmOpen(false);
    setMine(null);
    setPlaced(null);
    if (!booking) return;
    try {
      await api("POST", `/api/bookings/${booking.id}/release`);
    } catch {
      // the hold has already ended on the server
    }
    void load();
  };

  const confirmed = (booking: BookingWithChange): void => {
    justBooked.current = true;
    setConfirmOpen(false);
    setMine(booking);
    announce(`Seat booked: ${booking.boarding} to ${booking.alighting}, ${shortDate(new Date(booking.boarding_time))}. ${euros(booking.price_cents)} paid from your wallet.`);
  };

  const showBar = open && !isDriver && !(mine && mine.id === placed && (mine.state === "requested" || mine.state === "confirmed"));
  const label = pending ? "Working" : ride.booking_mode === "instant" ? "Book" : "Request to book";

  return (
    <div className={`ride-page${showBar ? " has-bar" : ""}`}>
      <h1 ref={heading} tabIndex={-1} className="ride-title">
        {title}
      </h1>
      {paused ? <div className="banner" role="alert">Live updates paused. Reconnecting.</div> : null}
      {ride.state === "cancelled" ? <div className="banner"><p>This ride was cancelled.</p></div> : null}

      <section className="ride-driver" aria-label="Driver and car">
        {ride.driver.photo_url ? <img src={ride.driver.photo_url} alt="" width="64" height="64" /> : null}
        <div>
          <p className="driver-name">{ride.driver.display_name}</p>
          <p className="muted">{ratingText(ride.driver.rating)}</p>
          <p className="muted">{`${ride.vehicle.make_model}, ${ride.vehicle.colour}, ${plural(ride.vehicle.seats, "seat")}`}</p>
        </div>
      </section>

      {mine && !isDriver ? <RideUpdate booking={mine} /> : null}

      <div className="ride-main">
        <ul className="stops" aria-label="Stops">
          {stops.map((stop) => (
            <li key={stop.city}>
              <span className="time">{hhmm(new Date(stop.time))}</span> {stop.city}
            </li>
          ))}
        </ul>

        <RidePlate ride={ride} source={shutterSource} onRevealed={() => heading.current?.focus({ preventScroll: true })} />

        <div className="ride-span">
          <LegSpan
            stops={stops}
            legs={ride.legs}
            seatMap={ride.seat_map}
            routeKm={ride.route_km}
            from={sel.from}
            to={sel.to}
            interactive={!isDriver && open}
            cleared={sel.cleared}
            assigned={assigned}
            onMove={move}
          />

          {showBar ? (
            <section aria-label="Book bar" className="book-bar">
              <RollingPrice price={euros(total)} km={segmentKm} />
              <Stepper
                label="Seats"
                value={chosen}
                min={1}
                max={Math.max(1, Math.min(4, free.length))}
                step={1}
                pageStep={2}
                format={String}
                disabled={sel.cleared || free.length === 0}
                onChange={setSeatCount}
                topNote="This is the most."
                bottomNote="This is the fewest."
                decreaseLabel="Fewer seats"
                increaseLabel="More seats"
              />
              <button type="button" className="primary book-button" disabled={sel.cleared || free.length === 0 || pending} onClick={() => void book()}>
                {label}
              </button>
              <Alert>{bookError}</Alert>
            </section>
          ) : null}

          {mine && !isDriver && mine.state === "confirmed" ? (
            <section aria-label="Your booking" className="panel booked" data-motion="booking-confirm" data-motion-ms={confirmMotion.ms} data-state={confirmMotion.state}>
              <h2 ref={bookedHeading} tabIndex={-1}>Seat booked</h2>
              <p>{`${mine.boarding} to ${mine.alighting}, ${plural(mine.seats, "seat")}`}</p>
              <Link href={`/bookings/${mine.id}`}>Open your booking</Link>
            </section>
          ) : null}
          {mine && !isDriver && mine.state !== "confirmed" && mine.state !== "held" && mine.state !== "cancelled_by_driver" && mine.state !== "cancelled_by_passenger" ? (
            <RequestPanel booking={mine} />
          ) : null}
        </div>
      </div>

      {isDriver ? (
        <DriverPanels
          ride={ride}
          bookings={bookings}
          notices={notices}
          queued={queued}
          onRide={setRide}
          onQueued={setQueued}
          onChanged={() => {
            void load();
          }}
        />
      ) : null}

      <Dialog open={confirmOpen && mine?.state === "held"} title="Confirm your seat" onClose={() => void release()}>
        {mine ? <ConfirmSeat booking={mine} onConfirmed={confirmed} onRelease={() => void release()} onFailed={() => { setConfirmOpen(false); setMine(null); void load(); }} setBarError={setBookError} /> : null}
      </Dialog>
    </div>
  );
}

function ConfirmSeat({ booking, onConfirmed, onRelease, onFailed, setBarError }: { booking: BookingWithChange; onConfirmed: (b: BookingWithChange) => void; onRelease: () => void; onFailed: () => void; setBarError: (m: string) => void }): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const until = booking.hold_expires_at ? new Date(booking.hold_expires_at) : null;

  const pay = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      onConfirmed(await api<BookingWithChange>("POST", `/api/bookings/${booking.id}/confirm`, { key: newKey() }));
    } catch (e) {
      if (e instanceof ApiError && (e.code === "hold_expired" || e.code === "invalid_transition")) {
        setBarError(e.message);
        onFailed();
      } else setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="confirm-seat">
      <p>{`${booking.boarding} to ${booking.alighting}, ${shortDate(new Date(booking.boarding_time))} at ${hhmm(new Date(booking.boarding_time))}`}</p>
      <p>{`${plural(booking.seats, "seat")}, ${euros(booking.price_cents)} from your wallet.`}</p>
      {until ? <p className="muted">{`Your seat is held until ${hhmm(until)}.`}</p> : null}
      <div className="actions">
        <button type="button" className="primary" onClick={() => void pay()}>
          {pending ? "Working" : "Confirm and pay"}
        </button>
        <button type="button" onClick={onRelease}>
          Release seat
        </button>
      </div>
      <Alert>{error}</Alert>
    </div>
  );
}

interface DriverProps {
  ride: Ride;
  bookings: BookingWithChange[];
  notices: (Notice & { sent_at?: string | null })[];
  queued: boolean;
  onRide: (ride: Ride) => void;
  onQueued: (queued: boolean) => void;
  onChanged: () => void;
}

function DriverPanels({ ride, bookings, notices, queued, onRide, onQueued, onChanged }: DriverProps): ReactElement {
  const requests = bookings.filter((b) => b.state === "requested");
  const passengers = bookings.filter((b) => b.state === "confirmed" || b.state === "completed" || b.state === "rated");
  const requestsHeading = useRef<HTMLHeadingElement | null>(null);
  const rowFocus = useRef<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<"time" | "seats" | "cancel" | null>(null);
  const [saved, setSaved] = useState("");
  const editable = ride.state === "published" || ride.state === "changed";

  useEffect(() => {
    if (rowFocus.current === null) return;
    const wanted = rowFocus.current;
    rowFocus.current = null;
    const row = wanted ? document.querySelector<HTMLElement>(`[data-id="${wanted}"] button`) : null;
    (row ?? requestsHeading.current)?.focus();
  });

  const decide = async (booking: BookingWithChange, action: "accept" | "decline"): Promise<void> => {
    const index = requests.findIndex((b) => b.id === booking.id);
    const next = requests[index + 1] ?? requests[index - 1];
    setRowError(null);
    try {
      await api("POST", `/api/bookings/${booking.id}/${action}`);
      rowFocus.current = next?.id ?? "";
      onChanged();
    } catch (e) {
      setRowError({ id: booking.id, message: errorMessage(e) });
      onChanged();
    }
  };

  return (
    <div className="driver-panels">
      <section aria-label="Requests" className="panel">
        <h2 ref={requestsHeading} tabIndex={-1}>Requests</h2>
        {requests.length === 0 ? <p className="muted">No requests are waiting.</p> : null}
        <ul className="rows">
          {requests.map((b) => (
            <li key={b.id} data-id={b.id}>
              <p>{`${b.passenger.display_name}: ${b.boarding} to ${b.alighting}, ${plural(b.seats, "seat")}, ${euros(b.price_cents)}`}</p>
              <div className="actions">
                <button type="button" onClick={() => void decide(b, "accept")}>{`Accept ${b.passenger.display_name}`}</button>
                <button type="button" onClick={() => void decide(b, "decline")}>{`Decline ${b.passenger.display_name}`}</button>
              </div>
              {rowError?.id === b.id ? <Alert>{rowError.message}</Alert> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Passengers panel" className="panel">
        <h2>Passengers</h2>
        <ul className="rows" aria-label="Passengers">
          {passengers.map((b) => (
            <li key={b.id} data-id={b.id}>
              <Link href={`/bookings/${b.id}`}>{`${b.passenger.display_name}: ${b.boarding} to ${b.alighting}, ${plural(b.seats, "seat")}`}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Notices panel" className="panel">
        <h2>Passenger notices</h2>
        {queued ? <div role="alert" className="alert">Saved. Emails to passengers are queued and will be sent when mail is back.</div> : null}
        <ul className="rows" aria-label="Passenger notices">
          {notices.map((n, i) => (
            <li key={`${n.passenger_id}-${n.kind}-${i}`}>
              {n.status === "sent" && n.sent_at ? `${n.name}: ${kindLabel(n.kind)} sent at ${hhmm(new Date(n.sent_at))}` : `${n.name}: ${kindLabel(n.kind)} queued`}
            </li>
          ))}
        </ul>
      </section>

      <StatusLine text={saved} />
      {editable ? (
        <div className="actions driver-actions">
          <button type="button" onClick={() => setDialog("time")}>Change departure</button>
          <button type="button" onClick={() => setDialog("seats")}>Change seats</button>
          <button type="button" onClick={() => setDialog("cancel")}>Cancel ride</button>
        </div>
      ) : null}

      <ChangeDeparture
        open={dialog === "time"}
        ride={ride}
        onClose={() => setDialog(null)}
        onSaved={(change) => {
          setDialog(null);
          onRide(change.ride);
          const waiting = change.notices.some((n) => n.status === "queued");
          onQueued(waiting);
          if (!waiting) {
            const message = `Departure saved and ${plural(change.notices.length, "passenger")} emailed.`;
            announce(message);
            setSaved(message);
          }
          onChanged();
        }}
      />
      <ChangeSeats
        open={dialog === "seats"}
        ride={ride}
        onClose={() => setDialog(null)}
        onSaved={(change) => {
          setDialog(null);
          onRide(change.ride);
          announce("Seats saved.");
          setSaved("Seats saved.");
          onChanged();
        }}
      />
      <Dialog open={dialog === "cancel"} title="Cancel this ride" onClose={() => setDialog(null)}>
        <CancelRide
          ride={ride}
          onClose={() => setDialog(null)}
          onCancelled={(change) => {
            setDialog(null);
            onRide(change.ride);
            announce("Ride cancelled. Every passenger has been refunded.");
            setSaved("Ride cancelled. Every passenger has been refunded.");
            onChanged();
          }}
        />
      </Dialog>
    </div>
  );
}

function patchRide(ride: Ride, body: Record<string, unknown>): Promise<RideChange> {
  return api<RideChange>("PATCH", `/api/rides/${ride.id}`, { body, headers: { "If-Match": String(ride.version) } });
}

function ChangeDeparture({ open, ride, onClose, onSaved }: { open: boolean; ride: Ride; onClose: () => void; onSaved: (c: RideChange) => void }): ReactElement {
  const current = hhmm(new Date(ride.stops[0]!.time));
  const [time, setTime] = useState(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState("");

  useEffect(() => {
    if (open) {
      setTime(current);
      setError("");
      setField("");
    }
  }, [open, current]);

  const save = async (): Promise<void> => {
    if (pending) return;
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) {
      setField("Enter the time as HH:MM.");
      return;
    }
    const day = localParts(new Date(ride.stops[0]!.time));
    const instant = brusselsInstant(day.year, day.month, day.day, Number(match[1]), Number(match[2]));
    setPending(true);
    setError("");
    setField("");
    try {
      onSaved(await patchRide(ride, { departure: isoBrussels(instant) }));
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setField(e.fields.departure ?? "");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} title="Change departure" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="new-departure">New departure time</label>
          <input id="new-departure" type="text" inputMode="numeric" autoComplete="off" value={time} aria-describedby="new-departure-error" onChange={(e) => setTime(e.target.value)} />
          <FieldError id="new-departure-error" message={field} />
        </div>
        <div className="actions">
          <button type="submit" className="primary">{pending ? "Working" : "Save new time"}</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <Alert>{error}</Alert>
      </form>
    </Dialog>
  );
}

function ChangeSeats({ open, ride, onClose, onSaved }: { open: boolean; ride: Ride; onClose: () => void; onSaved: (c: RideChange) => void }): ReactElement {
  const [seats, setSeats] = useState(ride.seats);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState("");

  useEffect(() => {
    if (open) {
      setSeats(ride.seats);
      setError("");
      setField("");
    }
  }, [open, ride.seats]);

  const save = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    setField("");
    try {
      onSaved(await patchRide(ride, { seats }));
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setField(e.fields.seats ?? "");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} title="Change seats" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Stepper
          label="Seats"
          value={seats}
          min={1}
          max={Math.min(4, ride.vehicle.seats)}
          step={1}
          pageStep={2}
          format={String}
          onChange={setSeats}
          topNote="This is the most."
          bottomNote="This is the fewest."
          decreaseLabel="Fewer seats"
          increaseLabel="More seats"
          describedBy="change-seats-error"
        />
        <FieldError id="change-seats-error" message={field} />
        <div className="actions">
          <button type="submit">{pending ? "Working" : "Save seats"}</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <Alert>{error}</Alert>
      </form>
    </Dialog>
  );
}

function CancelRide({ ride, onClose, onCancelled }: { ride: Ride; onClose: () => void; onCancelled: (c: RideChange) => void }): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const cancel = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      onCancelled(await api<RideChange>("POST", `/api/rides/${ride.id}/cancel`, { key: newKey() }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div>
      <p>Every passenger is refunded in full and gets one email.</p>
      <div className="actions">
        <button type="button" onClick={() => void cancel()}>{pending ? "Working" : "Cancel ride for everyone"}</button>
        <button type="button" onClick={onClose}>Keep ride</button>
      </div>
      <Alert>{error}</Alert>
    </div>
  );
}
