import { Group, Mesh, PerspectiveCamera, Vector3 } from "three";
import { TOY_COLOURS } from "../starters";
import { frameCamera, type Framing } from "./camera";
import { token, tint } from "./colour";
import { drawScene } from "./gl";
import { createStage, hexagonPoints, polygonShape, prism, toyMaterial, withRoundHole } from "./toys";

/** The 3D Workshop preview's part: a hex nut, in scene units. */
export const PART_SIZES = { circumradius: 34, hole: 14, height: 22 } as const;

export const PART_FRAMING: Framing = { azimuth: 18, elevation: 34, fov: 30, halfWidth: 84, halfHeight: 56, target: [0, 0, 8] };

/** One full turn of the preview part. */
export const PART_TURN_MS = 18000;
/** The three-quarter pose shown while the preview is paused or the device asks for reduced motion. */
export const PART_REST_MS = 3200;

export const partTurn = (ms: number): number => (ms / PART_TURN_MS) * Math.PI * 2;

interface PartScene {
  draw: (canvas: HTMLCanvasElement, ms: number) => void;
}

/** A hex nut turning on the workplane, wrapped in the selection box and corner handles the 3D Workshop draws. */
function createPartScene(): PartScene {
  const stage = createStage({ centre: tint(token("--cobalt"), 0.7), line: tint(token("--cobalt"), 0.86) });
  const camera = new PerspectiveCamera();
  const { circumradius, hole, height } = PART_SIZES;
  const nut = new Mesh(prism(withRoundHole(polygonShape(hexagonPoints(circumradius)), hole), height), toyMaterial(TOY_COLOURS.green));
  nut.castShadow = true;
  const turning = new Group();
  turning.add(nut);
  stage.scene.add(turning);

  const half = (circumradius * Math.sqrt(3)) / 2;
  const corners = [0, height].flatMap((z) => [[-circumradius, -half], [circumradius, -half], [circumradius, half], [-circumradius, half]].map(([x, y]) => new Vector3(x, y, z)));
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const cobalt = token("--cobalt");

  return {
    draw(canvas, ms) {
      turning.rotation.z = partTurn(ms);
      turning.updateMatrixWorld(true);
      frameCamera(camera, canvas.width / canvas.height, PART_FRAMING);
      const context = drawScene(canvas, stage.scene, camera);
      if (!context) return;
      const scale = canvas.width / canvas.clientWidth;
      const points = corners.map((corner) => {
        const ndc = corner.clone().applyMatrix4(turning.matrixWorld).project(camera);
        return { x: ((ndc.x + 1) / 2) * canvas.width, y: ((1 - ndc.y) / 2) * canvas.height };
      });
      context.strokeStyle = cobalt;
      context.lineWidth = 1.5 * scale;
      context.beginPath();
      for (const [from, to] of edges) {
        const a = points[from];
        const b = points[to];
        if (!a || !b) continue;
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      }
      context.stroke();
      const handle = 9 * scale;
      context.fillStyle = "#ffffff";
      for (const point of points) {
        context.fillRect(point.x - handle / 2, point.y - handle / 2, handle, handle);
        context.strokeRect(point.x - handle / 2, point.y - handle / 2, handle, handle);
      }
    },
  };
}

let scene: PartScene | undefined;

/** The one part scene of the 3D Workshop preview, made on first use. */
export function sharedPartScene(): PartScene {
  scene ??= createPartScene();
  return scene;
}
