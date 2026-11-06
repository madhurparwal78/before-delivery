// The Handshake track: five stations from the server's record, one keyboard composite with a single Tab stop,
// a tooltip for mouse and pen, and the signature step (token glide 640ms, ring fill 320ms, stamp fade 160ms).
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { EASE, FEEDBACK_MS, reducedMotion, STATE_MS, TRAVEL_MS, WIDE_QUERY } from "../hooks";
import type { Station } from "../types";

const REACHED = new Set(["done", "late", "refused"]);
const RING_RADIUS = 13;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface TrackProps {
  track: Station[];
  /** The track as it stood before the latest poll, so newly reached stations play the signature step. */
  previous: Station[] | null;
  when: (instant: string) => string;
  onOpen: (index: number) => void;
}

/** The latest reached station: where the token sits. */
function tokenIndex(track: Station[]): number {
  let at = 0;
  track.forEach((s, i) => {
    if (REACHED.has(s.state)) at = i;
  });
  return at;
}

export function HandshakeTrack({ track, previous, when, onOpen }: TrackProps) {
  const initialStop = Math.max(0, track.findIndex((s) => s.state === "current"));
  const [stop, setStop] = useState(track.some((s) => s.state === "current") ? initialStop : track.length - 1);
  const [tip, setTip] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const tipId = useId();
  const tokenSlot = useRef<HTMLSpanElement>(null);
  const waiting = track.some((s) => s.state === "current" && s.text === "Waiting for answer");
  const fresh = track.map((s, i) => previous !== null && REACHED.has(s.state) && !REACHED.has(previous[i]?.state ?? "pending"));

  // The signature step starts in the same task that commits the server's new record: the token glides from its old
  // station, each newly reached ring fills and its stamp fades in, together. Reduced motion leaves the end state.
  useLayoutEffect(() => {
    if (previous === null || !fresh.includes(true) || reducedMotion()) return;
    const timing = (duration: number) => ({ duration, easing: EASE });
    const from = tokenIndex(previous);
    if (from !== tokenIndex(track)) {
      const axis = matchMedia(WIDE_QUERY).matches ? "X" : "Y";
      tokenSlot.current?.animate([{ transform: `translate${axis}(${from * 100}%)` }], timing(TRAVEL_MS));
    }
    fresh.forEach((isFresh, i) => {
      const button = buttons.current[i];
      if (!isFresh || !button) return;
      button.querySelector(".ring-fill")?.animate([{ strokeDashoffset: CIRCUMFERENCE }, { strokeDashoffset: 0 }], timing(STATE_MS));
      button.querySelector(".station-stamp")?.animate([{ opacity: 0 }, { opacity: 1 }], timing(FEEDBACK_MS));
    });
  }, [track]);

  const move = (to: number) => {
    const next = Math.min(track.length - 1, Math.max(0, to));
    setStop(next);
    buttons.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: stop + 1, ArrowDown: stop + 1, ArrowLeft: stop - 1, ArrowUp: stop - 1, Home: 0, End: track.length - 1 };
    if (event.key in keys) {
      event.preventDefault();
      move(keys[event.key]);
    }
  };

  return (
    <div class="track-frame">
      <div role="toolbar" aria-label="Handshake track" class={`track${waiting ? " is-waiting" : ""}`} onKeyDown={onKeyDown}
        style={{ "--token-index": String(tokenIndex(track)) }}>
        <div class="track-token-lane" aria-hidden="true">
          <span class="track-token-slot" ref={tokenSlot}><span class="track-token" /></span>
        </div>
        {track.map((s, i) => {
          const ringWaiting = s.state === "current" && s.text === "Waiting for answer";
          return (
            <button
              key={s.station}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              class={`station state-${s.state}${ringWaiting ? " ring-waiting" : ""}`}
              data-station={s.station}
              data-state={s.state}
              data-at={s.at ?? undefined}
              tabIndex={i === stop ? 0 : -1}
              aria-describedby={tip === i ? tipId : undefined}
              onFocus={() => setStop(i)}
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse" || e.pointerType === "pen") setTip(i);
              }}
              onPointerLeave={() => setTip((t) => (t === i ? null : t))}
              onPointerDown={(e) => {
                if (e.pointerType === "touch") setTip(null);
              }}
              onClick={() => {
                setTip(null);
                setStop(i);
                onOpen(i);
              }}
            >
              <span class="station-ring" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="32" height="32" focusable="false">
                  <circle class="ring-base" cx="16" cy="16" r={RING_RADIUS} />
                  <circle class="ring-fill" cx="16" cy="16" r={RING_RADIUS}
                    style={{ strokeDasharray: `${CIRCUMFERENCE}`, strokeDashoffset: REACHED.has(s.state) ? "0" : `${CIRCUMFERENCE}` }} />
                  <circle class="ring-core" cx="16" cy="16" r="4" />
                </svg>
              </span>
              <span class="station-words">
                <span class="station-label">{s.label}</span>
                <span class="station-text">{s.text}</span>
                {s.at && <span class="station-stamp fig">{when(s.at)}</span>}
              </span>
            </button>
          );
        })}
        {tip !== null && (
          <span role="tooltip" id={tipId} class="track-tooltip" style={{ "--tip-index": String(tip) }}>
            <span class="track-tooltip-label">{track[tip].label}</span>
            <span class="fig">{track[tip].at ? when(track[tip].at!) : track[tip].text}</span>
          </span>
        )}
      </div>
    </div>
  );
}
