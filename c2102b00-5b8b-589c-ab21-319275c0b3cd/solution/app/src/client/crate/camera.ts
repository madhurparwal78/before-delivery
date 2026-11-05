// The crate's one camera: the home view, fitted so the whole box (and the lid, however it stands)
// stays inside a 4:3 picture at every turn from -75 to 75 degrees.
import { PerspectiveCamera, Vector3 } from "three";
import { BOX } from "./model.js";

/** The home view: looking down at 55 degrees, from the front. */
const HOME_ELEVATION = (55 * Math.PI) / 180;
const FIELD_OF_VIEW = 24;
/** The lid is fitted a little way open: the first frames of its swing may reach past the picture. */
const LID_FIT_DEG = 16;

function fitCamera(camera: PerspectiveCamera): void {
  const { w, d, h } = BOX;
  const points: Vector3[] = [];
  for (const x of [-w / 2, w / 2]) {
    for (const y of [0, h]) for (const z of [-d / 2, d / 2]) points.push(new Vector3(x, y, z));
    const open = (LID_FIT_DEG * Math.PI) / 180;
    for (const reach of [0, d]) points.push(new Vector3(x, h + reach * Math.sin(open), -d / 2 + reach * Math.cos(open)));
  }
  const target = new Vector3(0, h * 0.8, 0);
  let distance = 12;
  const tilt = new Vector3(0, Math.sin(HOME_ELEVATION), Math.cos(HOME_ELEVATION));
  for (let pass = 0; pass < 12; pass++) {
    camera.position.copy(target).addScaledVector(tilt, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let turn = -75; turn <= 75; turn += 15) {
      const angle = (turn * Math.PI) / 180;
      for (const p of points) {
        const q = p.clone().applyAxisAngle(new Vector3(0, 1, 0), angle).project(camera);
        [minX, maxX, minY, maxY] = [Math.min(minX, q.x), Math.max(maxX, q.x), Math.min(minY, q.y), Math.max(maxY, q.y)];
      }
    }
    const reach = distance * Math.tan((FIELD_OF_VIEW * Math.PI) / 360);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(up, ((minY + maxY) / 2) * reach).addScaledVector(right, ((minX + maxX) / 2) * reach * camera.aspect);
    distance *= Math.max((maxX - minX) / 2 / camera.aspect, (maxY - minY) / 2) / 0.95;
  }
}


export function homeCamera(aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, aspect, 0.5, 60);
  fitCamera(camera);
  return camera;
}
