import { svg } from './dom';
import type { AvailabilitySector, SectorKind } from '../shared/types';
import { minutesToWall } from '../shared/tz';

export const DIAL_SIZE = 280;
export const DIAL_RADIUS = 96;
export const RING_WIDTH = 22;

const SECTOR_NAMES: Record<SectorKind, string> = {
  booked: 'Booked',
  buffer: 'Sanitation',
  own_held: 'Your hold',
  own_confirmed: 'Your booking',
  nonexistent: 'Not on the clock',
};

export function degreesFor(minutes: number): number {
  return minutes * 0.25;
}

function polar(radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  const centre = DIAL_SIZE / 2;
  return [centre + radius * Math.cos(radians), centre + radius * Math.sin(radians)];
}

export function arcPath(startDegrees: number, endDegrees: number, radius = DIAL_RADIUS): string {
  const span = endDegrees - startDegrees;
  if (span <= 0) {
    const [x, y] = polar(radius, startDegrees);
    return `M ${x.toFixed(2)} ${y.toFixed(2)} l 0 0`;
  }
  if (span >= 360) {
    const [x1, y1] = polar(radius, 0);
    const [x2, y2] = polar(radius, 180);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(
      2,
    )} A ${radius} ${radius} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const [x1, y1] = polar(radius, startDegrees);
  const [x2, y2] = polar(radius, endDegrees);
  const large = span > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(
    2,
  )} ${y2.toFixed(2)}`;
}

export function sectorLabel(sector: AvailabilitySector): string {
  return `${SECTOR_NAMES[sector.kind]} ${sector.start} to ${sector.end}`;
}

export function claimLabel(startMinutes: number, endMinutes: number): string {
  return `Claim ${minutesToWall(startMinutes)} to ${minutesToWall(endMinutes)}`;
}

/** The ring's ticks and hour labels, drawn once per dial. */
export function ringFurniture(): SVGElement[] {
  const nodes: SVGElement[] = [];
  const centre = DIAL_SIZE / 2;
  nodes.push(
    svg('circle', {
      cx: centre,
      cy: centre,
      r: DIAL_RADIUS,
      class: 'dial-ring',
      fill: 'none',
      'stroke-width': RING_WIDTH,
    }),
  );
  for (let hour = 0; hour < 24; hour += 1) {
    const degrees = degreesFor(hour * 60);
    const major = hour % 3 === 0;
    const [x1, y1] = polar(DIAL_RADIUS - RING_WIDTH / 2, degrees);
    const [x2, y2] = polar(DIAL_RADIUS + RING_WIDTH / 2, degrees);
    nodes.push(
      svg('line', {
        x1: x1.toFixed(2),
        y1: y1.toFixed(2),
        x2: x2.toFixed(2),
        y2: y2.toFixed(2),
        class: major ? 'tick-major' : 'tick-hour',
      }),
    );
    if (major) {
      const [lx, ly] = polar(DIAL_RADIUS + RING_WIDTH / 2 + 10, degrees);
      const label = svg('text', {
        x: lx.toFixed(2),
        y: (ly + 4).toFixed(2),
        class: 'tick-label',
        'text-anchor': 'middle',
      });
      label.textContent = String(hour).padStart(2, '0');
      nodes.push(label);
    }
  }
  for (let quarter = 0; quarter < 96; quarter += 1) {
    if (quarter % 4 === 0) continue;
    const degrees = degreesFor(quarter * 15);
    const [x1, y1] = polar(DIAL_RADIUS - RING_WIDTH / 4, degrees);
    const [x2, y2] = polar(DIAL_RADIUS + RING_WIDTH / 4, degrees);
    nodes.push(
      svg('line', {
        x1: x1.toFixed(2),
        y1: y1.toFixed(2),
        x2: x2.toFixed(2),
        y2: y2.toFixed(2),
        class: 'tick-quarter',
      }),
    );
  }
  return nodes;
}

export function dialPatterns(): SVGElement {
  const defs = svg('defs');
  const hatch = svg('pattern', {
    id: 'pattern-hatch',
    width: 6,
    height: 6,
    patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(45)',
  });
  hatch.append(svg('rect', { width: 6, height: 6, class: 'pattern-ground' }));
  hatch.append(svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'pattern-stroke' }));
  const cross = svg('pattern', {
    id: 'pattern-cross',
    width: 6,
    height: 6,
    patternUnits: 'userSpaceOnUse',
  });
  cross.append(svg('rect', { width: 6, height: 6, class: 'pattern-ground' }));
  cross.append(svg('line', { x1: 0, y1: 0, x2: 6, y2: 6, class: 'pattern-stroke' }));
  cross.append(svg('line', { x1: 6, y1: 0, x2: 0, y2: 6, class: 'pattern-stroke' }));
  const dots = svg('pattern', {
    id: 'pattern-dots',
    width: 5,
    height: 5,
    patternUnits: 'userSpaceOnUse',
  });
  dots.append(svg('rect', { width: 5, height: 5, class: 'pattern-ground' }));
  dots.append(svg('circle', { cx: 2.5, cy: 2.5, r: 1.1, class: 'pattern-dot' }));
  defs.append(hatch, cross, dots);
  return defs;
}

export function sectorClass(kind: SectorKind): string {
  return `sector sector-${kind}`;
}

/** The angle, in minutes from midnight, of a point inside the dial. */
export function minutesFromPoint(
  element: SVGSVGElement,
  clientX: number,
  clientY: number,
): number {
  const box = element.getBoundingClientRect();
  const centreX = box.left + box.width / 2;
  const centreY = box.top + box.height / 2;
  const dx = clientX - centreX;
  const dy = clientY - centreY;
  let degrees = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (degrees < 0) degrees += 360;
  return degrees / 0.25;
}

export function snapToStep(minutes: number): number {
  const snapped = Math.round(minutes / 15) * 15;
  return Math.min(1440, Math.max(0, snapped));
}
