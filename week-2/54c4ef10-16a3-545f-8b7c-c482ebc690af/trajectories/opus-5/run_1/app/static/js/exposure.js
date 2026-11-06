// The Exposure preview, from the server's own aperture table and rules.
import { APERTURES, LOG10_2 } from './boot.js';

export function apertureN(aperture) {
  const index = APERTURES.indexOf(String(aperture));
  if (index < 0) return null;
  return 2 ** (index / 6);
}

export function shutterSeconds(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('1/')) {
    const digits = trimmed.slice(2);
    if (!/^[1-9]\d*$/.test(digits)) return null;
    const n = Number(digits);
    if (n < 2 || n > 8000) return null;
    return 1 / n;
  }
  if (trimmed.endsWith('"')) {
    const digits = trimmed.slice(0, -1);
    if (!/^[1-9]\d*$/.test(digits)) return null;
    const n = Number(digits);
    if (n < 1 || n > 3600) return null;
    return n;
  }
  return null;
}

export function effectiveTime(seconds, reciprocityP) {
  return seconds > 1 ? seconds ** reciprocityP : seconds;
}

// Returns {stops, logH} or null when any input does not parse.
export function figures({ roll, aperture, shutter, meteredEv }) {
  if (!roll) return null;
  const n = apertureN(aperture);
  const seconds = shutterSeconds(shutter);
  if (n === null || seconds === null) return null;
  if (meteredEv === '' || meteredEv === null || meteredEv === undefined) return null;
  const ev = Number(meteredEv);
  if (!Number.isFinite(ev) || ev < -6 || ev > 21) return null;
  const stops =
    ev + Math.log2(roll.ei / 100) - Math.log2(n * n)
    + Math.log2(effectiveTime(seconds, roll.reciprocity_p));
  return { stops, logH: stops * LOG10_2 };
}
