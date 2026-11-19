import { crossVec, dotVec, normaliseVec, subtractVec, type Mesh, type Triangle, type Vec3 } from './mesh.js';

/**
 * Binary space partition solid geometry: the union of the solids minus the union of the holes.
 * Deterministic, so equal inputs always give an equal result.
 */

const EPSILON = 1e-6;

interface Plane {
  normal: Vec3;
  w: number;
}

interface Polygon {
  vertices: Vec3[];
  plane: Plane;
}

const planeOf = (a: Vec3, b: Vec3, c: Vec3): Plane => {
  const normal = normaliseVec(crossVec(subtractVec(b, a), subtractVec(c, a)));
  return { normal, w: dotVec(normal, a) };
};

const polygonOf = (vertices: Vec3[]): Polygon | null => {
  const plane = planeOf(vertices[0], vertices[1], vertices[2]);
  if (!Number.isFinite(plane.w) || (plane.normal[0] === 0 && plane.normal[1] === 0 && plane.normal[2] === 0)) {
    return null;
  }
  return { vertices, plane };
};

const flip = (polygon: Polygon): Polygon => ({
  vertices: [...polygon.vertices].reverse(),
  plane: { normal: [-polygon.plane.normal[0], -polygon.plane.normal[1], -polygon.plane.normal[2]], w: -polygon.plane.w },
});

const interpolate = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const splitPolygon = (
  plane: Plane,
  polygon: Polygon,
  coplanarFront: Polygon[],
  coplanarBack: Polygon[],
  front: Polygon[],
  back: Polygon[],
): void => {
  const COPLANAR = 0;
  const FRONT = 1;
  const BACK = 2;
  const SPANNING = 3;
  let polygonType = 0;
  const types: number[] = [];
  for (const vertex of polygon.vertices) {
    const distance = dotVec(plane.normal, vertex) - plane.w;
    const type = distance < -EPSILON ? BACK : distance > EPSILON ? FRONT : COPLANAR;
    polygonType |= type;
    types.push(type);
  }
  if (polygonType === COPLANAR) {
    (dotVec(plane.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
    return;
  }
  if (polygonType === FRONT) {
    front.push(polygon);
    return;
  }
  if (polygonType === BACK) {
    back.push(polygon);
    return;
  }
  if (polygonType !== SPANNING) return;
  const frontVertices: Vec3[] = [];
  const backVertices: Vec3[] = [];
  for (let index = 0; index < polygon.vertices.length; index += 1) {
    const next = (index + 1) % polygon.vertices.length;
    const type = types[index];
    const nextType = types[next];
    const vertex = polygon.vertices[index];
    const nextVertex = polygon.vertices[next];
    if (type !== BACK) frontVertices.push(vertex);
    if (type !== FRONT) backVertices.push(vertex);
    if ((type | nextType) === SPANNING) {
      const t = (plane.w - dotVec(plane.normal, vertex)) / dotVec(plane.normal, subtractVec(nextVertex, vertex));
      const middle = interpolate(vertex, nextVertex, t);
      frontVertices.push(middle);
      backVertices.push(middle);
    }
  }
  if (frontVertices.length >= 3) {
    const made = polygonOf(frontVertices);
    if (made) front.push(made);
  }
  if (backVertices.length >= 3) {
    const made = polygonOf(backVertices);
    if (made) back.push(made);
  }
};

class BspNode {
  private plane: Plane | null = null;
  private front: BspNode | null = null;
  private back: BspNode | null = null;
  private polygons: Polygon[] = [];

  constructor(polygons?: Polygon[]) {
    if (polygons && polygons.length > 0) this.build(polygons);
  }

  invert(): void {
    this.polygons = this.polygons.map(flip);
    if (this.plane) this.plane = { normal: [-this.plane.normal[0], -this.plane.normal[1], -this.plane.normal[2]], w: -this.plane.w };
    this.front?.invert();
    this.back?.invert();
    const swap = this.front;
    this.front = this.back;
    this.back = swap;
  }

  clipPolygons(polygons: Polygon[]): Polygon[] {
    if (!this.plane) return [...polygons];
    let front: Polygon[] = [];
    let back: Polygon[] = [];
    for (const polygon of polygons) {
      splitPolygon(this.plane, polygon, front, back, front, back);
    }
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return [...front, ...back];
  }

  clipTo(other: BspNode): void {
    this.polygons = other.clipPolygons(this.polygons);
    this.front?.clipTo(other);
    this.back?.clipTo(other);
  }

  allPolygons(): Polygon[] {
    return [...this.polygons, ...(this.front?.allPolygons() ?? []), ...(this.back?.allPolygons() ?? [])];
  }

  build(polygons: Polygon[]): void {
    if (polygons.length === 0) return;
    if (!this.plane) this.plane = polygons[0].plane;
    const front: Polygon[] = [];
    const back: Polygon[] = [];
    for (const polygon of polygons) {
      splitPolygon(this.plane, polygon, this.polygons, this.polygons, front, back);
    }
    if (front.length > 0) {
      this.front ??= new BspNode();
      this.front.build(front);
    }
    if (back.length > 0) {
      this.back ??= new BspNode();
      this.back.build(back);
    }
  }
}

const meshToPolygons = (mesh: Mesh): Polygon[] => {
  const polygons: Polygon[] = [];
  for (const triangle of mesh.triangles) {
    const made = polygonOf([triangle.a, triangle.b, triangle.c]);
    if (made) polygons.push(made);
  }
  return polygons;
};

const polygonsToMesh = (polygons: Polygon[]): Mesh => {
  const triangles: Triangle[] = [];
  for (const polygon of polygons) {
    for (let index = 2; index < polygon.vertices.length; index += 1) {
      triangles.push({ a: polygon.vertices[0], b: polygon.vertices[index - 1], c: polygon.vertices[index] });
    }
  }
  return { triangles };
};

const unionPolygons = (left: Polygon[], right: Polygon[]): Polygon[] => {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const a = new BspNode(left);
  const b = new BspNode(right);
  a.clipTo(b);
  b.clipTo(a);
  b.invert();
  b.clipTo(a);
  b.invert();
  a.build(b.allPolygons());
  return a.allPolygons();
};

const subtractPolygons = (left: Polygon[], right: Polygon[]): Polygon[] => {
  if (left.length === 0 || right.length === 0) return left;
  const a = new BspNode(left);
  const b = new BspNode(right);
  a.invert();
  a.clipTo(b);
  b.clipTo(a);
  b.invert();
  b.clipTo(a);
  b.invert();
  a.build(b.allPolygons());
  a.invert();
  return a.allPolygons();
};

/** The union of the solids with the union of the holes carved out of it. */
export const solidsMinusHoles = (solids: Mesh[], holes: Mesh[]): Mesh => {
  let polygons: Polygon[] = [];
  for (const mesh of solids) polygons = unionPolygons(polygons, meshToPolygons(mesh));
  for (const mesh of holes) polygons = subtractPolygons(polygons, meshToPolygons(mesh));
  return polygonsToMesh(polygons);
};
