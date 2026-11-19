import type { PerspectiveCamera } from "three";

export interface Framing {
  /** Degrees around the vertical axis (0 looks along +y) and above the ground. */
  azimuth: number;
  elevation: number;
  fov: number;
  /** World extent that must fit on each side of the target, measured at the target. */
  halfWidth: number;
  halfHeight: number;
  /** The point the camera looks at. */
  target: readonly [number, number, number];
}

/** Places a z-up camera so the framing's half extents fit the canvas, whatever its aspect ratio. */
export function frameCamera(camera: PerspectiveCamera, aspect: number, framing: Framing): void {
  const tan = Math.tan((framing.fov * Math.PI) / 360);
  const distance = Math.max(framing.halfHeight / tan, framing.halfWidth / (tan * aspect));
  const azimuth = (framing.azimuth * Math.PI) / 180;
  const elevation = (framing.elevation * Math.PI) / 180;
  const [x, y, z] = framing.target;
  camera.fov = framing.fov;
  camera.aspect = aspect;
  camera.near = 10;
  camera.far = 2400;
  camera.up.set(0, 0, 1);
  camera.position.set(x + distance * Math.sin(azimuth) * Math.cos(elevation), y - distance * Math.cos(azimuth) * Math.cos(elevation), z + distance * Math.sin(elevation));
  camera.lookAt(x, y, z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
