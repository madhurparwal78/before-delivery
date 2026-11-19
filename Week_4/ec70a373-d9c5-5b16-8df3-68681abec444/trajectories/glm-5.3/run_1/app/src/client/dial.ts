import type { Sector } from '../shapes.js';
import { wallMinutesToDeg, parseWall, minutesToWall } from '../sitetime.js';

export const SVG_SIZE = 250;
const RADIUS = 108;
const CENTRE = SVG_SIZE / 2;
const RING_WIDTH = 22;

export function polar(minutes: number): { x: number; y: number } {
  const deg = wallMinutesToDeg(minutes) - 90;
  const rad = (deg * Math.PI) / 180;
  return { x: CENTRE + RADIUS * Math.cos(rad), y: CENTRE + RADIUS * Math.sin(rad) };
}

/** A sector path drawn as an annular arc. */
export function sectorPath(startMin: number, endMin: number): string {
  const outer = 1.03;
  const r1 = RADIUS;
  const r0 = RADIUS - RING_WIDTH;
  const p1 = polar(startMin);
  const p2 = polar(endMin);
  const large = endMin - startMin > 720 ? 1 : 0;
  const p3 = polar(endMin);
  const p4 = polar(startMin);
  void outer;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ');
}

export const SECTOR_CLASS: Record<string, string> = {
  booked: 'sector-booked',
  buffer: 'sector-buffer',
  own_held: 'sector-own-held',
  own_confirmed: 'sector-own-confirmed',
  nonexistent: 'sector-nonexistent',
};

export const SECTOR_ARIA: Record<string, string> = {
  booked: 'Booked',
  buffer: 'Sanitation',
  own_held: 'Your hold',
  own_confirmed: 'Your booking',
  nonexistent: 'Not on the clock',
};

export function sectorLabel(sector: Sector): string {
  return `${SECTOR_ARIA[sector.kind] ?? sector.kind} ${sector.start} to ${sector.end}`;
}

export function dialTicks(): string {
  let marks = '';
  for (let minute = 0; minute <= 1410; minute += 15) {
    const major = minute % 180 === 0;
    const p1 = polar(minute);
    const inner = RADIUS - (major ? 12 : 7);
    const p2 = { x: CENTRE + (p1.x - CENTRE) * (inner / RADIUS), y: CENTRE + (p1.y - CENTRE) * (inner / RADIUS) };
    marks += `<line class="tick${major ? ' major' : ''}" x1="${p2.x.toFixed(2)}" y1="${p2.y.toFixed(2)}" x2="${p1.x.toFixed(2)}" y2="${p1.y.toFixed(2)}" />`;
  }
  let labels = '';
  for (let hour = 0; hour < 24; hour += 3) {
    const p = polar(hour * 60);
    const lx = CENTRE + (p.x - CENTRE) * 0.68;
    const ly = CENTRE + (p.y - CENTRE) * 0.68;
    labels += `<text class="tick-label" x="${lx.toFixed(2)}" y="${(ly + 4).toFixed(2)}" text-anchor="middle">${String(hour).padStart(2, '0')}</text>`;
  }
  return marks + labels;
}

export function stationFilterMatches(kind: string, filter: string): boolean {
  if (filter === 'all') return true;
  const map: Record<string, string> = {
    ovens: 'oven',
    mixers: 'mixer',
    'blast chillers': 'blast_chiller',
    'prep tables': 'prep_table',
  };
  return map[filter] === kind;
}

/** The earliest open quarter-hour step on a dial from its sectors. */
/** The earliest quarter-hour step that no sector covers. */
export function earliestOpenStep(sectors: Array<{ kind: string; start: string; end: string }>): number {
  for (let step = 0; step <= 1410; step += 15) {
    const blocked = sectors.some((sector) => {
      const start = parseWall(sector.start);
      const end = parseWall(sector.end);
      return start <= step && step < end;
    });
    if (!blocked) return step;
  }
  return 0;
}

export function minutesLabel(minutes: number): string {
  return minutesToWall(minutes);
}
