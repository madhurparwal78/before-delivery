// Command engine: applies one base command to an in-memory drawing. Pure; the server owns persistence and versions.
import type { StoredObject } from '../../shared/types.ts';
import {
  angularDimensionGeometry, arcGeometry, circleGeometry, insertGeometry, lineGeometries, linearDimensionGeometry, mtextGeometry,
  polygonGeometry, polylineGeometry, radiusDimensionGeometry, rectangleGeometry, splineGeometry,
} from './create.ts';
import { extendObject, filletObjects, offsetObject, trimObject } from './cut.ts';
import { Draft, handleValue } from './draft.ts';
import { copyObjects, eraseObjects, mirrorObjects, moveObjects, rotateObjects, scaleObjects } from './edit.ts';
import { layerCommand, layoutCommand } from './layers.ts';
import { applyProperties } from './properties.ts';
import type { CommandResult, DrawingModel, Patch } from './types.ts';
import { invalid, MESSAGE, Reader, Refuse } from './validate.ts';

export { intersectionPoints } from './intersect.ts';
export { blankModel, studioPlanModel, wallDetailModel } from './models.ts';
export { createTraceObjects } from './trace.ts';

type Handler = (d: Draft, r: Reader) => void;

const HANDLERS: Record<string, Handler> = {
  LINE: (d, r) => lineGeometries(r).forEach((g) => d.create(g)),
  PLINE: (d, r) => void d.create(polylineGeometry(r)),
  RECTANG: (d, r) => void d.create(rectangleGeometry(r)),
  CIRCLE: (d, r) => void d.create(circleGeometry(r)),
  ARC: (d, r) => void d.create(arcGeometry(r)),
  POLYGON: (d, r) => void d.create(polygonGeometry(r)),
  SPLINE: (d, r) => void d.create(splineGeometry(r)),
  MTEXT: (d, r) => void d.create(mtextGeometry(r)),
  INSERT: (d, r) => void d.create(insertGeometry(r)),
  DIMLINEAR: (d, r) => void d.create(linearDimensionGeometry(r, 'linear')),
  DIMALIGNED: (d, r) => void d.create(linearDimensionGeometry(r, 'aligned')),
  DIMRADIUS: (d, r) => {
    const source = r.object('handle');
    const geometry = radiusDimensionGeometry(source, r);
    if (d.unlocked([source]).length > 0) d.create(geometry);
  },
  DIMANGULAR: (d, r) => {
    const first = r.object('first_handle');
    const second = r.object('second_handle');
    const geometry = angularDimensionGeometry(first, second, r);
    if (d.unlocked([first, second]).length === 2) d.create(geometry);
  },
  MOVE: moveObjects,
  COPY: copyObjects,
  ROTATE: rotateObjects,
  SCALE: scaleObjects,
  MIRROR: mirrorObjects,
  ERASE: eraseObjects,
  OFFSET: offsetObject,
  TRIM: trimObject,
  EXTEND: extendObject,
  FILLET: filletObjects,
  PROPERTIES: applyProperties,
  LAYER: layerCommand,
  LAYOUT: layoutCommand,
};

/** Every base command except UNDO, REDO and XREF (the server owns those: they act on history and rows). */
export function applyCommand(model: DrawingModel, command: string, args: unknown): CommandResult {
  const handler = Object.hasOwn(HANDLERS, command) ? HANDLERS[command] : undefined;
  try {
    if (!handler) return invalid('command', MESSAGE.unknownCommand(command));
    const draft = new Draft(model);
    handler(draft, new Reader(args, model));
    return { ok: true, outcome: draft.finish() };
  } catch (error) {
    if (error instanceof Refuse) return { ok: false, refusal: error.refusal };
    throw error;
  }
}

/** Applies a before/after image (undo and redo). */
export function applyPatch(model: DrawingModel, patch: Patch): DrawingModel {
  const known = new Set(model.objects.map((o) => o.handle));
  const objects: StoredObject[] = [];
  for (const object of model.objects) {
    const image = patch.objects[object.handle];
    if (image === undefined) objects.push(object);
    else if (image !== null) objects.push(image);
  }
  let nextHandle = model.next_handle;
  const restored = Object.entries(patch.objects)
    .filter((entry): entry is [string, StoredObject] => entry[1] !== null && !known.has(entry[0]))
    .map(([, image]) => image)
    .sort((a, b) => handleValue(a.handle) - handleValue(b.handle));
  // Objects stay in creation order: a returning object goes before the first one with a larger handle.
  for (const image of restored) {
    const at = objects.findIndex((o) => handleValue(o.handle) > handleValue(image.handle));
    objects.splice(at === -1 ? objects.length : at, 0, image);
  }
  for (const image of Object.values(patch.objects)) {
    if (image) nextHandle = Math.max(nextHandle, handleValue(image.handle) + 1);
  }
  return {
    units: patch.units ?? model.units,
    plot_style: patch.plot_style ?? model.plot_style,
    layers: patch.layers ?? model.layers,
    layouts: patch.layouts ?? model.layouts,
    objects,
    next_handle: nextHandle,
  };
}
