// The flight track: CZML parsing, coverage, and the interpolation rule for chainage and time.
import type { Db } from "../db.js";
import { chainageMessage, type CorridorRecord } from "./corridor.js";
import { project, type Centreline } from "../../shared/geodesy.js";

const NO_COVERAGE = "No flight coverage";

interface FlightSample {
  intervalIndex: number;
  timeMs: number;
  lonDeg: number;
  latDeg: number;
  heightM: number;
  chainageM: number;
}

interface CoverageRange {
  from_m: number;
  to_m: number;
}

export interface Track {
  samples: FlightSample[];
  coverage: CoverageRange[];
}

interface Packet {
  availability?: unknown;
  position?: { epoch?: unknown; cartographicDegrees?: unknown };
}

function intervalsOf(availability: unknown): Array<[number, number]> {
  const items = typeof availability === "string" ? [availability] : Array.isArray(availability) ? availability : [];
  const intervals: Array<[number, number]> = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const [start, end] = item.split("/");
    const from = Date.parse(start ?? "");
    const to = Date.parse(end ?? "");
    if (Number.isFinite(from) && Number.isFinite(to) && from <= to) intervals.push([from, to]);
  }
  return intervals.sort((a, b) => a[0] - b[0]);
}

/** Consecutive in-interval samples: the only pairs the track is ever interpolated between. */
function pairs(samples: FlightSample[]): Array<[FlightSample, FlightSample]> {
  const result: Array<[FlightSample, FlightSample]> = [];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a !== undefined && b !== undefined && a.intervalIndex === b.intervalIndex) result.push([a, b]);
  }
  return result;
}

/** Covered chainage ranges, merged into the fewest ascending, non-overlapping ranges. */
function coverageOf(samples: FlightSample[]): CoverageRange[] {
  const ranges = pairs(samples)
    .map(([a, b]) => ({ from_m: Math.min(a.chainageM, b.chainageM), to_m: Math.max(a.chainageM, b.chainageM) }))
    .filter((r) => r.from_m < r.to_m)
    .sort((x, y) => x.from_m - y.from_m);
  const merged: CoverageRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.from_m <= last.to_m) last.to_m = Math.max(last.to_m, range.to_m);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Reads the first packet whose position has an epoch and cartographicDegrees samples, keeping only
 * samples inside an availability interval. Projected chainages are kept to the millimetre.
 * Returns null for a track with no such samples.
 */
export function parseTrack(bytes: Buffer, line: Centreline): Track | null {
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(document)) return null;
  const packet = (document as Packet[]).find(
    (p) =>
      p !== null &&
      typeof p === "object" &&
      typeof p.position?.epoch === "string" &&
      Array.isArray(p.position.cartographicDegrees) &&
      p.position.cartographicDegrees.length >= 4 &&
      p.position.cartographicDegrees.length % 4 === 0,
  );
  const epoch = Date.parse(String(packet?.position?.epoch));
  const values = packet?.position?.cartographicDegrees;
  if (packet === undefined || !Number.isFinite(epoch) || !Array.isArray(values)) return null;
  const intervals = intervalsOf(packet.availability);

  const samples: FlightSample[] = [];
  for (let i = 0; i + 3 < values.length; i += 4) {
    const [seconds, lon, lat, height] = values.slice(i, i + 4);
    if (typeof seconds !== "number" || typeof lon !== "number" || typeof lat !== "number" || typeof height !== "number") {
      return null;
    }
    const timeMs = epoch + seconds * 1000;
    const intervalIndex = intervals.findIndex(([from, to]) => timeMs >= from && timeMs <= to);
    if (intervalIndex < 0) continue;
    const chainageM = Math.round(project(line, { lonDeg: lon, latDeg: lat }).chainageM * 1000) / 1000;
    samples.push({ intervalIndex, timeMs, lonDeg: lon, latDeg: lat, heightM: height, chainageM });
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a.timeMs - b.timeMs);
  return { samples, coverage: coverageOf(samples) };
}

export async function writeTrack(db: Db, assetId: string, track: Track): Promise<void> {
  const s = track.samples;
  await db.query(
    `INSERT INTO flight_samples (asset_id, seq, interval_index, time_ms, lon_deg, lat_deg, height_m, chainage_m)
     SELECT $1, ord - 1, interval_index, time_ms, lon_deg, lat_deg, height_m, chainage_m
       FROM unnest($2::int[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[])
            WITH ORDINALITY AS t(interval_index, time_ms, lon_deg, lat_deg, height_m, chainage_m, ord)`,
    [
      assetId,
      s.map((x) => x.intervalIndex),
      s.map((x) => x.timeMs),
      s.map((x) => x.lonDeg),
      s.map((x) => x.latDeg),
      s.map((x) => x.heightM),
      s.map((x) => x.chainageM),
    ],
  );
  for (const range of track.coverage) {
    await db.query("INSERT INTO flight_coverage (asset_id, from_m, to_m) VALUES ($1, $2, $3)", [
      assetId,
      range.from_m,
      range.to_m,
    ]);
  }
}

