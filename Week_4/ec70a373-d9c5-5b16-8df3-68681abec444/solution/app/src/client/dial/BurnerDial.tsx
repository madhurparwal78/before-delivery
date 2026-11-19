// The Burner Dial: a 24-hour ring per station; drag or key a claim, hold it, confirm or release it.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { SANITATION_BUFFER_MINUTES, type Quarters, type StationKind } from "../../shared/rules.ts";
import { elapsedQuarters, formatWall, parseWall, wallDegrees, type IsoDate } from "../../shared/time.ts";
import { quartersText } from "../../shared/format.ts";
import type { ApiErrorBody, Booking, Sector, SectorKind } from "../../shared/api.ts";
import { annulus, arcLength, centreArc, point, minutesAt, CENTRE, LABEL_RADIUS, RING_INNER, RING_OUTER, RING_WIDTH, VIEW } from "./geometry.ts";
import { earliestOpenStep, isBlocked, isOpenStep, moveEnd, moveStart, reachFrom, type ClaimWindow, type DialRules, type Occupied } from "./footprint.ts";
import { serverNow } from "../api.ts";

export interface DialStation {
  id: string;
  name: string;
  kind: StationKind;
  sectors: Sector[];
}

type HoldAnswer =
  | { outcome: "held"; apply: () => void }
  | { outcome: "refused"; error: ApiErrorBody["error"]; apply: () => void }
  | { outcome: "not_final"; error: ApiErrorBody["error"] | null };

export interface DialActions {
  /** Writes the attempt's pending copy. */
  holdPending: (w: ClaimWindow) => void;
  /** Sends the hold; `apply` updates the page, and runs only for an attempt's one final answer. */
  sendHold: (station: DialStation, date: IsoDate, w: ClaimWindow, key: string) => Promise<HoldAnswer>;
  /** Writes the copy for an answer that is not final. */
  holdNotFinal: (error: ApiErrorBody["error"] | null) => void;
  confirm: (booking: Booking) => Promise<boolean>;
  release: (booking: Booking) => Promise<void>;
  repeat: (station: DialStation, w: ClaimWindow, opener: HTMLElement | null) => void;
  slotTaken: () => void;
}

interface BurnerDialProps {
  station: DialStation;
  date: IsoDate;
  timeZone: string;
  available: Quarters;
  /** The member's live hold on this dial, if any. */
  hold: Booking | null;
  reduced: boolean;
  /** True while the newest availability request for a new rail subject is pending. */
  busy: boolean;
  /** Changes when a new rail subject's answer is drawn: the claim and centre reset. */
  subjectStamp: number;
  /** Changes on every availability answer drawn: the reload rule runs. */
  reloadStamp: number;
  /** Changes when a series booked this dial's window: the claim returns to the earliest open step. */
  seriesStamp: number;
  actions: DialActions;
}

const KIND_LABELS: Record<StationKind, string> = {
  oven: "Oven",
  mixer: "Mixer",
  blast_chiller: "Blast chiller",
  prep_table: "Prep table",
};

const SECTOR_LABELS: Record<SectorKind, string> = {
  booked: "Booked",
  buffer: "Sanitation",
  own_held: "Your hold",
  own_confirmed: "Your booking",
  nonexistent: "Not on the clock",
};

const STEP = 15;
const DAY = 1440;
const COUNT_MS = 250;
const EASE = "cubic-bezier(.2,0,0,1)";
const RING_PRESS_SLACK = 10;

function toOccupied(sectors: Sector[]): Occupied[] {
  return sectors.map((s) => ({ kind: s.kind, start: parseWall(s.start) ?? 0, end: parseWall(s.end) ?? 0, bookingId: s.booking_id }));
}

function countdown(ms: number, reduced: boolean): ReactNode {
  const left = Math.max(0, ms);
  if (reduced) return <>Held · <span className="mono">{Math.ceil(left / 60_000)}</span> min left</>;
  const seconds = Math.floor(left / 1000);
  return <>Held · <span className="mono">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span> left</>;
}

