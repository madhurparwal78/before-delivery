// How a table is drawn: round for the two-seat tables, rectangular otherwise, with one seat mark per maximum seat.
// Seat marks and place settings are numbered clockwise from the seat at twelve o'clock.

export interface Point {
  x: number;
  y: number;
}

export interface Geometry {
  round: boolean;
  /** Table body inside the glyph box. */
  body: { x: number; y: number; width: number; height: number };
  /** Whole glyph box, seats included. */
  box: { width: number; height: number };
  seats: Point[];
  settings: Point[];
}

const MARGIN = 26;
const SEAT_OFFSET = 10;
const SETTING_INSET = 15;

function sizeFor(maxSeats: number): { width: number; height: number } {
  if (maxSeats <= 2) return { width: 56, height: 56 };
  if (maxSeats <= 4) return { width: 84, height: 52 };
  if (maxSeats <= 6) return { width: 156, height: 52 };
  return { width: 200, height: 52 };
}

interface Edge {
  from: Point;
  to: Point;
  outward: Point;
}

function perimeter(width: number, height: number): Edge[] {
  return [
    { from: { x: width / 2, y: 0 }, to: { x: width, y: 0 }, outward: { x: 0, y: -1 } },
    { from: { x: width, y: 0 }, to: { x: width, y: height }, outward: { x: 1, y: 0 } },
    { from: { x: width, y: height }, to: { x: 0, y: height }, outward: { x: 0, y: 1 } },
    { from: { x: 0, y: height }, to: { x: 0, y: 0 }, outward: { x: -1, y: 0 } },
    { from: { x: 0, y: 0 }, to: { x: width / 2, y: 0 }, outward: { x: 0, y: -1 } },
  ];
}

function walk(edges: Edge[], distance: number): { point: Point; outward: Point } {
  let left = distance;
  for (const edge of edges) {
    const length = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
    if (left <= length) {
      const t = left / length;
      return {
        point: { x: edge.from.x + (edge.to.x - edge.from.x) * t, y: edge.from.y + (edge.to.y - edge.from.y) * t },
        outward: edge.outward,
      };
    }
    left -= length;
  }
  const last = edges[edges.length - 1];
  return { point: last?.to ?? { x: 0, y: 0 }, outward: last?.outward ?? { x: 0, y: -1 } };
}

export function geometryFor(maxSeats: number): Geometry {
  const { width, height } = sizeFor(maxSeats);
  const round = maxSeats <= 2;
  const body = { x: MARGIN, y: MARGIN, width, height };
  const box = { width: width + MARGIN * 2, height: height + MARGIN * 2 };
  const centre = { x: MARGIN + width / 2, y: MARGIN + height / 2 };
  const seats: Point[] = [];
  const settings: Point[] = [];
  const edges = perimeter(width, height);
  const total = edges.reduce((sum, edge) => sum + Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y), 0);
  for (let index = 0; index < maxSeats; index += 1) {
    if (round) {
      const angle = (index * 2 * Math.PI) / maxSeats;
      const direction = { x: Math.sin(angle), y: -Math.cos(angle) };
      const radius = width / 2;
      seats.push({ x: centre.x + direction.x * (radius + SEAT_OFFSET), y: centre.y + direction.y * (radius + SEAT_OFFSET) });
      settings.push({ x: centre.x + direction.x * (radius - SETTING_INSET), y: centre.y + direction.y * (radius - SETTING_INSET) });
    } else {
      const { point, outward } = walk(edges, ((index * total) / maxSeats) % total);
      seats.push({ x: MARGIN + point.x + outward.x * SEAT_OFFSET, y: MARGIN + point.y + outward.y * SEAT_OFFSET });
      settings.push({ x: MARGIN + point.x - outward.x * SETTING_INSET, y: MARGIN + point.y - outward.y * SETTING_INSET });
    }
  }
  return { round, body, box, seats, settings };
}
