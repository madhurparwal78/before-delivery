// The right-hand ticket drawer (not a modal): a hold with its countdown and confirm/release, or a
// booking with its cost lines and the inline cancellation question.

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Booking } from "../../shared/api.js";
import { cancellationIsFree, costSplit, formatHours, formatMoney, lateFeeCents } from "../../shared/rules.js";
import { longDate } from "../../shared/zone.js";
import { countdown, kitchenStamp, moneyCents } from "../format.js";
import { Close } from "../icons.js";
import { animate, DRAWER_IN, DRAWER_MS } from "./motion.js";

export interface HoldDetails {
  kind: "hold";
  id: string;
  stationName: string;
  rateCents: number;
  date: string;
  start: string;
  end: string;
  tailEnd: string;
  bookedMinutes: number;
  expiresAt: number;
}

export type DrawerTarget = HoldDetails | { kind: "booking"; id: string; booking: Booking };

interface Props {
  target: DrawerTarget;
  focus: "confirm" | "cancel" | "title";
  balanceMinutes: number;
  now: number;
  timeZone: string;
  busy: string | null;
  canCancel: boolean;
  onClose: () => void;
  onConfirm: (hold: HoldDetails) => void;
  onRelease: (hold: HoldDetails) => void;
  onCancel: (booking: Booking) => void;
}

const PAYMENT_WORDS: Record<string, string> = { paid: "Paid", payment_pending: "Payment pending", voided: "Voided" };
const STATUS_WORDS: Record<string, string> = { confirmed: "Confirmed", checked_in: "Checked in", completed: "Completed" };

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div class="drawer__line">
      <dt>{label}</dt>
      <dd class="num">{value}</dd>
    </div>
  );
}

export function Drawer(props: Props) {
  const { target } = props;
  const ref = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);

  useLayoutEffect(() => {
    if (ref.current) animate(ref.current, DRAWER_IN, { duration: DRAWER_MS });
  }, []);

  useLayoutEffect(() => {
    setAsking(false);
  }, [target.id]);

  useLayoutEffect(() => {
    const wanted = props.focus === "confirm" ? confirmRef.current : props.focus === "cancel" ? cancelRef.current : titleRef.current;
    (wanted ?? titleRef.current)?.focus();
  }, [target.id]);

  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    }
  };

  const header = (station: string) => (
    <header class="drawer__head">
      <h2 class="drawer__title" tabIndex={-1} ref={titleRef}>
        {station}
      </h2>
      <button type="button" class="button button--ghost button--icon" aria-label="Close details" onClick={props.onClose}>
        <Close />
        <span class="button__text">Close</span>
      </button>
    </header>
  );

  let body;
  if (target.kind === "hold") {
    const split = costSplit(target.bookedMinutes, props.balanceMinutes, target.rateCents);
    const busy = props.busy !== null;
    body = (
      <>
        {header(target.stationName)}
        <p class="drawer__kind">Live hold</p>
        <dl class="drawer__lines">
          <Line label="Date" value={`${longDate(target.date)} (${target.date})`} />
          <Line label="Time" value={`${target.start}–${target.end}`} />
          <Line label="Cleaning" value={`Cleaning until ${target.tailEnd}`} />
          <Line label="Prepaid hours" value={`${formatHours(split.prepaidMinutes)} h`} />
          <Line label="Overage" value={`$${formatMoney(split.overageCents)}`} />
          <Line label="Hold time left" value={countdown(target.expiresAt - props.now)} />
        </dl>
        <div class="drawer__actions">
          <button
            type="button"
            ref={confirmRef}
            class="button button--primary"
            disabled={busy}
            aria-busy={props.busy === "confirm" ? "true" : "false"}
            onClick={() => props.onConfirm(target)}
          >
            Confirm booking
          </button>
          <button type="button" class="button" disabled={busy} aria-busy={props.busy === "release" ? "true" : "false"} onClick={() => props.onRelease(target)}>
            Release hold
          </button>
        </div>
      </>
    );
  } else {
    const booking = target.booking;
    const free = cancellationIsFree(props.now, Date.parse(booking.free_cancel_until));
    const terms = free
      ? `Free cancellation until ${kitchenStamp(booking.free_cancel_until, props.timeZone)}`
      : `Late-cancellation fee: $${formatMoney(lateFeeCents(moneyCents(booking.list_amount)))}`;
    const cancellable = props.canCancel && booking.status === "confirmed";
    body = (
      <>
        {header(booking.station_name)}
        <p class="drawer__kind">
          {STATUS_WORDS[booking.status] ?? booking.status}
          {booking.payment === "payment_pending" && <span class="stamp">Payment pending</span>}
        </p>
        <dl class="drawer__lines">
          <Line label="Date" value={`${longDate(booking.date)} (${booking.date})`} />
          <Line label="Time" value={`${booking.start}–${booking.end}`} />
          <Line label="Cleaning" value={`Cleaning until ${booking.tail_end}`} />
          <Line label="Prepaid hours used" value={`${formatHours(booking.prepaid_minutes)} h`} />
          <Line label="Overage" value={`$${booking.overage_amount}`} />
          <Line label="Payment" value={PAYMENT_WORDS[booking.payment] ?? booking.payment} />
          {booking.check_ins.map((c) => (
            <Line key={c.id} label="Checked in" value={`${c.crew_cook_name}, ${kitchenStamp(c.at, props.timeZone)}`} />
          ))}
        </dl>
        {cancellable && <p class={free ? "drawer__terms" : "drawer__terms drawer__terms--late"}>{terms}</p>}
        {cancellable && !asking && (
          <div class="drawer__actions">
            <button type="button" ref={cancelRef} class="button" onClick={() => setAsking(true)}>
              Cancel booking
            </button>
          </div>
        )}
        {cancellable && asking && (
          <div class="drawer__question" role="group" aria-label="Cancel this booking?">
            <p>Cancel this booking? {terms}.</p>
            <div class="drawer__actions">
              <button
                type="button"
                class="button button--primary"
                disabled={props.busy !== null}
                aria-busy={props.busy === "cancel" ? "true" : "false"}
                onClick={() => props.onCancel(booking)}
              >
                Yes, cancel booking
              </button>
              <button type="button" class="button" disabled={props.busy !== null} onClick={() => setAsking(false)}>
                Keep booking
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <aside class="drawer" aria-label="Ticket details" ref={ref} onKeyDown={keyDown}>
      {body}
    </aside>
  );
}
