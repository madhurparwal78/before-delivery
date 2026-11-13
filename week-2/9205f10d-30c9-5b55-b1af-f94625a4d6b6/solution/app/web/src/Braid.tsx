import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clockLabels } from "../../shared/agencyTime";
import { seatWho } from "./format";
import { DURATION, play, reducedMotion } from "./motion";
import type { ApiRequest, SeatLabel } from "./types";

interface Segment {
  index: number;
  start: number;
  end: number;
  active: SeatLabel;
}

/**
 * Rotation segments: a job of length L with interval R has ⌈L ÷ R⌉ segments; segment k runs from
 * k×R to min((k+1)×R, L). Seat A is active in even segments and seat B in odd ones; a one-seat
 * job is active on its only seat throughout.
 */
function rotationSegments(length: number, interval: number, labels: SeatLabel[]): Segment[] {
  const only = labels.length === 1 ? labels[0] : undefined;
  return Array.from({ length: Math.ceil(length / interval) }, (_, index) => ({
    index,
    start: index * interval,
    end: Math.min((index + 1) * interval, length),
    active: only ?? (index % 2 === 0 ? "A" : "B"),
  }));
}

interface Rotation {
  labels: SeatLabel[];
  length: number;
  interval: number;
  segments: Segment[];
  /** How each seat reads to the viewer: a name, "open" or "taken". */
  who: Record<string, string>;
}

function rotationOf(request: ApiRequest): Rotation {
  const labels = request.seats.map((s) => s.label).sort();
  const length = request.duration_minutes;
  const interval = request.rotation_minutes ?? 20;
  return {
    labels,
    length,
    interval,
    segments: rotationSegments(length, interval, labels),
    who: Object.fromEntries(request.seats.map((s) => [s.label, seatWho(s)])),
  };
}

const isPerson = (who: string | undefined): boolean => who !== undefined && who !== "open" && who !== "taken";

const clockAt = (startIso: string, minute: number): string =>
  clockLabels(new Date(new Date(startIso).getTime() + minute * 60_000)).clock;

function segmentAt(rotation: Rotation, minute: number): Segment | undefined {
  return rotation.segments[Math.min(Math.floor(minute / rotation.interval), rotation.segments.length - 1)];
}

function supportOf(rotation: Rotation, active: SeatLabel): SeatLabel | undefined {
  return rotation.labels.find((l) => l !== active);
}

/** "<clock> · Active: Seat A, <who> · Support: Seat B, <who>" at a playhead minute. */
function readoutAt(startIso: string, rotation: Rotation, minute: number): string {
  const active = segmentAt(rotation, minute)?.active ?? "A";
  const support = supportOf(rotation, active);
  const supportPart = support ? `Seat ${support}, ${rotation.who[support]}` : "none";
  return [clockAt(startIso, minute), `Active: Seat ${active}, ${rotation.who[active]}`, `Support: ${supportPart}`].join(" · ");
}

interface Fill {
  from: string;
  count: number;
}

/**
 * When the server confirms a seat for the viewer, that lane's segments change from hatched to
 * filled one at a time, earliest first, 40 ms apart, each segment's name changing as its fill
 * begins. With reduced motion they all switch at once.
 */
function useFills(rotation: Rotation): Record<string, Fill> {
  const [fills, setFills] = useState<Record<string, Fill>>({});
  const previous = useRef(rotation.who);
  const timers = useRef<number[]>([]);
  // One string that changes whenever any seat reads differently.
  const whoKey = rotation.labels.map((l) => `${l}:${rotation.who[l]}`).join("|");
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = rotation.who;
    for (const label of rotation.labels) {
      const from = before[label];
      const to = rotation.who[label];
      if (from === to) continue;
      const staggered = from !== undefined && !isPerson(from) && isPerson(to) && !reducedMotion();
      setFills((current) => {
        const { [label]: _replaced, ...rest } = current;
        return staggered && from !== undefined ? { ...rest, [label]: { from, count: 1 } } : rest;
      });
      if (!staggered) continue;
      for (let k = 1; k < rotation.segments.length; k += 1) {
        timers.current.push(
          window.setTimeout(() => {
            setFills((current) => {
              const fill = current[label];
              return fill ? { ...current, [label]: { ...fill, count: k + 1 } } : current;
            });
          }, DURATION.fillStagger * k),
        );
      }
    }
  }, [whoKey]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  return fills;
}

