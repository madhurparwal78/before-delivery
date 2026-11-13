// Ticket cards (tenant) and door cards (staff). A card changes only after the server answers 2xx;
// a refusal re-reads the booking and shows its true status with the rule copy. Pending actions
// live in the Board, so a refresh can never undo a card that is waiting for its answer.

import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Booking, DoorAction, DoorEntry, Kitchen } from "../../shared/api.js";
import { bookingDate, cancellationLine, cancelStepDescription, clearanceText, doorCopy, doorLogLine, doorStatus, spanText, ticketStatus } from "../copy.js";
import { holdSecondsLeft, kitchenNow } from "../kitchen.js";
import { navigate } from "../router.js";
import { Icon, Notice, type NoticeState } from "../ui.js";
import { MOTION, reducedMotion } from "./motion.js";

function ticketName(b: Booking): string {
  return `${b.stationName} ${bookingDate(b)} ${spanText(b)}`;
}

const RECEIPT_STATUSES: readonly Booking["status"][] = ["confirmed", "checked_in", "completed", "no_show"];

export type TicketPending = "confirm" | "cancel" | "move";

export function TicketCard({ booking, kitchen, entering, pending, moveLifted, moveDisabled, moveProps, notice, onConfirm, onCancel }: {
  booking: Booking; kitchen: Kitchen; entering: boolean; pending: TicketPending | null; moveLifted: boolean; moveDisabled: boolean;
  moveProps: JSX.HTMLAttributes<HTMLButtonElement>; notice: NoticeState | null; onConfirm: () => void; onCancel: () => Promise<void>;
}): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  const refocusCancel = useRef(false);
  const left = booking.status === "held" ? holdSecondsLeft(booking.holdExpiresAt, kitchen.holdSeconds) : 0;
  const confirming = pending === "confirm";
  const live = booking.status === "held" && (left > 0 || confirming);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && entering && !reducedMotion()) {
      el.animate([{ transform: "translateY(-12px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: MOTION.mid, easing: MOTION.easing });
    }
  }, []);

  useEffect(() => {
    if (asking) keepButton.current?.focus();
    else if (refocusCancel.current) cancelButton.current?.focus();
    refocusCancel.current = false;
  }, [asking]);

  const keep = (): void => {
    refocusCancel.current = true;
    setAsking(false);
  };

  const yes = async (): Promise<void> => {
    await onCancel();
    setAsking(false);
  };

  const cancelling = pending === "cancel";
  const canCancel = live || booking.status === "confirmed";
  const describe = booking.status === "confirmed" ? `cancel-step-${booking.id}` : undefined;
  return (
    <article ref={ref} class="ticket ticket--card" tabIndex={0} aria-label={ticketName(booking)} data-booking-id={booking.id}
      data-status={booking.status === "held" && !live ? "expired" : booking.status}>
      <header class="ticket__head">
        <h3 class="ticket__title">{booking.stationName}</h3>{" "}
        <p class="stamp">{ticketStatus(booking, left, confirming)}</p>
      </header>
      {" "}<p class="ticket__meta"><span>{bookingDate(booking)}</span>{" "}<span class="mono">{spanText(booking)}</span></p>{" "}
      {booking.shelfName ? <p class="ticket__shelf">+ {booking.shelfName}</p> : null}{" "}
      {booking.status === "confirmed" ? <p class="ticket__cancel">{cancellationLine(booking)}</p> : null}{" "}
      {asking ? (
        <div class="confirm-strip" role="group" aria-label="Cancel this booking?" aria-describedby={describe}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !cancelling) {
              e.stopPropagation();
              keep();
            }
          }}>
          <p>Cancel this booking?</p>{" "}
          {describe ? <p class="confirm-strip__text" id={describe}>{cancelStepDescription(booking)}</p> : null}
          <div class="actions">
            <button type="button" ref={keepButton} class="button" disabled={cancelling} onClick={keep}>Keep it</button>
            <button type="button" class="button button--ink" disabled={cancelling} onClick={() => void yes()}>Yes, cancel</button>
          </div>
        </div>
      ) : (
        <div class="actions">
          {live ? <button type="button" class="button button--ink" disabled={confirming} onClick={onConfirm}>Confirm booking</button> : null}
          {booking.movable ? (
            <button type="button" class="button" data-move={booking.id} aria-pressed={moveLifted ? "true" : "false"}
              aria-disabled={moveDisabled || pending !== null ? "true" : undefined} {...moveProps}>Move booking</button>
          ) : null}
          {canCancel ? <button type="button" ref={cancelButton} class="button" disabled={pending !== null} onClick={() => setAsking(true)}>Cancel booking</button> : null}
          {RECEIPT_STATUSES.includes(booking.status) || (booking.status === "cancelled" && booking.debitedMinutes !== null) ? (
            <a class="button button--link" href={`/receipt/${booking.id}`} onClick={(e) => { e.preventDefault(); navigate(`/receipt/${booking.id}`); }}>
              <Icon name="receipt" />Receipt
            </a>
          ) : null}
        </div>
      )}
      {" "}<Notice notice={notice} />
    </article>
  );
}

