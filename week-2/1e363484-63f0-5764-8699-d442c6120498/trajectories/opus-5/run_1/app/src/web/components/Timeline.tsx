import { useRef } from 'react';
import type { TimelineDay } from '../api';
import { COPY } from '../copy';
import { DAY_MS, HALF_HOUR_MS, intervalDisplay, signedTonnes } from '../format';

export interface Brush {
  readonly startMs: number;
  readonly endMs: number;
}

export interface TimelineProps {
  readonly days: readonly TimelineDay[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly brush: Brush;
  readonly hasReadings: boolean;
  readonly roleCopy: string | null;
  readonly windowError: string | null;
  readonly fromValue: string;
  readonly toValue: string;
  readonly onFromChange: (value: string) => void;
  readonly onToChange: (value: string) => void;
  readonly onApplyDates: () => void;
  readonly onBrushChange: (brush: Brush) => void;
}

const CHART_HEIGHT = 200;

function snap(ms: number): number {
  return Math.round(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper);
}

export function Timeline(props: TimelineProps): React.ReactElement {
  const { days, windowStartMs, windowEndMs, brush } = props;
  const chartRef = useRef<HTMLDivElement | null>(null);
  const span = Math.max(1, windowEndMs - windowStartMs);
  const maxAbs = days.reduce(
    (largest, day) => Math.max(largest, Math.abs(Number(day.net_tco2e))),
    0.001,
  );

  const toPercent = (ms: number): number => ((ms - windowStartMs) / span) * 100;
  const fromClientX = (clientX: number): number => {
    const box = chartRef.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return windowStartMs;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return snap(windowStartMs + ratio * span);
  };

  const apply = (next: Brush): void => {
    if (next.startMs !== brush.startMs || next.endMs !== brush.endMs) props.onBrushChange(next);
  };

  /** Every change is clamped to the window and keeps start before end. */
  const setStart = (ms: number): void =>
    apply({
      startMs: clamp(snap(ms), windowStartMs, brush.endMs - HALF_HOUR_MS),
      endMs: brush.endMs,
    });
  const setEnd = (ms: number): void =>
    apply({
      startMs: brush.startMs,
      endMs: clamp(snap(ms), brush.startMs + HALF_HOUR_MS, windowEndMs),
    });
  const setPosition = (startMs: number, span: number): void => {
    const start = clamp(snap(startMs), windowStartMs, windowEndMs - span);
    apply({ startMs: start, endMs: start + span });
  };
  const shiftBy = (deltaMs: number): void =>
    setPosition(brush.startMs + deltaMs, brush.endMs - brush.startMs);

  const keyStep = (
    event: React.KeyboardEvent,
    step: (deltaMs: number) => void,
    atStart: () => void,
    atEnd: () => void,
  ): void => {
    const steps: Record<string, number> = {
      ArrowLeft: -HALF_HOUR_MS,
      ArrowDown: -HALF_HOUR_MS,
      ArrowRight: HALF_HOUR_MS,
      ArrowUp: HALF_HOUR_MS,
      PageDown: -DAY_MS,
      PageUp: DAY_MS,
    };
    const delta = steps[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      step(delta);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      atStart();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      atEnd();
    }
  };

  const dragHandler =
    (onDrag: (ms: number, startState: Brush, grabMs: number) => void) =>
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      const startState = brush;
      const grabMs = fromClientX(event.clientX);
      const onMove = (moveEvent: PointerEvent): void => {
        onDrag(fromClientX(moveEvent.clientX), startState, grabMs);
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

  const halfHoursIn = (ms: number): number => Math.round((ms - windowStartMs) / HALF_HOUR_MS);
  const totalHalfHours = Math.round(span / HALF_HOUR_MS);

  return (
    <section className="panel timeline-group" aria-label="Flux timeline" role="group">
      <div className="date-window">
        <div className="field">
          <label htmlFor="from-date">From</label>
          <input
            id="from-date"
            type="date"
            className="num"
            value={props.fromValue}
            onChange={(event) => props.onFromChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="to-date">To</label>
          <input
            id="to-date"
            type="date"
            className="num"
            value={props.toValue}
            onChange={(event) => props.onToChange(event.target.value)}
          />
        </div>
        <button type="button" onClick={props.onApplyDates}>
          Apply dates
        </button>
      </div>

      {props.windowError !== null ? (
        <div role="alert" className="alert">
          {props.windowError}
        </div>
      ) : null}
      {props.roleCopy !== null ? <p className="seal-reason">{props.roleCopy}</p> : null}
      {!props.hasReadings ? <p>{COPY.noReadings}</p> : null}

      {props.hasReadings ? (
        <>
          <div
            className="timeline-figure"
            ref={chartRef}
            style={{ height: `${CHART_HEIGHT}px`, position: 'relative', border: '1px solid var(--rule)' }}
          >
            <div
              role="separator"
              aria-label="Zero rule"
              aria-orientation="horizontal"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '50%',
                height: '1px',
                background: 'var(--rule)',
              }}
            />
            <ul className="bars-list" role="list" aria-label="Daily net CO2e">
              {days.map((day) => {
                const dayMs = Date.parse(`${day.date}T00:00:00Z`);
                const net = Number(day.net_tco2e);
                const magnitude = Math.min(1, Math.abs(net) / maxAbs);
                const height = net === 0 ? 2 : Math.max(3, magnitude * (CHART_HEIGHT / 2 - 6));
                const left = toPercent(dayMs);
                const width = (DAY_MS / span) * 100;
                const uptake = net < 0;
                return (
                  <li
                    key={day.date}
                    role="listitem"
                    aria-label={`${day.date} ${signedTonnes(day.net_tco2e)} tCO2e`}
                    title={`${day.date} ${signedTonnes(day.net_tco2e)} tCO2e`}
                    style={{
                      position: 'absolute',
                      left: `${left + width * 0.1}%`,
                      width: `${Math.max(0.6, width * 0.8)}%`,
                      height: `${height}px`,
                      top: uptake ? '50%' : undefined,
                      bottom: uptake ? undefined : '50%',
                      background: uptake ? 'var(--covered)' : 'var(--ink)',
                      backgroundImage: uptake
                        ? undefined
                        : 'repeating-linear-gradient(45deg, var(--paper) 0 1px, var(--ink) 1px 4px)',
                      borderTop: uptake ? 'none' : '1px solid var(--ink)',
                    }}
                  />
                );
              })}
            </ul>

            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${toPercent(brush.startMs)}%`,
                width: `${Math.max(0.2, toPercent(brush.endMs) - toPercent(brush.startMs))}%`,
                background: 'rgba(184, 117, 22, 0.12)',
                borderLeft: '2px solid var(--accent)',
                borderRight: '2px solid var(--accent)',
                pointerEvents: 'none',
              }}
            />

            <div
              role="slider"
              tabIndex={0}
              aria-label="Interval start"
              aria-valuemin={0}
              aria-valuemax={totalHalfHours}
              aria-valuenow={halfHoursIn(brush.startMs)}
              aria-valuetext={intervalDisplay(brush.startMs)}
              className="brush-handle"
              style={{
                position: 'absolute',
                top: 0,
                height: '100%',
                width: '44px',
                left: `max(0px, calc(${toPercent(brush.startMs)}% - 44px))`,
                zIndex: 3,
                touchAction: 'none',
                cursor: 'ew-resize',
              }}
              onKeyDown={(event) =>
                keyStep(
                  event,
                  (delta) => setStart(brush.startMs + delta),
                  () => setStart(windowStartMs),
                  () => setStart(windowEndMs),
                )
              }
              onPointerDown={dragHandler((ms) => setStart(ms))}
            />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Interval position"
              aria-valuemin={0}
              aria-valuemax={totalHalfHours}
              aria-valuenow={halfHoursIn(brush.startMs)}
              aria-valuetext={`${intervalDisplay(brush.startMs)} to ${intervalDisplay(brush.endMs)}`}
              style={{
                position: 'absolute',
                top: 0,
                height: '100%',
                left: `${(toPercent(brush.startMs) + toPercent(brush.endMs)) / 2}%`,
                transform: 'translateX(-50%)',
                width: `max(44px, ${toPercent(brush.endMs) - toPercent(brush.startMs)}%)`,
                zIndex: 2,
                touchAction: 'none',
                cursor: 'grab',
              }}
              onKeyDown={(event) =>
                keyStep(
                  event,
                  (delta) => shiftBy(delta),
                  () => setPosition(windowStartMs, brush.endMs - brush.startMs),
                  () => setPosition(windowEndMs, brush.endMs - brush.startMs),
                )
              }
              onPointerDown={dragHandler((ms, startState, grabMs) =>
                setPosition(
                  startState.startMs + snap(ms - grabMs),
                  startState.endMs - startState.startMs,
                ),
              )}
            />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Interval end"
              aria-valuemin={0}
              aria-valuemax={totalHalfHours}
              aria-valuenow={halfHoursIn(brush.endMs)}
              aria-valuetext={intervalDisplay(brush.endMs)}
              style={{
                position: 'absolute',
                top: 0,
                height: '100%',
                width: '44px',
                left: `min(calc(100% - 44px), ${toPercent(brush.endMs)}%)`,
                zIndex: 3,
                touchAction: 'none',
                cursor: 'ew-resize',
              }}
              onKeyDown={(event) =>
                keyStep(
                  event,
                  (delta) => setEnd(brush.endMs + delta),
                  () => setEnd(windowStartMs),
                  () => setEnd(windowEndMs),
                )
              }
              onPointerDown={dragHandler((ms) => setEnd(ms))}
            />
          </div>

          <div className="brush-handles">
            <button
              type="button"
              onClick={() => shiftBy(-(brush.endMs - brush.startMs))}
            >
              Previous interval
            </button>
            <button
              type="button"
              onClick={() => shiftBy(brush.endMs - brush.startMs)}
            >
              Next interval
            </button>
            <span className="num" style={{ fontSize: '0.8125rem' }}>
              {intervalDisplay(brush.startMs)} to {intervalDisplay(brush.endMs)}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