function SegmentItem({
  name,
  who,
  role,
  left,
  width,
  showWord,
}: {
  name: string;
  who: string;
  role: "active" | "support";
  left: number;
  width: number;
  showWord: boolean;
}) {
  // The hatch that was there sweeps off left to right, uncovering the fill beneath.
  const sweepRef = useRef<HTMLSpanElement>(null);
  const filled = isPerson(who);
  const wasFilled = useRef(filled);
  useLayoutEffect(() => {
    if (filled && !wasFilled.current) {
      play(sweepRef.current, [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }], DURATION.fill);
    }
    wasFilled.current = filled;
  }, [filled]);
  return (
    <li
      aria-label={name}
      className={`segment segment--${role} ${filled ? "segment--filled" : "segment--hatched"}`}
      style={{ left: `${left}%`, width: `${width}%` }}
    >
      <span className="segment-band">
        {filled && <span ref={sweepRef} className="segment-sweep" />}
        {showWord && <span className="segment-word">{who}</span>}
      </span>
    </li>
  );
}

/** The diagonals between the lanes: at each boundary the active band crosses to the other lane. */
function Crossovers({ rotation, width }: { rotation: Rotation; width: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const height = 20;
  const lean = Math.min(8, width / rotation.segments.length / 4);
  // Drawn once, when the braid first appears (its width becomes known).
  useEffect(() => {
    const svg = ref.current;
    if (!svg || width === 0) return;
    const frame = requestAnimationFrame(() => {
      for (const path of svg.querySelectorAll("path")) {
        const length = path.getTotalLength();
        play(path, [{ strokeDasharray: `${length}`, strokeDashoffset: `${length}` }, { strokeDasharray: `${length}`, strokeDashoffset: "0" }], DURATION.crossover);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [width === 0]);
  const boundaries = rotation.segments.slice(1);
  return (
    <svg ref={ref} className="crossovers" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {boundaries.map((segment) => {
        const x = (segment.start / rotation.length) * width;
        const intoB = segment.active === "B";
        const [top, bottom] = intoB ? [x - lean, x + lean] : [x + lean, x - lean];
        const active = intoB ? `M${top},0 L${bottom},${height}` : `M${bottom},${height} L${top},0`;
        const support = intoB ? `M${x - lean},${height} L${x + lean},0` : `M${x - lean},0 L${x + lean},${height}`;
        return (
          <g key={segment.index}>
            <path className="crossover-support" d={support} />
            <path className="crossover-active" d={active} />
          </g>
        );
      })}
    </svg>
  );
}

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The rotation braid: one lane per seat, segments with alternating active role, a playhead and readout. */
export function Braid({ request }: { request: ApiRequest }) {
  const rotation = rotationOf(request);
  const fills = useFills(rotation);
  const [minute, setMinute] = useState(0);
  const [trackRef, trackWidth] = useWidth<HTMLDivElement>();
  const dragging = useRef(false);
  const playhead = Math.min(minute, rotation.length);
  const text = readoutAt(request.starts_at, rotation, playhead);

  const shown = (label: SeatLabel, index: number): string => {
    const fill = fills[label];
    return fill && index >= fill.count ? fill.from : (rotation.who[label] ?? "open");
  };

  const seek = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setMinute(Math.round(fraction * rotation.length));
  };
  const press = (event: PointerEvent<HTMLElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seek(event.clientX);
  };
  const drag = (event: PointerEvent<HTMLElement>) => {
    if (dragging.current) seek(event.clientX);
  };
  const release = () => {
    dragging.current = false;
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.shiftKey ? rotation.interval : 1;
    const moves: Record<string, number> = {
      ArrowRight: playhead + by,
      ArrowUp: playhead + by,
      ArrowLeft: playhead - by,
      ArrowDown: playhead - by,
      PageUp: playhead + rotation.interval,
      PageDown: playhead - rotation.interval,
      Home: 0,
      End: rotation.length,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setMinute(Math.min(rotation.length, Math.max(0, next)));
  };
  const percent = (value: number) => (value / rotation.length) * 100;

  return (
    <>
    <div className="braid" role="group" aria-label="Rotation braid">
      <div className="braid-lanes">
        <div className="braid-titles" aria-hidden="true">
          {rotation.labels.map((label, i) => (
            <span key={label} className={`lane-title lane-title--${i === 0 ? "first" : "second"}`}>
              Seat {label}
            </span>
          ))}
        </div>
        <div
          ref={trackRef}
          className={`braid-track braid-track--${rotation.labels.length === 2 ? "team" : "solo"}`}
          onPointerDown={press}
          onPointerMove={drag}
          onPointerUp={release}
          onPointerCancel={release}
        >
          {rotation.labels.map((label, laneIndex) => (
            <div key={label} className={`lane-slot lane-slot--${laneIndex === 0 ? "first" : "second"}`}>
              <ul className={`lane lane--${laneIndex === 0 ? "first" : "second"}`} aria-label={`Seat ${label} lane`}>
                {rotation.segments.map((segment) => {
                  const who = shown(label, segment.index);
                  const role = segment.active === label ? "active" : "support";
                  const widthPx = (trackWidth * (segment.end - segment.start)) / rotation.length;
                  return (
                    <SegmentItem
                      key={segment.index}
                      name={`${clockAt(request.starts_at, segment.start)} to ${clockAt(request.starts_at, segment.end)}, ${role}, ${who}`}
                      who={who}
                      role={role}
                      left={percent(segment.start)}
                      width={percent(segment.end - segment.start)}
                      showWord={widthPx >= who.length * 7.5 + 14}
                    />
                  );
                })}
              </ul>
              {laneIndex === 0 && rotation.labels.length === 2 && <Crossovers rotation={rotation} width={trackWidth} />}
            </div>
          ))}
          <span className="playhead-line" style={{ left: `${percent(playhead)}%` }} aria-hidden="true" />
        </div>
      </div>
      <div className="braid-ruler-row">
        <span className="braid-ruler-gap" aria-hidden="true" />
        <div
          className="braid-ruler"
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={rotation.length}
          aria-valuenow={playhead}
          aria-valuetext={text}
          onKeyDown={step}
          onPointerDown={press}
          onPointerMove={drag}
          onPointerUp={release}
          onPointerCancel={release}
        >
          {rotation.segments.map((segment) => (
            <span key={segment.index} className="ruler-tick" style={{ left: `${percent(segment.start)}%` }} aria-hidden="true" />
          ))}
          <span className="ruler-tick" style={{ left: "100%" }} aria-hidden="true" />
          <span className="ruler-label ruler-label--start" aria-hidden="true">
            {clockAt(request.starts_at, 0)}
          </span>
          <span className="ruler-label ruler-label--end" aria-hidden="true">
            {clockAt(request.starts_at, rotation.length)}
          </span>
          <span className="ruler-thumb" style={{ left: `${percent(playhead)}%` }} aria-hidden="true" />
        </div>
      </div>
      <p className="braid-readout" role="status" aria-label="Rotation readout">
        {text}
      </p>
    </div>
    <RotationTable request={request} rotation={rotation} />
    </>
  );
}

function RotationTable({ request, rotation }: { request: ApiRequest; rotation: Rotation }) {
  return (
    <table className="rotation-table" aria-label="Rotation table">
        <thead>
          <tr>
            <th scope="col">Start</th>
            <th scope="col">End</th>
            <th scope="col">Active</th>
            <th scope="col">Support</th>
          </tr>
        </thead>
        <tbody>
          {rotation.segments.map((segment) => {
            const support = supportOf(rotation, segment.active);
            return (
              <tr key={segment.index}>
                <td className="num">{clockAt(request.starts_at, segment.start)}</td>
                <td className="num">{clockAt(request.starts_at, segment.end)}</td>
                <td>
                  Seat {segment.active}, {rotation.who[segment.active]}
                </td>
                <td>{support ? `Seat ${support}, ${rotation.who[support]}` : "none"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
  );
}
