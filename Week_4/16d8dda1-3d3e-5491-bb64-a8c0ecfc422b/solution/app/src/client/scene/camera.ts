import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_GLIDE_MS, frontWallZ, type Room } from './geometry';
import { Transition } from './tween';

export interface Pose {
  position: Vector3;
  target: Vector3;
}

const FIELD_OF_VIEW = 40;
const PIVOT = new Vector3(0, 0.5, 0);
const AZIMUTH_LIMIT = Math.PI / 6;
const ELEVATION_LIMIT = 0.17;
const UP = new Vector3(0, 1, 0);

/** Front-right overlooking the whole room (teachers and learners without a seat). */
export function overviewPose(room: Room, aspect: number): Pose {
  const vertical = (FIELD_OF_VIEW * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = Math.max((room.columns * 0.62) / Math.tan(horizontal / 2), (room.rows * 0.7) / Math.tan(vertical / 2), 6);
  const azimuth = 0.62;
  const elevation = 0.78;
  const target = new Vector3(0, 0.55, 0.25);
  const position = new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  )
    .multiplyScalar(distance)
    .add(target);
  return { position, target };
}

/** Behind the viewer's own seat, facing the board. */
export function seatPose(room: Room, seat: Vector3, boardCentreX: number): Pose {
  return {
    position: new Vector3(seat.x, 3.1, seat.z + 4.8),
    target: new Vector3((seat.x + boardCentreX) / 2, 0.9, frontWallZ(room) + room.rows * 0.25),
  };
}

/** Where the entry glide starts: far back and high above the room. */
export function entryPose(pose: Pose): Pose {
  return { position: pose.position.clone().add(new Vector3(0, 2.2, 6)), target: pose.target.clone() };
}

export class CameraRig {
  readonly camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 80);
  private azimuth = 0;
  private elevation = 0;
  private from: Pose = { position: new Vector3(0, 6, 8), target: new Vector3() };
  private to: Pose = this.from;
  private readonly progress = new Transition(1);

  private current(): Pose {
    const t = this.progress.value;
    return {
      position: this.from.position.clone().lerp(this.to.position, t),
      target: this.from.target.clone().lerp(this.to.target, t),
    };
  }

  /** Glides (or cuts, when `glide` is false) to the pose from wherever the camera is now, or from `start`. */
  moveTo(pose: Pose, now: number, glide: boolean, start?: Pose): void {
    this.from = start ?? this.current();
    this.to = pose;
    this.progress.value = 0;
    this.progress.retarget(1, now, glide ? CAMERA_GLIDE_MS : 0);
  }

  orbit(azimuth: number, elevation: number): void {
    this.azimuth = Math.max(-AZIMUTH_LIMIT, Math.min(AZIMUTH_LIMIT, this.azimuth + azimuth));
    this.elevation = Math.max(-ELEVATION_LIMIT, Math.min(ELEVATION_LIMIT, this.elevation + elevation));
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  step(now: number): boolean {
    return this.progress.step(now);
  }

  apply(): void {
    const pose = this.current();
    this.camera.position.copy(this.orbited(pose.position));
    this.camera.lookAt(this.orbited(pose.target));
  }

  private orbited(point: Vector3): Vector3 {
    const offset = point.clone().sub(PIVOT).applyAxisAngle(UP, this.azimuth);
    const axis = new Vector3().crossVectors(UP, offset);
    if (axis.lengthSq() > 1e-6) offset.applyAxisAngle(axis.normalize(), this.elevation);
    return offset.add(PIVOT);
  }
}
