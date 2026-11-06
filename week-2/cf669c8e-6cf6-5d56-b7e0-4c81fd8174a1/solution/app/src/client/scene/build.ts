import * as THREE from 'three';
import type { Primitive, ScenePart } from '../../shared/parts.js';

THREE.ColorManagement.enabled = false;

export const COLOURS = {
  ground: 0xf4efe4,
  ink: 0x1b1a17,
  accent: 0xb3321b,
  body: 0xe3dccb,
  struct: 0xd6cdb8,
  mech: 0xcbc1a8,
  kit: 0xbfb394,
  selected: 0xf4efe4,
  rim: 0xeae3d3,
} as const;

const unitBox = new THREE.BoxGeometry(1, 1, 1);

export interface PartObject {
  id: string;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  fills: THREE.MeshBasicMaterial[];
  lines: THREE.LineBasicMaterial[];
  tones: number[];
  base: THREE.Vector3;
  /** Extent of the drawn part along its dimension axis, in whole millimetres. */
  dimensionMm: number;
  dimensionAxis: 'x' | 'y' | 'z';
}

interface RailGuides {
  ground: THREE.LineSegments;
  railLine: THREE.Line;
  ticks: THREE.LineSegments;
  feeler: THREE.Mesh;
  feelerEdge: THREE.LineLoop;
  foul: THREE.Mesh;
}

export interface MopedScene {
  scene: THREE.Scene;
  parts: Map<string, PartObject>;
  guides: RailGuides;
  meshCount: number;
}

export function buildMoped(parts: readonly ScenePart[]): MopedScene {
  const scene = new THREE.Scene();
  const out = new Map<string, PartObject>();
  let meshCount = 0;
  for (const part of parts) {
    const group = new THREE.Group();
    group.name = part.id;
    const inner = new THREE.Group();
    inner.rotation.y = THREE.MathUtils.degToRad(part.tiltYDeg);
    group.add(inner);
    const object: PartObject = {
      id: part.id, group, meshes: [], fills: [], lines: [], tones: [], base: new THREE.Vector3(...part.position),
      dimensionMm: 0, dimensionAxis: part.dimensionAxis,
    };
    for (const primitive of part.primitives) {
      const tone = COLOURS[primitive.tone ?? part.tone];
      const geometry = geometryOf(primitive);
      const fill = new THREE.MeshBasicMaterial({ color: tone, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(geometry, fill);
      if (primitive.at) mesh.position.set(...primitive.at);
      mesh.userData['partId'] = part.id;
      const edgeMaterial = new THREE.LineBasicMaterial({ color: COLOURS.ink });
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24), edgeMaterial));
      inner.add(mesh);
      object.meshes.push(mesh);
      object.fills.push(fill);
      object.lines.push(edgeMaterial);
      object.tones.push(tone);
      meshCount += 1;
    }
    group.position.copy(object.base);
    scene.add(group);
    group.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    object.dimensionMm = Math.round(size[object.dimensionAxis]);
    out.set(part.id, object);
  }
  return { scene, parts: out, guides: addGuides(scene), meshCount };
}

function geometryOf(primitive: Primitive): THREE.BufferGeometry {
  switch (primitive.kind) {
    case 'box': return unitBox.clone().scale(...primitive.size);
    case 'cylinder': return cylinder(primitive);
    case 'profile': return extruded(primitive);
  }
}

function cylinder(primitive: Extract<Primitive, { kind: 'cylinder' }>): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(primitive.radius, primitive.radius, primitive.length, primitive.segments ?? 28);
  if (primitive.axis === 'x') geometry.rotateZ(Math.PI / 2);
  if (primitive.axis === 'z') geometry.rotateX(Math.PI / 2);
  return geometry;
}

function extruded(primitive: Extract<Primitive, { kind: 'profile' }>): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const round = primitive.round ?? 0;
  const { points } = primitive;
  points.forEach(([x, z], i) => {
    const toward = ([px, pz]: [number, number]): [number, number] => {
      const length = Math.hypot(px - x, pz - z);
      const reach = Math.min(round, length / 2) / length;
      return [x + (px - x) * reach, z + (pz - z) * reach];
    };
    const [inX, inZ] = toward(points[(i + points.length - 1) % points.length]);
    const [outX, outZ] = toward(points[(i + 1) % points.length]);
    if (i === 0) shape.moveTo(inX, inZ);
    else shape.lineTo(inX, inZ);
    shape.quadraticCurveTo(x, z, outX, outZ);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: primitive.width, bevelEnabled: false, curveSegments: 6 });
  geometry.translate(0, 0, -primitive.width / 2);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function addGuides(scene: THREE.Scene): RailGuides {
  const railLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
    new THREE.LineDashedMaterial({ color: COLOURS.ink, dashSize: 14, gapSize: 9, depthTest: false }));
  railLine.renderOrder = 1020;
  railLine.visible = false;
  const ticks = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLOURS.ink, depthTest: false }));
  ticks.renderOrder = 1020;
  ticks.visible = false;
  const feeler = new THREE.Mesh(unitBox.clone(), new THREE.MeshBasicMaterial({ color: COLOURS.ground, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
  feeler.renderOrder = 1021;
  feeler.visible = false;
  const feelerEdge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -0.5, -0.5), new THREE.Vector3(0, 0.5, -0.5), new THREE.Vector3(0, 0.5, 0.5), new THREE.Vector3(0, -0.5, 0.5),
  ]), new THREE.LineBasicMaterial({ color: COLOURS.ink, depthTest: false }));
  feelerEdge.renderOrder = 1022;
  feelerEdge.visible = false;
  // In the transparent pass, so that a faded panel never paints over the flat fill.
  const foul = new THREE.Mesh(unitBox.clone(), new THREE.MeshBasicMaterial({ color: COLOURS.accent, transparent: true, depthTest: false, depthWrite: false }));
  foul.renderOrder = 1023;
  foul.visible = false;
  const groundPoints: THREE.Vector3[] = [new THREE.Vector3(-260, 0, 0), new THREE.Vector3(1500, 0, 0)];
  for (let x = -220; x <= 1500; x += 90) groundPoints.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x - 55, 0, -45));
  const ground = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(groundPoints), new THREE.LineBasicMaterial({ color: COLOURS.ink, depthTest: false }));
  ground.renderOrder = -10;
  scene.add(ground, railLine, ticks, feeler, feelerEdge, foul);
  return { ground, railLine, ticks, feeler, feelerEdge, foul };
}
