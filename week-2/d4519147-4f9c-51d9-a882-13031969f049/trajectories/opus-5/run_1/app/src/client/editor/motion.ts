import { crossingsOfZone, derivedZone } from '../../shared/derive';
import { zoneTally } from '../../shared/copy';
import type { Derived, PageDocument, PointTuple } from '../../shared/types';
import { announce, prefersReducedMotion } from '../dom';
import type { CanvasRefs } from './canvas';

const MORPH_MS = 200;
const STAGGER_MS = 40;
const ROLL_MS = 300;
const MAX_STAGGER = 12;

export interface TallyPlan {
  beforeDoc: PageDocument;
  beforeDerived: Derived;
  afterDoc: PageDocument;
  afterDerived: Derived;
  reverse: boolean;
  announcement: string | null;
}

/** The boundary tally plays when any zone's member set or crossing count changes. */
export function tallyQualifies(before: Derived, after: Derived): boolean {
  const beforeZones = new Map(before.zones.map((zone) => [zone.id, zone]));
  for (const zone of after.zones) {
    const previous = beforeZones.get(zone.id);
    if (!previous) return true;
    if (previous.crossings !== zone.crossings) return true;
    if (previous.members.join(',') !== zone.members.join(',')) return true;
  }
  return before.zones.length !== after.zones.length;
}

interface Running {
  finish(): void;
}

let running: Running | null = null;

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function animate(duration: number, onFrame: (progress: number) => void): { promise: Promise<void>; finish(): void } {
  let frame = 0;
  let settle: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const start = performance.now();
  const step = (now: number): void => {
    const progress = Math.min(1, (now - start) / duration);
    onFrame(easeOut(progress));
    if (progress < 1) frame = requestAnimationFrame(step);
    else settle?.();
  };
  frame = requestAnimationFrame(step);
  return {
    promise,
    finish: () => {
      cancelAnimationFrame(frame);
      onFrame(1);
      settle?.();
    },
  };
}

function samplePath(points: PointTuple[], count: number): PointTuple[] {
  if (points.length === 0) return [];
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    lengths.push(total);
  }
  const sampled: PointTuple[] = [];
  for (let i = 0; i < count; i += 1) {
    const target = total * (i / (count - 1));
    let segment = 1;
    while (segment < lengths.length && (lengths[segment] ?? 0) < target) segment += 1;
    const a = points[segment - 1] ?? points[0];
    const b = points[segment] ?? points[points.length - 1];
    const spanStart = lengths[segment - 1] ?? 0;
    const spanEnd = lengths[segment] ?? spanStart;
    const ratio = spanEnd === spanStart ? 0 : (target - spanStart) / (spanEnd - spanStart);
    if (!a || !b) continue;
    sampled.push([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]);
  }
  return sampled;
}

function markerKey(zoneId: string, connectorId: string, x: number, y: number): string {
  return `${zoneId}:${connectorId}:${x}:${y}`;
}

function markerKeys(doc: PageDocument, derived: Derived): Map<string, { x: number; y: number }> {
  const keys = new Map<string, { x: number; y: number }>();
  for (const zone of doc.zones) {
    for (const crossing of crossingsOfZone(derived, zone.id)) {
      keys.set(markerKey(zone.id, crossing.connectorId, crossing.x, crossing.y), { x: crossing.x, y: crossing.y });
    }
  }
  return keys;
}

