// The marker band: the track, its zones, the one dot, the numerals, the trend line and the station row.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MarkerResults, RangeInForce, ResultEntry } from "../shared/api";
import { dateTimeIn, formatDateIn, zoneTime } from "../shared/format";
import { FLAG_LABEL } from "../shared/labels";
import type { TimeZone } from "../shared/time";
import { LONG, MEDIUM, play } from "./motion";
import { Rolling } from "./screensPublic";
import { announce, openDialog } from "./stores";
import { Dialog, Figures, useMedia } from "./ui";

const ZONES = ["below", "inRange", "optimal", "above"] as const;
type ZoneName = (typeof ZONES)[number];

interface Geometry {
  left: number;
  width: number;
}

// Turning a value into a position for drawing is the only use of a number here.
function position(value: string, scale: MarkerResults["scale"]): number {
  const min = Number(scale.min);
  const max = Number(scale.max);
  return max === min ? 0 : ((Number(value) - min) / (max - min)) * 100;
}

function zoneGeometry(range: RangeInForce, scale: MarkerResults["scale"]): Record<ZoneName, Geometry> {
  const low = position(range.low, scale);
  const high = position(range.high, scale);
  const optimalLow = position(range.optimalLow, scale);
  const optimalHigh = position(range.optimalHigh, scale);
  return {
    below: { left: 0, width: low },
    inRange: { left: low, width: high - low },
    optimal: { left: optimalLow, width: optimalHigh - optimalLow },
    above: { left: high, width: 100 - high },
  };
}

const ZONE_LABEL: Record<ZoneName, string> = { below: "Below range", inRange: "In range", optimal: "Optimal", above: "Above range" };

const percent = (value: number): string => `${value}%`;

function correctionCopy(marker: MarkerResults, entry: ResultEntry, zone: TimeZone): string | null {
  if (!entry.correctedBy || !entry.correctedAt) return null;
  return `${entry.correctedBy} corrected ${marker.name} at ${zoneTime(entry.correctedAt, zone)}. The band shows the corrected value.`;
}

function TrendLine({ marker, grew, selectedIndex }: { marker: MarkerResults; grew: boolean; selectedIndex: number }) {
  const newest = useRef<SVGPathElement>(null);
  // The line spans its own readings, so a small change still reads as a slope. Each point sits over its station's column.
  const readings = marker.draws.map((entry) => position(entry.value, marker.scale));
  const lowest = Math.min(...readings);
  const span = Math.max(...readings) - lowest;
  const points = readings.map((reading, index) => ({
    x: ((index + 0.5) / readings.length) * 100,
    y: span === 0 ? 20 : 36 - ((reading - lowest) / span) * 32,
  }));
  const firstPoints = points.slice(0, -1);
  const last = points.at(-1);
  const previous = firstPoints.at(-1);

  useLayoutEffect(() => {
    if (grew && newest.current) {
      play(newest.current, [{ clipPath: "inset(-8px 100% -8px 0)" }, { clipPath: "inset(-8px 0 -8px 0)" }], LONG);
    }
  }, [grew, marker.draws.length]);

  return (
    <svg className="trend" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <g data-part="trend">
        {firstPoints.length > 1 ? <path d={`M${firstPoints.map((point) => `${point.x} ${point.y}`).join(" L")}`} className="trend-line" /> : null}
        {previous && last ? <path ref={newest} d={`M${previous.x} ${previous.y} L${last.x} ${last.y}`} className="trend-line" /> : null}
        {points.map((point, index) => (
          <path key={marker.draws[index]?.drawId} d={`M${point.x} ${point.y} h0`} className={index === selectedIndex ? "trend-point trend-point-selected" : "trend-point"} />
        ))}
      </g>
    </svg>
  );
}

interface BandProps {
  marker: MarkerResults;
  zone: TimeZone;
  dialogPrefix: string;
  action?: (entry: ResultEntry) => React.ReactNode;
}