/** Counts the numeral to a new value over a quarter second; jumps under reduced motion. */
function useCountedNumber(target: number, animate: boolean, reduced: boolean): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced || !animate || from.current === target) {
      from.current = target;
      setShown(target);
      return undefined;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = requestAnimationFrame(function step(at) {
      const t = Math.min(1, (at - start) / COUNT_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t === 1 ? target : Math.round(origin + (target - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    });
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target, animate, reduced]);
  return shown;
}

function SectorShape({ sector, patternIds, flashConfirm }: { sector: Occupied; patternIds: Record<string, string>; flashConfirm: boolean }): ReactNode {
  // A hold turning into a booking plays the flame-to-green change once.
  const ref = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    if (flashConfirm && ref.current) ref.current.animate([{ fill: "var(--flame)" }, { fill: "var(--green)" }], { duration: COUNT_MS, easing: EASE });
  }, [flashConfirm]);
  const pattern = patternIds[sector.kind];
  return (
    <path
      ref={ref}
      role="img"
      aria-label={`${SECTOR_LABELS[sector.kind]} ${formatWall(sector.start)} to ${formatWall(sector.end)}`}
      d={annulus(sector.start, sector.end)}
      fill={pattern ? `url(#${pattern})` : undefined}
      className={`sector sector-${sector.kind}`}
      data-start-deg={wallDegrees(sector.start)}
      data-end-deg={wallDegrees(sector.end)}
    />
  );
}

/** One claim attempt: one idempotency key until the attempt gets a final answer. */
interface Attempt {
  key: string;
  window: ClaimWindow;
  awaited: number;
  settled: boolean;
  /** The rail subject it started under: its answer changes the dial only while that subject is shown. */
  subjectStamp: number;
}

