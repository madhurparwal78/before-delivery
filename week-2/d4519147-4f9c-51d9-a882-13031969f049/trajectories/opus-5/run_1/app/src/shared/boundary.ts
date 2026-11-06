import { derivedZone } from './derive';
import { plainLabel } from './labels';
import { shapeMovedInto, shapeMovedOut, zoneMoved, zoneResized, zoneUpdated } from './copy';
import type { Derived, PageDocument } from './types';

export interface BoundaryContext {
  movedShapeIds?: string[];
  zoneAction?: { zoneId: string; kind: 'moved' | 'resized' };
}

function zonesHolding(derived: Derived, shapeId: string): string[] {
  return derived.zones.filter((zone) => zone.members.includes(shapeId)).map((zone) => zone.id);
}

/** The published boundary announcements, in their published order. */
export function boundarySentences(
  beforeDoc: PageDocument,
  beforeDerived: Derived,
  afterDoc: PageDocument,
  afterDerived: Derived,
  context: BoundaryContext,
): string[] {
  const named = new Set<string>();
  const sentences: string[] = [];
  const zoneById = new Map(afterDoc.zones.map((zone) => [zone.id, zone]));
  const beforeZoneById = new Map(beforeDoc.zones.map((zone) => [zone.id, zone]));

  const movedShapes = (context.movedShapeIds ?? [])
    .map((id) => afterDoc.shapes.find((shape) => shape.id === id))
    .filter((shape): shape is NonNullable<typeof shape> => shape !== undefined)
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));

  for (const shape of movedShapes) {
    const before = zonesHolding(beforeDerived, shape.id);
    const after = zonesHolding(afterDerived, shape.id);
    const entered = after.find((zoneId) => !before.includes(zoneId));
    if (entered) {
      const zone = zoneById.get(entered);
      if (!zone) continue;
      const tally = derivedZone(afterDerived, entered);
      sentences.push(shapeMovedInto(plainLabel(shape.label), zone.name, tally.systems, tally.crossings));
      named.add(entered);
      continue;
    }
    if (before.length > 0 && after.length === 0) {
      const leftId = before[0];
      if (!leftId) continue;
      const zone = zoneById.get(leftId) ?? beforeZoneById.get(leftId);
      if (!zone) continue;
      const tally = derivedZone(afterDerived, leftId);
      sentences.push(shapeMovedOut(plainLabel(shape.label), zone.name, tally.systems, tally.crossings));
      named.add(leftId);
    }
  }

  if (context.zoneAction) {
    const zone = zoneById.get(context.zoneAction.zoneId);
    if (zone) {
      const tally = derivedZone(afterDerived, zone.id);
      sentences.push(
        context.zoneAction.kind === 'moved'
          ? zoneMoved(zone.name, tally.systems, tally.crossings)
          : zoneResized(zone.name, tally.systems, tally.crossings),
      );
      named.add(zone.id);
    }
  }

  for (const zone of afterDoc.zones) {
    if (named.has(zone.id)) continue;
    const before = derivedZone(beforeDerived, zone.id);
    const after = derivedZone(afterDerived, zone.id);
    if (before.systems === after.systems && before.crossings === after.crossings) continue;
    sentences.push(zoneUpdated(zone.name, after.systems, after.crossings));
  }

  return sentences;
}
