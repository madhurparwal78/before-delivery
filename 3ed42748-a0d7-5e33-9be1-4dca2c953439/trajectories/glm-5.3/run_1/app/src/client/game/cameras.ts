// The camera rigs: intro dive, follow camera, route orbit and photo camera.
// Each rig's pose and limits is decided here; every animation reads the reduced-motion
// preference live.

import * as THREE from "three";
import { PLANET_RADIUS_M, arcM, type LatLon } from "../../shared/geometry.js";
import { clamp, easeOutCubic, lerp } from "../dom.js";
import { latLonToVec, poseFor } from "./world.js";

export type CameraMode = "intro" | "over-shoulder" | "orbit" | "photo";

export type CourierPose = {
  position: LatLon;
  headingDeg: number;
  airborneM: number;
};

const FOLLOW_BACK_M = 7.0;
const FOLLOW_UP_M = 3.5;
const FOLLOW_LOOK_AHEAD_M = 2.0;
const FOLLOW_LOOK_UP_M = 1.0;
const FOLLOW_FOV = 55;

const INTRO_START_M = 240; // from the planet's centre, on the line through the courier
const INTRO_FOV = 40;

const PHOTO_DIST_M = 8.0;
const PHOTO_ELEV_DEG = 20;
const PHOTO_FOV_DEFAULT = 50;

const MIN_CLEARANCE_M = 1.5;

export type CameraRig = {
  mode: CameraMode;
  photoYawDeg: number;
  photoFov: number;
  settled: boolean;
  /** The camera state actually on screen right now, eased toward the target pose. */
  current: { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
  target: { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
  retarget(at: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }, reduced: boolean): void;
  update(now: number, reduced: boolean): void;
  /** Height above the surface below the camera, for the clearance invariant. */
  altitudeM(): number;
};

/**
 * The resting follow-camera pose: 7 m behind the courier along the ground, 3.5 m above
 * the feet, looking 2 m ahead and 1 m up.
 */
export function followPose(pose: CourierPose): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
  const { pos, up, forward } = poseFor(pose.position, pose.headingDeg, pose.airborneM);
  const behind = forward.clone().multiplyScalar(-FOLLOW_BACK_M);
  const posOut = pos.clone().add(up.clone().multiplyScalar(FOLLOW_UP_M)).add(behind);
  const look = pos.clone().add(forward.clone().multiplyScalar(FOLLOW_LOOK_AHEAD_M)).add(up.clone().multiplyScalar(FOLLOW_LOOK_UP_M));
  return { pos: posOut, look, fov: FOLLOW_FOV };
}

/** The intro start pose: 240 m out on the line through the courier, whole planet in view. */
export function introStartPose(pose: CourierPose): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
  const { pos } = poseFor(pose.position, pose.headingDeg, pose.airborneM);
  const dir = pos.clone().normalize();
  return { pos: dir.multiplyScalar(INTRO_START_M), look: new THREE.Vector3(0, 0, 0), fov: INTRO_FOV };
}

/** The route orbit pose: on the outward line through the route midpoint, 2.2–4 radii out. */
export function orbitPose(from: LatLon, to: LatLon): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
  const a = latLonToVec(from);
  const b = latLonToVec(to);
  const mid = a.clone().add(b).normalize();
  const arc = arcM(from, to);
  const fraction = clamp((arc / (Math.PI * PLANET_RADIUS_M)) * 3.3, 0, 1);
  const dist = PLANET_RADIUS_M * (2.2 + 1.8 * fraction);
  return { pos: mid.clone().multiplyScalar(dist), look: mid.clone().multiplyScalar(PLANET_RADIUS_M * 0.2), fov: FOLLOW_FOV };
}

