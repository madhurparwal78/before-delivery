import type { DesignObject } from "../../shared/types";
import { meshVolume, primitiveMesh } from "../geometry";
import type { GroupInfo } from "./store";

interface SceneItem {
  object: DesignObject;
  /** Mesh volume in cubic millimetres, unrounded. */
  volume: number;
  triangles: number;
}

interface SceneSummary {
  items: SceneItem[];
  /** Summed volume of the top-level solids, rounded; holes count zero. */
  totalVolume: number;
  triangles: number;
}

interface Measure {
  volume: number;
  triangles: number;
}

const MEMO_LIMIT = 400;
const memo = new Map<string, Measure>();

/** A shape's volume and triangle count do not depend on where it stands, so equal shapes share one measurement. */
function measurePrimitive(object: DesignObject): Measure {
  const key = `${object.kind}|${object.w}|${object.d}|${object.h}|${object.rotationZ}`;
  const known = memo.get(key);
  if (known) return known;
  const mesh = primitiveMesh({ ...object, x: 0, y: 0, z: 0 });
  const measure = { volume: meshVolume(mesh), triangles: mesh.indices.length / 3 };
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, measure);
  return measure;
}

/** The numbers the hidden scene element publishes. A group counts zero until the worker has measured it. */
export function summarise(objects: readonly DesignObject[], groups: ReadonlyMap<string, GroupInfo>): SceneSummary {
  const items = objects.map((object): SceneItem => {
    if (object.kind === "group") {
      const info = groups.get(object.id);
      return { object, volume: info?.volume ?? 0, triangles: info?.triangleCount ?? 0 };
    }
    const measure = measurePrimitive(object);
    return { object, volume: measure.volume, triangles: measure.triangles };
  });
  const solid = items.reduce((total, item) => total + (item.object.mode === "solid" ? item.volume : 0), 0);
  return {
    items,
    totalVolume: Math.round(solid),
    triangles: items.reduce((total, item) => total + item.triangles, 0),
  };
}
