import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useAnnounce } from "../announce";
import { ApiError, type Booking, type Match, type Me, type Quote, RequestKey, call, messageOf, sessionEnded } from "../api";
import { type SlotDraft, cellPath, saveDraft, signInReturningTo } from "../draft";
import { type Countdown, mmss, setServerNow } from "../clock";
import { clubTime, euros, levelOptions } from "../format";
import { ErrorBand, FieldBand } from "./Feedback";
import { Halo, useCountdownText } from "./Halo";
import { Modal } from "./Modal";

export interface CellInfo {
  court: number;
  start: string;
  state: string;
  mine: boolean;
  bookingId: string | null;
}

interface HoldTracker {
  countdowns: Record<string, Countdown>;
  track: (booking: Booking) => void;
  drop: (id: string) => void;
}

interface Props {
  cell: CellInfo;
  /** The Courts day the cell belongs to, YYYY-MM-DD. */
  day: string;
  /** A draft saved when the session ended during an action, restored for the same person after sign-in. */
  draft: SlotDraft | null;
  me: Me;
  holds: HoldTracker;
  onClose: () => void;
  onChanged: () => void;
}

type View = "form" | "held" | "paid" | "matched" | "ended" | "detail";

const lengths = [60, 90, 120];

const detailCopy: Record<string, string> = {
  held: "Another player is holding this court. It frees up if they do not pay in time.",
  booked: "This court is booked.",
  match: "An open match is booked here. You can find it under Matches.",
  lesson: "A coach lesson is booked here.",
  past: "This time has passed.",
  free: "This court is free.",
};

function defaultLevels(level: number | null): [string, string] {
  if (level === null) return ["1.0", "7.0"];
  return [Math.max(1, level - 0.5).toFixed(1), Math.min(7, level + 0.5).toFixed(1)];
}

