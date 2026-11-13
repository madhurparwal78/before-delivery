// Where an object shows its grips: one per vertex.
import type { ApiObject, Point } from '../../../shared/types.ts';

export function gripPoints(object: ApiObject): Point[] {
  switch (object.type) {
    case 'line': return [object.start, object.end];
    case 'polyline': return object.vertices;
    case 'circle': return [object.center];
    case 'arc': return [...object.snaps.endpoint, object.center];
    case 'spline': return object.fit_points;
    case 'mtext': return [object.position];
    case 'dimension': return [...object.points, object.location];
    case 'insert': return [object.position];
    case 'revcloud': return [object.first, object.opposite];
  }
}

/** Only a line's ends can be dragged. */
export const draggableEnds = (object: ApiObject): readonly ('start' | 'end')[] => (object.type === 'line' ? ['start', 'end'] : []);