export function BurnerDial({ station, date, timeZone, available, hold, reduced, busy, subjectStamp, reloadStamp, seriesStamp, actions }: BurnerDialProps): ReactNode {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const patternIds: Record<string, string> = { booked: `hatch${uid}`, buffer: `dots${uid}`, nonexistent: `cross${uid}` };
  const sectors = useMemo(() => toOccupied(station.sectors), [station.sectors]);
  const rules: DialRules = useMemo(
    () => ({
      sectors,
      buffer: SANITATION_BUFFER_MINUTES[station.kind],
      available,
      cost: (w: ClaimWindow) => elapsedQuarters(date, w.start, w.end, timeZone),
    }),
    [sectors, station.kind, available, date, timeZone],
  );
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const firstOpen = (r: DialRules): number => earliestOpenStep(r) ?? 0;
  const [claim, setClaimState] = useState<ClaimWindow>(() => ({ start: firstOpen(rules), end: firstOpen(rules) }));
  const claimRef = useRef(claim);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [counting, setCounting] = useState(false);
  const [ghost, setGhost] = useState<ClaimWindow | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const figure = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const lastDelta = useRef(0);
  const claimedByPointer = useRef(false);
  const [focusConfirm, setFocusConfirm] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [releasePending, setReleasePending] = useState(false);
  const stampRef = useRef(subjectStamp);
  stampRef.current = subjectStamp;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [, setTick] = useState(0);

  const setClaim = (w: ClaimWindow): void => {
    claimRef.current = w;
    setClaimState(w);
  };

  // A new rail subject's answer resets the claim and the centre to the new date's earliest open step.
  const seenSubject = useRef(subjectStamp);
  useLayoutEffect(() => {
    if (seenSubject.current === subjectStamp) return;
    seenSubject.current = subjectStamp;
    attempt.current = null;
    setConfirmed(false);
    setGhost(null);
    const step = firstOpen(rulesRef.current);
    setClaim({ start: step, end: step });
  }, [subjectStamp]);

  const seenSeries = useRef(seriesStamp);
  useLayoutEffect(() => {
    if (seenSeries.current === seriesStamp) return;
    seenSeries.current = seriesStamp;
    const step = firstOpen({ ...rulesRef.current, sectors: [...rulesRef.current.sectors, { kind: "own_confirmed", start: claimRef.current.start, end: claimRef.current.end, bookingId: null }] });
    setClaim({ start: step, end: step });
  }, [seriesStamp]);

  // A reload replaces sectors only, except that a claim window the new sectors block snaps back and is announced.
  const seenReload = useRef(reloadStamp);
  useEffect(() => {
    if (seenReload.current === reloadStamp) return;
    seenReload.current = reloadStamp;
    const w = claimRef.current;
    if (draggingRef.current || attempt.current || w.end <= w.start || !isBlocked(rulesRef.current, w)) return;
    const step = firstOpen(rulesRef.current);
    if (!reduced) setGhost(w);
    setClaim({ start: step, end: step });
    actions.slotTaken();
  }, [reloadStamp, actions, reduced]);

  // The countdown updates every second (every minute under reduced motion) while a hold is live.
  useEffect(() => {
    if (!hold) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), reduced ? 60_000 : 1000);
    return () => clearInterval(id);
  }, [hold, reduced]);

  // Focus moves to Confirm booking when this dial's own claim attempt is accepted. A pointer or touch claim
  // leaves the page where the finger left it.
  useLayoutEffect(() => {
    if (focusConfirm && hold && confirmButton.current) {
      confirmButton.current.focus({ preventScroll: claimedByPointer.current });
      setFocusConfirm(false);
    }
  }, [focusConfirm, hold]);

  const hasLength = claim.end > claim.start;
  const cost = hasLength ? rules.cost(claim) : 0;
  const shownBalance = useCountedNumber(available, counting, reduced);

  const snapBack = (from: ClaimWindow): void => {
    setClaim({ start: from.start, end: from.start });
    if (!reduced && from.end > from.start) setGhost(from);
  };

  const finish = (current: Attempt, answer: Exclude<HoldAnswer, { outcome: "not_final" }>): void => {
    if (current.settled) return;
    current.settled = true;
    if (attempt.current === current) attempt.current = null;
    answer.apply();
    if (current.subjectStamp !== stampRef.current) return;
    const w = current.window;
    if (answer.outcome === "refused") {
      snapBack(w);
      return;
    }
    // The held window is now occupied; the claim returns to the earliest open step around it.
    const held: Occupied[] = [
      { kind: "own_held", start: w.start, end: w.end, bookingId: null },
      { kind: "buffer", start: w.end, end: Math.min(DAY, w.end + rulesRef.current.buffer), bookingId: null },
    ];
    const next = firstOpen({ ...rulesRef.current, sectors: [...rulesRef.current.sectors, ...held] });
    setFocusConfirm(true);
    setClaim({ start: next, end: next });
  };

  /** A first send, or a resend with the same key while the attempt has no final answer. */
  const sendAttempt = (w: ClaimWindow): void => {
    let current = attempt.current;
    if (!current) {
      current = { key: crypto.randomUUID(), window: w, awaited: 0, settled: false, subjectStamp: stampRef.current };
      attempt.current = current;
    }
    if (current.awaited === 0) actions.holdPending(current.window);
    const sending = current;
    sending.awaited += 1;
    void actions.sendHold(station, date, sending.window, sending.key).then((answer) => {
      sending.awaited -= 1;
      if (answer.outcome !== "not_final") {
        finish(sending, answer);
        return;
      }
      if (!sending.settled && sending.awaited === 0) actions.holdNotFinal(answer.error);
    });
  };

  const startClaim = (w: ClaimWindow): void => {
    setConfirmed(false);
    setCounting(false);
    setClaim(w);
  };

  const onKey = (which: "start" | "end") => (event: KeyboardEvent<HTMLDivElement>) => {
    const later = event.key === "ArrowUp" || event.key === "ArrowRight";
    const earlier = event.key === "ArrowDown" || event.key === "ArrowLeft";
    if (!later && !earlier) return;
    event.preventDefault();
    if (attempt.current || busy) return;
    const delta = (later ? 1 : -1) * (event.shiftKey ? 60 : STEP);
    const next = which === "start" ? moveStart(rules, claimRef.current, delta) : moveEnd(rules, claimRef.current, delta);
    if (next) {
      claimedByPointer.current = false;
      startClaim(next);
    }
  };

  const pressStep = (x: number, y: number): number | null => {
    const box = figure.current?.getBoundingClientRect();
    if (!box) return null;
    const at = minutesAt(box, x, y, RING_INNER - RING_PRESS_SLACK, RING_OUTER + RING_PRESS_SLACK);
    if (at === null) return null;
    const step = (Math.round(at / STEP) * STEP) % DAY;
    return isOpenStep(rulesRef.current, step) ? step : null;
  };

  // A touch that starts a claim keeps the ring until its release: the page does not scroll.
  useEffect(() => {
    const element = figure.current;
    if (!element) return undefined;
    const onStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touch && !attempt.current && !busyRef.current && pressStep(touch.clientX, touch.clientY) !== null) event.preventDefault();
    };
    const onMove = (event: TouchEvent): void => {
      if (draggingRef.current) event.preventDefault();
    };
    element.addEventListener("touchstart", onStart, { passive: false });
    element.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
    };
  }, []);

  const release = (): void => {
    draggingRef.current = false;
    setDragging(false);
    const w = claimRef.current;
    if (w.end > w.start) sendAttempt(w);
    else {
      const step = firstOpen(rulesRef.current);
      setClaim({ start: step, end: step });
    }
  };

  const centre = (() => {
    if (dragging || hasLength) {
      return (
        <>
          <span className="centre-range mono">{`${formatWall(claim.start)}–${formatWall(claim.end)}`}</span>
          <span className="centre-label">Pack hours after this claim</span>
          <span className="numeral claim-numeral" data-pack-hours={quartersText(available - cost)}>
            {quartersText(available - cost)}
          </span>
        </>
      );
    }
    if (hold) {
      return (
        <>
          <span className="centre-countdown">{countdown(Date.parse(hold.hold_expires_at ?? "") - serverNow(), reduced)}</span>
          <span className="centre-label">Pack hours</span>
          <span className="numeral" data-pack-hours={quartersText(available)}>
            {quartersText(available)}
          </span>
        </>
      );
    }
    if (confirmed) {
      return (
        <>
          <span className="centre-confirmed">
            <Check aria-hidden="true" className="confirm-check" size={20} strokeWidth={3} />
            Confirmed
          </span>
          <span className="centre-label">Pack hours</span>
          <span className="numeral" data-pack-hours={quartersText(available)}>
            {quartersText(shownBalance)}
          </span>
        </>
      );
    }
    return (
      <>
        <span className="centre-idle">Drag to claim</span>
        <span className="centre-label">Pack hours</span>
        <span className="numeral" data-pack-hours={quartersText(available)}>
          {quartersText(available)}
        </span>
      </>
    );
  })();

  const ticks: ReactNode[] = [];
  for (let q = 0; q < 96; q++) {
    const degrees = q * 3.75;
    const major = q % 12 === 0;
    const hour = q % 4 === 0;
    const [x0, y0] = point(RING_OUTER + 1, degrees);
    const [x1, y1] = point(RING_OUTER + (major ? 7 : hour ? 5 : 3), degrees);
    ticks.push(<line key={q} x1={x0} y1={y0} x2={x1} y2={y1} className={major ? "tick tick-major" : hour ? "tick tick-hour" : "tick"} />);
  }
  const labels = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
    const [x, y] = point(LABEL_RADIUS, h * 15);
    return (
      <text key={h} x={x} y={y} className="tick-label" textAnchor="middle" dominantBaseline="central">
        {String(h).padStart(2, "0")}
      </text>
    );
  });

  const nameId = `${uid}-name`;
  const flashId = confirmed && !reduced ? (hold ? null : "flash") : null;

  return (
    <div role="group" aria-label={`${station.name} dial`} aria-busy={busy} className={`dial-row${busy ? " dial-busy" : ""}`}>
      <div
        ref={figure}
        className={`dial-figure${dragging ? " is-dragging" : ""}`}
        onPointerDown={(event) => {
          if (busy || event.button > 0) return;
          if (attempt.current) {
            // A bounce while the attempt is outstanding: its release resends the same request.
            figure.current?.setPointerCapture(event.pointerId);
            return;
          }
          const step = pressStep(event.clientX, event.clientY);
          if (step === null) return;
          event.preventDefault();
          figure.current?.setPointerCapture(event.pointerId);
          lastDelta.current = 0;
          claimedByPointer.current = true;
          draggingRef.current = true;
          setDragging(true);
          startClaim({ start: step, end: step });
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          const box = figure.current?.getBoundingClientRect();
          const at = box ? minutesAt(box, event.clientX, event.clientY, 0, Infinity) : null;
          if (at === null) return;
          const current = claimRef.current;
          let delta = (at - current.start + DAY) % DAY;
          if (delta > DAY - 180 && lastDelta.current < 720) delta = 0;
          lastDelta.current = delta;
          const wanted = current.start + Math.round(delta / STEP) * STEP;
          const end = Math.min(wanted, reachFrom(rulesRef.current, current.start));
          if (end !== current.end) setClaim({ start: current.start, end });
        }}
        onPointerUp={() => {
          if (draggingRef.current) release();
          else if (attempt.current) sendAttempt(attempt.current.window);
        }}
        onPointerCancel={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          setDragging(false);
          const step = firstOpen(rulesRef.current);
          setClaim({ start: step, end: step });
        }}
      >
        <svg className="dial-svg" viewBox={`0 0 ${VIEW} ${VIEW}`}>
          <g aria-hidden="true">
            <defs>
              <pattern id={patternIds.booked} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" className="pattern-ground" />
                <line x1="0" y1="0" x2="0" y2="6" className="pattern-hatch" />
              </pattern>
              <pattern id={patternIds.buffer} width="5" height="5" patternUnits="userSpaceOnUse">
                <rect width="5" height="5" className="pattern-ground" />
                <circle cx="2.5" cy="2.5" r="1.25" className="pattern-dot" />
              </pattern>
              <pattern id={patternIds.nonexistent} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="4" className="pattern-ground" />
                <path d="M0 0H4M0 0V4" className="pattern-cross" />
              </pattern>
            </defs>
            <circle cx={CENTRE} cy={CENTRE} r={(RING_INNER + RING_OUTER) / 2} className="ring-track" strokeWidth={RING_WIDTH} />
            <circle cx={CENTRE} cy={CENTRE} r={RING_OUTER} className="ring-edge" />
            <circle cx={CENTRE} cy={CENTRE} r={RING_INNER} className="ring-edge" />
            {ticks}
            {labels}
          </g>
          {sectors.map((sector) => (
            <SectorShape
              key={`${sector.kind}-${sector.start}-${sector.end}`}
              sector={sector}
              patternIds={patternIds}
              flashConfirm={flashId !== null && sector.kind === "own_confirmed"}
            />
          ))}
          {ghost && (
            <path
              aria-hidden="true"
              d={centreArc(ghost.start, ghost.end)}
              className="claim-ghost"
              strokeWidth={RING_WIDTH}
              strokeDasharray={arcLength(ghost.start, ghost.end)}
              ref={(path) => {
                if (!path) return;
                const length = arcLength(ghost.start, ghost.end);
                const retract = path.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: length }], { duration: COUNT_MS, easing: EASE, fill: "forwards" });
                void retract.finished.then(() => setGhost(null), () => setGhost(null));
              }}
            />
          )}
          <path
            role="img"
            aria-label={`Claim ${formatWall(claim.start)} to ${formatWall(claim.end)}`}
            d={centreArc(claim.start, claim.end)}
            className={`claim-arc${hasLength ? "" : " claim-arc-empty"}`}
            strokeWidth={RING_WIDTH}
            data-start-deg={wallDegrees(claim.start)}
            data-end-deg={wallDegrees(claim.end)}
          />
          {dragging && (() => {
            const [x, y] = point((RING_INNER + RING_OUTER) / 2, wallDegrees(claim.start));
            return <circle aria-hidden="true" cx={x} cy={y} r={7} className="claim-dot" />;
          })()}
        </svg>
        <div className="dial-centre">{centre}</div>
      </div>
      <div className="dial-side">
        <h3 className="dial-name" id={nameId}>
          {station.name}
        </h3>
        <p className="dial-kind">{KIND_LABELS[station.kind]}</p>
        <ul className="legend" aria-hidden="true">
          <li><span className="swatch swatch-booked" />Booked</li>
          <li><span className="swatch swatch-buffer" />Sanitation</li>
          <li><span className="swatch swatch-own" />Yours</li>
          <li><span className="swatch swatch-nonexistent" />Not on the clock</li>
          <li><span className="swatch swatch-hold" />Your hold</li>
          <li><span className="swatch swatch-claim" />Claim</li>
        </ul>
        <div className="time-inputs">
          {(["start", "end"] as const).map((which) => {
            const value = which === "start" ? claim.start : claim.end;
            const labelId = `${uid}-${which}`;
            return (
              <div className="spin" key={which}>
                <span className="spin-label" id={labelId}>
                  {which === "start" ? "Start time" : "End time"}
                </span>
                <div
                  role="spinbutton"
                  tabIndex={0}
                  aria-labelledby={labelId}
                  aria-valuemin={0}
                  aria-valuemax={DAY}
                  aria-valuenow={value}
                  aria-valuetext={formatWall(value)}
                  className="spin-value mono"
                  onKeyDown={onKey(which)}
                >
                  {formatWall(value)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="dial-actions">
          <button
            type="button"
            className={`button${hold ? "" : " button-primary"}${hasLength ? "" : " button-unready"}`}
            aria-disabled={!hasLength}
            onClick={() => {
              if (busy) return;
              if (attempt.current) sendAttempt(attempt.current.window);
              else if (claimRef.current.end > claimRef.current.start) sendAttempt(claimRef.current);
            }}
          >
            Hold window
          </button>
          <button
            type="button"
            className={`button${hasLength ? "" : " button-unready"}`}
            aria-disabled={!hasLength}
            onClick={(event) => {
              if (!busy && !attempt.current && claimRef.current.end > claimRef.current.start) actions.repeat(station, claimRef.current, event.currentTarget);
            }}
          >
            Repeat weekly
          </button>
          {hold && (
            <>
              <button
                ref={confirmButton}
                type="button"
                className="button button-confirm"
                aria-disabled={confirmPending}
                onClick={() => {
                  if (confirmPending) return;
                  setConfirmPending(true);
                  void actions.confirm(hold).then((done) => {
                    setConfirmPending(false);
                    if (done) {
                      setCounting(true);
                      setConfirmed(true);
                    }
                  });
                }}
              >
                Confirm booking
              </button>
              <button
                type="button"
                className="button"
                aria-disabled={releasePending}
                onClick={() => {
                  if (releasePending) return;
                  setReleasePending(true);
                  void actions.release(hold).finally(() => setReleasePending(false));
                }}
              >
                Release hold
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
