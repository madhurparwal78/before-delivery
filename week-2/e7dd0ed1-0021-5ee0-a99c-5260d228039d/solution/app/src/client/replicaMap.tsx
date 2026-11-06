// The inspector's replica map, status list and readiness line (brief: Motion and effects, Replica Wake;
// Feedback states, Replica announcements and Release readiness). Everything here reads the displayed pins.
import type { JSX } from "preact";
import { formatCount, shortVersion } from "../shared/format";
import type { Region } from "./api";
import { Status } from "./dialog";
import { Icon } from "./icons";
import { type Pin, statusLine } from "./wake";
import { type DotGrid, type Frame, LandDots, project, viewBox } from "./worldmap";

// Cropped to the seeded region positions with room for a label on every side of a pin.
const FRAME: Frame = { west: -138, east: 153, north: 90, south: -56 };
const FRAME_W = FRAME.east - FRAME.west;
const FRAME_H = FRAME.north - FRAME.south;
// One dot per 6°, so the grid still reads as dots in the narrow inspector.
const COARSE_DOTS: DotGrid = { cells: 2, radius: 1.35 };
const PIN_R = 4.5;

// A pin's label block: the region name over its word or numeral, on a ground-coloured plate. The
// block goes on the side of the pin that fits inside the map and points furthest from the pin's
// wake lines, so no line runs under its own label; lines from other pins pass beneath the plate,
// and the pins are drawn last so no plate covers one.
type Side = "right" | "left" | "above" | "below";
const SIDE_DIRECTIONS: Record<Side, [number, number]> = { right: [1, 0], left: [-1, 0], above: [0, -1], below: [0, 1] };
const GAP = PIN_R + 3;
const LINE = 15;
const PLATE_PAD = 2;

interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Widths are estimated from the 14px faces (about 0.6em a character). The second line is sized for an
// eight-character numeral such as "9,999 ms" (settles land within 10 seconds), so the block holds
// still while the state changes and the numeral counts.
const labelWidth = (name: string): number => Math.max(name.length, 8) * 8.4;

function boxOn(side: Side, x: number, y: number, width: number): LabelBox {
  const height = 2 * LINE;
  if (side === "right") return { x: x + GAP, y: y - height / 2, width, height };
  if (side === "left") return { x: x - GAP - width, y: y - height / 2, width, height };
  // Above and below, the block centres on the pin but slides sideways to stay inside the map.
  const left = Math.min(Math.max(x - width / 2, 0), FRAME_W - width);
  if (side === "above") return { x: left, y: y - GAP - height, width, height };
  return { x: left, y: y + GAP, width, height };
}

const fits = (box: LabelBox): boolean => box.x >= 0 && box.y >= 0 && box.x + box.width <= FRAME_W && box.y + box.height <= FRAME_H;

function placeLabel(x: number, y: number, width: number, lineEnds: { x: number; y: number }[]): LabelBox {
  const clearance = (side: Side): number => {
    const [dx, dy] = SIDE_DIRECTIONS[side];
    return Math.min(Math.PI, ...lineEnds.map((end) => Math.acos(Math.max(-1, Math.min(1,
      (dx * (end.x - x) + dy * (end.y - y)) / (Math.hypot(end.x - x, end.y - y) || 1))))));
  };
  const sides = (Object.keys(SIDE_DIRECTIONS) as Side[]).filter((side) => fits(boxOn(side, x, y, width)));
  const best = sides.reduce<Side | null>((chosen, side) => (chosen === null || clearance(side) > clearance(chosen) ? side : chosen), null);
  return boxOn(best ?? "right", x, y, width);
}

function readiness(pins: Pin[], versionId: string): string {
  const failed = pins.filter((p) => p.state === "failed").length;
  const pending = pins.filter((p) => p.state === "pending").length;
  if (failed > 0) return `Not ready: ${formatCount(failed)} failed. Retry before shipping.`;
  if (pending > 0) return `Waiting on ${formatCount(pending)} of ${formatCount(pins.length)} regions.`;
  return `Ready to ship: all ${formatCount(pins.length)} regions hold version ${shortVersion(versionId)}.`;
}

