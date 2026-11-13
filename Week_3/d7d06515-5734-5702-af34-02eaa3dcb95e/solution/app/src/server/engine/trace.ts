// Trace markups: the creation commands a reviewer may use, producing objects with `T<HEX>` handles.
import { normalizeObject } from '../../shared/geometry.ts';
import type { Geometry, StoredObject } from '../../shared/types.ts';
import {
  circleGeometry, lineGeometries, mtextGeometry, polylineGeometry, revcloudGeometry,
} from './create.ts';
import { newObject } from './draft.ts';
import { blankModel } from './models.ts';
import { MESSAGE, Reader, Refuse } from './validate.ts';

type TraceCreateResult =
  | { ok: true; objects: StoredObject[]; next_trace_handle: number }
  | { ok: false; errors: Record<string, string> };

/** Builds trace objects for LINE, PLINE, CIRCLE, REVCLOUD or MTEXT; handles are `T<HEX>` from `nextTraceHandle`. */
export function createTraceObjects(command: string, args: unknown, nextTraceHandle: number, currentLayer: string): TraceCreateResult {
  try {
    const reader = new Reader(args, blankModel('mm'));
    const geometries: Geometry[] = (() => {
      switch (command) {
        case 'LINE': return lineGeometries(reader);
        case 'PLINE': return [polylineGeometry(reader)];
        case 'CIRCLE': return [circleGeometry(reader)];
        case 'REVCLOUD': return [revcloudGeometry(reader)];
        case 'MTEXT': return [mtextGeometry(reader)];
        default: throw new Refuse({ status: 422, body: { errors: { command: MESSAGE.unknownCommand(command) } } });
      }
    })();
    let counter = nextTraceHandle;
    const objects = geometries.map((geometry) => normalizeObject(newObject(`T${(counter++).toString(16).toUpperCase()}`, currentLayer, geometry)));
    return { ok: true, objects, next_trace_handle: counter };
  } catch (error) {
    if (error instanceof Refuse && error.refusal.status === 422) return { ok: false, errors: error.refusal.body.errors };
    throw error;
  }
}
