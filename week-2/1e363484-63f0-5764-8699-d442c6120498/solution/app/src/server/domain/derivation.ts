// The derivation of a figure from readings: the contributing rule, coverage allocation, the unit
// chain, contribution allocation, the buffer, and the canonical readings file with its fingerprint.
// Previews, timeline days, seals, breaks and every re-derivation call `derive`; nothing else decides
// these rules.

import { createHash } from "node:crypto";
import { allocateArea, polygonArea, type Point } from "./geometry.js";
import { fixed, Rational } from "./rational.js";
import { compactStamp, HALF_HOUR } from "./time.js";

export type SensorKind = "tower" | "satellite";

export interface Sensor {
  id: string;
  kind: SensorKind;
  polygon: Point[];
}

export interface ProjectGeometry {
  slug: string;
  boundary: Point[];
  floorTenths: number;
  bufferTenths: number;
  sensors: Sensor[];
}

/** A stored reading; `fc` and `fch4` are held in units of 0.0001. */
export interface Reading {
  sensorId: string;
  intervalStart: number;
  fcE4: number;
  fch4E4: number;
  qc: number;
}

export interface Contribution {
  sensor_id: string;
  kind: SensorKind;
  area_m2: number;
  qualifying_half_hours: number;
  half_hours: number;
  co2_tco2e: string;
  ch4_tco2e: string;
  net_tco2e: string;
}

export interface Derivation {
  coverageTenths: bigint;
  netMilli: bigint;
  co2Milli: bigint;
  ch4Milli: bigint;
  bufferMilli: bigint;
  creditedMilli: bigint;
  readingsCount: number;
  fingerprint: string;
  file: Buffer;
  contributions: Contribution[];
  atFloor: boolean;
}

/** Sensor ids compare in ascending byte order. */
export function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// --- Unit chain, as published --------------------------------------------------------------
const READING_UNIT = Rational.of(1n, 10_000n);
const SECONDS_PER_HALF_HOUR = Rational.of(BigInt(HALF_HOUR));
const CO2_GRAMS_PER_MICROMOLE = Rational.decimal("0.00004401");
const CH4_GRAMS_PER_NANOMOLE = Rational.decimal("0.00000001604");
const CH4_GWP100 = Rational.decimal("27.0");
const GRAMS_PER_TONNE = Rational.of(1_000_000n);
const CO2_TONNES_PER_UNIT_AREA = READING_UNIT.mul(SECONDS_PER_HALF_HOUR).mul(CO2_GRAMS_PER_MICROMOLE).div(GRAMS_PER_TONNE);
const CH4_TONNES_PER_UNIT_AREA = READING_UNIT.mul(SECONDS_PER_HALF_HOUR).mul(CH4_GRAMS_PER_NANOMOLE).mul(CH4_GWP100).div(GRAMS_PER_TONNE);

/** A reading qualifies when it is measured (qc 0) or a good-quality gap-fill (qc 1). */
function qualifies(reading: Reading): boolean {
  return reading.qc === 0 || reading.qc === 1;
}

/** A sensor contributes when its qualifying readings fill at least 80 percent of the half-hours. */
function contributes(qualifyingHalfHours: number, halfHours: number): boolean {
  return 5 * qualifyingHalfHours >= 4 * halfHours;
}

/** Towers first, then satellite cells, each in ascending byte order of sensor id. */
function allocationOrder(sensors: Sensor[]): Sensor[] {
  const rank = (s: Sensor) => (s.kind === "tower" ? 0 : 1);
  return [...sensors].sort((a, b) => rank(a) - rank(b) || byteOrder(a.id, b.id));
}

function allocatedAreas(project: ProjectGeometry, contributing: Sensor[]): Map<string, bigint> {
  const ordered = allocationOrder(contributing);
  const allocations = allocateArea(project.boundary, ordered.map((s) => s.polygon));
  return new Map(ordered.map((s, i) => [s.id, allocations[i]!]));
}

/** Whole square metres inside the boundary polygon. */
export function boundaryAreaM2(project: ProjectGeometry): bigint {
  return polygonArea(project.boundary).roundHalfEven(0);
}

/**
 * Largest-remainder allocation of one column: floor each exact value at 0.001, then give 0.001 to
 * the sensors with the largest remainders (ties in ascending byte order) until the column sums to
 * the rounded total.
 */
function allocateColumn(exact: Map<string, Rational>, totalMilli: bigint): Map<string, bigint> {
  const floors = new Map<string, bigint>();
  const remainders: { id: string; rest: Rational }[] = [];
  let floorSum = 0n;
  for (const [id, value] of exact) {
    const floor = value.floor(3);
    floors.set(id, floor);
    floorSum += floor;
    remainders.push({ id, rest: value.sub(Rational.of(floor, 1000n)) });
  }
  remainders.sort((a, b) => b.rest.cmp(a.rest) || byteOrder(a.id, b.id));
  remainders.slice(0, Number(totalMilli - floorSum)).forEach(({ id }) => floors.set(id, floors.get(id)! + 1n));
  return floors;
}

