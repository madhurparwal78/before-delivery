/** The playback frame grid and cubic Hermite interpolation, shared by the API and the browser. */

import { derive } from "./geometry.js";

export const FRAME_RATES = [1, 5, 10, 25] as const;
export type FrameRate = (typeof FRAME_RATES)[number];
export const MAX_FRAMES = 3000;
export const HOLD_GAP_SECONDS = 600;

export type FrameSample = {
  met: number;
  x_m: number;
  y_m: number;
  z_m: number;
  vx_m_s: number;
  vy_m_s: number;
  vz_m_s: number;
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
};

export type Frame = {
  k: number;
  met_ms: number;
  altitude_m: number;
  lat_deg: number;
  lon_deg: number;
  speed_m_s: number;
};

export function isFrameRate(value: number): value is FrameRate {
  return (FRAME_RATES as readonly number[]).includes(value);
}

function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) {
    return floor + 1;
  }
  if (remainder < 0.5) {
    return floor;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `met_ms` of frame `k` on the grid starting at `fromSeconds`. */
export function frameMetMs(fromSeconds: number, k: number, fps: FrameRate): number {
  return fromSeconds * 1000 + roundHalfEven((k * 1000) / fps);
}

export function frameCount(fromSeconds: number, toSeconds: number, fps: FrameRate): number {
  const limit = toSeconds * 1000;
  let k = 0;
  while (frameMetMs(fromSeconds, k, fps) <= limit) {
    k += 1;
  }
  return k;
}

/** Index of the last sample whose MET is at or before `metSeconds`, or 0 when none is. */
export function snapIndex(samples: readonly { met: number }[], metSeconds: number): number {
  let low = 0;
  let high = samples.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (samples[middle].met <= metSeconds) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found < 0 ? 0 : found;
}

/** The frame at `met_ms`, held across gaps over 600 s and Hermite-interpolated otherwise. */
export function frameAt(
  samples: readonly FrameSample[],
  k: number,
  metMs: number,
): Frame {
  const t = metMs / 1000;
  const aIndex = snapIndex(samples, t);
  const a = samples[aIndex];
  const b = aIndex + 1 < samples.length ? samples[aIndex + 1] : null;
  if (!b || b.met - a.met > HOLD_GAP_SECONDS || t <= a.met) {
    return {
      k,
      met_ms: metMs,
      altitude_m: a.altitude_m,
      lat_deg: a.lat_deg,
      lon_deg: a.lon_deg,
      speed_m_s: a.speed_m_s,
    };
  }
  const h = b.met - a.met;
  const s = (t - a.met) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const d00 = 6 * s2 - 6 * s;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = -6 * s2 + 6 * s;
  const d11 = 3 * s2 - 2 * s;
  const position = {
    x: h00 * a.x_m + h10 * h * a.vx_m_s + h01 * b.x_m + h11 * h * b.vx_m_s,
    y: h00 * a.y_m + h10 * h * a.vy_m_s + h01 * b.y_m + h11 * h * b.vy_m_s,
    z: h00 * a.z_m + h10 * h * a.vz_m_s + h01 * b.z_m + h11 * h * b.vz_m_s,
  };
  const velocity = {
    x: (d00 * a.x_m + d10 * h * a.vx_m_s + d01 * b.x_m + d11 * h * b.vx_m_s) / h,
    y: (d00 * a.y_m + d10 * h * a.vy_m_s + d01 * b.y_m + d11 * h * b.vy_m_s) / h,
    z: (d00 * a.z_m + d10 * h * a.vz_m_s + d01 * b.z_m + d11 * h * b.vz_m_s) / h,
  };
  const derived = derive(position, velocity);
  return {
    k,
    met_ms: metMs,
    altitude_m: derived.altitude_m,
    lat_deg: derived.lat_deg,
    lon_deg: derived.lon_deg,
    speed_m_s: derived.speed_m_s,
  };
}

export function buildFrames(
  samples: readonly FrameSample[],
  fromSeconds: number,
  toSeconds: number,
  fps: FrameRate,
): Frame[] {
  const frames: Frame[] = [];
  const limit = toSeconds * 1000;
  for (let k = 0; ; k += 1) {
    const metMs = frameMetMs(fromSeconds, k, fps);
    if (metMs > limit) {
      break;
    }
    frames.push(frameAt(samples, k, metMs));
  }
  return frames;
}
