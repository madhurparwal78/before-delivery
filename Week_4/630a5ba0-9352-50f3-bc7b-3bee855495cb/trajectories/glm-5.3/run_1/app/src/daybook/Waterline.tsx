import type { ApiDay } from '../api/client';
import { copy } from './logic';

/** The Waterline gauge: fill height = planned/threshold capped at 1.2, tidemark at 5/6, hatching above it. */
export function Waterline({
  day,
  threshold,
  ghost,
  ghosted,
  animate,
}: {
  day: ApiDay;
  threshold: number;
  ghost: number | null;
  ghosted: boolean;
  animate: boolean;
}): JSX.Element {
  const ratio = (minutes: number): number => Math.min(1.2, minutes / threshold);
  const fill = ratio(day.plannedMinutes);
  const projected = day.plannedMinutes + (ghost ?? 0);
  const projectedRatio = ratio(projected);
  const over = projected > threshold;
  const overBy = Math.max(0, projected - threshold);
  const hatchHeight = over ? Math.max(0, Math.min(projectedRatio, 1.2) - 1) : 0;

  const style = (value: number): React.CSSProperties => ({
    height: animate ? undefined : `${(value / 1.2) * 100}%`,
    ...(animate ? { height: `${(value / 1.2) * 100}%` } : {}),
  });

  return (
    <div className="waterline" aria-hidden="true">
      <div className="fill" style={style(fill)} data-part="waterline-fill" />
      {over ? <div className="hatch" style={{ height: `${(hatchHeight / 1.2) * 100}%` }} /> : null}
      <div className="tidemark" data-part="tidemark" />
      {ghost !== null && ghost > 0 ? (
        <div
          className="ghost"
          data-part="waterline-ghost"
          style={{ bottom: `${(fill / 1.2) * 100}%`, height: `${(Math.min(projectedRatio, 1.2) - fill) / 1.2 * 100}%` }}
        />
      ) : null}
      {over ? (
        <span className={`over-label${ghosted ? ' ghosted' : ''}`} data-part="over-label">
          {copy.overLabel(overBy)}
        </span>
      ) : null}
    </div>
  );
}

/** The gauge's meter mirror for checks: value text with the uncapped planned minutes. */
export function LoadMeter({ day, threshold }: { day: ApiDay; threshold: number }): JSX.Element {
  const max = Math.round(threshold * 1.2);
  const value = Math.min(day.plannedMinutes, max);
  return (
    <meter
      role="meter"
      aria-label={`Load for ${day.label}`}
      min={0}
      max={max}
      value={value}
    >
      {`${day.plannedMinutes} of ${threshold} minutes`}
    </meter>
  );
}
