import { CAMERA_MAX_DISTANCE, CAMERA_MIN_DISTANCE, CAMERA_START_AZIMUTH, CAMERA_START_DISTANCE } from "../../shared/limits";
import type { Vec3 } from "../../shared/types";

/** An orbit camera: azimuth 0 looks from the front (-Y) and grows toward +X; the elevation is the angle above the ground. */
export interface Camera {
  azimuth: number;
  elevation: number;
  distance: number;
}

/** The point the camera looks at: a little above the ground so a shape at the origin sits at the centre of the view. */
export const CAMERA_TARGET: Vec3 = [0, 0, 10];

export const START_CAMERA: Camera = { azimuth: CAMERA_START_AZIMUTH, elevation: 35, distance: CAMERA_START_DISTANCE };

const DEGREES_PER_PIXEL = 0.5;
const ELEVATION_PER_PIXEL = 0.25;
const MIN_ELEVATION = 5;
const MAX_ELEVATION = 85;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** One degree of azimuth per two pixels of horizontal drag; vertical drag tilts the view. */
export function orbit(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    azimuth: camera.azimuth - dx * DEGREES_PER_PIXEL,
    elevation: clamp(camera.elevation + dy * ELEVATION_PER_PIXEL, MIN_ELEVATION, MAX_ELEVATION),
  };
}

/** The distance times `factor`, kept between 20 and 2000 mm. */
export function zoom(camera: Camera, factor: number): Camera {
  return { ...camera, distance: clamp(camera.distance * factor, CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE) };
}

export function cameraPosition(camera: Camera): Vec3 {
  const azimuth = (camera.azimuth * Math.PI) / 180;
  const elevation = (camera.elevation * Math.PI) / 180;
  const ground = Math.cos(elevation) * camera.distance;
  return [
    CAMERA_TARGET[0] + Math.sin(azimuth) * ground,
    CAMERA_TARGET[1] - Math.cos(azimuth) * ground,
    CAMERA_TARGET[2] + Math.sin(elevation) * camera.distance,
  ];
}

/** Azimuth as published: whole degrees, 0 to 359. */
export function publishedAzimuth(camera: Camera): number {
  return Math.round(((camera.azimuth % 360) + 360) % 360) % 360;
}

/** Distance as published: millimetres with one decimal. */
export function publishedDistance(camera: Camera): string {
  return camera.distance.toFixed(1);
}
