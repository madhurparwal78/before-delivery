import { lengthIn, type Units } from '../../shared/units';

/** Width × depth × height in the chosen units. Feet carry their own marks; metres get an `m`. */
export function sizeText(widthMm: number, depthMm: number, heightMm: number, units: Units): string {
  const text = [widthMm, depthMm, heightMm].map((mm) => lengthIn(mm, units)).join(' × ');
  return units === 'm' ? `${text} m` : text;
}