function PinMark({ pin, x, y }: { pin: Pin; x: number; y: number }): JSX.Element {
  if (pin.state === "origin") return <circle class="pin__solid" cx={x} cy={y} r={PIN_R} />;
  if (pin.state === "failed") {
    const d = PIN_R * 0.5;
    return (
      <g class="pin__failed">
        <circle cx={x} cy={y} r={PIN_R} />
        <path d={`M${x - d} ${y - d}L${x + d} ${y + d}M${x + d} ${y - d}L${x - d} ${y + d}`} />
      </g>
    );
  }
  if (pin.state === "pending") return <circle class="pin__pending" cx={x} cy={y} r={PIN_R} />;
  return (
    <g class="pin__settled">
      <circle class="pin__ring" cx={x} cy={y} r={PIN_R} />
      <circle class="pin__solid" cx={x} cy={y} r={PIN_R} fill-opacity={pin.fill} />
    </g>
  );
}

interface ReplicaMapProps {
  pins: Pin[];
  versionId: string;
  announcement: string;
  regions: Region[];
  canRetry: boolean;
  onRetry: (region: string) => void;
}

export function ReplicaMap({ pins, versionId, announcement, regions, canRetry, onRetry }: ReplicaMapProps): JSX.Element {
  const placeOf = (id: string): { x: number; y: number; name: string } => {
    const region = regions.find((r) => r.id === id);
    return region ? { ...project(FRAME, region.lon, region.lat), name: region.name } : { x: 0, y: 0, name: id };
  };
  const origin = pins.find((p) => p.state === "origin");
  const from = origin ? placeOf(origin.region) : { x: 0, y: 0 };
  const failed = pins.filter((p) => p.state === "failed");
  return (
    <>
      <figure class="replica-map" aria-label="Replica map">
        <svg class="replica-map__svg" viewBox={viewBox(FRAME)} aria-hidden="true">
          <LandDots frame={FRAME} grid={COARSE_DOTS} class="land land--coarse" />
          {pins
            .filter((p) => p.state !== "origin")
            .map((pin) => {
              const to = placeOf(pin.region);
              return (
                <line key={pin.region} class="wake" data-wake={pin.region} data-progress={pin.progress.toFixed(2)}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y} pathLength={1} stroke-dasharray="1"
                  stroke-dashoffset={1 - pin.progress} />
              );
            })}
          {pins.map((pin) => {
            const { x, y, name } = placeOf(pin.region);
            const word = pin.state === "settled" ? null : pin.state;
            const lineEnds = pin.state === "origin"
              ? pins.filter((p) => p.state !== "origin").map((p) => placeOf(p.region))
              : origin ? [from] : [];
            const box = placeLabel(x, y, labelWidth(name), lineEnds);
            const text = { x: box.x, "text-anchor": "start" } as const;
            return (
              <g key={pin.region} class="pin__label">
                <rect class="pin__plate" x={box.x - PLATE_PAD} y={box.y - PLATE_PAD} width={box.width + 2 * PLATE_PAD}
                  height={box.height + 2 * PLATE_PAD} rx={2} />
                <text class="pin__name" {...text} y={box.y + 12}>
                  {name}
                </text>
                {word && (
                  <text class="pin__word" {...text} y={box.y + 12 + LINE}>
                    {word}
                  </text>
                )}
                <text class="pin__numeral" data-numeral={pin.region} {...text} y={box.y + 12 + LINE}>
                  {pin.numeral}
                </text>
              </g>
            );
          })}
          {pins.map((pin) => {
            const { x, y } = placeOf(pin.region);
            return (
              <g key={pin.region} class="pin" data-region={pin.region} data-state={pin.state}>
                <PinMark pin={pin} x={x} y={y} />
              </g>
            );
          })}
        </svg>
        {canRetry && failed.length > 0 && (
          <div class="replica-map__retry">
            {failed.map((pin) => (
              <button key={pin.region} type="button" class="button button--small" onClick={() => onRetry(pin.region)}>
                <Icon name="rotate-ccw" />
                Retry<span class="vh"> {placeOf(pin.region).name}</span>
              </button>
            ))}
          </div>
        )}
      </figure>
      <ul role="list" class="vh" aria-label="Replica status">
        {pins.map((pin) => (
          <li key={pin.region}>{statusLine(placeOf(pin.region).name, pin)}</li>
        ))}
      </ul>
      <div role="status" aria-live="polite" aria-label="Replica announcements" class="vh">
        {announcement}
      </div>
      <Status label="Release readiness" text={readiness(pins, versionId)} class="readiness" />
    </>
  );
}
