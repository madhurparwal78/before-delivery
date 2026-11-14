import type { Airfield } from '../layouts.js';
import type { Aircraft, Leg } from './model.js';

function viaFits(airfield: Airfield, legs: Leg[], via: string[]): boolean {
  const taxiways: string[] = [];
  for (const leg of legs) {
    if (leg.kind !== 'seg') continue;
    const taxiway = airfield.segments.get(leg.id)!.taxiway.toUpperCase();
    if (taxiways[taxiways.length - 1] !== taxiway) taxiways.push(taxiway);
  }
  let at = 0;
  for (const wanted of via) {
    while (at < taxiways.length && taxiways[at] !== wanted) at++;
    if (at === taxiways.length) return false;
    at++;
  }
  return true;
}

/** The leg the aircraft is on now, when it is on a segment. */
function currentLeg(aircraft: Aircraft): Leg | null {
  return aircraft.segment !== null && aircraft.legs[0]?.kind === 'seg' ? aircraft.legs[0] : null;
}

/** Where a new route starts: the rest of the current segment, or the node the aircraft is at. */
function routeStart(aircraft: Aircraft): { head: Leg[]; node: string; avoid: string | null } | null {
  const leg = currentLeg(aircraft);
  if (leg) return { head: [leg], node: leg.to, avoid: leg.from };
  if (aircraft.node === null) return null;
  return { head: [], node: aircraft.node, avoid: null };
}

export function findRoute(airfield: Airfield, aircraft: Aircraft, target: string, via: string[]): Leg[] | null {
  const start = routeStart(aircraft);
  if (!start) return null;
  const candidates: Leg[][] = [];
  const visited = new Set<string>([start.node]);
  if (start.avoid) visited.add(start.avoid);
  const path: Leg[] = [];

  const walk = (node: string) => {
    if (node === target) {
      candidates.push([...start.head, ...path]);
      return;
    }
    const steps: Leg[] = airfield.segmentsAt(node).map((segment) => ({
      kind: 'seg' as const,
      id: segment.id,
      from: node,
      to: segment.from === node ? segment.to : segment.from,
    }));
    const across = airfield.crossings.get(node);
    if (across) steps.push({ kind: 'cross', id: `${node}-${across}`, from: node, to: across });
    for (const step of steps) {
      if (visited.has(step.to)) continue;
      visited.add(step.to);
      path.push(step);
      walk(step.to);
      path.pop();
      visited.delete(step.to);
    }
  };
  walk(start.node);

  const fitting = candidates.filter((legs) => legs.length > 0 && viaFits(airfield, legs, via));
  if (fitting.length === 0) return null;
  const crossingsOf = (legs: Leg[]) => legs.filter((leg) => leg.kind === 'cross').map((leg) => leg.from);
  fitting.sort((a, b) => {
    const ca = crossingsOf(a);
    const cb = crossingsOf(b);
    if (ca.length !== cb.length) return ca.length - cb.length;
    const fa = ca[0] ?? '';
    const fb = cb[0] ?? '';
    return fa === fb ? 0 : fa < fb ? -1 : 1;
  });
  return fitting[0]!;
}

export const segmentIds = (legs: Leg[]) => legs.filter((leg) => leg.kind === 'seg').map((leg) => leg.id);
