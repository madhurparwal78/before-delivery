import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { RequestView, Seat, SeatLabel } from '../../shared/types.js';
import { rotationSegments, segmentAtMinute, type RotationSegment } from '../../shared/rotation.js';
import { addMinutesIso, clock } from '../format.js';

const LANE_HEIGHT = 40;
const STAGGER_MS = 40;
const TEXT_MIN_WIDTH = 62;

/** The word for a seat: the interpreter's name, "open", or "taken" to onlookers. */
function seatWord(seat: Seat): string {
  if (seat.status === 'open') return 'open';
  return seat.interpreter === null ? 'taken' : seat.interpreter.display_name;
}

/** Only a seat confirmed to someone the viewer may see fills in; "taken" stays hatched. */
function fills(seat: Seat): boolean {
  return seat.status === 'confirmed' && seat.interpreter !== null;
}

export function segmentsOf(request: RequestView): RotationSegment[] {
  const labels = request.seats.map((seat) => seat.label);
  return rotationSegments(
    request.duration_minutes,
    request.rotation_minutes,
    labels.length > 0 ? labels : ['A'],
  );
}

export function readoutText(request: RequestView, minute: number): string {
  const segments = segmentsOf(request);
  const segment = segments[
    segmentAtMinute(minute, request.rotation_minutes, segments.length)
  ] as RotationSegment;
  const at = clock(addMinutesIso(request.starts_at, minute));
  const wordFor = (label: SeatLabel): string => {
    const seat = request.seats.find((entry) => entry.label === label);
    return seat === undefined ? 'open' : seatWord(seat);
  };
  const activePart = `Active: Seat ${segment.active_label}, ${wordFor(segment.active_label)}`;
  const supportPart =
    segment.support_label === null
      ? 'Support: none'
      : `Support: Seat ${segment.support_label}, ${wordFor(segment.support_label)}`;
  return `${at} · ${activePart} · ${supportPart}`;
}

interface BraidProps {
  request: RequestView;
  reducedMotion: boolean;
  minute: number;
  onMinuteChange: (minute: number) => void;
}