const DOOR_BUTTON: Readonly<Record<DoorAction, string>> = { check_in: "Check in", check_out: "Check out", no_show: "Mark no-show" };

type Face = "front" | "back";

/** How the check-out dialog hands its outcome back to the card that opened it: true after a 200. */
export type CheckOutFinish = (done: boolean) => void;

/** One face of a door card: its content, and the buttons only on the live face (the one showing or coming into view). */
function DoorFace({ entry, face, live, busy, onPress, hidden }: {
  entry: DoorEntry; face: Face; live: boolean; busy: boolean; onPress: (action: DoorAction, opener: HTMLButtonElement) => void; hidden: boolean;
}): JSX.Element {
  const opensLater = entry.status === "confirmed" && kitchenNow() < Date.parse(entry.checkInOpensAt);
  const props = hidden ? { "aria-hidden": true, inert: true } : {};
  return (
    <div class="door-face" data-side={face} {...props}>
      <header class="ticket__head">
        <h3 class="ticket__title">{entry.tenantName}</h3>{" "}
        <p class="stamp">{doorStatus(entry.status)}</p>
      </header>
      {" "}<p class="ticket__meta"><span>{entry.stationName}</span>{" "}<span class="mono">{spanText(entry)}</span></p>{" "}
      {entry.shelfName ? <p class="ticket__shelf">+ {entry.shelfName}</p> : null}{" "}
      <p class="clearance">{clearanceText(entry.cleared, entry.reason)}</p>{" "}
      {opensLater ? <p class="opens mono">{doorCopy.opens(entry.checkInOpensAt)}</p> : null}{" "}
      {entry.doorLog.length > 0 ? (
        <ul class="door-log">{entry.doorLog.map((line) => <li key={`${line.action}${line.at}`} class="mono">{doorLogLine(line)}</li>)}</ul>
      ) : null}
      {live && entry.actions.length > 0 ? (
        <div class="actions">
          {entry.actions.map((action) => (
            <button key={action} type="button" class={action === "no_show" ? "button" : "button button--ink"} disabled={busy}
              onClick={(e) => onPress(action, e.currentTarget)}>{DOOR_BUTTON[action]}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface DoorCardProps {
  entry: DoorEntry;
  /** The pending copy and flag the Board keeps for this card: set from the press until its own answer. */
  pending: DoorAction | null;
  notice: NoticeState | null;
  /** Presses Check in / Mark no-show; the Board applies the answer to the entry and resolves true after a 200. */
  onAct: (action: "check_in" | "no_show") => Promise<boolean>;
  onCheckOut: (opener: HTMLButtonElement, finish: CheckOutFinish) => void;
}

/** A door card: a front and a back face, one at a time, turning over after this page's own successful action. */
export function DoorCard({ entry, pending, notice, onAct, onCheckOut }: DoorCardProps): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [face, setFace] = useState<Face>("front");
  const [turning, setTurning] = useState<{ from: DoorEntry; serial: number } | null>(null);
  const serial = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!turning || !el) return;
    const next: Face = face === "front" ? "back" : "front";
    const done = (): void => {
      setFace(next);
      setTurning(null);
    };
    if (reducedMotion()) {
      done();
      return;
    }
    const animation = el.animate(
      [{ transform: "perspective(800px) rotateY(0deg)" }, { transform: "perspective(800px) rotateY(180deg)" }],
      { duration: 420, easing: MOTION.easing },
    );
    animation.finished.then(done, done);
  }, [turning?.serial]);

  /** Turns the card over from the entry it showed when the action was pressed to the one the answer made. */
  const turnOver = (before: DoorEntry): void => {
    setTurning({ from: before, serial: ++serial.current });
    ref.current?.focus();
  };

  const press = (action: DoorAction, opener: HTMLButtonElement): void => {
    const before = entry;
    const settle = (done: boolean): void => {
      if (done) turnOver(before);
      else ref.current?.focus();
    };
    if (action === "check_out") onCheckOut(opener, settle);
    else void onAct(action).then(settle);
  };

  const other: Face = face === "front" ? "back" : "front";
  const busy = pending !== null;
  return (
    <article ref={ref} class="ticket ticket--card ticket--door" tabIndex={0} data-face={face} data-turning={turning ? "true" : undefined}
      aria-label={`${entry.tenantName} ${entry.stationName} ${spanText(entry)}`} data-booking-id={entry.bookingId}
      data-status={entry.status} data-cleared={entry.cleared ? "true" : "false"}>
      {turning ? (
        <>
          <DoorFace entry={turning.from} face={face} live={false} busy hidden onPress={press} />
          <DoorFace entry={entry} face={other} live busy={busy} hidden={false} onPress={press} />
        </>
      ) : <DoorFace entry={entry} face={face} live busy={busy} hidden={false} onPress={press} />}
      {" "}<Notice notice={notice} />
    </article>
  );
}
