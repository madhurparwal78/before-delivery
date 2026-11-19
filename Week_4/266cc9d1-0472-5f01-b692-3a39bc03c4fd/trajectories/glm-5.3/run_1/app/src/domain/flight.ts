import { centrelinePoint, projectOntoCentreline } from './geometry.js';
import type { CorridorModel } from './corridors.js';

/** One parsed flight sample: seconds since epoch, geodetic position, projected chainage. */
export type FlightSample = {
  seconds: number;
  lonDeg: number;
  latDeg: number;
  heightM: number;
  chainageM: number;
  intervalIndex: number;
};

export type FlightInterval = { startSeconds: number; endSeconds: number };

export type FlightTrack = {
  epochMs: number;
  intervals: FlightInterval[];
  /** Samples grouped per interval, ascending in time. */
  perInterval: FlightSample[][];
};

type ParsedCzml = FlightTrack | { invalid: true };

const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function parseIsoMs(value: string): number | null {
  if (!ISO_TIME_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function parseCzml(model: CorridorModel, text: string): ParsedCzml {
  let packets: unknown;
  try {
    packets = JSON.parse(text);
  } catch {
    return { invalid: true };
  }
  if (!Array.isArray(packets)) return { invalid: true };
  for (const packet of packets) {
    if (typeof packet !== 'object' || packet === null) continue;
    const p = packet as Record<string, unknown>;
    const position = p.position;
    if (typeof position !== 'object' || position === null) continue;
    const pos = position as Record<string, unknown>;
    if (typeof pos.epoch !== 'string') continue;
    const epochMs = parseIsoMs(pos.epoch);
    if (epochMs === null) continue;
    const cd = pos.cartographicDegrees;
    if (!Array.isArray(cd)) continue;
    const samples: Array<{ seconds: number; lon: number; lat: number; h: number }> = [];
    for (let i = 0; i + 3 < cd.length; i += 4) {
      const seconds = cd[i];
      const lon = cd[i + 1];
      const lat = cd[i + 2];
      const h = cd[i + 3];
      if (typeof seconds !== 'number' || typeof lon !== 'number' || typeof lat !== 'number' || typeof h !== 'number') continue;
      samples.push({ seconds, lon, lat, h });
    }
    if (samples.length === 0) continue;
    const availRaw = p.availability;
    const intervals: FlightInterval[] = [];
    if (typeof availRaw === 'string' || Array.isArray(availRaw)) {
      const rawPairs: Array<[string, string]> = Array.isArray(availRaw)
        ? (availRaw as unknown[])
            .map((v): [string, string] => (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : ['', '']))
            .filter((p2) => p2[0] !== '' && p2[1] !== '')
        : (availRaw as string).split('&&').map((part): [string, string] => {
            const bits = part.split('/');
            return bits.length === 2 ? [bits[0], bits[1]] : ['', ''];
          }).filter((p2) => p2[0] !== '' && p2[1] !== '');
      for (const [s, e] of rawPairs) {
        const a = parseIsoMs(s);
        const b = parseIsoMs(e);
        if (a !== null && b !== null && b > a) {
          intervals.push({ startSeconds: (a - epochMs) / 1000, endSeconds: (b - epochMs) / 1000 });
        }
      }
    }
    if (intervals.length === 0) continue;
    const perInterval: FlightSample[][] = intervals.map(() => []);
    for (const s of samples) {
      const idx = intervals.findIndex((iv) => s.seconds >= iv.startSeconds && s.seconds <= iv.endSeconds);
      if (idx < 0) continue;
      const proj = projectOntoCentreline({ lonDeg: s.lon, latDeg: s.lat, heightM: 0 }, model.centreline);
      perInterval[idx].push({ seconds: s.seconds, lonDeg: s.lon, latDeg: s.lat, heightM: s.h, chainageM: proj.chainageM, intervalIndex: idx });
    }
    const anySamples = perInterval.some((arr) => arr.length >= 2);
    if (!anySamples) continue;
    return { epochMs, intervals, perInterval };
  }
  return { invalid: true };
}

export function isInvalid(r: ParsedCzml): r is { invalid: true } {
  return (r as { invalid?: true }).invalid === true;
}

/** Covered chainage ranges, merged, ascending, non-overlapping. */
export function coverageRanges(track: FlightTrack | null): Array<{ from_m: number; to_m: number }> {
  if (!track) return [];
  const ranges: Array<{ from_m: number; to_m: number }> = [];
  for (const samples of track.perInterval) {
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i].chainageM;
      const b = samples[i + 1].chainageM;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (hi > lo) {
        // The projection leaves a sliver past 0 at the first sample of the
        // whole track. Clamp only that one to exactly 0.
        const fromM = lo < 0.05 && i === 0 ? 0 : lo;
        ranges.push({ from_m: fromM, to_m: hi });
      }
    }
  }
  ranges.sort((x, y) => x.from_m - y.from_m || x.to_m - y.to_m);
  const merged: Array<{ from_m: number; to_m: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.from_m <= last.to_m) {
      if (r.to_m > last.to_m) last.to_m = r.to_m;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

export type FlightAnswer =
  | { covered: true; chainageM: number; timeMs: number; lonDeg: number; latDeg: number; heightM: number }
  | { covered: false; chainageM: number | null; timeMs: number | null };

/** The earliest time at which consecutive in-interval samples bracket a chainage. */
export function flightByChainage(track: FlightTrack | null, chainageM: number, corridorLength = Infinity): FlightAnswer {
  if (!track) return { covered: false, chainageM, timeMs: null };
  let best: { t: number; lon: number; lat: number; h: number } | null = null;
  for (const samples of track.perInterval) {
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const lo = Math.min(a.chainageM, b.chainageM);
      const hi = Math.max(a.chainageM, b.chainageM);
      const atFirst = i === 0;
      const atLast = i === samples.length - 2;
      // The projected chainages of the track's end samples can be a sliver
      // past 0 or shy of the corridor length. Bracket the corridor's own ends
      // with a 0.05 m tolerance so chainage 0 and the full length count as
      // covered. Only pairs whose projected chainage actually sits within
      // 0.05 m of the corridor ends are widened.
      const effLo = atFirst && lo < 0.05 ? -0.05 : lo;
      const effHi = atLast && hi > corridorLength - 0.05 ? hi + 0.05 : hi;
      if (chainageM < effLo || chainageM > effHi) continue;
      const spanC = b.chainageM - a.chainageM;
      const t = spanC === 0 ? a.seconds : a.seconds + ((chainageM - a.chainageM) / spanC) * (b.seconds - a.seconds);
      if (best === null || t < best.t) {
        const f = t - a.seconds;
        const dur = b.seconds - a.seconds;
        const k = dur === 0 ? 0 : f / dur;
        best = {
          t,
          lon: a.lonDeg + (b.lonDeg - a.lonDeg) * k,
          lat: a.latDeg + (b.latDeg - a.latDeg) * k,
          h: a.heightM + (b.heightM - a.heightM) * k,
        };
      }
    }
  }
  if (!best) return { covered: false, chainageM, timeMs: null };
  return {
    covered: true,
    chainageM,
    timeMs: track.epochMs + Math.round(best.t * 1000),
    lonDeg: best.lon,
    latDeg: best.lat,
    heightM: best.h,
  };
}

/** Interpolate position at a time; also project the interpolated chainage. */
export function flightByTime(model: CorridorModel, track: FlightTrack | null, timeMs: number): FlightAnswer {
  if (!track) return { covered: false, chainageM: null, timeMs };
  const seconds = (timeMs - track.epochMs) / 1000;
  for (const samples of track.perInterval) {
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      if (seconds >= a.seconds && seconds <= b.seconds) {
        const dur = b.seconds - a.seconds;
        const k = dur === 0 ? 0 : (seconds - a.seconds) / dur;
        const lon = a.lonDeg + (b.lonDeg - a.lonDeg) * k;
        const lat = a.latDeg + (b.latDeg - a.latDeg) * k;
        const h = a.heightM + (b.heightM - a.heightM) * k;
        const proj = projectOntoCentreline({ lonDeg: lon, latDeg: lat, heightM: 0 }, model.centreline);
        return {
          covered: true,
          chainageM: Math.round(proj.chainageM * 10) / 10,
          timeMs,
          lonDeg: lon,
          latDeg: lat,
          heightM: h,
        };
      }
    }
  }
  return { covered: false, chainageM: null, timeMs };
}

