import {
  AmbientLight, BufferGeometry, CanvasTexture, DirectionalLight, DoubleSide, ExtrudeGeometry, GridHelper, HemisphereLight, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, Path, PlaneGeometry, RepeatWrapping, Scene, Shape, ShadowMaterial, SRGBColorSpace,
} from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

/** Smallest angle (radians) between faces that still shades as a hard edge. */
const CREASE = 0.6;
const BEVEL = 1.6;
const CURVE_SEGMENTS = 64;

export type Point = readonly [number, number];

/** A solid prism of `height` standing on z = 0, with softly bevelled edges that keep the outline's size. */
export function prism(outline: Shape, height: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(outline, {
    depth: height - 2 * BEVEL, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelOffset: -BEVEL,
    bevelSegments: 4, curveSegments: CURVE_SEGMENTS, steps: 1,
  });
  geometry.translate(0, 0, BEVEL);
  return toCreasedNormals(geometry, CREASE);
}

export function polygonShape(points: readonly Point[]): Shape {
  const shape = new Shape();
  points.forEach(([x, y], index) => (index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

export function circleShape(radius: number): Shape {
  const shape = new Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

export function roundedRectShape(width: number, depth: number, radius: number): Shape {
  const x = width / 2;
  const y = depth / 2;
  const shape = new Shape();
  shape.moveTo(-x + radius, -y);
  shape.lineTo(x - radius, -y);
  shape.absarc(x - radius, -y + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(x, y - radius);
  shape.absarc(x - radius, y - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-x + radius, y);
  shape.absarc(-x + radius, y - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-x, -y + radius);
  shape.absarc(-x + radius, -y + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

export function hexagonPoints(circumradius: number): Point[] {
  return Array.from({ length: 6 }, (_, corner): Point => [Math.cos((corner * Math.PI) / 3) * circumradius, Math.sin((corner * Math.PI) / 3) * circumradius]);
}

/** Cuts a round hole straight through a shape. */
export function withRoundHole(outline: Shape, radius: number): Shape {
  const hole = new Path();
  hole.absarc(0, 0, radius, 0, Math.PI * 2, true);
  outline.holes.push(hole);
  return outline;
}

/** A right-angled wedge: `run` along x, `rise` along z, `width` along y, centred on y = 0 and standing on z = 0. */
export function wedgeGeometry(run: number, rise: number, width: number): BufferGeometry {
  const geometry = prism(polygonShape([[-run / 2, 0], [run / 2, 0], [-run / 2, rise]]), width);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, width / 2, 0);
  return geometry;
}

const materials = new Map<string, MeshPhysicalMaterial>();

/** Glossy toy plastic in one of the toy primaries. */
export function toyMaterial(colour: string): MeshPhysicalMaterial {
  const cached = materials.get(colour);
  if (cached) return cached;
  const material = new MeshPhysicalMaterial({ color: colour, roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.28 });
  materials.set(colour, material);
  return material;
}

/** Translucent grey with diagonal stripes: how every hole is drawn. */
export function holeMaterial(repeat: { around: number; along: number }): MeshBasicMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(139, 148, 163, 0.4)";
    context.fillRect(0, 0, 64, 64);
    context.strokeStyle = "rgba(100, 110, 128, 0.75)";
    context.lineWidth = 9;
    for (let offset = -64; offset <= 64; offset += 32) {
      context.beginPath();
      context.moveTo(offset, 64);
      context.lineTo(offset + 64, 0);
      context.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat.around, repeat.along);
  return new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: DoubleSide });
}

interface Stage {
  scene: Scene;
  grid: GridHelper;
}

/** Lights, a soft shadow on the ground and a workplane grid: the set every toy render stands on. */
export function createStage(gridColours: { centre: string; line: string }): Stage {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x9db4d6, 1.25));
  scene.add(new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xffffff, 2.3);
  key.position.set(-80, -110, 170);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -170;
  key.shadow.camera.right = 170;
  key.shadow.camera.top = 170;
  key.shadow.camera.bottom = -170;
  key.shadow.camera.far = 600;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.6;
  key.shadow.radius = 5;
  scene.add(key);
  const fill = new DirectionalLight(0xc4dcff, 0.8);
  fill.position.set(120, -60, 60);
  scene.add(fill);
  const ground = new Mesh(new PlaneGeometry(900, 900), new ShadowMaterial({ opacity: 0.22 }));
  ground.position.z = 0.02;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new GridHelper(480, 24, gridColours.centre, gridColours.line);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  return { scene, grid };
}
