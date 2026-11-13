import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { Booking, BookingRating, Member, Message, Presence, BookingWithChange } from "../../shared/api";
import { euros, plural } from "../../shared/money";
import { hhmm, shortDate, shortDateTime } from "../../shared/time";
import { announce } from "../lib/announce";
import { STATUS } from "../lib/format";
import { ApiError, api, errorMessage, newKey } from "../lib/http";
import { useLive } from "../lib/live";
import { useMotion } from "../lib/motion";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { useRequestOutcome } from "../lib/useBookingOutcome";
import { Alert, FieldError, PageHeading } from "../ui/Bits";
import { Dialog } from "../ui/Dialog";
import { RequestPanel, RideUpdate } from "../ui/Panels";
import { NotFoundPage } from "./NotFound";


export function BookingPage({ id }: { id: string }): ReactElement {
  const session = useSession();
  const me = session.member;
  const [booking, setBooking] = useState<BookingWithChange | null>(null);
  const [missing, setMissing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [rating, setRating] = useState<BookingRating | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const bookingRef = useRef<BookingWithChange | null>(null);
  bookingRef.current = booking;

  const loadRating = useCallback(async () => {
    try {
      setRating(await api<BookingRating>("GET", `/api/bookings/${id}/rating`));
    } catch {
      setRating(null);
    }
  }, [id]);

  const load = useCallback(async () => {
    try {
      const fresh = await api<BookingWithChange>("GET", `/api/bookings/${id}`);
      setBooking(fresh);
      const thread = await api<{ messages: Message[]; presence: Presence }>("GET", `/api/bookings/${id}/messages`);
      setMessages(thread.messages);
      setPresence(thread.presence);
      await loadRating();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
    }
  }, [id, loadRating]);

  useEffect(() => {
    void load();
  }, [load]);

  const otherOf = (b: Booking): Member => (me && me.id === b.passenger.id ? b.driver : b.passenger);

  useLive({
    ride: booking?.ride_id,
    thread: id,
    onEvent: (event) => {
      switch (event.type) {
        case "hello":
        case "clock":
        case "ride":
          void load();
          break;
        case "booking":
          if (event.data.booking.id === id) setBooking(event.data.booking as BookingWithChange);
          break;
        case "message": {
          if (event.data.booking_id !== id) break;
          const message = event.data.message;
          setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]));
          const current = bookingRef.current;
          if (current && me && message.author_id !== me.id) announce(`New message from ${otherOf(current).display_name}`);
          break;
        }
        case "presence":
          if (event.data.booking_id === id) setPresence({ member_id: event.data.member_id, online: event.data.online, last_seen_at: event.data.last_seen_at });
          break;
        case "rating":
          if (event.data.booking_id === id) void load();
          break;
        default:
          break;
      }
    },
  });

  const previousRating = useRef<string | null>(null);
  const reveal = useMotion("rating-reveal");
  const { play } = reveal;
  useEffect(() => {
    if (!rating || !booking || !me) return;
    const was = previousRating.current;
    previousRating.current = rating.state;
    if (rating.state === "revealed" && was !== "revealed") {
      announce(revealText(rating, otherOf(booking).display_name));
      play();
    }
    // announcements follow the rating state only
  }, [rating?.state]);

  useRequestOutcome(booking);

  if (missing) return <NotFoundPage />;
  if (!booking || !me) return <div className="booking-page" aria-busy="true" />;

  const isPassenger = me.id === booking.passenger.id;
  const other = otherOf(booking);
  const date = shortDate(new Date(booking.boarding_time));
  const title = isPassenger
    ? `Your seat: ${booking.boarding} to ${booking.alighting}, ${date}`
    : `${booking.passenger.display_name}: ${booking.boarding} to ${booking.alighting}, ${date}`;
  const participant = me.id === booking.passenger.id || me.id === booking.driver.id;
  const ratable = booking.state === "confirmed" || booking.state === "completed" || booking.state === "rated";

  return (
    <div className="booking-page">
      <PageHeading>{title}</PageHeading>
      <section className="panel" aria-label="Booking details">
        <p>{`Status: ${STATUS[booking.state]}`}</p>
        <p className="muted">{`${plural(booking.seats, "seat")}, ${euros(booking.price_cents)}, boarding ${hhmm(new Date(booking.boarding_time))}`}</p>
        <ol className="history" aria-label="History">
          {booking.history.map((h) => (
            <li key={`${h.state}-${h.at}`}>{`${STATUS[h.state]}, ${shortDateTime(new Date(h.at))}`}</li>
          ))}
        </ol>
      </section>

      {isPassenger ? <RideUpdate booking={booking} /> : null}

      {isPassenger && (booking.state === "requested" || booking.state === "declined" || booking.state === "expired" || booking.state === "withdrawn") ? (
        <RequestPanel booking={booking} withdrawable onChanged={(b) => setBooking(b as BookingWithChange)} />
      ) : null}

      {isPassenger && booking.cancel_quote ? (
        <div className="actions">
          <button type="button" onClick={() => setCancelOpen(true)}>
            Cancel my seat
          </button>
        </div>
      ) : null}

      {participant && booking.state !== "held" ? (
        <Thread bookingId={booking.id} other={other} me={me} messages={messages} presence={presence} onSent={(m) => setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))} />
      ) : null}

      {participant && ratable ? (
        <RatingPanel booking={booking} rating={rating} other={other} motion={reveal} onSubmitted={() => void load()} />
      ) : null}

      <CancelBooking open={cancelOpen} bookingId={booking.id} onClose={() => setCancelOpen(false)} />
    </div>
  );
}

