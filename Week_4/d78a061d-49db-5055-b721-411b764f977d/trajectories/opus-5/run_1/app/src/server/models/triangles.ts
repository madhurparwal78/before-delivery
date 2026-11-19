import { defaultSceneNodes, type GltfJson, type GltfPrimitive } from './glb.js';

const MODE_POINTS = 0;
const MODE_LINES = 1;
const MODE_LINE_LOOP = 2;
const MODE_LINE_STRIP = 3;
const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

function primitiveElementCount(json: GltfJson, primitive: GltfPrimitive): number {
  const accessors = json.accessors ?? [];
  if (primitive.indices !== undefined) {
    return accessors[primitive.indices]?.count ?? 0;
  }
  const position = primitive.attributes?.POSITION;
  if (position === undefined) return 0;
  return accessors[position]?.count ?? 0;
}

function trianglesForPrimitive(json: GltfJson, primitive: GltfPrimitive): number {
  const count = primitiveElementCount(json, primitive);
  const mode = primitive.mode ?? MODE_TRIANGLES;
  switch (mode) {
    case MODE_TRIANGLES:
      return Math.floor(count / 3);
    case MODE_TRIANGLE_STRIP:
    case MODE_TRIANGLE_FAN:
      return Math.max(0, count - 2);
    case MODE_POINTS:
    case MODE_LINES:
    case MODE_LINE_LOOP:
    case MODE_LINE_STRIP:
      return 0;
    default:
      return 0;
  }
}

/** R04: the triangles the default scene draws, counted once per node that names a mesh. */
export function countSceneTriangles(json: GltfJson): number {
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  let total = 0;

  const walk = (index: number, seen: Set<number>): void => {
    if (seen.has(index)) return;
    const node = nodes[index];
    if (node === undefined) return;
    const visited = new Set(seen).add(index);
    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        total += trianglesForPrimitive(json, primitive);
      }
    }
    for (const child of node.children ?? []) walk(child, visited);
  };

  for (const root of defaultSceneNodes(json)) walk(root, new Set());
  return total;
}