/** The photo-camera pose: 8 m from the courier, 20° above the local horizon. */
export function photoPose(pose: CourierPose, yawDeg: number, fov: number): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
  const { pos, up, forward } = poseFor(pose.position, pose.headingDeg, pose.airborneM);
  const east = new THREE.Vector3().crossVectors(forward, up).normalize();
  const yaw = (yawDeg * Math.PI) / 180;
  // Yaw 0 is directly behind the courier along their heading; increasing yaw moves clockwise as seen from above.
  const horizontal = forward
    .clone()
    .multiplyScalar(-Math.cos(yaw))
    .add(east.clone().multiplyScalar(Math.sin(yaw)))
    .normalize();
  const elev = (PHOTO_ELEV_DEG * Math.PI) / 180;
  const offset = horizontal.multiplyScalar(Math.cos(elev) * PHOTO_DIST_M).add(up.clone().multiplyScalar(Math.sin(elev) * PHOTO_DIST_M));
  const cameraPos = pos.clone().add(offset);
  const look = pos.clone().add(up.clone().multiplyScalar(1.0));
  return { pos: cameraPos, look, fov };
}

/** Pushes a camera pose out of the planet until the 1.5 m clearance is met. */
function enforceClearance(pos: THREE.Vector3, look: THREE.Vector3): THREE.Vector3 {
  const dir = pos.clone().normalize();
  const radius = pos.length();
  const above = radius - PLANET_RADIUS_M;
  if (above >= MIN_CLEARANCE_M) return pos;
  return dir.multiplyScalar(PLANET_RADIUS_M + MIN_CLEARANCE_M);
  void look;
}

export function createRig(camera: THREE.PerspectiveCamera, startPose: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }): CameraRig {
  const rig: CameraRig = {
    mode: "intro",
    photoYawDeg: 0,
    photoFov: PHOTO_FOV_DEFAULT,
    settled: true,
    current: { pos: startPose.pos.clone(), look: startPose.look.clone(), fov: startPose.fov },
    target: { pos: startPose.pos.clone(), look: startPose.look.clone(), fov: startPose.fov },
    retarget(at: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }, reduced: boolean) {
      rig.target = {
        pos: enforceClearance(at.pos, at.look).clone(),
        look: at.look.clone(),
        fov: at.fov,
      };
      rig.settled = false;
      if (reduced) {
        rig.current.pos.copy(rig.target.pos);
        rig.current.look.copy(rig.target.look);
        rig.current.fov = rig.target.fov;
        rig.settled = true;
      }
    },
    update(now: number, reduced: boolean) {
      void now;
      if (rig.settled) return;
      if (reduced) {
        rig.current.pos.copy(rig.target.pos);
        rig.current.look.copy(rig.target.look);
        rig.current.fov = rig.target.fov;
        rig.settled = true;
      } else {
        const k = 0.16; // ease: settles in 0.3–0.5 s at 60 fps
        rig.current.pos.lerp(rig.target.pos, k);
        rig.current.look.lerp(rig.target.look, k);
        rig.current.fov = lerp(rig.current.fov, rig.target.fov, k);
        const moved = rig.current.pos.distanceTo(rig.target.pos) + Math.abs(rig.current.fov - rig.target.fov) * 0.05;
        if (moved < 0.02) {
          rig.current.pos.copy(rig.target.pos);
          rig.current.look.copy(rig.target.look);
          rig.current.fov = rig.target.fov;
          rig.settled = true;
        }
      }
    },
    altitudeM() {
      return rig.current.pos.length() - PLANET_RADIUS_M;
    },
  };
  void easeOutCubic;
  camera.position.copy(rig.current.pos);
  camera.lookAt(rig.current.look);
  camera.fov = rig.current.fov;
  camera.updateProjectionMatrix();
  return rig;
}

export function applyRig(camera: THREE.PerspectiveCamera, rig: CameraRig): void {
  camera.position.copy(rig.current.pos);
  camera.lookAt(rig.current.look);
  camera.fov = rig.current.fov;
  camera.updateProjectionMatrix();
}

export const PHOTO_FOV_MIN = 30;
export const PHOTO_FOV_MAX = 70;
export { PHOTO_FOV_DEFAULT, MIN_CLEARANCE_M, INTRO_START_M, INTRO_FOV, FOLLOW_FOV };