function revealText(rating: BookingRating, other: string): string {
  if (rating.mine && rating.theirs) {
    return `Ratings revealed: you gave ${plural(rating.mine.stars, "star")}, ${other} gave you ${plural(rating.theirs.stars, "star")}.`;
  }
  if (rating.mine) return `Ratings revealed: you gave ${plural(rating.mine.stars, "star")}. ${other} did not rate.`;
  if (rating.theirs) return `Ratings revealed: ${other} gave you ${plural(rating.theirs.stars, "star")}. You did not rate.`;
  return "The rating window closed without ratings.";
}

function CancelBooking({ open, bookingId, onClose }: { open: boolean; bookingId: string; onClose: () => void }): ReactElement {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBooking(null);
    setError("");
    api<Booking>("GET", `/api/bookings/${bookingId}`)
      .then(setBooking)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [open, bookingId]);

  const quote = booking?.cancel_quote ?? null;
  let text = "";
  if (booking && quote) {
    text =
      quote.reason === "free_window"
        ? `Cancelling now refunds ${euros(booking.price_cents)} of ${euros(booking.price_cents)} (100%, free after the driver's time change).`
        : `Cancelling now refunds ${euros(quote.refund_cents)} of ${euros(booking.price_cents)} (${quote.percent}%, ${plural(quote.hours_before, "hour")} before departure).`;
  }

  const cancel = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api("POST", `/api/bookings/${bookingId}/cancel`, { key: newKey() });
      navigate("/wallet");
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  };

  return (
    <Dialog open={open} title="Cancel this booking" onClose={onClose} initialFocus={(root) => root.querySelector<HTMLElement>("[data-keep]")}>
      <p aria-live="off">{text || (error ? "" : "Checking the refund.")}</p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void cancel()}>
          {pending ? "Working" : "Cancel booking"}
        </button>
        <button type="button" data-keep onClick={onClose}>
          Keep booking
        </button>
      </div>
      <Alert>{error}</Alert>
    </Dialog>
  );
}

interface ThreadProps {
  bookingId: string;
  other: Member;
  me: Member;
  messages: Message[];
  presence: Presence | null;
  onSent: (message: Message) => void;
}

function Thread({ bookingId, other, me, messages, presence, onSent }: ThreadProps): ReactElement {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length]);

  const send = async (): Promise<void> => {
    const body = text.trim();
    if (pending || !body) return;
    setPending(true);
    setError("");
    try {
      onSent(await api<Message>("POST", `/api/bookings/${bookingId}/messages`, { body: { body } }));
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  let presenceText = `${other.display_name} has not opened this thread yet`;
  if (presence && presence.member_id === other.id) {
    if (presence.online) presenceText = `${other.display_name} is online`;
    else if (presence.last_seen_at) presenceText = `${other.display_name} was online at ${hhmm(new Date(presence.last_seen_at))}`;
  }

  const names = new Map([[me.id, me.display_name], [other.id, other.display_name]]);

  return (
    <section className="panel thread" aria-label="Conversation">
      <h2>Messages</h2>
      <p className="muted presence">{presenceText}</p>
      <div role="log" aria-label={`Messages with ${other.display_name}`} className="log" tabIndex={0} ref={log}>
        {messages.map((m) => (
          <p key={m.id} data-id={m.id} className={m.author_id === me.id ? "mine" : "theirs"}>
            <span className="muted">{`${names.get(m.author_id) ?? ""} ${hhmm(new Date(m.sent_at))}`}</span>
            <span className="body">{m.body}</span>
          </p>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="message-box">{`Message ${other.display_name}`}</label>
        <textarea
          id="message-box"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit">{pending ? "Working" : "Send"}</button>
        <Alert>{error}</Alert>
      </form>
    </section>
  );
}

function RatingPanel({ booking, rating, other, motion, onSubmitted }: { booking: Booking; rating: BookingRating | null; other: Member; motion: ReturnType<typeof useMotion>; onSubmitted: () => void }): ReactElement {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const state = rating?.state ?? "not_open";

  const submit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    setFields({});
    try {
      await api("POST", `/api/bookings/${booking.id}/rating`, { body: { ...(stars ? { stars } : {}), comment } });
      onSubmitted();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setFields(e.fields);
    } finally {
      setPending(false);
    }
  };

  const canRate = (state === "open" || (state === "waiting" && !rating?.mine));
  return (
    <section aria-label="Rating" className="panel rating">
      {state === "not_open" ? <p>You can rate this trip once it arrives.</p> : null}
      {state === "waiting" ? <p>Waiting for both ratings</p> : null}
      {state === "closed" ? <p>The rating window closed without ratings.</p> : null}
      {state === "revealed" && rating ? (
        <div data-motion="rating-reveal" data-motion-ms={motion.ms} data-state={motion.state} className="revealed">
          <p>{revealText(rating, other.display_name)}</p>
          {rating.theirs?.comment ? <p className="muted">{`${other.display_name}: ${rating.theirs.comment}`}</p> : null}
        </div>
      ) : null}
      {canRate ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div role="radiogroup" aria-label={`Rating for ${other.display_name}`} className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={`star${stars >= n ? " is-on" : ""}`}>
                <input type="radio" name="stars" aria-label={plural(n, "star")} checked={stars === n} onChange={() => setStars(n)} />
                <span aria-hidden="true">{n}</span>
              </label>
            ))}
          </div>
          <FieldError id="stars-error" message={fields.stars} />
          <div className="field">
            <label htmlFor="rating-comment">Comment</label>
            <textarea id="rating-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            <FieldError id="comment-error" message={fields.comment} />
          </div>
          <button type="submit" className="primary">
            {pending ? "Working" : "Submit rating"}
          </button>
          <Alert>{error}</Alert>
        </form>
      ) : null}
    </section>
  );
}
