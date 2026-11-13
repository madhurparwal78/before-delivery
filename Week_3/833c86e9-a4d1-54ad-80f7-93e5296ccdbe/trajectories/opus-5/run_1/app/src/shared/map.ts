export interface MapPoint {
  code: string;
  x: number;
  y: number;
}

export const PLANE_SIZE = 1000;
export const DEFAULT_ZOOM = 2;

export function viewSide(zoom: number): number {
  return PLANE_SIZE / 2 ** zoom;
}

export function panStep(zoom: number): number {
  return 100 / 2 ** zoom;
}

export function clampCentre(value: number): number {
  return Math.min(PLANE_SIZE, Math.max(0, value));
}

export function inView(point: MapPoint, zoom: number, cx: number, cy: number): boolean {
  const half = viewSide(zoom) / 2;
  return Math.abs(point.x - cx) <= half && Math.abs(point.y - cy) <= half;
}

export interface MapGroup<T extends MapPoint> {
  kind: 'pin' | 'cluster';
  code: string;
  x: number;
  y: number;
  members: T[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Grid clustering: cell size `200 / 2^zoom` km; 2 or more results make a cluster. */
export function clusterPoints<T extends MapPoint>(points: T[], zoom: number, cx: number, cy: number): MapGroup<T>[] {
  const size = 200 / 2 ** zoom;
  const cells = new Map<string, T[]>();
  for (const point of points) {
    if (!inView(point, zoom, cx, cy)) continue;
    const key = `${Math.floor(point.x / size)},${Math.floor(point.y / size)}`;
    const list = cells.get(key) ?? [];
    list.push(point);
    cells.set(key, list);
  }
  const groups: MapGroup<T>[] = [];
  for (const members of cells.values()) {
    const code = members.map((m) => m.code).sort()[0];
    if (members.length === 1) {
      groups.push({ kind: 'pin', code, x: members[0].x, y: members[0].y, members });
    } else {
      const mx = round1(members.reduce((sum, m) => sum + m.x, 0) / members.length);
      const my = round1(members.reduce((sum, m) => sum + m.y, 0) / members.length);
      groups.push({ kind: 'cluster', code, x: mx, y: my, members });
    }
  }
  groups.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return groups;
}

export type Arrow = 'up' | 'down' | 'left' | 'right';

/** The nearest pin or cluster on that side of the focused one. */
export function nearestInDirection<T extends MapPoint>(groups: T[], from: T, arrow: Arrow): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of groups) {
    if (candidate.code === from.code) continue;
    const dx = candidate.x - from.x;
    const dy = candidate.y - from.y;
    const onSide =
      (arrow === 'up' && dy < 0) ||
      (arrow === 'down' && dy > 0) ||
      (arrow === 'left' && dx < 0) ||
      (arrow === 'right' && dx > 0);
    if (!onSide) continue;
    const along = arrow === 'up' || arrow === 'down' ? Math.abs(dy) : Math.abs(dx);
    const across = arrow === 'up' || arrow === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along < across) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate.code < best.code)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
