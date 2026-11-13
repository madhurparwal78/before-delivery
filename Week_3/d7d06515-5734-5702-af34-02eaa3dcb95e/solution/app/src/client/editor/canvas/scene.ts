// The drawing as paint batches: primitives grouped by effective look so each look is one canvas path, with boxes for culling.
import { styledPrimitivesOf } from '../../../shared/geometry.ts';
import type { ColorName, Layer, LinetypeName, LineweightName, Point, Primitive, StoredObject, Units } from '../../../shared/types.ts';

/** Average glyph advance as a fraction of the letter height, the same estimate the geometry module picks with. */
const TEXT_ADVANCE = 0.6;

export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export interface Item { handle: string; primitive: Primitive; box: Box }
export interface Bucket {
  color: ColorName;
  linetype: LinetypeName;
  lineweight: LineweightName;
  linetypeScale: number;
  faded: boolean;
  items: Item[];
}
export interface Scene { buckets: Bucket[]; byHandle: Map<string, Item[]> }

const boxOf = (points: Point[]): Box => ({
  minX: Math.min(...points.map((p) => p[0])), minY: Math.min(...points.map((p) => p[1])),
  maxX: Math.max(...points.map((p) => p[0])), maxY: Math.max(...points.map((p) => p[1])),
});

export function boxOfPrimitive(primitive: Primitive): Box {
  switch (primitive.kind) {
    case 'line': return boxOf([primitive.a, primitive.b]);
    case 'polyline': return boxOf(primitive.points);
    case 'circle': case 'arc':
      return {
        minX: primitive.center[0] - primitive.radius, minY: primitive.center[1] - primitive.radius,
        maxX: primitive.center[0] + primitive.radius, maxY: primitive.center[1] + primitive.radius,
      };
    case 'text': {
      const width = Math.max(primitive.width ?? 0, primitive.text.length * primitive.height * TEXT_ADVANCE);
      return { minX: primitive.at[0], minY: primitive.at[1] - primitive.height, maxX: primitive.at[0] + width, maxY: primitive.at[1] };
    }
  }
}

interface SceneObject { object: StoredObject; faded: boolean }

export function buildScene(objects: SceneObject[], layers: Layer[], units: Units): Scene {
  const buckets = new Map<string, Bucket>();
  const byHandle = new Map<string, Item[]>();
  for (const { object, faded } of objects) {
    for (const styled of styledPrimitivesOf(object, layers, units)) {
      if (styled.primitive.kind === 'polyline' && styled.primitive.points.length === 0) continue;
      const key = [styled.color, styled.linetype, styled.lineweight, object.linetype_scale, faded].join('|');
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { color: styled.color, linetype: styled.linetype, lineweight: styled.lineweight, linetypeScale: object.linetype_scale, faded, items: [] };
        buckets.set(key, bucket);
      }
      const item: Item = { handle: object.handle, primitive: styled.primitive, box: boxOfPrimitive(styled.primitive) };
      bucket.items.push(item);
      const own = byHandle.get(object.handle);
      if (own) own.push(item);
      else byHandle.set(object.handle, [item]);
    }
  }
  return { buckets: [...buckets.values()], byHandle };
}
