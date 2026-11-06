// A ticket on a rail: a perforated thermal slip hanging below the rail, with its hatched buffer
// tail. Held tickets carry their text on a paper strip over the orange body.

import { type AnimationEvent, type PointerEvent, type ReactNode, memo, useLayoutEffect, useRef } from "react";
import { MINUTES_PER_DAY } from "../../../shared/kitchenTime.js";
import { prefersReducedMotion } from "../../motion.js";

type TicketKind = "draft" | "hold" | "booking" | "other" | "maintenance" | "staff";

export interface TicketProps {
  kind: TicketKind;
  /** Wall-clock minutes on the shown day (may run past either end). */
  left: number;
  right: number;
  height: number;
  label: string;
  heading?: string;
  times: string;
  hours?: string;
  weeks?: string;
  bufferRight?: number;
  bufferLabel?: string;
  bookingId?: string;
  selected?: boolean;
  settling?: boolean;
  leaving?: boolean;
  waiting?: boolean;
  onActivate?: () => void;
  onPress?: (event: PointerEvent<HTMLElement>) => void;
  onLeft?: () => void;
}

const percent = (minute: number): string => `${(Math.min(Math.max(minute, 0), MINUTES_PER_DAY) / MINUTES_PER_DAY) * 100}%`;
const span = (from: number, to: number): string =>
  `${((Math.min(Math.max(to, 0), MINUTES_PER_DAY) - Math.min(Math.max(from, 0), MINUTES_PER_DAY)) / MINUTES_PER_DAY) * 100}%`;

function Body({ heading, times, hours, weeks }: { heading?: string; times: string; hours?: string; weeks?: string }): ReactNode {
  return (
    <span className="ticket__strip">
      {heading ? <span className="ticket__heading">{heading} </span> : null}
      <span className="ticket__times mono">{times} </span>
      {hours ? <span className="ticket__hours mono">{hours} </span> : null}
      {weeks ? <span className="ticket__weeks mono">{weeks}</span> : null}
    </span>
  );
}

export const Ticket = memo(function Ticket(props: TicketProps) {
  const { kind, left, right, height, label } = props;
  const className = [
    "ticket",
    `ticket--${kind}`,
    props.selected ? "ticket--selected" : "",
    props.settling ? "ticket--settling" : "",
    props.leaving ? "ticket--leaving" : "",
    props.waiting ? "ticket--waiting" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = { left: percent(left), width: span(left, right), height: `${height}px` };
  // The ticket's box (its hit area) takes the new span at once; only the paper inside slides from
  // the previous edges to the new ones, so a press always lands where the ticket says it is.
  const paperRef = useRef<HTMLSpanElement>(null);
  const drawn = useRef<{ left: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const box = paperRef.current?.parentElement;
    if (!paperRef.current || !box) return;
    const before = drawn.current;
    drawn.current = { left: box.offsetLeft, width: box.offsetWidth, height: box.offsetHeight };
    if (!before || prefersReducedMotion()) return;
    const now = drawn.current;
    const leftShift = before.left - now.left;
    const rightShift = before.left + before.width - (now.left + now.width);
    const heightShift = before.height - now.height;
    if (!leftShift && !rightShift && !heightShift) return;
    const tokens = getComputedStyle(box);
    paperRef.current.animate(
      [
        { left: `${leftShift}px`, right: `${-rightShift}px`, bottom: `${-heightShift}px` },
        { left: "0px", right: "0px", bottom: "0px" },
      ],
      { duration: parseFloat(tokens.getPropertyValue("--t-step")), easing: tokens.getPropertyValue("--ease").trim() },
    );
  }, [left, right, height]);
  const onAnimationEnd = (event: AnimationEvent<HTMLElement>): void => {
    if (event.animationName === "ticket-leave") props.onLeft?.();
  };
  const paper = (
    <span ref={paperRef} className="ticket__paper">
      <Body heading={props.heading} times={props.times} hours={props.hours} weeks={props.weeks} />
    </span>
  );
  const ticket = props.leaving ? (
    <span className={className} style={style} aria-hidden="true" onAnimationEnd={onAnimationEnd}>
      {paper}
    </span>
  ) : props.onActivate ? (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label}
      aria-pressed={props.selected ? true : undefined}
      data-booking={props.bookingId}
      onClick={props.onActivate}
    >
      {paper}
    </button>
  ) : (
    <span className={className} style={style} role="img" aria-label={label} onPointerDown={props.onPress}>
      {paper}
    </span>
  );
  const tail =
    props.bufferRight !== undefined && props.bufferRight > right && !props.leaving ? (
      <span
        className={`buffer-tail${kind === "draft" ? " buffer-tail--draft" : ""}`}
        role="img"
        aria-label={props.bufferLabel}
        style={{ left: percent(right), width: span(right, props.bufferRight), height: `${Math.max(12, Math.round(height / 2))}px` }}
        onPointerDown={props.onPress}
      />
    ) : null;
  return (
    <>
      {ticket}
      {tail}
    </>
  );
});
