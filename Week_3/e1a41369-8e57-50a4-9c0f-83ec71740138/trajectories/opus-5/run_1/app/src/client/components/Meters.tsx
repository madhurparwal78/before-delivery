import { tenths1 } from '../../shared/format.js';
import { useTravellingNumber } from '../motion.js';

interface MeterProps {
  name: string;
  value: number;
  max: number;
  text: string;
  tone?: 'health' | 'experience' | 'boss';
}

export function Meter({ name, value, max, text, tone = 'health' }: MeterProps): JSX.Element {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      role="meter"
      aria-label={name}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={text}
      className={`meter meter-${tone}`}
    >
      <span className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="meter-text tabular" aria-hidden="true">
        {text}
      </span>
    </div>
  );
}

export function HealthMeter({ value }: { value: number }): JSX.Element {
  return <Meter name="Health" value={value} max={50} text={`${tenths1(value)} / 50.0`} tone="health" />;
}

export function MemberHealthMeter({ username, value }: { username: string; value: number }): JSX.Element {
  return (
    <Meter name={`${username} health`} value={value} max={50} text={`${tenths1(value)} / 50.0`} tone="health" />
  );
}

export function ExperienceMeter({ value, max }: { value: number; max: number }): JSX.Element {
  return <Meter name="Experience" value={value} max={max} text={`${value} / ${max}`} tone="experience" />;
}

/** The boss meter's numerals count down to the new value while its value stays the server's. */
export function BossMeter({
  name,
  value,
  max,
}: {
  name: string;
  value: number;
  max: number;
}): JSX.Element {
  const shown = useTravellingNumber(value, 550);
  return (
    <div
      role="meter"
      aria-label={name}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={`${tenths1(value)} / ${tenths1(max)}`}
      className="meter meter-boss"
    >
      <span className="meter-text tabular" aria-hidden="true">
        {`${tenths1(shown)} / ${tenths1(max)}`}
      </span>
    </div>
  );
}