/** The non-permanence buffer withheld from a rounded net removal, and the credited tonnes. */
function bufferAndCredit(netMilli: bigint, bufferTenths: number): { bufferMilli: bigint; creditedMilli: bigint } {
  if (netMilli >= 0n) return { bufferMilli: 0n, creditedMilli: netMilli };
  const bufferMilli = Rational.of(-netMilli * BigInt(bufferTenths), 1_000_000n).roundHalfEven(3);
  return { bufferMilli, creditedMilli: netMilli + bufferMilli };
}

const formatE4 = (units: number) => fixed(BigInt(units), 4);

/** The canonical readings file line of one reading. */
function canonicalLine(r: Reading): string {
  return `${r.sensorId},${compactStamp(r.intervalStart)},${formatE4(r.fcE4)},${formatE4(r.fch4E4)},${r.qc}`;
}

/** The canonical readings file: header, one line per stored reading by sensor then interval, final newline. */
export function canonicalFile(readings: Reading[]): Buffer {
  const ordered = [...readings].sort((a, b) => byteOrder(a.sensorId, b.sensorId) || a.intervalStart - b.intervalStart);
  return Buffer.from(["sensor_id,interval_start,fc,fch4,qc", ...ordered.map(canonicalLine)].join("\n") + "\n", "utf8");
}

export function fingerprintOf(file: Buffer): string {
  return createHash("sha256").update(file).digest("hex");
}

/**
 * Derives a figure for [start, end) over the selected sensors. `readings` are the stored readings of
 * those sensors inside the interval.
 */
export function derive(project: ProjectGeometry, start: number, end: number, sensorIds: string[], readings: Reading[]): Derivation {
  const halfHours = (end - start) / HALF_HOUR;
  const selected = project.sensors.filter((s) => sensorIds.includes(s.id));
  const qualifying = new Map<string, Reading[]>(selected.map((s) => [s.id, []]));
  for (const r of readings) if (qualifies(r)) qualifying.get(r.sensorId)!.push(r);

  const contributing = selected.filter((s) => contributes(qualifying.get(s.id)!.length, halfHours));
  const areas = allocatedAreas(project, contributing);

  const co2 = new Map<string, Rational>();
  const ch4 = new Map<string, Rational>();
  const net = new Map<string, Rational>();
  for (const s of [...contributing].sort((a, b) => byteOrder(a.id, b.id))) {
    const rows = qualifying.get(s.id)!;
    const area = Rational.of(areas.get(s.id)!);
    const fcSum = Rational.of(rows.reduce((sum, r) => sum + BigInt(r.fcE4), 0n));
    const fch4Sum = Rational.of(rows.reduce((sum, r) => sum + BigInt(r.fch4E4), 0n));
    const sensorCo2 = fcSum.mul(CO2_TONNES_PER_UNIT_AREA).mul(area);
    const sensorCh4 = fch4Sum.mul(CH4_TONNES_PER_UNIT_AREA).mul(area);
    co2.set(s.id, sensorCo2);
    ch4.set(s.id, sensorCh4);
    net.set(s.id, sensorCo2.add(sensorCh4));
  }
  const total = (column: Map<string, Rational>) => [...column.values()].reduce((a, b) => a.add(b), Rational.ZERO).roundHalfEven(3);
  const co2Milli = total(co2);
  const ch4Milli = total(ch4);
  const netMilli = total(net);
  const co2Alloc = allocateColumn(co2, co2Milli);
  const ch4Alloc = allocateColumn(ch4, ch4Milli);
  const netAlloc = allocateColumn(net, netMilli);

  const coveredM2 = [...areas.values()].reduce((a, b) => a + b, 0n);
  const coverageTenths = Rational.of(coveredM2 * 100n).div(polygonArea(project.boundary)).roundHalfEven(1);
  const { bufferMilli, creditedMilli } = bufferAndCredit(netMilli, project.bufferTenths);
  const file = canonicalFile(readings);

  return {
    coverageTenths, netMilli, co2Milli, ch4Milli, bufferMilli, creditedMilli,
    readingsCount: readings.length,
    fingerprint: fingerprintOf(file),
    file,
    atFloor: coverageTenths >= BigInt(project.floorTenths),
    contributions: [...net.keys()].map((id) => ({
      sensor_id: id,
      kind: selected.find((s) => s.id === id)!.kind,
      area_m2: Number(areas.get(id)!),
      qualifying_half_hours: qualifying.get(id)!.length,
      half_hours: halfHours,
      co2_tco2e: tonnes(co2Alloc.get(id)!),
      ch4_tco2e: tonnes(ch4Alloc.get(id)!),
      net_tco2e: tonnes(netAlloc.get(id)!),
    })),
  };
}

/** `<tonnes>`: three decimals, a leading `-` only when negative. */
export function tonnes(milli: bigint): string {
  return fixed(milli, 3);
}

/** `<coverage>`, `<floor>`, `buffer_pct`: one decimal. */
export function percent(tenths: bigint | number): string {
  return fixed(BigInt(tenths), 1);
}

export function readingValue(unitsE4: number): string {
  return formatE4(unitsE4);
}
