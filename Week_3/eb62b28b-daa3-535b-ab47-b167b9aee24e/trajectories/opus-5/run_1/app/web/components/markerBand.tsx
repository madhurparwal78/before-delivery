import { useEffect, useRef, useState } from 'react';
import { Popover } from './overlays';
import {
  MarkerResultsView,
  ResultDrawView,
  TimeZoneId,
  displayDate,
  displayDateOfInstant,
  displayTimeOfInstant,
  flagLabel,
  localDate,
  zoneLabel,
} from '../app/types';

function share(value: string, min: string, max: string): number {
  const low = Number(min);
  const high = Number(max);
  const reading = Number(value);
  if (high <= low) return 0;
  return Math.min(100, Math.max(0, ((reading - low) / (high - low)) * 100));
}

interface ZoneBox {
  zone: 'below' | 'inRange' | 'optimal' | 'above';
  left: number;
  width: number;
}

function zonesOf(draw: ResultDrawView, scale: { min: string; max: string }): ZoneBox[] {
  const at = (value: string): number => share(value, scale.min, scale.max);
  const low = at(draw.range.low);
  const high = at(draw.range.high);
  const optimalLow = at(draw.range.optimalLow);
  const optimalHigh = at(draw.range.optimalHigh);
  return [
    { zone: 'below', left: 0, width: low },
    { zone: 'inRange', left: low, width: Math.max(0, high - low) },
    { zone: 'optimal', left: optimalLow, width: Math.max(0, optimalHigh - optimalLow) },
    { zone: 'above', left: high, width: Math.max(0, 100 - high) },
  ];
}

function trendPath(marker: MarkerResultsView, upTo: number): string {
  const points = marker.draws.slice(0, upTo + 1).map((draw, index) => {
    const x =
      marker.draws.length <= 1 ? 50 : (index / (marker.draws.length - 1)) * 100;
    const y = 100 - share(draw.value, marker.scale.min, marker.scale.max);
    return `${x},${y}`;
  });
  if (points.length === 0) return '';
  return `M ${points.join(' L ')}`;
}

export interface MarkerBandProps {
  marker: MarkerResultsView;
  zone: TimeZoneId;
  onCorrect?: (draw: ResultDrawView) => void;
  correctionLine?: string | null;
}

