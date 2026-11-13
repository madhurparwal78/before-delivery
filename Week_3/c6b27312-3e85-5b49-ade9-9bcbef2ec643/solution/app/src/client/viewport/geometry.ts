// Solid JSON -> three.js meshes. The geometry is built from the stored solid, never recomputed from parameters.
import * as THREE from "three";
import type { Solid, SolidOp, Vec3 } from "../../shared/tine";
import { bodyHeight } from "../../shared/tine";

export type LitShape = { kind: "op"; op: SolidOp; bodyHeight: number } | { kind: "box"; min: Vec3; max: Vec3 };

const SEGMENTS = 56;

function circle(x: number, y: number, r: number): THREE.Path {
  const path = new THREE.Path();
  path.absarc(x, y, r, 0, Math.PI * 2, true);
  return path;
}

function stadium(x: number, y: number, len: number, w: number): THREE.Path {
  const r = w / 2;
  const path = new THREE.Path();
  path.moveTo(x - len / 2, y - r);
  path.lineTo(x + len / 2, y - r);
  path.absarc(x + len / 2, y, r, -Math.PI / 2, Math.PI / 2, false);
  path.lineTo(x - len / 2, y + r);
  path.absarc(x - len / 2, y, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return path;
}

function outline(body: SolidOp): THREE.Shape {
  const shape = new THREE.Shape();
  if (body.op === "box") {
    shape.moveTo(-body.w / 2, -body.d / 2);
    shape.lineTo(body.w / 2, -body.d / 2);
    shape.lineTo(body.w / 2, body.d / 2);
    shape.lineTo(-body.w / 2, body.d / 2);
    shape.closePath();
  } else if (body.op === "cylinder") shape.absarc(0, 0, body.dia / 2, 0, Math.PI * 2, false);
  return shape;
}

interface Solid3 {
  geometry: THREE.BufferGeometry;
  /** Crease edges as line-segment endpoints: the outline loops at both ends plus the straight verticals. */
  edges: number[];
}

function loops(points: THREE.Vector2[][], z: number, out: number[]): void {
  for (const loop of points) {
    loop.forEach((p, i) => {
      const q = loop[(i + 1) % loop.length] as THREE.Vector2;
      out.push(p.x, p.y, z, q.x, q.y, z);
    });
  }
}

/** An extruded plan with holes. Edges are built from the outline, never found from triangle normals (sliver triangles give false creases). */
function prism(shape: THREE.Shape, depth: number, z: number, verticals = false): Solid3 {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: SEGMENTS });
  geometry.translate(0, 0, z);
  const { shape: outer, holes } = shape.extractPoints(SEGMENTS);
  const edges: number[] = [];
  loops([outer, ...holes], z, edges);
  loops([outer, ...holes], z + depth, edges);
  if (verticals) for (const p of outer) edges.push(p.x, p.y, z, p.x, p.y, z + depth);
  return { geometry, edges };
}

function cutPath(op: SolidOp): THREE.Path | null {
  if (op.op === "hole") return circle(op.x, op.y, op.dia / 2);
  if (op.op === "slot") return stadium(op.x, op.y, op.len, op.w);
  return null;
}

function bossGeometry(op: Extract<SolidOp, { op: "boss" }>, top: number): Solid3 {
  const geometry = new THREE.CylinderGeometry(op.dia / 2, op.dia / 2, op.h, SEGMENTS);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(op.x, op.y, top + op.h / 2);
  const ring = circle(op.x, op.y, op.dia / 2).getPoints(SEGMENTS);
  const edges: number[] = [];
  loops([ring], top, edges);
  loops([ring], top + op.h, edges);
  return { geometry, edges };
}

function meshWithEdges(solid: Solid3, material: THREE.Material, edge: THREE.LineBasicMaterial | null): THREE.Object3D[] {
  const out: THREE.Object3D[] = [new THREE.Mesh(solid.geometry, material)];
  if (edge) {
    const lines = new THREE.BufferGeometry();
    lines.setAttribute("position", new THREE.Float32BufferAttribute(solid.edges, 3));
    out.push(new THREE.LineSegments(lines, edge));
  }
  return out;
}

/** The part: body with its cuts as holes in the plan, bosses on top. Ops in `skip` are left out (drawn lit instead). */
export function buildPart(solid: Solid, material: THREE.Material, edge: THREE.LineBasicMaterial | null, skip: Set<string>): THREE.Group {
  const group = new THREE.Group();
  const body = solid.ops[0];
  if (!body || (body.op !== "box" && body.op !== "cylinder")) return group;
  const height = bodyHeight(solid);
  const shape = outline(body);
  for (const op of solid.ops) {
    if (skip.has(opKey(op))) continue;
    const path = cutPath(op);
    if (path) shape.holes.push(path);
  }
  group.add(...meshWithEdges(prism(shape, height, 0, body.op === "box"), material, edge));
  for (const op of solid.ops) {
    if (op.op === "boss" && !skip.has(opKey(op))) group.add(...meshWithEdges(bossGeometry(op, height), material, edge));
  }
  return group;
}

export function opKey(op: SolidOp): string {
  return Object.entries(op).map(([k, v]) => `${k}:${v}`).join("|");
}

/** A lit or ghost shape: a boss standing on the part, a cut's prism, a whole body, or a compare hunk box. */
export function buildShape(shape: LitShape, material: THREE.Material, edge: THREE.LineBasicMaterial | null): THREE.Object3D[] {
  if (shape.kind === "box") {
    const size = new THREE.Vector3(shape.max[0] - shape.min[0], shape.max[1] - shape.min[1], shape.max[2] - shape.min[2]);
    const geometry = new THREE.BoxGeometry(size.x + 0.04, size.y + 0.04, size.z + 0.04);
    geometry.translate((shape.min[0] + shape.max[0]) / 2, (shape.min[1] + shape.max[1]) / 2, (shape.min[2] + shape.max[2]) / 2);
    const creases = new THREE.EdgesGeometry(geometry);
    return meshWithEdges({ geometry, edges: Array.from(creases.getAttribute("position").array) }, material, edge);
  }
  const { op } = shape;
  if (op.op === "boss") return meshWithEdges(bossGeometry(op, shape.bodyHeight), material, edge);
  const path = cutPath(op);
  if (path) {
    const holeShape = new THREE.Shape(path.getPoints(SEGMENTS));
    return meshWithEdges(prism(holeShape, shape.bodyHeight, 0), material, edge);
  }
  const bodyShape = outline(op);
  return meshWithEdges(prism(bodyShape, op.op === "box" || op.op === "cylinder" ? op.h : 0, 0, op.op === "box"), material, edge);
}

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    (child as THREE.Mesh).geometry?.dispose();
  });
}
