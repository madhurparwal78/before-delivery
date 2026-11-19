/**
 * The flight track: CZML parsing, coverage and the interpolation rule.
 * Parsed samples live in PostgreSQL so flight answers survive a storage outage.
 */

import { query, queryOne, type Tx } from "../db.js";
import { invalidCzml } from "../errors.js";
import { projectOntoCentreline, type CorridorGeometry } from "../../shared/corridor.js";
import { NO_FLIGHT_COVERAGE } from "../../shared/copy.js";

export interface FlightSample {
  ordinal: number;
  intervalIdx: number;
  timeMs: number;
  lonDeg: number;
  latDeg: number;
  heightM: number;
  chainageM: number;
}

export interface CoverageRange {
  from_m: number;
  to_m: number;
}

interface RawSample {
  timeMs: number;
  lonDeg: number;
  latDeg: number;
  heightM: number;
}

/** Flight `time` values always carry exactly three fractional digits. */
export function flightTime(timeMs: number): string {
  return new Date(Math.round(timeMs)).toISOString();
}

function parseIntervals(availability: unknown): { startMs: number; endMs: number }[] {
  const raw = Array.isArray(availability) ? availability : [availability];
  const intervals: { startMs: number; endMs: number }[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const [start, end] = entry.split("/");
    const startMs = Date.parse(start ?? "");
    const endMs = Date.parse(end ?? "");
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) intervals.push({ startMs, endMs });
  }
  return intervals.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Reads the first packet whose position carries an epoch and
 * `cartographicDegrees` samples, bounded by the packet's availability.
 * Samples outside every interval are ignored entirely.
 */
export function parseCzml(
  bytes: Uint8Array,
  corridor: CorridorGeometry,
): { samples: FlightSample[]; coverage: CoverageRange[] } {
  let document: unknown;
  try {
    document = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw invalidCzml();
  }
  const packets = Array.isArray(document) ? document : [document];

  for (const packet of packets) {
    if (typeof packet !== "object" || packet === null) continue;
    const record = packet as Record<string, unknown>;
    const position = record.position;
    if (typeof position !== "object" || position === null) continue;
    const positionRecord = position as Record<string, unknown>;
    const epoch = positionRecord.epoch;
    const values = positionRecord.cartographicDegrees;
    if (typeof epoch !== "string" || !Array.isArray(values)) continue;
    const epochMs = Date.parse(epoch);
    if (!Number.isFinite(epochMs)) continue;
    const intervals = parseIntervals(record.availability);
    if (intervals.length === 0) continue;

    const raw: RawSample[] = [];
    for (let i = 0; i + 3 < values.length; i += 4) {
      const seconds = Number(values[i]);
      const lonDeg = Number(values[i + 1]);
      const latDeg = Number(values[i + 2]);
      const heightM = Number(values[i + 3]);
      if (![seconds, lonDeg, latDeg, heightM].every(Number.isFinite)) continue;
      raw.push({ timeMs: epochMs + seconds * 1000, lonDeg, latDeg, heightM });
    }
    if (raw.length === 0) continue;

    const kept: FlightSample[] = [];
    for (const sample of raw.slice().sort((a, b) => a.timeMs - b.timeMs)) {
      const intervalIdx = intervals.findIndex(
        (interval) => sample.timeMs >= interval.startMs && sample.timeMs <= interval.endMs,
      );
      if (intervalIdx < 0) continue;
      kept.push({
        ordinal: kept.length,
        intervalIdx,
        timeMs: sample.timeMs,
        lonDeg: sample.lonDeg,
        latDeg: sample.latDeg,
        heightM: sample.heightM,
        chainageM: projectOntoCentreline(corridor, sample.lonDeg, sample.latDeg).chainageM,
      });
    }
    if (kept.length < 2) throw invalidCzml();
    return { samples: kept, coverage: mergeCoverage(kept) };
  }
  throw invalidCzml();
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Covered chainage ranges merged into the fewest ascending, non-overlapping ranges. */
export function mergeCoverage(samples: FlightSample[]): CoverageRange[] {
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.intervalIdx !== b.intervalIdx) continue;
    const from = Math.min(a.chainageM, b.chainageM);
    const to = Math.max(a.chainageM, b.chainageM);
    if (round1(from) < round1(to)) spans.push([round1(from), round1(to)]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: CoverageRange[] = [];
  for (const [from, to] of spans) {
    const last = merged[merged.length - 1];
    if (last && from <= last.to_m) {
      last.to_m = Math.max(last.to_m, to);
    } else {
      merged.push({ from_m: from, to_m: to });
    }
  }
  return merged;
}

export interface FlightAnswer {
  chainage_m: number | null;
  time: string | null;
  covered: boolean;
  position?: { lon_deg: number; lat_deg: number; height_m: number };
  label?: string;
}

function notCovered(chainageM: number | null, time: string | null): FlightAnswer {
  return { chainage_m: chainageM, time, covered: false, label: NO_FLIGHT_COVERAGE };
}

function interpolate(a: FlightSample, b: FlightSample, fraction: number) {
  return {
    lon_deg: a.lonDeg + (b.lonDeg - a.lonDeg) * fraction,
    lat_deg: a.latDeg + (b.latDeg - a.latDeg) * fraction,
    height_m: a.heightM + (b.heightM - a.heightM) * fraction,
  };
}

function roundPosition(position: { lon_deg: number; lat_deg: number; height_m: number }) {
  return {
    lon_deg: Math.round(position.lon_deg * 1e7) / 1e7,
    lat_deg: Math.round(position.lat_deg * 1e7) / 1e7,
    height_m: Math.round(position.height_m * 1e3) / 1e3,
  };
}

/**
 * The earliest time at which two consecutive in-interval samples bracket the
 * chainage. Samples are in ascending time order, so the first bracketing pair
 * is the earliest, even where a reverse pass overlaps.
 */
export function positionAtChainage(samples: FlightSample[], chainageM: number): FlightAnswer {
  for (let i = 0; i + 1 < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.intervalIdx !== b.intervalIdx) continue;
    const low = Math.min(a.chainageM, b.chainageM);
    const high = Math.max(a.chainageM, b.chainageM);
    if (chainageM < low || chainageM > high) continue;
    const span = b.chainageM - a.chainageM;
    const fraction = span === 0 ? 0 : (chainageM - a.chainageM) / span;
    const timeMs = a.timeMs + (b.timeMs - a.timeMs) * fraction;
    return {
      chainage_m: round1(chainageM),
      time: flightTime(timeMs),
      covered: true,
      position: roundPosition(interpolate(a, b, fraction)),
    };
  }
  return notCovered(round1(chainageM), null);
}

