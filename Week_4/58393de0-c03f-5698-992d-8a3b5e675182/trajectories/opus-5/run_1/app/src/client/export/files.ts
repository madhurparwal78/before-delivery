import type { CircuitComponent, CircuitWire, SceneObject } from '../../shared/types.js';
import { meshBox, triangleNormal, type Mesh, type Vec3 } from '../geom/mesh.js';
import { weldMesh } from '../geom/weld.js';
import { computeGroupResult, flattenMembers } from '../geom/scene.js';

export const MM_PER_INCH = 25.4;

/** The whole design: every top-level solid unioned and every top-level hole subtracted. */
export const designMesh = (objects: SceneObject[]): Mesh => {
  const members = objects.flatMap((object) =>
    object.kind === 'group'
      ? flattenMembers(object).map((member) => ({
          ...member,
          mode: object.mode === 'hole' ? ('hole' as const) : member.mode,
        }))
      : [object],
  );
  return weldMesh(computeGroupResult(members).mesh);
};

export const scaleMesh = (mesh: Mesh, divisor: number): Mesh =>
  divisor === 1
    ? mesh
    : {
        triangles: mesh.triangles.map((triangle) => ({
          a: triangle.a.map((value) => value / divisor) as Vec3,
          b: triangle.b.map((value) => value / divisor) as Vec3,
          c: triangle.c.map((value) => value / divisor) as Vec3,
        })),
      };

/** Binary little-endian STL with an 80-byte header that starts with `Quarkyard`. */
export const buildStl = (mesh: Mesh): Uint8Array => {
  const count = mesh.triangles.length;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  const header = new Uint8Array(buffer, 0, 80);
  header.set(new TextEncoder().encode('Quarkyard binary STL export').subarray(0, 80));
  view.setUint32(80, count, true);
  let at = 84;
  for (const triangle of mesh.triangles) {
    const normal = triangleNormal(triangle);
    view.setFloat32(at, normal[0], true);
    view.setFloat32(at + 4, normal[1], true);
    view.setFloat32(at + 8, normal[2], true);
    at += 12;
    for (const corner of [triangle.a, triangle.b, triangle.c]) {
      view.setFloat32(at, corner[0], true);
      view.setFloat32(at + 4, corner[1], true);
      view.setFloat32(at + 8, corner[2], true);
      at += 12;
    }
    view.setUint16(at, 0, true);
    at += 2;
  }
  return new Uint8Array(buffer);
};

const format = (value: number): string => {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

const vertexKey = (point: Vec3): string => `${format(point[0])} ${format(point[1])} ${format(point[2])}`;

/** Text OBJ with one `o` and triangle `f` lines using 1-based indices. */
export const buildObj = (mesh: Mesh, name: string): string => {
  const indices = new Map<string, number>();
  const vertexLines: string[] = [];
  const faceLines: string[] = [];
  const indexOf = (point: Vec3): number => {
    const key = vertexKey(point);
    const known = indices.get(key);
    if (known !== undefined) return known;
    vertexLines.push(`v ${key}`);
    const next = vertexLines.length;
    indices.set(key, next);
    return next;
  };
  for (const triangle of mesh.triangles) {
    faceLines.push(`f ${indexOf(triangle.a)} ${indexOf(triangle.b)} ${indexOf(triangle.c)}`);
  }
  return ['# Quarkyard export', `o ${name}`, ...vertexLines, ...faceLines, ''].join('\n');
};

const svgNumber = (value: number, unit: 'mm' | 'in'): string => {
  const decimals = unit === 'mm' ? 3 : 5;
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
};

/** The design's top view, sized to the bounding box in the chosen unit. */
export const buildSvg3d = (mesh: Mesh, objects: SceneObject[], unit: 'mm' | 'in'): string => {
  const box = meshBox(mesh);
  const divisor = unit === 'in' ? MM_PER_INCH : 1;
  const widthMm = box.max[0] - box.min[0];
  const heightMm = box.max[1] - box.min[1];
  const width = svgNumber(widthMm / divisor, unit);
  const height = svgNumber(heightMm / divisor, unit);
  const shapes: string[] = [];
  for (const member of objects.flatMap((object) => flattenMembers(object))) {
    const fill = member.mode === 'hole' ? '#9aa4b2' : member.color;
    const opacity = member.mode === 'hole' ? '0.55' : '1';
    const cx = member.x - box.min[0];
    const cy = box.max[1] - member.y;
    if (member.kind === 'cylinder' || member.kind === 'sphere') {
      shapes.push(
        `  <circle cx="${svgNumber(cx, 'mm')}" cy="${svgNumber(cy, 'mm')}" r="${svgNumber(member.w / 2, 'mm')}" fill="${fill}" fill-opacity="${opacity}" />`,
      );
    } else {
      const radians = (member.rotationZ * Math.PI) / 180;
      const points = (
        [
          [-member.w / 2, -member.d / 2],
          [member.w / 2, -member.d / 2],
          [member.w / 2, member.d / 2],
          [-member.w / 2, member.d / 2],
        ] as [number, number][]
      )
        .map(([x, y]) => {
          const rx = x * Math.cos(radians) - y * Math.sin(radians);
          const ry = x * Math.sin(radians) + y * Math.cos(radians);
          return `${svgNumber(cx + rx, 'mm')},${svgNumber(cy - ry, 'mm')}`;
        })
        .join(' ');
      shapes.push(`  <polygon points="${points}" fill="${fill}" fill-opacity="${opacity}" />`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}${unit}" height="${height}${unit}" viewBox="0 0 ${svgNumber(widthMm, 'mm')} ${svgNumber(heightMm, 'mm')}">
  <title>Quarkyard top view</title>
${shapes.join('\n')}
</svg>
`;
};

/** A circuit's wiring diagram on an A4 page. */
export const buildSvgCircuit = (components: CircuitComponent[], wires: CircuitWire[]): string => {
  const spots = new Map<string, { x: number; y: number }>();
  components.forEach((component, index) => {
    spots.set(component.label, { x: 40 + (index % 4) * 60, y: 40 + Math.floor(index / 4) * 50 });
  });
  const parts: string[] = [];
  for (const component of components) {
    const spot = spots.get(component.label);
    if (!spot) continue;
    parts.push(
      `  <rect x="${spot.x}" y="${spot.y}" width="40" height="24" rx="4" fill="#ffffff" stroke="#1552f0" stroke-width="1" />`,
      `  <text x="${spot.x + 20}" y="${spot.y + 16}" font-family="Fira Sans" font-size="7" text-anchor="middle" fill="#14181f">${component.label}</text>`,
    );
  }
  for (const wire of wires) {
    const from = spots.get(wire.from.slice(0, -1));
    const to = spots.get(wire.to.slice(0, -1));
    if (!from || !to) continue;
    parts.push(
      `  <path d="M ${from.x + 20} ${from.y + 24} L ${from.x + 20} ${from.y + 34} L ${to.x + 20} ${to.y + 34} L ${to.x + 20} ${to.y + 24}" fill="none" stroke="#2742a6" stroke-width="1.2" />`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">
  <title>Quarkyard wiring diagram</title>
  <rect x="0" y="0" width="297" height="210" fill="#ffffff" />
${parts.join('\n')}
</svg>
`;
};

/** The file name rule: lowercased, runs of other characters become one hyphen. */
export const exportFileName = (projectName: string, format: 'stl' | 'obj' | 'svg'): string => {
  const stem = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${stem === '' ? 'design' : stem}.${format}`;
};
