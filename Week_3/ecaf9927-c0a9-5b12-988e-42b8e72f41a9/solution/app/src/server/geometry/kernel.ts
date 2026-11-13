import Module, { type Manifold } from 'manifold-3d';
import type { Direction, Operation, Plane, Point2 } from '../../shared/api';
import { emptyBody, separateBodies } from '../errors';

/** The triangles of a closed, manifold body in part-space millimetres. */
export interface Mesh {
  vertices: [number, number, number][];
  triangles: [number, number, number][];
}

/** One extrude, ready to be applied: a closed profile on a plane and how far it goes. */
export interface ExtrudeStep {
  operation: Operation;
  loops: Point2[][];
  plane: Plane;
  offset_mm: number;
  depth_mm: number;
  direction: Direction;
}

const wasm = await Module();
wasm.setup();
const { Manifold: Solid, CrossSection } = wasm;

/**
 * Where a sketch point (u, v) and the extrude direction w land in part space:
 * the images of u, v and w, and the offset along the plane's normal axis.
 */
const PLANES: Record<Plane, { columns: [[number, number, number], [number, number, number], [number, number, number]]; offsetAxis: 0 | 1 | 2 }> = {
  top: { columns: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], offsetAxis: 2 },
  front: { columns: [[1, 0, 0], [0, 0, 1], [0, 1, 0]], offsetAxis: 1 },
  right: { columns: [[0, 1, 0], [0, 0, 1], [1, 0, 0]], offsetAxis: 0 },
};

const OPERATION_WORDS: Record<Operation, string> = { new: 'New body', join: 'Join', cut: 'Cut', intersect: 'Intersect' };

/** Vertices sit on a 1 nm grid so welding them by rounding always agrees with the stored mesh. */
const snap = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;

function extrusion(step: ExtrudeStep): Manifold {
  const section = CrossSection.ofPolygons(
    step.loops.map((loop) => loop.map((p): [number, number] => [p.x, p.y])),
    'EvenOdd',
  );
  const prism = Solid.extrude(section, step.depth_mm);
  section.delete();
  const lift = step.direction === 'normal' ? 0 : step.direction === 'reverse' ? -step.depth_mm : -step.depth_mm / 2;
  const { columns, offsetAxis } = PLANES[step.plane];
  const shift: [number, number, number] = [0, 0, 0];
  shift[offsetAxis] = step.offset_mm;
  const lifted = prism.translate([0, 0, lift]);
  const [u, v, w] = columns;
  const placed = lifted.transform([...u, 0, ...v, 0, ...w, 0, ...shift, 1]);
  prism.delete();
  lifted.delete();
  return placed;
}

function combine(body: Manifold | undefined, tool: Manifold, operation: Operation): Manifold {
  if (!body) return tool;
  const result = operation === 'join' ? body.add(tool) : operation === 'cut' ? body.subtract(tool) : body.intersect(tool);
  body.delete();
  tool.delete();
  return result;
}

function toMesh(body: Manifold): Mesh {
  const raw = body.getMesh();
  const stride = raw.numProp;
  const vertices: Mesh['vertices'] = [];
  for (let i = 0; i < raw.vertProperties.length; i += stride) {
    vertices.push([snap(raw.vertProperties[i] as number), snap(raw.vertProperties[i + 1] as number), snap(raw.vertProperties[i + 2] as number)]);
  }
  const triangles: Mesh['triangles'] = [];
  for (let i = 0; i < raw.triVerts.length; i += 3) {
    triangles.push([raw.triVerts[i] as number, raw.triVerts[i + 1] as number, raw.triVerts[i + 2] as number]);
  }
  return { vertices, triangles };
}

/** Applies the extrudes in order; refuses an empty result or one in separate pieces. */
export function buildBody(steps: readonly ExtrudeStep[]): Mesh | undefined {
  let body: Manifold | undefined;
  for (const step of steps) {
    body = combine(body, extrusion(step), step.operation);
    const word = OPERATION_WORDS[step.operation];
    if (body.isEmpty()) {
      body.delete();
      throw emptyBody(word);
    }
    const pieces = body.decompose();
    const count = pieces.length;
    pieces.forEach((piece) => piece.delete());
    if (count > 1) {
      body.delete();
      throw separateBodies(word);
    }
  }
  if (!body) return undefined;
  const mesh = toMesh(body);
  body.delete();
  return mesh;
}
