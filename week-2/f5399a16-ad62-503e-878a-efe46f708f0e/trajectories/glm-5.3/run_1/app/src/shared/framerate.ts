import { Rat } from "./rat";

// Frame rates are held exactly: 25 is 25/1, 23.976 is 24000/1001 and 29.97 is
// 30000/1001. Every conversion on a frame count goes through here, so no rate
// is ever held as a float.

export const FRAME_RATES = ["25", "23.976", "29.97"] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

export function isFrameRate(v: string): v is FrameRate {
  return (FRAME_RATES as readonly string[]).includes(v);
}

export const RATE_RAT: Record<FrameRate, Rat> = {
  "25": Rat.of(25n, 1n),
  "23.976": Rat.of(24000n, 1001n),
  "29.97": Rat.of(30000n, 1001n),
};

// The nominal whole rate used for nominal seconds and the timecode base:
// 24 at 23.976, 30 at 29.97, 25 at 25.
export const NOMINAL_RATE: Record<FrameRate, bigint> = {
  "25": 25n,
  "23.976": 24n,
  "29.97": 30n,
};

// Real seconds of a frame count, exact: frames x 1001/24000 at 23.976,
// frames x 1001/30000 at 29.97, frames/25 at 25.
export function realSeconds(frames: number, rate: FrameRate): Rat {
  const f = BigInt(frames);
  switch (rate) {
    case "25":
      return Rat.of(f, 25n);
    case "23.976":
      return Rat.of(f * 1001n, 24000n).norm();
    case "29.97":
      return Rat.of(f * 1001n, 30000n).norm();
  }
}

// Real seconds shown half up to 0.01 s, with the unit: 5.005 -> "5.01 s".
export function realSecondsText(frames: number, rate: FrameRate): string {
  const centis = realSeconds(frames, rate).scaledHalfUp(2);
  const negative = centis < 0n;
  const abs = negative ? -centis : centis;
  const units = abs / 100n;
  const cents = abs % 100n;
  return `${negative ? "-" : ""}${units}.${cents.toString().padStart(2, "0")} s`;
}

// Target frames of a nominal length: nominal seconds x 25, 24 or 30.
export function targetFrames(targetSeconds: number, rate: FrameRate): number {
  return Number(BigInt(targetSeconds) * NOMINAL_RATE[rate]);
}

// Seconds turned into frames, half up on the exact value: 1.5 s at 25 is
// 37.5 -> 38.
export function secondsToFrames(seconds: string, rate: FrameRate): number {
  const r = parseDecimalExact(seconds);
  if (r === null) return 0;
  return Number(r.mul(RATE_RAT[rate]).roundHalfUp());
}

// Frames of one nominal second at a rate.
export function nominalFrames(rate: FrameRate): number {
  return Number(NOMINAL_RATE[rate]);
}

// Changing the frame rate: each clip's real length is kept as near as whole
// frames allow, half up, never under 1. The exact rates are 25, 24000/1001
// and 30000/1001, so the conversion goes through the real length in frames
// of the exact rate, never a decimal.
export function convertFrames(frames: number, from: FrameRate, to: FrameRate): number {
  if (from === to) return frames;
  // Real seconds held as (frames x denominator) / numerator of the source rate.
  const exact = Rat.of(BigInt(frames) * RATE_RAT[from].d, RATE_RAT[from].n)
    .mul(Rat.of(RATE_RAT[to].n, RATE_RAT[to].d));
  const converted = Number(exact.roundHalfUp());
  return converted < 1 ? 1 : converted;
}
// A decimal string above 0 with `.` as its point, held exactly as a Rat.
// Returns null when the text is not such a decimal.
export function parseDecimalExact(text: string): Rat | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const whole = BigInt(m[1]!);
  const fracText = m[2] ?? "";
  const frac = fracText.length === 0 ? 0n : BigInt(fracText);
  const pow = 10n ** BigInt(fracText.length);
  return Rat.of(whole * pow + frac, pow);
}

// A decimal string above 0 with at most `places` decimals, exactly: used for
// script seconds (any decimals) and money (2 places).
export function parsePositiveDecimal(text: string, maxPlaces: number | null): Rat | null {
  const r = parseDecimalExact(text);
  if (!r) return null;
  if (r.sign() <= 0) return null;
  if (maxPlaces !== null) {
    const pow = 10n ** BigInt(maxPlaces);
    if ((r.n * pow) % r.d !== 0n) return null;
  }
  return r;
}
