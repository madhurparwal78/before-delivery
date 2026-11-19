import { MAX_STAGE } from '../../shared/catalogue.js';
import {
  METER_LABELS,
  METER_MAXIMA,
  type MeterKey,
  type Units,
  formatMeter,
} from '../../shared/format.js';

export function Meter({
  meterKey,
  value,
  preview,
  units,
}: {
  meterKey: MeterKey;
  value: number;
  preview: number | null;
  units: Units;
}) {
  const shown = preview ?? value;
  const text = formatMeter(meterKey, shown, units);
  const valueText =
    preview === null
      ? text
      : `${formatMeter(meterKey, value, units)} → ${formatMeter(meterKey, preview, units)}`;
  const maximum = METER_MAXIMA[meterKey];
  const width = Math.min(100, Math.round((shown / maximum) * 100));
  return (
    <div className="meter">
      <span className="label">{METER_LABELS[meterKey]}</span>
      <div
        role="meter"
        aria-label={METER_LABELS[meterKey]}
        aria-valuenow={shown}
        aria-valuemin={0}
        aria-valuemax={maximum}
        aria-valuetext={valueText}
        className="meter-track"
      >
        <div className="meter-fill" style={{ width: `${width}%` }} />
      </div>
      <span className="meter-value">{text}</span>
    </div>
  );
}

export function StagePips({ stage }: { stage: number }) {
  return (
    <span className="pips" role="img" aria-label={`Stage ${stage} of ${MAX_STAGE}`}>
      {[1, 2, 3].map((pip) => (
        <span key={pip} className={`pip${pip <= stage ? ' filled' : ''}`} />
      ))}
    </span>
  );
}
