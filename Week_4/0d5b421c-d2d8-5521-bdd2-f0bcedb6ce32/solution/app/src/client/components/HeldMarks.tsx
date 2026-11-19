// What lies on a held table: one place setting per guest, and the lime ring that drains to the hold's expiry.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "../motion.js";
import { secondsLeft, serverNowMs } from "../serverClock.js";
import type { Geometry } from "./geometry.js";

const STAGGER_LAY_MS = 70;
const STAGGER_LIFT_MS = 40;
const FADE_MS = 170;
const RING_OFFSET = 22;
const STEP_SECONDS = 15;

function Setting({ style, label, lifting, rank }: { style: CSSProperties; label: string; lifting: boolean; rank: number }) {
  return (
    <svg
      role="img"
      aria-label={label}
      className="setting"
      data-lifting={lifting}
      viewBox="0 0 22 22"
      style={{ ...style, "--rank": rank } as CSSProperties}
    >
      <circle cx="11" cy="11" r="5.5" fill="var(--ground)" stroke="var(--surface)" strokeWidth="1.5" />
      <path d="M3.5 5v12M2 5v4.5a1.5 1.5 0 0 0 3 0V5" fill="none" stroke="var(--ground)" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M18.5 5c-1.6 1.2-2 4-2 7h2zM18.5 12v5" fill="none" stroke="var(--ground)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Settings enter clockwise one every 70 ms and lift off from the last one, one every 40 ms. */
export function PlaceSettings({
  tableId,
  geometry,
  partySize,
  firstSetting = 0,
}: {
  tableId: string;
  geometry: Geometry;
  partySize: number | null;
  /** Settings already laid on the other table of a joined pair. */
  firstSetting?: number;
}) {
  const reduced = useReducedMotion();
  const [laid, setLaid] = useState(0);
  const [lifting, setLifting] = useState(false);
  const shown = useRef(0);

  useEffect(() => {
    const timers: number[] = [];
    if (partySize !== null) {
      shown.current = partySize;
      setLifting(false);
      if (reduced) setLaid(partySize);
      else {
        setLaid(1);
        for (let k = 2; k <= partySize; k += 1) timers.push(window.setTimeout(() => setLaid(k), (k - 1) * STAGGER_LAY_MS));
      }
    } else if (shown.current > 0) {
      const count = shown.current;
      setLifting(true);
      if (reduced) {
        setLaid(0);
        shown.current = 0;
      } else {
        for (let k = count; k >= 1; k -= 1) timers.push(window.setTimeout(() => setLaid(k - 1), (count - k) * STAGGER_LIFT_MS + FADE_MS));
        timers.push(window.setTimeout(() => (shown.current = 0), (count - 1) * STAGGER_LIFT_MS + FADE_MS));
      }
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [partySize, reduced]);

  return (
    <>
      {geometry.settings.map((point, index) => {
        const setting = firstSetting + index + 1;
        return setting > laid ? null : (
          <Setting
            key={index}
            label={`Place setting ${setting} of ${shown.current}, table ${tableId}`}
            lifting={lifting}
            rank={shown.current - setting}
            style={{ left: point.x, top: point.y }}
          />
        );
      })}
    </>
  );
}

function ringPath(geometry: Geometry): string {
  const { x, y, width, height } = geometry.body;
  const out = RING_OFFSET;
  if (geometry.round) {
    const radius = width / 2 + out;
    const cx = x + width / 2;
    const top = y + height / 2 - radius;
    return `M ${cx} ${top} A ${radius} ${radius} 0 1 1 ${cx} ${top + radius * 2} A ${radius} ${radius} 0 1 1 ${cx} ${top}`;
  }
  const left = x - out;
  const right = x + width + out;
  const top = y - out;
  const bottom = y + height + out;
  const middle = x + width / 2;
  return `M ${middle} ${top} H ${right} V ${bottom} H ${left} V ${top} H ${middle}`;
}

/**
 * The ring is full when the hold is granted and empty at the server's expiry. Under reduced motion it is a still
 * segment that steps every 15 seconds, and so does the progressbar value.
 */
export function CountdownRing({
  geometry,
  expiresAt,
  lifetimeSeconds,
  label,
}: {
  geometry: Geometry;
  expiresAt: string;
  lifetimeSeconds: number;
  /** The progressbar's name; without one the ring is only drawn. */
  label?: string;
}) {
  const reduced = useReducedMotion();
  const [, tick] = useState(0);
  const elapsedMs = useMemo(
    () => lifetimeSeconds * 1000 - (Date.parse(expiresAt) - serverNowMs()),
    [expiresAt, lifetimeSeconds],
  );
  useEffect(() => {
    const timer = window.setInterval(() => tick((count) => count + 1), 250);
    return () => window.clearInterval(timer);
  }, []);

  const left = secondsLeft(expiresAt);
  const elapsed = Math.max(0, lifetimeSeconds - left);
  const value = reduced ? Math.max(0, lifetimeSeconds - STEP_SECONDS * Math.floor(elapsed / STEP_SECONDS)) : left;
  const path = ringPath(geometry);
  const stillOffset = -(100 * (lifetimeSeconds - value)) / lifetimeSeconds;
  return (
    <div
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": lifetimeSeconds, "aria-valuenow": value })}
      className="ring"
    >
      <svg width={geometry.box.width} height={geometry.box.height} viewBox={`0 0 ${geometry.box.width} ${geometry.box.height}`} className="ring" aria-hidden="true">
        <path d={path} className="keyline" fill="none" pathLength={100} strokeDasharray="100" style={{ strokeDashoffset: reduced ? stillOffset : undefined }} />
        <path
          d={path}
          className="drain"
          fill="none"
          pathLength={100}
          style={reduced ? { animation: "none", strokeDashoffset: stillOffset } : { animationDuration: `${lifetimeSeconds * 1000}ms`, animationDelay: `${-elapsedMs}ms` }}
        />
      </svg>
    </div>
  );
}
