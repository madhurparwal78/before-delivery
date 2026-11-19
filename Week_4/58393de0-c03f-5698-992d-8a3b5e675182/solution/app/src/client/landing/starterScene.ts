import { Box3, Group, Mesh, PerspectiveCamera, Vector3 } from "three";
import type { DesignObject, Snapshot3d } from "../../shared/types";
import { geometryJob, primitiveMesh, type MeshData } from "../geometry";
import { creaseGeometry } from "../render/creaseGeometry";
import { frameCamera } from "./camera";
import { token, tint } from "./colour";
import { drawScene } from "./gl";
import { createStage, toyMaterial } from "./toys";

/** One starter model turns once every 25 seconds (the brief allows 20 to 30). */
export const STARTER_TURN_MS = 25000;
/** The three-quarter pose shown while paused or under reduced motion. */
export const STARTER_REST_MS = 3500;

export interface StarterScene {
  draw: (canvas: HTMLCanvasElement, ms: number) => void;
}

const overlaps = (solid: DesignObject, hole: DesignObject): boolean =>
  (["x", "y", "z"] as const).every((axis) => {
    const size = axis === "x" ? "w" : axis === "y" ? "d" : "h";
    return Math.abs(solid[axis] - hole[axis]) < (solid[size] + hole[size]) / 2;
  });

/** The solid's mesh with every hole that touches it carved out by the geometry worker, or its plain primitive when none does. */
async function carved(solid: DesignObject, holes: DesignObject[]): Promise<MeshData | null> {
  const touching = holes.filter((hole) => overlaps(solid, hole));
  if (touching.length === 0) return primitiveMesh(solid);
  const { x, y, z, w, d, h } = solid;
  return geometryJob("resolveObject", { id: `${solid.id}-carved`, kind: "group", mode: "solid", x, y, z, w, d, h, rotationZ: 0, color: solid.color, children: [solid, ...touching] });
}

/**
 * Builds the starter's model: every solid with the holes it touches carved out, in its own toy colour. The scene is
 * ready once the geometry worker has answered, so this resolves later than the page paints.
 */
export async function createStarterScene(snapshot: Snapshot3d): Promise<StarterScene> {
  const solids = snapshot.objects.filter((object) => object.mode === "solid");
  const holes = snapshot.objects.filter((object) => object.mode === "hole");
  const stage = createStage({ centre: tint(token("--cobalt"), 0.7), line: tint(token("--cobalt"), 0.86) });
  stage.grid.visible = false;
  const camera = new PerspectiveCamera();
  const model = new Group();
  for (const solid of solids) {
    const mesh = await carved(solid, holes);
    if (!mesh) continue;
    const part = new Mesh(creaseGeometry(mesh, 1), toyMaterial(solid.color));
    part.castShadow = true;
    model.add(part);
  }
  const bounds = new Box3().setFromObject(model);
  const centre = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  model.position.set(-centre.x, -centre.y, 0);
  const turning = new Group();
  turning.add(model);
  stage.scene.add(turning);
  const reach = Math.hypot(size.x, size.y) / 2;
  const framing = { azimuth: 0, elevation: 30, fov: 28, halfWidth: reach * 1.3, halfHeight: Math.max(size.z * 0.72, reach * 0.62), target: [0, 0, size.z * 0.46] } as const;

  return {
    draw(canvas, ms) {
      turning.rotation.z = (ms / STARTER_TURN_MS) * Math.PI * 2;
      frameCamera(camera, canvas.width / canvas.height, framing);
      drawScene(canvas, stage.scene, camera);
    },
  };
}
