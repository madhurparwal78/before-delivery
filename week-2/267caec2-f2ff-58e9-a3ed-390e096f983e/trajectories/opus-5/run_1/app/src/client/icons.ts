import arrowDown from 'lucide-static/icons/arrow-down.svg';
import arrowUp from 'lucide-static/icons/arrow-up.svg';
import circle from 'lucide-static/icons/circle.svg';
import star from 'lucide-static/icons/star.svg';
import triangle from 'lucide-static/icons/triangle.svg';
import cross from 'lucide-static/icons/x.svg';

export type IconName =
  | 'triangle'
  | 'triangle-filled'
  | 'star'
  | 'star-filled'
  | 'circle'
  | 'cross'
  | 'arrow-up'
  | 'arrow-down';

/** Lucide ships whole documents; the markers reuse the drawing inside a shared <svg> frame. */
function inner(source: string, filled: boolean): string {
  const body = source.slice(source.indexOf('>', source.indexOf('<svg')) + 1, source.lastIndexOf('</svg>'));
  return filled ? body.replace(/<path /g, '<path fill="currentColor" ') : body;
}

export const ICONS: Record<IconName, string> = {
  triangle: inner(triangle, false),
  'triangle-filled': inner(triangle, true),
  star: inner(star, false),
  'star-filled': inner(star, true),
  circle: inner(circle, false),
  cross: inner(cross, false),
  'arrow-up': inner(arrowUp, false),
  'arrow-down': inner(arrowDown, false),
};