export function MarkerBand({
  marker,
  zone,
  onCorrect,
  correctionLine,
}: MarkerBandProps): JSX.Element {
  const [selected, setSelected] = useState(marker.draws.length - 1);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const selectedStation = useRef<HTMLElement | null>(null);
  const lastCount = useRef(marker.draws.length);
  const lastValue = useRef(marker.draws[selected]?.value ?? '');

  useEffect(() => {
    lastCount.current = marker.draws.length;
    if (selected > marker.draws.length - 1) setSelected(marker.draws.length - 1);
  }, [marker.draws.length, selected]);

  const draw = marker.draws[Math.max(0, Math.min(selected, marker.draws.length - 1))] ?? null;

  useEffect(() => {
    if (draw && lastValue.current !== draw.value) {
      setPreviousValue(lastValue.current);
      lastValue.current = draw.value;
    }
  }, [draw]);

  const move = (next: number): void => {
    const clamped = Math.max(0, Math.min(marker.draws.length - 1, next));
    setSelected(clamped);
    optionRefs.current[clamped]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const stacked = (): boolean => window.matchMedia('(max-width: 767px)').matches;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowLeft' || (stacked() && event.key === 'ArrowUp')) {
      event.preventDefault();
      move(selected - 1);
      return;
    }
    if (event.key === 'ArrowRight' || (stacked() && event.key === 'ArrowDown')) {
      event.preventDefault();
      move(selected + 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      move(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      move(marker.draws.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      setPopoverOpen(true);
    }
  };

  if (!draw) return <p className="muted">No results yet.</p>;

  const zones = zonesOf(draw, marker.scale);
  const dotLeft = share(draw.value, marker.scale.min, marker.scale.max);
  const newestLength = 120;

  return (
    <section className="card marker-card" role="region" aria-label={marker.name}>
      <h3>{marker.name}</h3>
      <p className="muted">
        {marker.unit} · {displayDateOfInstant(draw.collectedAt, zone)}
      </p>
      <div className="band">
        {zones.map((box) => (
          <div
            key={box.zone}
            className="zone"
            data-part="zone"
            data-zone={box.zone}
            style={{ left: `${box.left}%`, width: `${box.width}%` }}
          />
        ))}
        <div className="dot" data-part="dot" style={{ left: `${dotLeft}%` }} />
      </div>
      <p>
        <span className="band-value" data-part="value">
          {previousValue !== null && previousValue !== draw.value ? (
            <span className="roll-out" aria-hidden="true" onAnimationEnd={() => setPreviousValue(null)}>
              {previousValue} {marker.unit}
            </span>
          ) : null}
          <span className="roll-in" key={draw.value}>
            {draw.value} {marker.unit}
          </span>
        </span>{' '}
        <span className="pill">{flagLabel[draw.flag]}</span>
      </p>
      <p className="zone-legend">
        <span>Below range</span>
        <span>In range</span>
        <span>Optimal</span>
        <span>Above range</span>
      </p>
      <svg className="trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={trendPath(marker, marker.draws.length - 1)} data-part="trend" />
        {marker.draws.length > 1 ? (
          <path
            className="newest"
            style={{ ['--len' as string]: `${newestLength}` }}
            d={`M ${((marker.draws.length - 2) / (marker.draws.length - 1)) * 100},${
              100 - share((marker.draws[marker.draws.length - 2] as ResultDrawView).value, marker.scale.min, marker.scale.max)
            } L 100,${100 - share((marker.draws[marker.draws.length - 1] as ResultDrawView).value, marker.scale.min, marker.scale.max)}`}
            key={`segment-${marker.draws.length}`}
          />
        ) : null}
      </svg>
      <div
        className="stations"
        role="listbox"
        aria-label={`Draws for ${marker.name}`}
        tabIndex={0}
        ref={listRef}
        aria-activedescendant={`station-${marker.marker}-${selected}`}
        onKeyDown={onKeyDown}
      >
        {marker.draws.map((entry, index) => (
          <div
            key={entry.drawId}
            id={`station-${marker.marker}-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === selected}
            data-state={index === selected ? 'selected' : index < selected ? 'earlier' : 'later'}
            data-at={entry.collectedAt}
            ref={(node) => {
              optionRefs.current[index] = node;
              if (index === selected) selectedStation.current = node;
            }}
            onClick={() => {
              if (index === selected) setPopoverOpen(true);
              else setSelected(index);
            }}
          >
            {displayDate(localDate(new Date(entry.collectedAt), zone))}
          </div>
        ))}
      </div>
      {draw.note ? <p>{draw.note}</p> : null}
      {correctionLine ? <p>{correctionLine}</p> : null}
      {onCorrect ? (
        <p>
          <button type="button" className="quiet" onClick={() => onCorrect(draw)}>
            Correct value
          </button>
        </p>
      ) : null}
      <Popover
        name={`Draw on ${displayDate(localDate(new Date(draw.collectedAt), zone))}`}
        open={popoverOpen}
        onClose={() => {
          setPopoverOpen(false);
          selectedStation.current?.focus();
        }}
        opener={selectedStation}
      >
        <h4>Draw on {displayDate(localDate(new Date(draw.collectedAt), zone))}</h4>
        <p>
          Collected {displayTimeOfInstant(draw.collectedAt, zone)} {zoneLabel(zone)}
        </p>
        <p>
          {draw.value} {marker.unit} · {flagLabel[draw.flag]}
        </p>
        <p>
          Range in force {draw.range.low}–{draw.range.high} (optimal {draw.range.optimalLow}–
          {draw.range.optimalHigh})
        </p>
        {draw.note ? <p>{draw.note}</p> : null}
        {draw.correctedBy && draw.correctedAt ? (
          <p>
            {draw.correctedBy} corrected {marker.name} at{' '}
            {displayTimeOfInstant(draw.correctedAt, zone)} {zoneLabel(zone)}. The band shows the
            corrected value.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setPopoverOpen(false);
            selectedStation.current?.focus();
          }}
        >
          Close
        </button>
      </Popover>
    </section>
  );
}
