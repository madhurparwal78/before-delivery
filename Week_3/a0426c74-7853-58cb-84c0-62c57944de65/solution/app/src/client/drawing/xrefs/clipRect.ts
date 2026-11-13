import { parseNumber } from '../../../shared/commands/points.ts';
import type { Rect } from '../../../shared/types.ts';

/** `x1,y1,x2,y2` as a clip rectangle; null when it is not four numbers. */
export function readRect(text: string): Rect | null {
  const parts = text.split(',').map((part) => parseNumber(part.trim()));
  const [x1, y1, x2, y2] = parts;
  return parts.length === 4 && x1 !== null && y1 !== null && x2 !== null && y2 !== null ? [x1, y1, x2, y2] : null;
}
