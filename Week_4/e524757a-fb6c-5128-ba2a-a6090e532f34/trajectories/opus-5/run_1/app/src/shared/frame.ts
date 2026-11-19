import type { Heading } from './islands.js';

export type FrameVector = { forward: number; lateral: number };

/** The published frame rule: forward and lateral offsets for a creature from the explorer's pose. */
export function frameVector(
  explorer: { x: number; y: number },
  heading: Heading,
  creature: { x: number; y: number },
): FrameVector {
  switch (heading) {
    case 'N':
      return { forward: explorer.y - creature.y, lateral: creature.x - explorer.x };
    case 'E':
      return { forward: creature.x - explorer.x, lateral: creature.y - explorer.y };
    case 'S':
      return { forward: creature.y - explorer.y, lateral: explorer.x - creature.x };
    case 'W':
      return { forward: explorer.x - creature.x, lateral: explorer.y - creature.y };
  }
}

export function inFrame(vector: FrameVector, zoom: number): boolean {
  const { forward, lateral } = vector;
  return forward >= 1 && forward <= 24 && 2 * zoom * Math.abs(lateral) <= forward;
}

export type FramedCreature<T> = { creature: T; vector: FrameVector };

/** In-frame creatures ordered by the published subject rule: nearest, then least lateral, then lower id. */
export function framedCreatures<T extends { id: string; x: number; y: number }>(
  explorer: { x: number; y: number },
  heading: Heading,
  zoom: number,
  creatures: ReadonlyArray<T>,
): FramedCreature<T>[] {
  const framed: FramedCreature<T>[] = [];
  for (const creature of creatures) {
    const vector = frameVector(explorer, heading, creature);
    if (inFrame(vector, zoom)) framed.push({ creature, vector });
  }
  framed.sort((a, b) => {
    if (a.vector.forward !== b.vector.forward) return a.vector.forward - b.vector.forward;
    const la = Math.abs(a.vector.lateral);
    const lb = Math.abs(b.vector.lateral);
    if (la !== lb) return la - lb;
    return a.creature.id < b.creature.id ? -1 : a.creature.id > b.creature.id ? 1 : 0;
  });
  return framed;
}