/** The position interpolated between the two in-interval samples bracketing a time. */
export function positionAtTime(
  samples: FlightSample[],
  timeMs: number,
  corridor: CorridorGeometry,
): FlightAnswer {
  for (let i = 0; i + 1 < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.intervalIdx !== b.intervalIdx) continue;
    if (timeMs < a.timeMs || timeMs > b.timeMs) continue;
    const span = b.timeMs - a.timeMs;
    const fraction = span === 0 ? 0 : (timeMs - a.timeMs) / span;
    const position = roundPosition(interpolate(a, b, fraction));
    return {
      chainage_m: round1(
        projectOntoCentreline(corridor, position.lon_deg, position.lat_deg).chainageM,
      ),
      time: flightTime(timeMs),
      covered: true,
      position,
    };
  }
  return notCovered(null, flightTime(timeMs));
}

export async function activeTrackAssetId(corridorId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM assets
     WHERE corridor_id = $1 AND kind = 'czml' AND state = 'stored'
     ORDER BY stored_at DESC, id DESC LIMIT 1`,
    [corridorId],
  );
  return row?.id ?? null;
}

export async function loadSamples(assetId: string): Promise<FlightSample[]> {
  const rows = await query<{
    ordinal: number;
    interval_idx: number;
    sample_time: Date;
    lon_deg: number;
    lat_deg: number;
    height_m: number;
    chainage_m: number;
  }>(
    `SELECT ordinal, interval_idx, sample_time, lon_deg, lat_deg, height_m, chainage_m
     FROM flight_samples WHERE asset_id = $1 ORDER BY ordinal`,
    [assetId],
  );
  return rows.map((row) => ({
    ordinal: row.ordinal,
    intervalIdx: row.interval_idx,
    timeMs: row.sample_time.getTime(),
    lonDeg: row.lon_deg,
    latDeg: row.lat_deg,
    heightM: row.height_m,
    chainageM: row.chainage_m,
  }));
}

export async function corridorSamples(corridorId: string): Promise<FlightSample[]> {
  const assetId = await activeTrackAssetId(corridorId);
  return assetId ? loadSamples(assetId) : [];
}

export async function corridorCoverage(corridorId: string): Promise<CoverageRange[]> {
  const assetId = await activeTrackAssetId(corridorId);
  if (!assetId) return [];
  return query<CoverageRange>(
    `SELECT from_m, to_m FROM flight_coverage WHERE asset_id = $1 ORDER BY ordinal`,
    [assetId],
  );
}

/** Writes the parsed track exactly once for an asset. */
export async function storeTrack(
  tx: Tx,
  assetId: string,
  parsed: { samples: FlightSample[]; coverage: CoverageRange[] },
): Promise<void> {
  for (const sample of parsed.samples) {
    await tx.query(
      `INSERT INTO flight_samples
         (asset_id, ordinal, interval_idx, sample_time, lon_deg, lat_deg, height_m, chainage_m)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (asset_id, ordinal) DO NOTHING`,
      [
        assetId,
        sample.ordinal,
        sample.intervalIdx,
        new Date(sample.timeMs).toISOString(),
        sample.lonDeg,
        sample.latDeg,
        sample.heightM,
        sample.chainageM,
      ],
    );
  }
  for (const [index, range] of parsed.coverage.entries()) {
    await tx.query(
      `INSERT INTO flight_coverage (asset_id, ordinal, from_m, to_m)
       VALUES ($1,$2,$3,$4) ON CONFLICT (asset_id, ordinal) DO NOTHING`,
      [assetId, index, range.from_m, range.to_m],
    );
  }
}
