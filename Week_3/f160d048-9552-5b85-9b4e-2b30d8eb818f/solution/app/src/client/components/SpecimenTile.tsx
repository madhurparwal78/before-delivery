import { useEffect, useId, useRef, useState } from "react";
import { formatRange, formatRupees } from "../../shared/money";
import type { PayBand, PayRow } from "../../shared/api";
import { EASE, motionMs } from "../motion";
import { Glassware } from "./Glassware";

export const rowKey = (row: PayRow): string => `${row.role_family}:${row.city}`;

const countSentence = (row: PayRow): string => `${row.report_count} of ${row.threshold} reports. The range opens at ${row.threshold}.`;

export function rowCaption(row: PayRow): string {
  return row.report_count >= row.threshold
    ? `${row.role_name}, ${row.city_name}. Pay range from ${row.report_count} reports`
    : `${row.role_name}, ${row.city_name}. ${row.report_count} of ${row.threshold} reports so far`;
}

/** The Reports cell: the count sentence below the threshold, `<n> reports` at or above it. */
export function reportsText(row: PayRow): string {
  return row.report_count >= row.threshold ? `${row.report_count} reports` : countSentence(row);
}

type BandViewProps = { row: PayRow; unlocked: boolean };

function BandView({ row, unlocked }: BandViewProps) {
  const open = row.band !== null;
  const previous = useRef(row);
  const cover = useRef<HTMLDivElement>(null);
  const tick = useRef<HTMLSpanElement>(null);
  const [unhatch, setUnhatch] = useState<"covered" | "running" | "done">(open ? "done" : "covered");
  const [count, setCount] = useState<"running" | "done">("done");
  const [shown, setShown] = useState<PayBand | null>(row.band);
  const [hadCover, setHadCover] = useState(!open);
  const unhatchMs = motionMs(320);
  const countMs = motionMs(600);

  useEffect(() => {
    const before = previous.current;
    previous.current = row;
    const target = row.band;
    if (target === null) {
      setShown(null);
      setUnhatch("covered");
      setHadCover(true);
      return;
    }
    const resolving = before.band === null && before.report_count < before.threshold && unlocked;
    if (!resolving) {
      setShown(target);
      setUnhatch("done");
      return;
    }
    if (unhatchMs === 0) {
      setUnhatch("done");
      setShown(target);
      setCount("done");
      return;
    }
    const timers: number[] = [];
    let frame = 0;
    setUnhatch("running");
    setCount("running");
    setShown({ low: 0, median: 0, high: 0 });
    cover.current?.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }], { duration: unhatchMs, easing: EASE, fill: "both" });
    tick.current?.animate([{ transform: "translateY(-18px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: countMs, easing: EASE, fill: "both" });
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / countMs);
      const eased = 1 - (1 - progress) ** 3;
      setShown({ low: Math.round(target.low * eased), median: Math.round(target.median * eased), high: Math.round(target.high * eased) });
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    timers.push(window.setTimeout(() => setUnhatch("done"), unhatchMs));
    timers.push(
      window.setTimeout(() => {
        setShown(target);
        setCount("done");
      }, countMs),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      cancelAnimationFrame(frame);
    };
  }, [row, unlocked, unhatchMs, countMs]);

  const band = row.band;
  const domainPad = band ? Math.max((band.high - band.low) * 0.6, 20000) : 0;
  const min = band ? band.low - domainPad : 0;
  const span = band ? band.high - band.low + 2 * domainPad : 1;
  const at = (value: number): string => `${(((value - min) / span) * 100).toFixed(2)}%`;
  return (
    <div className="layer">
      <div className="band-view">
        <p className="role">{row.role_name}, {row.city_name}</p>
        <div className="band-bar" aria-hidden="true">
          <span className="rule" />
          {[0, 25, 50, 75, 100].map((position) => (
            <span className="tick" key={position} style={{ left: `${position}%` }} />
          ))}
          {band ? (
            <>
              <span className="span" style={{ left: at(band.low), width: `${((band.high - band.low) / span) * 100}%` }} />
              <span ref={tick} data-part="median-tick" style={{ left: at(band.median) }} />
            </>
          ) : null}
        </div>
        {band && shown ? (
          <div data-motion="band-count" data-motion-ms={countMs} data-state={count}>
            <p className="range figure">{formatRange(shown.low, shown.high)}</p>
            <p className="median figure">{`Median ${formatRupees(shown.median)}`}</p>
          </div>
        ) : null}
      </div>
      {hadCover ? (
        <div ref={cover} className="cover" data-motion="band-unhatch" data-motion-ms={unhatchMs} data-state={unhatch}>
          <p className="plate figure">{unlocked ? countSentence(row) : row.report_count >= row.threshold ? "Share one post to see this range." : countSentence(row)}</p>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  bandKey: string;
  rows: PayRow[];
  unlocked: boolean;
  /** The glassware shown for a key that is not a pay row: its seed and caption. */
  glass: (key: string) => { seed: string; caption: string };
};

type LayerEntry = { key: string; id: number };

/** The specimen tile: company glassware, or the pay band of the row in view, crossfading between them. */
export function SpecimenTile({ bandKey, rows, unlocked, glass }: Props) {
  const captionId = useId();
  const counter = useRef(0);
  const [layers, setLayers] = useState<LayerEntry[]>([{ key: bandKey, id: 0 }]);
  const [state, setState] = useState<"running" | "done">("done");
  const wrapper = useRef<HTMLDivElement>(null);
  const shownKey = useRef(bandKey);
  const timer = useRef<number | undefined>(undefined);
  const ms = motionMs(420);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (shownKey.current === bandKey) return;
    shownKey.current = bandKey;
    window.clearTimeout(timer.current);
    counter.current += 1;
    const next: LayerEntry = { key: bandKey, id: counter.current };
    if (ms === 0) {
      setLayers([next]);
      setState("done");
      return;
    }
    setLayers((current) => [...current.slice(-1), next]);
    setState("running");
    timer.current = window.setTimeout(() => {
      setLayers((current) => current.slice(-1));
      setState("done");
    }, ms);
  }, [bandKey, ms]);

  useEffect(() => {
    if (layers.length < 2 || ms === 0) return;
    const [outgoing, incoming] = Array.from(wrapper.current?.querySelectorAll(":scope > .layer-slot") ?? []);
    outgoing?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: EASE, fill: "both" });
    incoming?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: EASE, fill: "both" });
  }, [layers, ms]);

  const current = rows.find((row) => rowKey(row) === bandKey);
  const caption = current ? rowCaption(current) : glass(bandKey).caption;
  const covered = current !== undefined && current.band === null;
  return (
    <figure className={`specimen ${covered ? "on-frost" : ""}`} aria-labelledby={captionId}>
      <div ref={wrapper} className="tile" data-band={bandKey} data-motion="band-crossfade" data-motion-ms={ms} data-state={state}>
        {layers.map((layer) => {
          const row = rows.find((candidate) => rowKey(candidate) === layer.key);
          return (
            <div className="layer layer-slot" key={layer.id}>
              {row ? <BandView row={row} unlocked={unlocked} /> : <Glassware seed={glass(layer.key).seed} />}
            </div>
          );
        })}
      </div>
      <figcaption className="caption" id={captionId}>
        {caption}
      </figcaption>
    </figure>
  );
}

export function TileLoading() {
  return (
    <figure className="specimen">
      <div className="tile tile-loading">Loading</div>
    </figure>
  );
}
