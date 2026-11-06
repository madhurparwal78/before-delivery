import { createHash } from 'node:crypto';
import {
  add,
  compare,
  dec,
  divideRounded,
  floorAt,
  isNegative,
  mul,
  round,
  sub,
  sum,
  toFixed,
  type Dec,
} from './decimal';
import { allocateAreas, coveragePercent, type Ring } from './geometry';
import { formatCompactStamp, halfHourCount } from './time';

export type SensorKind = 'tower' | 'satellite';

export interface Sensor {
  readonly id: string;
  readonly kind: SensorKind;
  readonly polygon: Ring;
}

export interface ProjectShape {
  readonly boundary: Ring;
  readonly boundaryAreaM2: bigint;
  readonly sensors: readonly Sensor[];
  readonly floorPct: Dec;
  readonly bufferPct: Dec;
}

/** A stored reading. `fc` and `fch4` are held scaled by 10^4, their canonical precision. */
export interface Reading {
  readonly sensorId: string;
  readonly intervalStartMs: number;
  readonly fc4: bigint;
  readonly fch44: bigint;
  readonly qc: number;
}

export interface Contribution {
  readonly sensorId: string;
  readonly kind: SensorKind;
  readonly areaM2: bigint;
  readonly qualifyingHalfHours: number;
  readonly halfHours: number;
  readonly co2: Dec;
  readonly ch4: Dec;
  readonly net: Dec;
}

export interface Derived {
  readonly startMs: number;
  readonly endMs: number;
  readonly sensorIds: readonly string[];
  readonly coveragePct: Dec;
  readonly co2: Dec;
  readonly ch4: Dec;
  readonly net: Dec;
  readonly bufferTco2e: Dec;
  readonly creditedTco2e: Dec;
  readonly readingsCount: number;
  readonly fingerprint: string;
  readonly readingsFile: Buffer;
  readonly contributions: readonly Contribution[];
}

/** Half-hour integration, molar masses and GWP100: the one place the unit chain lives. */
const SECONDS_PER_HALF_HOUR = 1800n;
const CO2_GRAMS_PER_MICROMOL_UNITS = 4401n;
const CO2_GRAMS_PER_MICROMOL_SCALE = 8;
const CH4_GRAMS_PER_NANOMOL_UNITS = 1604n;
const CH4_GRAMS_PER_NANOMOL_SCALE = 11;
const CH4_GWP100_UNITS = 270n;
const CH4_GWP100_SCALE = 1;
const GRAMS_PER_TONNE_SCALE = 6;

const CONTRIBUTION_THRESHOLD_NUMERATOR = 4n;
const CONTRIBUTION_THRESHOLD_DENOMINATOR = 5n;

