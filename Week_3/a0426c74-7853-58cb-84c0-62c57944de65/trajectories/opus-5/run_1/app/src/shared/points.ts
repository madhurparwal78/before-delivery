import { round6 } from './numbers.js';
import { type Vec, toRad, vec } from './geometry.js';

/** Absolute 10,20, relative @5,0 and polar @10<45, from the last point entered. */
export function parsePoint(text: string, lastPoint: Vec): Vec | null {
  const raw = text.trim();
  if (!raw) return null;
  if (raw.startsWith('@')) {
    const body = raw.slice(1);
    if (body.includes('<')) {
      const [distanceText, angleText] = body.split('<');
      const distance = Number(distanceText);
      const angle = Number(angleText);
      if (!Number.isFinite(distance) || !Number.isFinite(angle) || distanceText.trim() === '' || angleText.trim() === '') return null;
      return vec(
        round6(lastPoint.x + distance * Math.cos(toRad(angle))),
        round6(lastPoint.y + distance * Math.sin(toRad(angle))),
      );
    }
    const parts = body.split(',');
    if (parts.length !== 2) return null;
    const dx = Number(parts[0]);
    const dy = Number(parts[1]);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || parts[0].trim() === '' || parts[1].trim() === '') return null;
    return vec(round6(lastPoint.x + dx), round6(lastPoint.y + dy));
  }
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || parts[0].trim() === '' || parts[1].trim() === '') return null;
  return vec(round6(x), round6(y));
}

export function parseNumber(text: string): number | null {
  const raw = text.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