export function Braid({ request, reducedMotion, minute, onMinuteChange }: BraidProps): ReactNode {
  const segments = segmentsOf(request);
  const lanes = request.seats;
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);
  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const seenFilled = useRef<Set<SeatLabel> | null>(null);

  useLayoutEffect(() => {
    const element = lanesRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const fingerprint = lanes
    .map((seat) => `${seat.label}:${seat.status}:${seatWord(seat)}`)
    .join('|');

  // Segments fill one by one in start-time order once the server has confirmed the seat.
  useEffect(() => {
    const filledNow = new Set(lanes.filter(fills).map((seat) => seat.label));
    const first = seenFilled.current === null;
    const previously = seenFilled.current ?? new Set<SeatLabel>();
    seenFilled.current = filledNow;

    const immediate: string[] = [];
    const staggered: string[] = [];
    for (const label of filledNow) {
      const keys = segments.map((segment) => `${label}:${segment.index}`);
      if (first || previously.has(label) || reducedMotion) immediate.push(...keys);
      else staggered.push(...keys);
    }

    setRevealed(() => {
      const next: Record<string, true> = {};
      for (const key of immediate) next[key] = true;
      return next;
    });

    if (staggered.length === 0) return;
    const timers = staggered.map((key, step) =>
      window.setTimeout(
        () => setRevealed((current) => ({ ...current, [key]: true })),
        step * STAGGER_MS,
      ),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, request.rotation_minutes, request.duration_minutes, fingerprint, reducedMotion]);

  const minuteAt = (clientX: number): number => {
    const element = lanesRef.current;
    if (element === null) return minute;
    const box = element.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;
    return Math.max(
      0,
      Math.min(request.duration_minutes, Math.round(ratio * request.duration_minutes)),
    );
  };

  const columns = segments
    .map((segment) => `${segment.end_minute - segment.start_minute}fr`)
    .join(' ');
  const playheadX = width * (minute / request.duration_minutes);

  return (
    <div className="braid" role="group" aria-label="Rotation braid">
      <div className="braid-row">
      <div className="braid-gutter" aria-hidden="true">
        {lanes.map((seat) => (
          <span key={seat.label}>{`Seat ${seat.label}`}</span>
        ))}
      </div>
      <div
        className="braid-lanes"
        ref={lanesRef}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          onMinuteChange(minuteAt(event.clientX));
        }}
        onPointerMove={(event) => {
          if (dragging.current) onMinuteChange(minuteAt(event.clientX));
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        {lanes.map((seat) => (
          <div key={seat.label} className="braid-lane-wrap">
            <ul
              className="braid-lane"
              aria-label={`Seat ${seat.label} lane`}
              style={{ gridTemplateColumns: columns }}
            >
              {segments.map((segment) => {
                const key = `${seat.label}:${segment.index}`;
                const isActive = segment.active_label === seat.label;
                const shown = revealed[key] === true;
                const word = fills(seat) && !shown ? 'open' : seatWord(seat);
                const segmentWidth =
                  (width * (segment.end_minute - segment.start_minute)) / request.duration_minutes;
                return (
                  <li
                    key={key}
                    className={`segment${shown ? '' : ' segment-open'}`}
                    aria-label={`${clock(
                      addMinutesIso(request.starts_at, segment.start_minute),
                    )} to ${clock(addMinutesIso(request.starts_at, segment.end_minute))}, ${
                      isActive ? 'active' : 'support'
                    }, ${word}`}
                  >
                    <span
                      className={`segment-fill ${isActive ? 'active' : 'support'}${
                        shown ? ' shown' : ''
                      }`}
                      aria-hidden="true"
                    />
                    {segmentWidth >= TEXT_MIN_WIDTH ? (
                      <span
                        className={`segment-text ${
                          shown ? (isActive ? 'on-active' : 'on-support') : 'on-open'
                        }`}
                      >
                        {word}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <svg
          className="braid-overlay"
          width={width}
          height={lanes.length * LANE_HEIGHT}
          aria-hidden="true"
        >
          {lanes.length > 1
            ? segments.slice(0, -1).map((segment) => {
                const x = width * (segment.end_minute / request.duration_minutes);
                const segmentWidth = width / segments.length;
                const reach = Math.max(5, Math.min(14, segmentWidth / 3.2));
                const top = LANE_HEIGHT / 2;
                const bottom = LANE_HEIGHT + LANE_HEIGHT / 2;
                const activeLeavesTop = segment.active_label === 'A';
                const activeFrom = activeLeavesTop ? top : bottom;
                const activeTo = activeLeavesTop ? bottom : top;
                return (
                  <g key={`crossover-${segment.index}`}>
                    {/* The support band passes under, the active band crosses over it. */}
                    <line
                      className="crossover draw"
                      x1={x - reach}
                      y1={activeTo}
                      x2={x + reach}
                      y2={activeFrom}
                      stroke="var(--cobalt-edge)"
                      strokeWidth={9}
                    />
                    <line
                      className="crossover draw"
                      x1={x - reach}
                      y1={activeTo}
                      x2={x + reach}
                      y2={activeFrom}
                      stroke="var(--cobalt-wash)"
                      strokeWidth={6}
                    />
                    <line
                      className="crossover draw"
                      x1={x - reach}
                      y1={activeFrom}
                      x2={x + reach}
                      y2={activeTo}
                      stroke="var(--ground)"
                      strokeWidth={11}
                    />
                    <line
                      className="crossover draw"
                      x1={x - reach}
                      y1={activeFrom}
                      x2={x + reach}
                      y2={activeTo}
                      stroke="var(--cobalt)"
                      strokeWidth={7}
                    />
                  </g>
                );
              })
            : null}
          <line
            className="playhead-line"
            x1={playheadX}
            y1={0}
            x2={playheadX}
            y2={lanes.length * LANE_HEIGHT}
          />
        </svg>
      </div>
      </div>
      <div className="playhead-row">
        <input
          type="range"
          aria-label="Playhead"
          min={0}
          max={request.duration_minutes}
          step={1}
          value={minute}
          aria-valuetext={readoutText(request, minute)}
          onChange={(event) => onMinuteChange(Number(event.target.value))}
          onKeyDown={(event) => {
            if (!event.shiftKey) return;
            const step = request.rotation_minutes;
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              onMinuteChange(Math.min(request.duration_minutes, minute + step));
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              onMinuteChange(Math.max(0, minute - step));
            }
          }}
        />
      </div>
    </div>
  );
}

export function RotationTable({ request }: { request: RequestView }): ReactNode {
  const segments = segmentsOf(request);
  const wordFor = (label: SeatLabel | null): string => {
    if (label === null) return 'none';
    const seat = request.seats.find((entry) => entry.label === label);
    return seat === undefined ? 'open' : seatWord(seat);
  };
  return (
    <table>
      <caption>Rotation table</caption>
      <thead>
        <tr>
          <th scope="col">Start</th>
          <th scope="col">End</th>
          <th scope="col">Active</th>
          <th scope="col">Support</th>
        </tr>
      </thead>
      <tbody>
        {segments.map((segment) => (
          <tr key={segment.index}>
            <td className="num">{clock(addMinutesIso(request.starts_at, segment.start_minute))}</td>
            <td className="num">{clock(addMinutesIso(request.starts_at, segment.end_minute))}</td>
            <td>{`Seat ${segment.active_label}, ${wordFor(segment.active_label)}`}</td>
            <td>
              {segment.support_label === null
                ? 'none'
                : `Seat ${segment.support_label}, ${wordFor(segment.support_label)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