function useQuote(cell: CellInfo, minutes: number) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const ticket = useRef(0);
  useEffect(() => {
    const mine = ++ticket.current;
    const controller = new AbortController();
    setQuote(null);
    const query = new URLSearchParams({ court: String(cell.court), start: cell.start.slice(0, 16), minutes: String(minutes) });
    call<Quote>(`/api/quote?${query}`, { signal: controller.signal })
      .then((answer) => {
        if (ticket.current === mine) setQuote(answer);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [cell.court, cell.start, minutes]);
  return quote;
}

function Field({ label, error, children, errorId }: { label: string; error?: string; children: ReactNode; errorId: string }) {
  return (
    <div className="field">
      <label className="field__label">
        <span>{label}</span>
        {children}
      </label>
      {error && <FieldBand id={errorId}>{error}</FieldBand>}
    </div>
  );
}

export function SlotDialog({ cell, day, draft, me, holds, onClose, onChanged }: Props) {
  const announce = useAnnounce();
  const uid = useId();
  const titleId = `${uid}-title`;
  const liveHold = cell.mine && cell.state === "held";
  // A restored draft reopens its live hold, or else the hold form; it never sends anything by itself.
  const initial: View = draft ? (liveHold && draft.bookingId === cell.bookingId ? "held" : "form") : cell.state === "free" ? "form" : liveHold ? "held" : "detail";
  const [view, setView] = useState<View>(initial);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [minutes, setMinutes] = useState(draft?.minutes ?? 60);
  const [split, setSplit] = useState(draft?.split ?? false);
  const [emails, setEmails] = useState(draft?.emails ?? ["", "", ""]);
  const [note, setNote] = useState(draft?.note ?? "");
  const [openMatch, setOpenMatch] = useState(draft?.openMatch ?? false);
  const [low, setLow] = useState(() => draft?.low ?? defaultLevels(me.level)[0]);
  const [high, setHigh] = useState(() => draft?.high ?? defaultLevels(me.level)[1]);
  const [pending, setPending] = useState<"" | "hold" | "pay" | "release">("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const payRef = useRef<HTMLButtonElement>(null);
  const holdRef = useRef<HTMLButtonElement>(null);
  const focusPay = useRef(draft !== null && initial === "held");
  const holdKey = useRef(new RequestKey());
  const payKey = useRef(new RequestKey());
  const ended = useRef(false);
  const resyncing = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);

  const quote = useQuote(cell, minutes);
  const countdown = booking ? (holds.countdowns[booking.id] ?? null) : null;

  const holdFor = (id: string) => holds.countdowns[id];

  const endHold = useCallback(
    (id: string) => {
      holds.drop(id);
      if (!ended.current) {
        ended.current = true;
        announce("Hold released.");
        setView("ended");
      }
      onChanged();
    },
    [announce, holds, onChanged],
  );

  const resync = useCallback(async () => {
    if (!booking || resyncing.current || ended.current) return;
    resyncing.current = true;
    try {
      const fresh = await call<Booking>(`/api/bookings/${booking.id}`);
      setServerNow(fresh.server_now);
      if (fresh.status === "held") holds.track(fresh);
      else if (fresh.status === "released") endHold(fresh.id);
      else {
        holds.drop(fresh.id);
        setView("paid");
      }
    } catch {
      // The next resync reads the server again; the screen keeps counting from the last server answer.
    } finally {
      resyncing.current = false;
    }
  }, [booking, endHold, holds]);

  // A held cell opened from the grid: read the hold from the server.
  useEffect(() => {
    if (initial !== "held" || !cell.bookingId) return;
    let live = true;
    call<Booking>(`/api/bookings/${cell.bookingId}`)
      .then((fresh) => {
        if (!live) return;
        setServerNow(fresh.server_now);
        setBooking(fresh);
        if (fresh.status === "held") holds.track(fresh);
        else setView(fresh.status === "released" ? "ended" : "paid");
      })
      .catch((e: unknown) => live && setError(messageOf(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a hold is open, re-read it at least every 5 seconds; the server's answer wins.
  useEffect(() => {
    if (view !== "held" || !booking) return;
    const timer = window.setInterval(() => void resync(), 5000);
    return () => window.clearInterval(timer);
  }, [view, booking, resync]);

  useEffect(() => {
    if (view === "held" && focusPay.current && booking) {
      focusPay.current = false;
      payRef.current?.focus();
    }
    if (view === "paid" || view === "matched") closeRef.current?.focus();
  }, [view, booking]);

  // A draft restored onto the hold form puts focus on Hold slot (or Open match).
  useEffect(() => {
    if (draft && initial === "form") holdRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The session ended during an action: keep the dialog for this person, say nothing, and sign in again. */
  const keepForSignIn = (bookingId: string | null) => {
    saveDraft({
      username: me.username,
      day,
      court: cell.court,
      time: clubTime(cell.start),
      minutes,
      split,
      emails,
      note,
      openMatch,
      low,
      high,
      bookingId,
    });
    signInReturningTo(cellPath(day, cell.court, clubTime(cell.start)));
  };

  const timerText = useCountdownText(countdown, () => void resync());

  const fieldTargets: Record<string, string> = {
    court: "length",
    minutes: "length",
    start: "length",
    note: "note",
    co_players: "email-0",
    level: "levels",
    level_min: "levels",
    level_max: "levels",
  };

  const focusFirstInvalid = (problems: Record<string, string>) => {
    const first = Object.keys(problems)[0];
    const target = first ? fieldTargets[first] : undefined;
    window.setTimeout(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${target}"]`)?.focus(), 0);
  };

  const submitHold = async () => {
    setPending("hold");
    setError(null);
    setFields({});
    const start = cell.start.slice(0, 16);
    try {
      if (openMatch) {
        const body = { court: cell.court, start, minutes, level_min: Number(low), level_max: Number(high) };
        const match = await call<Match>("/api/matches", {
          method: "POST",
          key: holdKey.current.for(`match ${JSON.stringify(body)}`),
          body,
          handlesSessionEnd: true,
        });
        holdKey.current.settle(null);
        setServerNow(match.server_now);
        announce("You joined the match.");
        setView("matched");
        onChanged();
        return;
      }
      const body: Record<string, unknown> = { court: cell.court, start, minutes, note };
      if (split) body.co_players = emails.map((e) => e.trim());
      const held = await call<Booking>("/api/holds", {
        method: "POST",
        key: holdKey.current.for(`hold ${JSON.stringify(body)}`),
        body,
        handlesSessionEnd: true,
      });
      holdKey.current.settle(null);
      setServerNow(held.server_now);
      holds.track(held);
      setBooking(held);
      announce(`Slot held for ${mmss(Date.parse(held.expires_at ?? held.created_at) - Date.parse(held.created_at))}.`);
      focusPay.current = true;
      setView("held");
      onChanged();
    } catch (e) {
      holdKey.current.settle(e);
      if (sessionEnded(e)) {
        keepForSignIn(null);
        return;
      }
      if (e instanceof ApiError && e.status === 422 && Object.keys(e.fields).length > 0) {
        setFields(e.fields);
        focusFirstInvalid(e.fields);
      } else {
        setError(messageOf(e));
        if (e instanceof ApiError && ["SLOT_TAKEN", "MATCH_FULL", "HOLD_EXPIRED"].includes(e.code)) onChanged();
      }
    } finally {
      setPending("");
    }
  };

  const pay = async () => {
    if (!booking) return;
    setPending("pay");
    setError(null);
    try {
      const paid = await call<Booking>(`/api/bookings/${booking.id}/pay`, {
        method: "POST",
        key: payKey.current.for(booking.id),
        body: {},
        handlesSessionEnd: true,
      });
      payKey.current.settle(null);
      setServerNow(paid.server_now);
      holds.drop(paid.id);
      setBooking(paid);
      announce("Payment received.");
      setView("paid");
      onChanged();
    } catch (e) {
      payKey.current.settle(e);
      if (sessionEnded(e)) {
        keepForSignIn(booking.id);
        return;
      }
      setError(messageOf(e));
      if (e instanceof ApiError && e.code === "HOLD_EXPIRED") void resync();
    } finally {
      setPending("");
    }
  };

  const release = async () => {
    if (!booking) return;
    setPending("release");
    setError(null);
    try {
      await call<Booking>(`/api/bookings/${booking.id}/release`, { method: "POST", body: {} });
      ended.current = true;
      holds.drop(booking.id);
      announce("Hold released.");
      onChanged();
      onClose();
    } catch (e) {
      setError(messageOf(e));
      setPending("");
    }
  };

  const title = `Court ${cell.court} at ${clubTime(cell.start)}`;
  const heldCountdown = view === "held" && booking ? holdFor(booking.id) : undefined;

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="slot-dialog">
      <div className="slot-dialog__band">
        <button type="button" ref={closeRef} className="pill pill--ghost slot-dialog__close" onClick={onClose}>
          Close
        </button>
        <h2 id={titleId}>{title}</h2>
        {heldCountdown && (
          <div className="hold-badge">
            <Halo countdown={heldCountdown} shape="disc" />
            <span className="hold-badge__digits" role="timer" aria-label="Time left on hold">
              {timerText}
            </span>
          </div>
        )}
      </div>

      <div className="slot-dialog__body" ref={formRef}>
        {view === "form" && (
          <>
            <div className="field">
              <span className="field__label" id={`${uid}-length`}>
                Length
              </span>
              <div role="radiogroup" aria-labelledby={`${uid}-length`} aria-label="Length" className="segmented">
                {lengths.map((value, index) => (
                  <label key={value} className="segmented__option">
                    <input
                      type="radio"
                      name={`${uid}-minutes`}
                      value={value}
                      checked={minutes === value}
                      data-field={index === 0 ? "length" : undefined}
                      onChange={() => setMinutes(value)}
                    />
                    <span>{value} minutes</span>
                  </label>
                ))}
              </div>
              {(fields.minutes || fields.court || fields.start) && <FieldBand id={`${uid}-length-error`}>{fields.minutes ?? fields.court ?? fields.start}</FieldBand>}
            </div>

            <div className="price" aria-live="off">
              <p className="price__total">{quote ? euros(quote.total_cents) : "—"}</p>
              {split && quote && (
                <>
                  <p className="price__split">
                    {quote.split_cents.map((cents, i) => (
                      <span key={i}>{euros(cents)}</span>
                    ))}
                  </p>
                  <p className="price__note">Your card guarantees the full price until every share is paid.</p>
                </>
              )}
            </div>

            {!openMatch && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={split}
                  onChange={(e) => {
                    setSplit(e.target.checked);
                    if (e.target.checked) setOpenMatch(false);
                  }}
                />
                <span>Split four ways</span>
              </label>
            )}
            {split && (
              <div className="field-group">
                {emails.map((value, i) => (
                  <Field key={i} label={`Co-player ${i + 1} email`} errorId={`${uid}-co-${i}`} error={i === 0 ? fields.co_players : undefined}>
                    <input
                      type="email"
                      autoComplete="off"
                      value={value}
                      data-field={i === 0 ? "email-0" : undefined}
                      aria-label={`Co-player ${i + 1} email`}
                      aria-invalid={i === 0 && fields.co_players ? true : undefined}
                      onChange={(e) => setEmails(emails.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  </Field>
                ))}
              </div>
            )}

            {!openMatch && (
              <Field label="Booking note" errorId={`${uid}-note-error`} error={fields.note}>
                <textarea
                  rows={2}
                  value={note}
                  data-field="note"
                  aria-label="Booking note"
                  aria-invalid={fields.note ? true : undefined}
                  onChange={(e) => setNote(e.target.value)}
                />
                <span className="field__counter">{[...note].length}/280</span>
              </Field>
            )}

            {!split && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={openMatch}
                  onChange={(e) => {
                    setOpenMatch(e.target.checked);
                    if (e.target.checked) setSplit(false);
                  }}
                />
                <span>Open as a match</span>
              </label>
            )}
            {openMatch && (
              <div className="field-group field-group--row">
                <Field label="Lowest level" errorId={`${uid}-low`}>
                  <select value={low} aria-label="Lowest level" data-field="levels" onChange={(e) => setLow(e.target.value)}>
                    {levelOptions.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Highest level" errorId={`${uid}-high`}>
                  <select value={high} aria-label="Highest level" onChange={(e) => setHigh(e.target.value)}>
                    {levelOptions.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </Field>
                {(fields.level || fields.level_min || fields.level_max) && (
                  <FieldBand id={`${uid}-levels-error`}>{fields.level ?? fields.level_min ?? fields.level_max}</FieldBand>
                )}
              </div>
            )}

            {error && <ErrorBand>{error}</ErrorBand>}
            <div className="slot-dialog__actions">
              <button type="button" ref={holdRef} className="pill pill--cobalt" disabled={pending === "hold"} onClick={() => void submitHold()}>
                {pending === "hold" ? (openMatch ? "Opening..." : "Holding...") : openMatch ? "Open match" : "Hold slot"}
              </button>
            </div>
          </>
        )}

        {view === "held" && (
          <>
            <div className="price">
              <p className="price__total">{booking ? euros(booking.total_cents) : "—"}</p>
              <p className="price__note">{booking ? `${booking.minutes} minutes, held for you until the badge reaches zero.` : "Reading your hold…"}</p>
            </div>
            {booking && booking.shares.length > 1 && (
              <p className="price__note">Your card guarantees the full price until every share is paid.</p>
            )}
            {error && <ErrorBand>{error}</ErrorBand>}
            <div className="slot-dialog__actions">
              <button type="button" ref={payRef} className="pill pill--cobalt" disabled={pending !== "" || !booking} onClick={() => void pay()}>
                {pending === "pay" ? "Paying..." : "Pay now"}
              </button>
              <button type="button" className="pill pill--outline" disabled={pending !== "" || !booking} onClick={() => void release()}>
                {pending === "release" ? "Releasing..." : "Release hold"}
              </button>
            </div>
          </>
        )}

        {view === "paid" && (
          <p className="status-block">
            <span className="status-word status-word--paid">Paid</span> Your booking is confirmed.
          </p>
        )}
        {view === "matched" && <p className="status-block">You joined the match. Others at your level can now find it under Matches.</p>}
        {view === "ended" && <p className="status-block">This hold has ended. Pick the slot again.</p>}
        {view === "detail" && (
          <>
            <p className="status-block">{cell.mine && cell.state === "booked" ? "This is your booking. You can manage it under My bookings." : detailCopy[cell.state]}</p>
            {error && <ErrorBand>{error}</ErrorBand>}
          </>
        )}
      </div>
    </Modal>
  );
}