function MarkerBand({ marker, zone, dialogPrefix, action }: BandProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = marker.draws;
  const selectedIndex = Math.max(0, entries.findIndex((entry) => entry.drawId === selectedId));
  const chosen = selectedId === null ? entries.at(-1) : entries[selectedIndex];
  const entry = chosen ?? entries[0];
  const shownIndex = selectedId === null ? entries.length - 1 : selectedIndex;
  const stacked = useMedia("(max-width: 599px)");

  const dot = useRef<HTMLDivElement>(null);
  const zones = useRef(new Map<ZoneName, HTMLDivElement>());
  const stations = useRef(new Map<string, HTMLDivElement>());
  const before = useRef<{ drawId: string; dot: number; geometry: Record<ZoneName, Geometry>; range: RangeInForce; scale: string } | null>(null);
  const drawCount = useRef(entries.length);
  const grew = entries.length > drawCount.current;
  const lastCorrection = useRef(new Map(entries.map((item) => [item.drawId, item.correctedAt])));

  const dotAt = entry ? position(entry.value, marker.scale) : 0;
  const geometry = entry ? zoneGeometry(entry.range, marker.scale) : null;
  const scaleKey = `${marker.scale.min}|${marker.scale.max}`;

  // Everything starts here, in one commit, so all of it begins in the same frame.
  useLayoutEffect(() => {
    drawCount.current = entries.length;
    if (!entry || !geometry) return;
    const past = before.current;
    before.current = { drawId: entry.drawId, dot: dotAt, geometry, range: entry.range, scale: scaleKey };
    if (!past || past.scale !== scaleKey) return;
    if (past.dot !== dotAt && dot.current) {
      play(dot.current, [{ left: percent(past.dot) }, { left: percent(dotAt) }], MEDIUM);
    }
    const rangeChanged = past.range.low !== entry.range.low || past.range.high !== entry.range.high
      || past.range.optimalLow !== entry.range.optimalLow || past.range.optimalHigh !== entry.range.optimalHigh;
    if (rangeChanged) {
      for (const name of ZONES) {
        const element = zones.current.get(name);
        const from = past.geometry[name];
        const to = geometry[name];
        if (element && (from.left !== to.left || from.width !== to.width)) {
          play(element, [{ left: percent(from.left), width: percent(from.width) }, { left: percent(to.left), width: percent(to.width) }], LONG);
        }
      }
    }
  }, [entry, dotAt, geometry, scaleKey, entries.length]);

  // A correction arriving in the refresh is announced as well as shown.
  useEffect(() => {
    for (const item of entries) {
      const known = lastCorrection.current.get(item.drawId);
      if (lastCorrection.current.has(item.drawId) && item.correctedAt && known !== item.correctedAt) {
        const copy = correctionCopy(marker, item, zone);
        if (copy) announce(copy);
      }
      lastCorrection.current.set(item.drawId, item.correctedAt);
    }
  }, [entries, marker, zone]);

  const popoverId = `${dialogPrefix}-popover-${marker.marker}`;

  if (!entry || !geometry) return null;

  const select = (index: number, focus: boolean): void => {
    const target = entries[Math.min(entries.length - 1, Math.max(0, index))];
    if (!target) return;
    setSelectedId(target.drawId);
    if (focus) stations.current.get(target.drawId)?.focus();
  };

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, number> = { ArrowLeft: shownIndex - 1, ArrowRight: shownIndex + 1, Home: 0, End: entries.length - 1 };
    if (stacked) {
      moves["ArrowUp"] = shownIndex - 1;
      moves["ArrowDown"] = shownIndex + 1;
    }
    const target = moves[event.key];
    if (target !== undefined) {
      event.preventDefault();
      select(target, true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openDialog(popoverId, stations.current.get(entry.drawId) ?? null);
    }
  };

  const correction = correctionCopy(marker, entry, zone);

  return (
    <div className="band">
      <div className="band-reading">
        <Rolling part="value" changeKey={`${entry.drawId}|${entry.value}`} className="numeral">
          <span className="numeral-value"><Figures text={entry.value} /></span> <span className="numeral-unit">{marker.unit}</span>
        </Rolling>
        <span className={`flag flag-${entry.flag}`}>{FLAG_LABEL[entry.flag]}</span>
      </div>
      <div className="track">
        <div className="track-zones">
        {ZONES.map((name) => (
          <div
            key={name}
            ref={(element) => {
              if (element) zones.current.set(name, element);
              else zones.current.delete(name);
            }}
            data-part="zone"
            data-zone={name}
            className={`zone zone-${name}`}
            style={{ left: percent(geometry[name].left), width: percent(geometry[name].width) }}
          >
            <span className="visually-hidden">{ZONE_LABEL[name]}</span>
          </div>
        ))}
        </div>
        <div ref={dot} data-part="dot" className="dot" style={{ left: percent(dotAt) }} />
      </div>
      <ul className="zone-legend" aria-hidden="true">
        {ZONES.map((name) => <li key={name}><span className={`swatch zone-${name}`} />{ZONE_LABEL[name]}</li>)}
      </ul>
      <TrendLine marker={marker} grew={grew} selectedIndex={shownIndex} />
      <div role="listbox" aria-label={`Draws for ${marker.name}`} aria-orientation={stacked ? "vertical" : "horizontal"} className="stations" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }} onKeyDown={onKey}>
        {entries.map((item, index) => {
          const state = index === shownIndex ? "selected" : index < shownIndex ? "earlier" : "later";
          return (
            <div
              key={item.drawId}
              ref={(element) => {
                if (element) stations.current.set(item.drawId, element);
                else stations.current.delete(item.drawId);
              }}
              role="option"
              aria-selected={state === "selected"}
              tabIndex={state === "selected" ? 0 : -1}
              data-state={state}
              data-at={item.collectedAt}
              className="station"
              onClick={(event) => {
                if (state === "selected") openDialog(popoverId, event.currentTarget);
                else select(index, false);
              }}
            >
              {formatDateIn(item.collectedAt, zone)}
            </div>
          );
        })}
      </div>
      {correction ? <p className="correction">{correction}</p> : null}
      {action ? action(entry) : null}
      <Dialog id={popoverId} title={`Draw on ${formatDateIn(entry.collectedAt, zone)}`} kind="popover" anchor={() => stations.current.get(entry.drawId)?.getBoundingClientRect() ?? null}>
          <dl className="details">
            <dt>Collected</dt><dd>{dateTimeIn(entry.collectedAt, zone)}</dd>
            <dt>Value</dt><dd>{entry.value} {marker.unit}</dd>
            <dt>Flag</dt><dd>{FLAG_LABEL[entry.flag]}</dd>
            <dt>Range in force</dt><dd>{entry.range.low}–{entry.range.high} (optimal {entry.range.optimalLow}–{entry.range.optimalHigh})</dd>
            {entry.note ? <><dt>Specialist note</dt><dd>{entry.note}</dd></> : null}
            {correction ? <><dt>Correction</dt><dd>{correction}</dd></> : null}
          </dl>
      </Dialog>
    </div>
  );
}

export function ResultsList({ markers, zone, dialogPrefix, action }: { markers: readonly MarkerResults[]; zone: TimeZone; dialogPrefix: string; action?: (marker: MarkerResults, entry: ResultEntry) => React.ReactNode }) {
  return (
    <>
      {markers.map((marker) => (
        <MarkerCard key={marker.marker} marker={marker} zone={zone} dialogPrefix={dialogPrefix} {...(action ? { action } : {})} />
      ))}
    </>
  );
}

function MarkerCard({ marker, zone, dialogPrefix, action }: { marker: MarkerResults; zone: TimeZone; dialogPrefix: string; action?: (marker: MarkerResults, entry: ResultEntry) => React.ReactNode }) {
  const headingId = `marker-${marker.marker}`;
  return (
    <section role="region" aria-labelledby={headingId} className="card marker-card">
      <h2 id={headingId}>{marker.name}</h2>
      <MarkerBand
        marker={marker}
        zone={zone}
        dialogPrefix={dialogPrefix}
        {...(action ? { action: (entry: ResultEntry) => action(marker, entry) } : {})}
      />
    </section>
  );
}
