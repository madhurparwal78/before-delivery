import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
  type Object3D,
} from "three";
import type { SceneObject } from "../../shared/doc";
import type { LoadedModel } from "./models";

export const STAGE = {
  sky: 0x87ceeb,
  grass: 0x3b8a36,
  woodLight: 0xb98a55,
  woodDark: 0x8d6238,
  cart: 0xf28b5e,
  bob: 0xef5f7a,
  frame: 0x4a4e5c,
  crate: 0xc9a26b,
  accent: 0x89b4fa,
};

const material = (color: number): MeshLambertMaterial => new MeshLambertMaterial({ color });

export function makeCart(): Group {
  const cart = new Group();
  const body = new Mesh(new CapsuleGeometry(0.1, 0.3, 4, 10), material(STAGE.cart));
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.16;
  cart.add(body);
  for (const x of [-0.14, 0.14]) {
    const wheel = new Mesh(new CapsuleGeometry(0.05, 0.12, 3, 8), material(STAGE.frame));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.05, 0);
    cart.add(wheel);
  }
  return cart;
}

export function makeWedge(length: number, angleDeg: number, width: number): Mesh {
  const angle = (angleDeg * Math.PI) / 180;
  const run = length * Math.cos(angle);
  const rise = length * Math.sin(angle);
  const shape = new Shape();
  shape.moveTo(-run / 2, 0);
  shape.lineTo(run / 2, 0);
  shape.lineTo(-run / 2, rise);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.translate(0, 0, -width / 2);
  const mesh = new Mesh(geometry, material(STAGE.woodLight));
  mesh.add(new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: STAGE.woodDark })));
  return mesh;
}

function makeRod(): Mesh {
  const rod = new Mesh(new CylinderGeometry(0.012, 0.012, 1, 6), material(STAGE.frame));
  rod.visible = true;
  return rod;
}

const UP = new Vector3(0, 1, 0);

export interface RigView {
  /** Static parts, placed with the object's own transform. */
  group: Group;
  /** The moving part, placed from the simulation pose in world space. */
  body: Object3D | null;
  rod: Mesh | null;
  pivot: Vector3 | null;
  kind: SceneObject["kind"];
  /** Half-height lift of the body above the pose point (for crates, boxes stand on the pose). */
  dispose: () => void;
}

function tag(root: Object3D, id: string): void {
  root.traverse((o) => {
    o.userData.objectId = id;
  });
}

export function buildRig(object: SceneObject, models: ReadonlyMap<string, LoadedModel>): RigView {
  const group = new Group();
  group.position.set(...object.position);
  group.quaternion.set(...object.rotation);
  let body: Object3D | null = null;
  let rod: Mesh | null = null;
  let pivot: Vector3 | null = null;
  if (object.kind === "ramp") {
    group.scale.set(...object.scale);
    group.add(makeWedge(object.params.length_m, object.params.angle_deg, 0.8));
    body = makeCart();
  } else if (object.kind === "pendulum") {
    const height = Math.max(object.position[1], 0.5);
    const rail = (x: number): Mesh => {
      const post = new Mesh(new CylinderGeometry(0.025, 0.025, height + 0.05, 8), material(STAGE.frame));
      post.position.set(0, -height / 2 + 0.025, x);
      return post;
    };
    group.add(rail(-0.35), rail(0.35));
    const beam = new Mesh(new CylinderGeometry(0.025, 0.025, 0.74, 8), material(STAGE.frame));
    beam.rotation.x = Math.PI / 2;
    group.add(beam);
    rod = makeRod();
    pivot = new Vector3(...object.position);
    body = new Mesh(new SphereGeometry(0.06 + 0.05 * Math.cbrt(object.params.mass_kg), 20, 14), material(STAGE.bob));
  } else if (object.kind === "launcher") {
    const base = new Mesh(new BoxGeometry(0.5, 0.12, 0.4), material(STAGE.frame));
    base.position.y = 0.06;
    const height = object.params.height_m;
    const angle = (object.params.launch_angle_deg * Math.PI) / 180;
    const tube = new Mesh(new CylinderGeometry(0.05, 0.06, 0.5, 14), material(STAGE.woodDark));
    tube.rotation.z = angle - Math.PI / 2;
    tube.position.set(Math.cos(angle) * -0.05, height - Math.sin(angle) * 0.05, 0);
    const post = new Mesh(new CylinderGeometry(0.02, 0.02, Math.max(height, 0.05), 6), material(STAGE.frame));
    post.position.set(0, Math.max(height, 0.05) / 2, 0);
    group.add(base, post, tube);
    body = new Mesh(new SphereGeometry(0.07, 14, 10), material(STAGE.cart));
  } else if (object.kind === "crate") {
    const box = new Mesh(new BoxGeometry(object.scale[0], object.scale[1], object.scale[2]), material(STAGE.crate));
    box.add(new LineSegments(new EdgesGeometry(box.geometry), new LineBasicMaterial({ color: STAGE.woodDark })));
    body = box;
  } else if (object.assetId !== null) {
    group.scale.set(...object.scale);
    const model = models.get(object.assetId);
    if (model) group.add(model.template.clone(true));
  }
  tag(group, object.id);
  if (body) tag(body, object.id);
  if (rod) tag(rod, object.id);
  return {
    group,
    body,
    rod,
    pivot,
    kind: object.kind,
    dispose: () => undefined,
  };
}

const scratch = new Vector3();
const quat = new Quaternion();

/** Places the moving part of a rig from its simulation pose. */
export function poseRig(view: RigView, object: SceneObject, position: [number, number, number], rotation: [number, number, number, number]): void {
  if (!view.body) return;
  quat.set(...rotation);
  if (object.kind === "crate") {
    view.body.position.set(position[0], position[1] + object.scale[1] / 2, position[2]);
    view.body.quaternion.copy(quat);
  } else {
    view.body.position.set(...position);
    view.body.quaternion.copy(quat);
  }
  if (object.kind === "ramp") view.body.scale.setScalar(1);
  if (view.rod && view.pivot) {
    const bob = scratch.set(...position);
    const direction = bob.clone().sub(view.pivot);
    const length = Math.max(direction.length(), 0.001);
    view.rod.position.copy(view.pivot).addScaledVector(direction, 0.5);
    view.rod.scale.set(1, length, 1);
    view.rod.quaternion.setFromUnitVectors(UP, direction.normalize());
  }
}
