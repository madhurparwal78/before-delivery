export type BodyMesh = {
  vertices: [number, number, number][];
  triangles: [number, number, number][];
};

export type BodyItem = { mesh: BodyMesh; label: string | null };

const FACE_LIGHT = '#d8d2c6';
const FACE_DARK = '#b9b2a4';
const EDGE = '#1b1f26';
const VIEW: [number, number, number] = [1, 1, 1];

/** Fixed three-quarter projection; larger z draws higher up. */
function project(x: number, y: number, z: number): [number, number] {
  return [(x - y) * 0.866, (x + y) * 0.5 - z];
}

type Projected = { points: [number, number][]; depth: number; shade: string };

function normalOf(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): [number, number, number] {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function faceList(mesh: BodyMesh): Projected[] {
  const faces: Projected[] = [];
  for (const triangle of mesh.triangles) {
    const a = mesh.vertices[triangle[0]];
    const b = mesh.vertices[triangle[1]];
    const c = mesh.vertices[triangle[2]];
    if (!a || !b || !c) continue;
    const normal = normalOf(a, b, c);
    if (normal[0] * VIEW[0] + normal[1] * VIEW[1] + normal[2] * VIEW[2] <= 0) continue;
    faces.push({
      points: [project(a[0], a[1], a[2]), project(b[0], b[1], b[2]), project(c[0], c[1], c[2])],
      depth: a[0] + a[1] + a[2] + b[0] + b[1] + b[2] + c[0] + c[1] + c[2],
      shade: Math.abs(normal[2]) > 0.5 ? FACE_LIGHT : FACE_DARK,
    });
  }
  faces.sort((left, right) => left.depth - right.depth);
  return faces;
}

type Silhouette = [[number, number], [number, number]][];

/** Edges where the surface turns sharply, which read as the body's outline. */
function featureEdges(mesh: BodyMesh): Silhouette {
  const normals = mesh.triangles.map((triangle) => {
    const a = mesh.vertices[triangle[0]] as [number, number, number];
    const b = mesh.vertices[triangle[1]] as [number, number, number];
    const c = mesh.vertices[triangle[2]] as [number, number, number];
    return normalOf(a, b, c);
  });
  const shared = new Map<string, number[]>();
  mesh.triangles.forEach((triangle, index) => {
    for (let i = 0; i < 3; i += 1) {
      const from = triangle[i] as number;
      const to = triangle[(i + 1) % 3] as number;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const list = shared.get(key);
      if (list) list.push(index);
      else shared.set(key, [index]);
    }
  });
  const edges: Silhouette = [];
  for (const [key, owners] of shared) {
    const [fromText, toText] = key.split(':');
    const from = mesh.vertices[Number(fromText)] as [number, number, number];
    const to = mesh.vertices[Number(toText)] as [number, number, number];
    if (!from || !to) continue;
    if (owners.length !== 2) continue;
    const first = normals[owners[0] as number] as [number, number, number];
    const second = normals[owners[1] as number] as [number, number, number];
    const alignment = first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
    if (alignment >= 0.94) continue;
    edges.push([project(from[0], from[1], from[2]), project(to[0], to[1], to[2])]);
  }
  return edges;
}

type Laid = { faces: Projected[]; edges: Silhouette; width: number; height: number; label: string | null };

function boundsOf(faces: Projected[], edges: Silhouette): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (point: [number, number]): void => {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  };
  for (const face of faces) face.points.forEach(visit);
  for (const edge of edges) edge.forEach(visit);
  return { minX, minY, maxX, maxY };
}

export type BodyLabel = { text: string; x: number; y: number };

/** Draws every body once, left to right, and reports where their labels belong. */
export function drawBodies(canvas: HTMLCanvasElement, items: BodyItem[]): BodyLabel[] {
  const context = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  if (!context || items.length === 0) return [];
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const laid: Laid[] = items.map((item) => {
    const faces = faceList(item.mesh);
    const edges = featureEdges(item.mesh);
    const bounds = boundsOf(faces, edges);
    const shiftX = -bounds.minX;
    const shiftY = -bounds.minY;
    for (const face of faces) {
      face.points = face.points.map(([x, y]) => [x + shiftX, y + shiftY] as [number, number]);
    }
    const shifted: Silhouette = edges.map(([a, b]) => [
      [a[0] + shiftX, a[1] + shiftY],
      [b[0] + shiftX, b[1] + shiftY],
    ]);
    return {
      faces,
      edges: shifted,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      label: item.label,
    };
  });

  const gap = 24;
  const totalWidth = laid.reduce((sum, item) => sum + item.width, 0) + gap * (laid.length - 1);
  const tallest = Math.max(...laid.map((item) => item.height));
  const margin = 56;
  const scale = Math.min(
    (width - margin * 2) / Math.max(totalWidth, 1),
    (height - margin * 2) / Math.max(tallest, 1),
    6,
  );
  let cursor = (width - totalWidth * scale) / 2;
  const baseline = (height + tallest * scale) / 2;
  const labels: BodyLabel[] = [];

  for (const item of laid) {
    const originX = cursor;
    const originY = baseline - item.height * scale;
    const place = ([x, y]: [number, number]): [number, number] => [
      originX + x * scale,
      originY + y * scale,
    ];
    for (const face of item.faces) {
      const [p0, p1, p2] = face.points.map(place) as [[number, number], [number, number], [number, number]];
      context.beginPath();
      context.moveTo(p0[0], p0[1]);
      context.lineTo(p1[0], p1[1]);
      context.lineTo(p2[0], p2[1]);
      context.closePath();
      context.fillStyle = face.shade;
      context.fill();
    }
    context.strokeStyle = EDGE;
    context.lineWidth = 1;
    context.beginPath();
    for (const [a, b] of item.edges) {
      const from = place(a);
      const to = place(b);
      context.moveTo(from[0], from[1]);
      context.lineTo(to[0], to[1]);
    }
    context.stroke();
    if (item.label !== null) {
      labels.push({
        text: item.label,
        x: originX + (item.width * scale) / 2,
        y: baseline + 14,
      });
    }
    cursor += (item.width + gap) * scale;
  }
  return labels;
}
