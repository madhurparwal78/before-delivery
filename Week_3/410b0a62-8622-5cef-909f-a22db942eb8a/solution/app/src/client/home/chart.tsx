import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, dayLabel, longDayLabel, shortMonthDay } from '../../shared/dates.js';
import { formatTsb, formatTss, plainNumber } from '../../shared/format.js';
import type { SeriesDay } from '../../shared/types.js';
import { chartAnimationMs, useAnnouncer, useReducedMotion } from '../hooks.js';
import { TRACK_EASING, TRACK_MS } from '../motion.js';
import { Status } from '../ui.js';

const HEIGHT = 280;
const PAD = { left: 44, right: 16, top: 16, bottom: 28 };

const readout = (day: SeriesDay): string =>
  `${longDayLabel(day.date)}: ${formatTss(day.tss)} TSS, fitness ${formatTss(day.ctl)}, fatigue ${formatTss(day.atl)}, form ${formatTsb(day.tsb)}`;

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

interface Level {
  ctl: number;
  atl: number;
}

/** Eases displayed levels from the previous series to the next over `ms`; `animating` is true until the last frame. */
function useMorph(days: SeriesDay[], ms: number): { levels: Level[]; animating: boolean } {
  const target = useMemo<Level[]>(() => days.map((day) => ({ ctl: day.ctl, atl: day.atl })), [days]);
  const [levels, setLevels] = useState<Level[]>(target);
  const [animating, setAnimating] = useState(false);
  const shown = useRef<Level[]>(target);
  const first = useRef(true);

  useEffect(() => {
    const from = shown.current;
    const initial = first.current;
    first.current = false;
    const unchanged = from.length === target.length && target.every((level, index) => level.ctl === from[index]?.ctl && level.atl === from[index]?.atl);
    if (unchanged) return undefined;
    if (initial || ms === 0 || from.length !== target.length) {
      shown.current = target;
      setLevels(target);
      setAnimating(false);
      return undefined;
    }
    let frame = 0;
    let start: number | null = null;
    setAnimating(true);
    const step = (now: number): void => {
      start ??= now;
      const progress = Math.min((now - start) / ms, 1);
      const eased = easeInOut(progress);
      const next = target.map((level, index) => {
        const before = from[index] as Level;
        return { ctl: before.ctl + (level.ctl - before.ctl) * eased, atl: before.atl + (level.atl - before.atl) * eased };
      });
      shown.current = next;
      setLevels(next);
      if (progress < 1) frame = requestAnimationFrame(step);
      else setAnimating(false);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);

  return { levels, animating };
}

interface ChartProps {
  days: SeriesDay[];
  /** The Monday of the centred week and its ISO id. */
  centreMonday: string;
  centreWeek: string;
}

export function FitnessChart({ days, centreMonday, centreWeek }: ChartProps) {
  const reduced = useReducedMotion();
  const ms = reduced ? 0 : chartAnimationMs();
  const { levels, animating } = useMorph(days, ms);
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [focusDate, setFocusDate] = useState(days[days.length - 1]?.date ?? '');
  const say = useAnnouncer();
  const tableBox = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = holder.current as HTMLDivElement;
    const measure = (): void => setWidth(Math.max(element.clientWidth, 200));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const box = tableBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [days.length]);

  const count = days.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = count > 1 ? plotW / (count - 1) : plotW;
  const xOf = (index: number): number => PAD.left + (count > 1 ? index * step : plotW / 2);
  const peak = Math.max(20, ...levels.flatMap((level) => [level.ctl, level.atl]));
  const top = Math.ceil((peak * 1.15) / 20) * 20;
  const yOf = (value: number): number => PAD.top + plotH - (value / top) * plotH;
  const peakStress = Math.max(1, ...days.map((day) => day.tss));
  const grid = Array.from({ length: top / 20 + 1 }, (_, index) => index * 20);
  const line = (key: 'ctl' | 'atl'): string => levels.map((level, index) => `${index === 0 ? 'M' : 'L'}${xOf(index).toFixed(1)} ${yOf(level[key]).toFixed(1)}`).join(' ');

  const reversedAtl = levels.map((_, index) => `L${xOf(count - 1 - index).toFixed(1)} ${yOf((levels[count - 1 - index] as Level).atl).toFixed(1)}`).join(' ');

  const focusIndex = Math.max(0, days.findIndex((day) => day.date === focusDate));
  const focused = days[focusIndex];

  const first = days[0]?.date ?? '';
  const last = days[count - 1]?.date ?? '';
  const weekDays = Array.from({ length: 7 }, (_, offset) => addDays(centreMonday, offset)).filter((date) => date >= first && date <= last);
  const bandFrom = weekDays[0] ? days.findIndex((day) => day.date === weekDays[0]) : -1;
  const bandStyle =
    bandFrom >= 0
      ? { left: xOf(bandFrom) - step / 2, width: weekDays.length * step, visibility: 'visible' as const }
      : { left: PAD.left, width: 0, visibility: 'hidden' as const };

  const band = useRef<HTMLDivElement>(null);
  const bandBefore = useRef<{ week: string; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const before = bandBefore.current;
    bandBefore.current = { week: centreWeek, left: bandStyle.left, width: bandStyle.width };
    if (reduced || !band.current || !before || before.week === centreWeek || bandFrom < 0) return;
    band.current.animate(
      [
        { transform: `translateX(${before.left - bandStyle.left}px)`, width: `${before.width}px` },
        { transform: 'translateX(0)', width: `${bandStyle.width}px` }
      ],
      { duration: TRACK_MS, easing: TRACK_EASING }
    );
  }, [centreWeek]);

  const move = (index: number, announce: boolean): void => {
    const next = days[Math.min(Math.max(index, 0), count - 1)];
    if (!next) return;
    setFocusDate(next.date);
    if (announce) say.say(readout(next));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, number> = { ArrowLeft: focusIndex - 1, ArrowRight: focusIndex + 1, Home: 0, End: count - 1 };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    move(target, true);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    move(Math.round((event.clientX - box.left - PAD.left) / (step || 1)), true);
  };

  const labelAt = [0, Math.floor((count - 1) / 2), count - 1].filter((value, position, all) => all.indexOf(value) === position && days[value]);

  return (
    <section className="chart-card" aria-labelledby="chart-title">
      <div className="chart-head">
        <h2 id="chart-title" className="card-title">
          Fitness, fatigue and form
        </h2>
        <p className="legend">
          <span className="legend-key legend-fitness" /> Fitness <span className="legend-key legend-fatigue" /> Fatigue
        </p>
      </div>
      <div className="chart-holder" ref={holder}>
        <div
          role="group"
          aria-label="Fitness chart"
          className="chart"
          tabIndex={0}
          data-focus-date={focusDate}
          data-animating={animating}
          data-animation-ms={ms}
          onKeyDown={onKeyDown}
        >
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} onPointerDown={onPointerDown} aria-hidden="true" focusable="false">
            {grid.map((value) => (
              <g key={value}>
                <line x1={PAD.left} x2={width - PAD.right} y1={yOf(value)} y2={yOf(value)} className="grid-line" />
                <text x={PAD.left - 8} y={yOf(value) + 4} className="axis-label" textAnchor="end">
                  {value}
                </text>
              </g>
            ))}
            {days.map((day, index) => (
              <rect key={`bar-${day.date}`} x={xOf(index) - Math.max(step * 0.3, 1)} width={Math.max(step * 0.6, 2)} y={PAD.top + plotH - (day.tss / peakStress) * plotH * 0.4} height={(day.tss / peakStress) * plotH * 0.4} className="stress-bar" />
            ))}
            <path d={`${line('ctl')} ${reversedAtl} Z`} className="form-area" />
            <path d={line('atl')} className="line line-fatigue" />
            <path d={line('ctl')} className="line line-fitness" />
            {days.map((day, index) => (
              <circle
                key={day.date}
                cx={xOf(index)}
                cy={yOf(levels[index]?.ctl ?? 0)}
                r={day.date === focusDate ? 6 : 3}
                className={day.date === focusDate ? 'point point-focus' : 'point'}
                data-date={day.date}
                data-ctl={plainNumber(day.ctl, 1)}
                data-atl={plainNumber(day.atl, 1)}
                data-tsb={plainNumber(day.tsb, 1)}
              />
            ))}
            {focused && <line x1={xOf(focusIndex)} x2={xOf(focusIndex)} y1={PAD.top} y2={PAD.top + plotH} className="focus-line" />}
            {last && <line x1={xOf(count - 1)} x2={xOf(count - 1)} y1={PAD.top} y2={PAD.top + plotH} className="today-line" />}
            {labelAt.map((position) => (
              <text key={position} x={Math.min(Math.max(xOf(position), PAD.left + 24), width - PAD.right - 24)} y={HEIGHT - 8} className="axis-label" textAnchor="middle">
                {shortMonthDay((days[position] as SeriesDay).date)}
              </text>
            ))}
          </svg>
          <div className="week-band" ref={band} data-week={centreWeek} style={bandStyle} aria-hidden="true" />
        </div>
      </div>
      <Status label="Chart readout" announcer={{ text: focused ? readout(focused) : '', seq: say.seq, say: say.say }} className="chart-readout" />
      <div className="table-wrap chart-table" ref={tableBox} role="region" aria-label="Fitness table scroller" tabIndex={0}>
        <table aria-label="Fitness table" className="data-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">TSS</th>
              <th scope="col">Fitness</th>
              <th scope="col">Fatigue</th>
              <th scope="col">Form</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date} data-date={day.date} data-tss={plainNumber(day.tss, 1)} data-ctl={plainNumber(day.ctl, 1)} data-atl={plainNumber(day.atl, 1)} data-tsb={plainNumber(day.tsb, 1)}>
                <th scope="row">{dayLabel(day.date)}</th>
                <td>{formatTss(day.tss)}</td>
                <td>{formatTss(day.ctl)}</td>
                <td>{formatTss(day.atl)}</td>
                <td>{formatTsb(day.tsb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