const trackCache = new Map<string, Track>();

/** A stored track never changes, so each process reads it from PostgreSQL once. */
export async function readTrack(db: Db, assetId: string): Promise<Track> {
  const cached = trackCache.get(assetId);
  if (cached !== undefined) return cached;
  const samples = await db.query<{ interval_index: number; time_ms: number; lon_deg: number; lat_deg: number; height_m: number; chainage_m: number }>(
    `SELECT interval_index, time_ms, lon_deg, lat_deg, height_m, chainage_m FROM flight_samples
      WHERE asset_id = $1 ORDER BY seq`,
    [assetId],
  );
  const coverage = await db.query<CoverageRange>(
    "SELECT from_m, to_m FROM flight_coverage WHERE asset_id = $1 ORDER BY from_m",
    [assetId],
  );
  const track: Track = {
    samples: samples.rows.map((r) => ({
      intervalIndex: r.interval_index,
      timeMs: r.time_ms,
      lonDeg: r.lon_deg,
      latDeg: r.lat_deg,
      heightM: r.height_m,
      chainageM: r.chainage_m,
    })),
    coverage: coverage.rows,
  };
  trackCache.set(assetId, track);
  return track;
}

function between(a: FlightSample, b: FlightSample, fraction: number): { lon_deg: number; lat_deg: number; height_m: number } {
  return {
    lon_deg: a.lonDeg + (b.lonDeg - a.lonDeg) * fraction,
    lat_deg: a.latDeg + (b.latDeg - a.latDeg) * fraction,
    height_m: a.heightM + (b.heightM - a.heightM) * fraction,
  };
}

function isoMs(timeMs: number): string {
  return new Date(Math.round(timeMs)).toISOString();
}

export type FlightQuery = { chainageM: number } | { timeMs: number };

/**
 * For a chainage: the earliest time two consecutive in-interval samples bracket it, whichever way
 * the drone flew. For a time: the two in-interval samples that bracket it. Never extrapolated.
 */
export function flightAnswer(track: Track | null, corridor: CorridorRecord, query: FlightQuery): Record<string, unknown> {
  const steps = track === null ? [] : pairs(track.samples);
  if ("chainageM" in query) {
    const c = query.chainageM;
    for (const [a, b] of steps) {
      if (c < Math.min(a.chainageM, b.chainageM) || c > Math.max(a.chainageM, b.chainageM)) continue;
      const fraction = a.chainageM === b.chainageM ? 0 : (c - a.chainageM) / (b.chainageM - a.chainageM);
      return {
        chainage_m: c,
        time: isoMs(a.timeMs + (b.timeMs - a.timeMs) * fraction),
        covered: true,
        position: between(a, b, fraction),
      };
    }
    return { chainage_m: c, time: null, covered: false, label: NO_COVERAGE };
  }
  const t = query.timeMs;
  for (const [a, b] of steps) {
    if (t < a.timeMs || t > b.timeMs) continue;
    const fraction = a.timeMs === b.timeMs ? 0 : (t - a.timeMs) / (b.timeMs - a.timeMs);
    const position = between(a, b, fraction);
    const projected = project(corridor.line, { lonDeg: position.lon_deg, latDeg: position.lat_deg }).chainageM;
    return { chainage_m: Math.round(projected * 10) / 10, time: isoMs(t), covered: true, position };
  }
  return { chainage_m: null, time: isoMs(t), covered: false, label: NO_COVERAGE };
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Exactly one of `chainage_m` (within the corridor) or `time` (ISO 8601). */
export function readFlightQuery(query: URLSearchParams, corridor: CorridorRecord): FlightQuery | { fields: Record<string, string> } {
  const chainage = query.get("chainage_m");
  const time = query.get("time");
  if ((chainage === null) === (time === null)) return { fields: { query: "Give exactly one of chainage_m or time." } };
  if (chainage !== null) {
    const value = chainage.trim() === "" ? Number.NaN : Number(chainage);
    if (!Number.isFinite(value) || value < 0 || value > corridor.lengthM) {
      return { fields: { chainage_m: chainageMessage(corridor) } };
    }
    return { chainageM: value };
  }
  const timeMs = ISO_TIME.test(time ?? "") ? Date.parse(time ?? "") : Number.NaN;
  if (!Number.isFinite(timeMs)) return { fields: { time: "Give the time as an ISO 8601 UTC time." } };
  return { timeMs };
}
