import type { CarStats } from './catalogue.js';

export type Units = 'kmh' | 'mph';

export const MINUS = '−';
const KMH_PER_MPS = 3.6;
const MPH_PER_MPS = 2.23694;

export function formatThousands(value: number): string {
  const sign = value < 0 ? MINUS : '';
  const digits = Math.abs(Math.trunc(value)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Race times as m:ss.mmm. */
export function formatRaceTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

/** A signed duration: a true minus or a plus, three decimals and ' s'. */
export function formatDelta(ms: number): string {
  if (ms === 0) return '0.000 s';
  const sign = ms < 0 ? MINUS : '+';
  const seconds = Math.abs(ms) / 1000;
  return `${sign}${seconds.toFixed(3)} s`;
}

export function speedValue(mps: number, units: Units): number {
  return Math.round(mps * (units === 'kmh' ? KMH_PER_MPS : MPH_PER_MPS));
}

export function unitLabel(units: Units): string {
  return units === 'kmh' ? 'km/h' : 'mph';
}

export function formatSpeed(mps: number, units: Units): string {
  return `${speedValue(mps, units)} ${unitLabel(units)}`;
}

export type MeterKey = 'accel' | 'brake' | 'top' | 'grip' | 'lane';

export const METER_LABELS: Record<MeterKey, string> = {
  accel: 'Acceleration',
  brake: 'Braking',
  top: 'Top speed',
  grip: 'Grip',
  lane: 'Lane change',
};

export const METER_MAXIMA: Record<MeterKey, number> = {
  accel: 10,
  brake: 16,
  top: 70,
  grip: 130,
  lane: 36,
};

export function meterValue(stats: CarStats, key: MeterKey): number {
  switch (key) {
    case 'accel':
      return stats.accelMps2;
    case 'brake':
      return stats.brakeMps2;
    case 'top':
      return stats.topMps;
    case 'grip':
      return stats.gripPct;
    case 'lane':
      return stats.laneChangeSteps;
  }
}

export function formatMeter(key: MeterKey, value: number, units: Units): string {
  switch (key) {
    case 'accel':
    case 'brake':
      return `${value.toFixed(1)} m/s²`;
    case 'top':
      return formatSpeed(value, units);
    case 'grip':
      return `${Math.round(value)}%`;
    case 'lane':
      return `${Math.round(value)} steps`;
  }
}

export const SECTOR_LABELS = ['S1', 'S2', 'S3'] as const;

/** The reference lap summary: '<delta>, mostly <sector>', or the no-change copy. */
export function referenceSummary(deltaMs: number, sectorDeltasMs: number[]): string {
  if (deltaMs === 0) return 'No change on the reference lap';
  let biggest = 0;
  for (let index = 1; index < sectorDeltasMs.length; index += 1) {
    if (Math.abs(sectorDeltasMs[index]!) > Math.abs(sectorDeltasMs[biggest]!)) biggest = index;
  }
  return `${formatDelta(deltaMs)}, mostly ${SECTOR_LABELS[biggest]}`;
}