/** Plays the three-step sequence, or its reverse for undo. */
export function playBoundaryTally(refs: CanvasRefs, plan: TallyPlan): void {
  running?.finish();
  running = null;

  const steps: Array<() => { promise: Promise<void>; finish(): void } | null> = [];
  const morph = (): { promise: Promise<void>; finish(): void } | null => {
    const changed: Array<{ line: SVGElement; from: PointTuple[]; to: PointTuple[] }> = [];
    const beforeById = new Map(plan.beforeDoc.connectors.map((connector) => [connector.id, connector]));
    for (const connector of plan.afterDoc.connectors) {
      const previous = beforeById.get(connector.id);
      if (!previous) continue;
      const from = JSON.stringify(previous.points);
      const to = JSON.stringify(connector.points);
      if (from === to) continue;
      const line = refs.connectors.querySelector<SVGElement>(`[data-line="${CSS.escape(connector.id)}"]`);
      if (!line) continue;
      const count = Math.max(previous.points.length, connector.points.length, 2) + 2;
      changed.push({
        line,
        from: samplePath(previous.points, count),
        to: samplePath(connector.points, count),
      });
    }
    if (changed.length === 0) return null;
    const final = plan.afterDoc.connectors;
    return animate(MORPH_MS, (progress) => {
      for (const entry of changed) {
        const points = entry.from.map((point, index) => {
          const target = entry.to[index] ?? point;
          return `${point[0] + (target[0] - point[0]) * progress},${point[1] + (target[1] - point[1]) * progress}`;
        });
        entry.line.setAttribute('points', points.join(' '));
      }
      if (progress === 1) {
        for (const connector of final) {
          const line = refs.connectors.querySelector<SVGElement>(`[data-line="${CSS.escape(connector.id)}"]`);
          line?.setAttribute('points', connector.points.map(([x, y]) => `${x},${y}`).join(' '));
        }
      }
    });
  };

  const markers = (): { promise: Promise<void>; finish(): void } | null => {
    const beforeKeys = markerKeys(plan.beforeDoc, plan.beforeDerived);
    const afterKeys = markerKeys(plan.afterDoc, plan.afterDerived);
    const added = [...afterKeys.entries()].filter(([key]) => !beforeKeys.has(key));
    const removed = [...beforeKeys.entries()].filter(([key]) => !afterKeys.has(key));
    if (added.length === 0 && removed.length === 0) return null;
    added.sort((a, b) => a[1].x - b[1].x || a[1].y - b[1].y);
    if (plan.reverse) added.reverse();
    const elements = added
      .map(([key]) => refs.markers.querySelector<SVGElement>(`[data-marker="${CSS.escape(key)}"]`))
      .filter((node): node is SVGElement => node !== null);
    const ghosts: SVGElement[] = [];
    for (const [key] of removed) {
      const ghost = refs.markers.querySelector<SVGElement>(`[data-ghost="${CSS.escape(key)}"]`);
      if (ghost) ghosts.push(ghost);
    }
    for (const element of elements) element.setAttribute('opacity', '0');
    const total = Math.min(elements.length, MAX_STAGGER) * STAGGER_MS + STAGGER_MS;
    return animate(Math.max(total, STAGGER_MS), (progress) => {
      const elapsed = progress * Math.max(total, STAGGER_MS);
      elements.forEach((element, index) => {
        const delay = Math.min(index, MAX_STAGGER - 1) * STAGGER_MS;
        element.setAttribute('opacity', elapsed >= delay ? '1' : '0');
      });
      for (const ghost of ghosts) ghost.setAttribute('opacity', String(1 - progress));
      if (progress === 1) {
        for (const element of elements) element.removeAttribute('opacity');
        for (const ghost of ghosts) ghost.remove();
      }
    });
  };

  const roll = (): { promise: Promise<void>; finish(): void } | null => {
    const changed: Array<{ node: SVGElement; from: [number, number]; to: [number, number] }> = [];
    for (const zone of plan.afterDoc.zones) {
      const before = derivedZone(plan.beforeDerived, zone.id);
      const after = derivedZone(plan.afterDerived, zone.id);
      if (before.systems === after.systems && before.crossings === after.crossings) continue;
      const node = refs.zones.querySelector<SVGElement>(`[data-tally="${CSS.escape(zone.id)}"] text`);
      if (!node) continue;
      changed.push({
        node,
        from: [before.systems, before.crossings],
        to: [after.systems, after.crossings],
      });
    }
    if (changed.length === 0) return null;
    return animate(ROLL_MS, (progress) => {
      for (const entry of changed) {
        const systems = Math.round(entry.from[0] + (entry.to[0] - entry.from[0]) * progress);
        const crossings = Math.round(entry.from[1] + (entry.to[1] - entry.from[1]) * progress);
        entry.node.textContent = zoneTally(systems, crossings);
      }
    });
  };

  if (prefersReducedMotion()) {
    if (plan.announcement) announce(plan.announcement);
    return;
  }

  steps.push(...(plan.reverse ? [roll, markers, morph] : [morph, markers, roll]));

  let cancelled = false;
  const finishers: Array<() => void> = [];
  running = {
    finish: () => {
      cancelled = true;
      for (const finisher of finishers) finisher();
    },
  };

  void (async () => {
    for (const step of steps) {
      if (cancelled) break;
      const handle = step();
      if (!handle) continue;
      finishers.push(handle.finish);
      await handle.promise;
    }
    running = null;
    if (plan.announcement) announce(plan.announcement);
  })();
}

/** Keeps the markers an edit removed in the DOM so they can fade out. */
export function addGhostMarkers(refs: CanvasRefs, plan: TallyPlan): void {
  if (prefersReducedMotion()) return;
  const beforeKeys = markerKeys(plan.beforeDoc, plan.beforeDerived);
  const afterKeys = markerKeys(plan.afterDoc, plan.afterDerived);
  for (const [key] of beforeKeys) {
    if (afterKeys.has(key)) continue;
    const parts = key.split(':');
    const x = Number(parts[2]);
    const y = Number(parts[3]);
    const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ghost.setAttribute('data-ghost', key);
    ghost.setAttribute('aria-hidden', 'true');
    const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    diamond.setAttribute('d', `M ${x} ${y - 7} L ${x + 7} ${y} L ${x} ${y + 7} L ${x - 7} ${y} Z`);
    diamond.setAttribute('fill', 'none');
    diamond.setAttribute('stroke', 'var(--ink)');
    ghost.append(diamond);
    refs.markers.append(ghost);
  }
}