export function compareSensorIds(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** A reading qualifies when its qc is 0 (measured) or 1 (good-quality gap-fill). */
function qualifies(qc: number): boolean {
  return qc === 0 || qc === 1;
}

/** A sensor contributes when qualifying readings fill at least 80 percent of the interval. */
function contributes(qualifyingHalfHours: number, halfHours: number): boolean {
  return (
    BigInt(qualifyingHalfHours) * CONTRIBUTION_THRESHOLD_DENOMINATOR >=
    CONTRIBUTION_THRESHOLD_NUMERATOR * BigInt(halfHours)
  );
}

function co2Tonnes(sumFc4: bigint, areaM2: bigint): Dec {
  return dec(
    sumFc4 * SECONDS_PER_HALF_HOUR * CO2_GRAMS_PER_MICROMOL_UNITS * areaM2,
    4 + CO2_GRAMS_PER_MICROMOL_SCALE + GRAMS_PER_TONNE_SCALE,
  );
}

function ch4Tonnes(sumFch44: bigint, areaM2: bigint): Dec {
  return dec(
    sumFch44 *
      SECONDS_PER_HALF_HOUR *
      CH4_GRAMS_PER_NANOMOL_UNITS *
      CH4_GWP100_UNITS *
      areaM2,
    4 + CH4_GRAMS_PER_NANOMOL_SCALE + CH4_GWP100_SCALE + GRAMS_PER_TONNE_SCALE,
  );
}

/**
 * Allocates one column by largest remainder, so the allocated values sum exactly to
 * the figure's rounded total for that column.
 */
function allocateColumn(
  entries: readonly { readonly sensorId: string; readonly exact: Dec }[],
  total: Dec,
): Map<string, Dec> {
  const floors = entries.map((entry) => {
    const floor = floorAt(entry.exact, 3);
    return { sensorId: entry.sensorId, floor, remainder: sub(entry.exact, floor) };
  });
  const floorSum = floors.reduce((acc, item) => acc + item.floor.units, 0n);
  const remainderCount = round(total, 3).units - floorSum;
  const ranked = [...floors].sort(
    (a, b) => -compare(a.remainder, b.remainder) || compareSensorIds(a.sensorId, b.sensorId),
  );
  const bumped = new Set(ranked.slice(0, Number(remainderCount)).map((item) => item.sensorId));
  const result = new Map<string, Dec>();
  for (const item of floors) {
    result.set(item.sensorId, dec(item.floor.units + (bumped.has(item.sensorId) ? 1n : 0n), 3));
  }
  return result;
}

/** The non-permanence buffer, computed half-even from the rounded net. */
function withheldBuffer(roundedNet: Dec, bufferPct: Dec): { buffer: Dec; credited: Dec } {
  if (!isNegative(roundedNet)) {
    return { buffer: dec(0n, 3), credited: round(roundedNet, 3) };
  }
  const magnitude = dec(-round(roundedNet, 3).units, 3);
  const product = mul(magnitude, bufferPct);
  const buffer = round(dec(product.units, product.scale + 2), 3);
  return { buffer, credited: add(round(roundedNet, 3), buffer) };
}

function canonicalLine(reading: Reading): string {
  const fc = toFixed(dec(reading.fc4, 4), 4);
  const fch4 = toFixed(dec(reading.fch44, 4), 4);
  return `${reading.sensorId},${formatCompactStamp(reading.intervalStartMs)},${fc},${fch4},${reading.qc}`;
}

/** The canonical readings file: every stored reading of the selected sensors in the interval. */
function canonicalReadingsFile(readings: readonly Reading[]): Buffer {
  const ordered = [...readings].sort(
    (a, b) =>
      compareSensorIds(a.sensorId, b.sensorId) || a.intervalStartMs - b.intervalStartMs,
  );
  const lines = ['sensor_id,interval_start,fc,fch4,qc', ...ordered.map(canonicalLine), ''];
  return Buffer.from(lines.join('\n'), 'utf8');
}

function fingerprintOf(file: Buffer): string {
  return createHash('sha256').update(file).digest('hex');
}

export interface DeriveInput {
  readonly shape: ProjectShape;
  readonly startMs: number;
  readonly endMs: number;
  readonly sensorIds: readonly string[];
  readonly readings: readonly Reading[];
}

/** Derives every figure value for an interval and sensor selection from stored readings. */
export function derive(input: DeriveInput): Derived {
  const { shape, startMs, endMs, readings } = input;
  const halfHours = halfHourCount(startMs, endMs);
  const sensorIds = [...input.sensorIds].sort(compareSensorIds);
  const selected = sensorIds.map((id) => shape.sensors.find((sensor) => sensor.id === id)!);

  const inInterval = readings.filter(
    (reading) =>
      sensorIds.includes(reading.sensorId) &&
      reading.intervalStartMs >= startMs &&
      reading.intervalStartMs < endMs,
  );

  const qualifying = new Map<string, Reading[]>();
  for (const sensor of selected) qualifying.set(sensor.id, []);
  for (const reading of inInterval) {
    if (qualifies(reading.qc)) qualifying.get(reading.sensorId)!.push(reading);
  }

  const contributing = selected.filter((sensor) =>
    contributes(qualifying.get(sensor.id)!.length, halfHours),
  );
  const ordered = [
    ...contributing.filter((sensor) => sensor.kind === 'tower'),
    ...contributing.filter((sensor) => sensor.kind === 'satellite'),
  ];
  const areas = allocateAreas(
    shape.boundary,
    ordered.map((sensor) => ({ id: sensor.id, polygon: sensor.polygon })),
  );
  const coveredM2 = [...areas.values()].reduce((acc, area) => acc + area, 0n);
  const coveragePct = coveragePercent(coveredM2, shape.boundaryAreaM2);

  const exact = ordered
    .map((sensor) => {
      const rows = qualifying.get(sensor.id)!;
      const areaM2 = areas.get(sensor.id)!;
      const sumFc4 = rows.reduce((acc, row) => acc + row.fc4, 0n);
      const sumFch44 = rows.reduce((acc, row) => acc + row.fch44, 0n);
      const co2 = co2Tonnes(sumFc4, areaM2);
      const ch4 = ch4Tonnes(sumFch44, areaM2);
      return {
        sensor,
        areaM2,
        qualifyingHalfHours: rows.length,
        co2,
        ch4,
        net: add(co2, ch4),
      };
    })
    .sort((a, b) => compareSensorIds(a.sensor.id, b.sensor.id));

  const co2Total = round(sum(exact.map((item) => item.co2)), 3);
  const ch4Total = round(sum(exact.map((item) => item.ch4)), 3);
  const netTotal = round(sum(exact.map((item) => item.net)), 3);

  const co2Allocated = allocateColumn(
    exact.map((item) => ({ sensorId: item.sensor.id, exact: item.co2 })),
    co2Total,
  );
  const ch4Allocated = allocateColumn(
    exact.map((item) => ({ sensorId: item.sensor.id, exact: item.ch4 })),
    ch4Total,
  );
  const netAllocated = allocateColumn(
    exact.map((item) => ({ sensorId: item.sensor.id, exact: item.net })),
    netTotal,
  );

  const contributions: Contribution[] = exact.map((item) => ({
    sensorId: item.sensor.id,
    kind: item.sensor.kind,
    areaM2: item.areaM2,
    qualifyingHalfHours: item.qualifyingHalfHours,
    halfHours,
    co2: co2Allocated.get(item.sensor.id)!,
    ch4: ch4Allocated.get(item.sensor.id)!,
    net: netAllocated.get(item.sensor.id)!,
  }));

  const { buffer, credited } = withheldBuffer(netTotal, shape.bufferPct);
  const readingsFile = canonicalReadingsFile(inInterval);

  return {
    startMs,
    endMs,
    sensorIds,
    coveragePct,
    co2: co2Total,
    ch4: ch4Total,
    net: netTotal,
    bufferTco2e: buffer,
    creditedTco2e: credited,
    readingsCount: inInterval.length,
    fingerprint: fingerprintOf(readingsFile),
    readingsFile,
    contributions,
  };
}

/** A preview is at the floor when its rounded coverage is at or above the project's floor. */
export function atCoverageFloor(coveragePct: Dec, floorPct: Dec): boolean {
  return compare(coveragePct, floorPct) >= 0;
}