/** Sample list for the seeded Ash Creek flight, on the centreline at 320 m. */
export function buildAshCreekCzml(model: CorridorModel): string {
  const intervals: Array<{ startSec: number; endSec: number; fromC: number; toC: number }> = [
    { startSec: 0, endSec: 480, fromC: 0, toC: 1268 },
    { startSec: 900, endSec: 1320, fromC: 1904, toC: 2870 },
    { startSec: 1800, endSec: 2220, fromC: 2870, toC: 1904 },
  ];
  const iso = (sec: number) => {
    const d = new Date(Date.UTC(2026, 5, 14, 14, 0, 0) + sec * 1000);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  };
  const samples: number[] = [];
  for (const iv of intervals) {
    const n = Math.round((iv.endSec - iv.startSec) / 10);
    for (let i = 0; i <= n; i++) {
      const sec = iv.startSec + i * 10;
      const t = i / n;
      const c = iv.fromC + (iv.toC - iv.fromC) * t;
      const p = centrelinePoint(model.centreline, c, 0, 320);
      samples.push(sec, p.lonDeg, p.latDeg, 320);
    }
  }
  // Stray samples outside every interval, which must be ignored.
  const stray1 = centrelinePoint(model.centreline, 1400, 0, 320);
  const stray2 = centrelinePoint(model.centreline, 2500, 0, 320);
  samples.push(540, stray1.lonDeg, stray1.latDeg, 320);
  samples.push(1560, stray2.lonDeg, stray2.latDeg, 320);

  const availability = intervals
    .map((iv) => `${iso(iv.startSec)}/${iso(iv.endSec)}`)
    .join('&&');
  return JSON.stringify([
    {
      id: 'document',
      name: 'Ash Creek flight 2026-06-14',
      version: '1.0',
    },
    {
      id: 'drone',
      name: 'Ash Creek drone',
      availability,
      position: {
        epoch: '2026-06-14T14:00:00Z',
        interpolationAlgorithm: 'LINEAR',
        interpolationDegree: 1,
        cartographicDegrees: samples,
      },
    },
  ]);
}
