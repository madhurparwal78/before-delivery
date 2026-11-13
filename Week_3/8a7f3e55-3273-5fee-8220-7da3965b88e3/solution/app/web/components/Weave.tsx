import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import type { Booking, Rotation, RotationEntry } from "../../shared/api";
import { minutesBetween, timeOf } from "../lib/format";
import { useReducedMotion } from "../lib/viewport";

type Transition = "enter" | "withdraw";

interface Drawn {
  bookingId: string;
  signature: string;
  epoch: number;
  transition: Transition;
  ghosts: RotationEntry[];
  rotation: Rotation;
}

/** What the weave draws, so a refetch of the same plan changes nothing and starts nothing. */
const signatureOf = (booking: Booking): string =>
  `${booking.id}|${booking.rotation.mode}|${booking.rotation.turns.map((entry) => `${entry.kind}:${entry.holder_initials ?? ""}:${entry.start}:${entry.end}`).join(",")}`;

function nextDrawn(held: Drawn | null, booking: Booking, signature: string): Drawn {
  const rotation = booking.rotation;
  const sameBooking = held !== null && held.bookingId === booking.id;
  const holdingSeats = (turns: RotationEntry[]): number => new Set(turns.flatMap((entry) => (entry.kind === "turn" ? [entry.seat] : []))).size;
  const withdrawal = sameBooking && holdingSeats(held.rotation.turns) === 2 && holdingSeats(rotation.turns) < 2;
  const transition: Transition = withdrawal ? "withdraw" : "enter";
  return {
    bookingId: booking.id,
    signature,
    epoch: (held?.epoch ?? 0) + 1,
    transition,
    ghosts: transition === "withdraw" && held !== null ? held.rotation.turns : [],
    rotation,
  };
}

const percentOf = (offset: number, total: number): string => `${(offset / total) * 100}%`;

function Ruler({ rotation }: { rotation: Rotation }) {
  const first = rotation.turns[0];
  const last = rotation.turns[rotation.turns.length - 1];
  if (first === undefined || last === undefined) return null;
  const total = minutesBetween(first.start, last.end);
  const step = Math.ceil(rotation.turns.length / 6);
  const marks = rotation.turns.filter((_entry, position) => position % step === 0 && position > 0);
  return (
    <div className="weave-ruler mono" aria-hidden="true">
      <span className="ruler-mark ruler-mark--first">{timeOf(first.start)}</span>
      {marks.map((entry) => (
        <span key={entry.index} className="ruler-mark" style={{ left: percentOf(minutesBetween(first.start, entry.start), total) }}>
          {timeOf(entry.start)}
        </span>
      ))}
      <span className="ruler-mark ruler-mark--last">{timeOf(last.end)}</span>
    </div>
  );
}

interface Leaving {
  /** 0 for the rightmost departing turn: each one to its left starts one stagger later. */
  order: number;
  onDone: () => void;
}

const tokenOf = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A departing turn turns hatched: a Web Animations animation, so it keeps its timing once the settled plan replaces the entry. */
function useHatching(leaving: Leaving | undefined) {
  const hatch = useRef<HTMLSpanElement>(null);
  const latest = useRef(leaving);
  latest.current = leaving;
  useLayoutEffect(() => {
    if (hatch.current === null || latest.current === undefined) return;
    const animation = hatch.current.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: parseFloat(tokenOf("--t-turn")),
      delay: latest.current.order * parseFloat(tokenOf("--t-stagger")),
      easing: tokenOf("--ease"),
      fill: "both",
    });
    animation.onfinish = () => latest.current?.onDone();
  }, []);
  return hatch;
}

function Entry({ entry, leaving }: { entry: RotationEntry; leaving?: Leaving }) {
  const hatch = useHatching(leaving);
  const style = { "--minutes": minutesBetween(entry.start, entry.end), "--i": entry.index } as CSSProperties;
  return (
    <div
      className={`entry entry--${entry.kind}${entry.kind === "turn" ? ` entry--seat-${entry.seat}` : ""}${entry.label === "uncovered" ? " entry--uncovered" : ""}`}
      style={style}
      data-turn-index={entry.index}
      data-kind={entry.kind}
      data-holder={entry.holder_initials ?? ""}
      data-start={timeOf(entry.start)}
      data-end={timeOf(entry.end)}
    >
      {entry.kind === "turn" ? <span className="entry-initials">{entry.holder_initials}</span> : <span className="entry-label">{entry.label}</span>}
      {leaving ? <span ref={hatch} className="entry-hatch" /> : null}
    </div>
  );
}

/**
 * The rotation weave: one element per plan entry. It is drawn again, with motion, only when the plan to draw differs
 * from the one already drawn for the selected booking. A withdrawal first keeps the previous plan's entries on screen
 * while the departing holder's turns turn into hatched gaps from right to left, then settles into the new plan.
 */
export function Weave({ booking }: { booking: Booking }) {
  const reduced = useReducedMotion();
  const signature = signatureOf(booking);
  const [drawn, setDrawn] = useState<Drawn>(() => nextDrawn(null, booking, signature));
  const [ghostsDone, setGhostsDone] = useState<number>(0);
  let current = drawn;
  if (drawn.signature !== signature) {
    current = nextDrawn(drawn, booking, signature);
    setDrawn(current);
    setGhostsDone(0);
  }
  const remainingSeat = current.rotation.turns.find((entry) => entry.kind === "turn")?.seat ?? null;
  const departing = current.ghosts.filter((entry) => entry.seat !== remainingSeat);
  const collapsing = !reduced && current.transition === "withdraw" && ghostsDone < departing.length;
  const style = { "--departing": departing.length } as CSSProperties;

  return (
    <div className="weave-block">
      <div className="weave" role="img" aria-label="Rotation weave" data-mode={current.rotation.mode} data-transition={collapsing ? "collapse" : current.transition} style={style}>
        {collapsing
          ? current.ghosts.map((entry) => {
              const rank = departing.indexOf(entry);
              const leaving = rank === -1 ? undefined : { order: departing.length - 1 - rank, onDone: () => setGhostsDone((done) => done + 1) };
              return <Entry key={`${current.epoch}-previous-${entry.index}`} entry={entry} leaving={leaving} />;
            })
          : current.rotation.turns.map((entry) => <Entry key={`${current.epoch}-${entry.index}`} entry={entry} />)}
      </div>
      <Ruler rotation={current.rotation} />
    </div>
  );
}

/** Keeps the figure's value in step with the plan; the descriptive text follows when the count ends. */
export function useCountedCoverage(percent: number, text: string): { figureRef: React.RefObject<HTMLSpanElement | null>; shownText: string } {
  const reduced = useReducedMotion();
  const figureRef = useRef<HTMLSpanElement>(null);
  const [shownText, setShownText] = useState(text);
  const latestText = useRef(text);
  latestText.current = text;
  const shownPercent = useRef(percent);

  useLayoutEffect(() => {
    const figure = figureRef.current;
    const changed = shownPercent.current !== percent;
    shownPercent.current = percent;
    if (!changed || reduced || figure === null || figure.getAnimations().length === 0) {
      setShownText(text);
      return undefined;
    }
    const finish = () => setShownText(latestText.current);
    figure.addEventListener("transitionend", finish, { once: true });
    figure.addEventListener("transitioncancel", finish, { once: true });
    return () => {
      figure.removeEventListener("transitionend", finish);
      figure.removeEventListener("transitioncancel", finish);
    };
  }, [percent, text, reduced]);

  return { figureRef, shownText };
}
