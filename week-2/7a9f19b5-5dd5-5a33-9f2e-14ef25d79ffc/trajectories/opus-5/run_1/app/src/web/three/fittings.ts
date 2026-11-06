/**
 * Every fitting is built in code from turned and extruded shapes: a recessed
 * downlight, a track spot on its adaptor, a pendant on its cord, a surface cylinder
 * or a gimbal downlight. No model files are shipped.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type ColorRepresentation,
} from "three";
import type { FinishCode } from "../../shared/types.js";

/** The finishes as they read under the fitting's own light. */
export const FINISH_APPEARANCE: Record<FinishCode, { colour: ColorRepresentation; metalness: number; roughness: number }> = {
  WH: { colour: 0xe9e6df, metalness: 0.06, roughness: 0.82 },
  BK: { colour: 0x14161a, metalness: 0.12, roughness: 0.74 },
  BR: { colour: 0xb08d4b, metalness: 0.88, roughness: 0.3 },
  BZ: { colour: 0x6d5438, metalness: 0.76, roughness: 0.45 },
  CH: { colour: 0x3a3d44, metalness: 0.28, roughness: 0.62 },
  SN: { colour: 0xb9bcc1, metalness: 0.74, roughness: 0.34 },
};

/** Warm amber for 2700K, soft warm white for 3000K, pale cool blue-white for 4000K. */
export function cctColour(cctK: number): number {
  if (cctK <= 2700) return 0xffb55c;
  if (cctK <= 3000) return 0xffd9a8;
  return 0xd3e4f7;
}

export type FittingShape = "downlight" | "track-spot" | "pendant" | "surface" | "gimbal";

/** The product families map onto the five shapes the viewer draws. */
export function shapeFor(family: string, slug: string): FittingShape {
  if (slug === "rimu-gimbal-downlight") return "gimbal";
  switch (family) {
    case "track-spots":
      return "track-spot";
    case "pendants":
      return "pendant";
    case "surface":
      return "surface";
    default:
      return "downlight";
  }
}

function finishMaterial(finish: FinishCode): MeshStandardMaterial {
  const appearance = FINISH_APPEARANCE[finish];
  return new MeshStandardMaterial({
    color: appearance.colour,
    metalness: appearance.metalness,
    roughness: appearance.roughness,
  });
}

/** A turned profile, revolved about the vertical axis. */
function lathe(points: ReadonlyArray<[number, number]>, material: MeshStandardMaterial, segments = 48): Mesh {
  const profile = points.map(([x, y]) => new Vector2(x, y));
  return new Mesh(new LatheGeometry(profile, segments), material);
}

export interface FittingParts {
  group: Group;
  /** Where the light leaves the fitting, so the cone starts there. */
  emitterY: number;
  materials: MeshStandardMaterial[];
}

export function buildFitting(shape: FittingShape, finish: FinishCode): FittingParts {
  const group = new Group();
  const body = finishMaterial(finish);
  const materials = [body];

  const lens = new MeshStandardMaterial({
    color: 0xfdf6e6,
    emissive: 0xfdf0dc,
    emissiveIntensity: 0.65,
    roughness: 0.35,
  });
  materials.push(lens);

  let emitterY = 0;

  if (shape === "downlight") {
    // A deep-recessed can with a glare-free trim.
    const trim = lathe(
      [
        [0.52, 0],
        [0.52, 0.06],
        [0.42, 0.06],
        [0.3, 0.3],
        [0.3, 0.86],
        [0.0, 0.86],
      ],
      body,
    );
    group.add(trim);
    const ring = new Mesh(new RingGeometry(0.3, 0.52, 48), body);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.001;
    group.add(ring);
    const glass = new Mesh(new CylinderGeometry(0.29, 0.29, 0.02, 40), lens);
    glass.position.y = 0.12;
    group.add(glass);
    emitterY = 0.1;
  } else if (shape === "gimbal") {
    // An adjustable gimbal in a ring yoke.
    const can = lathe(
      [
        [0.5, 0.02],
        [0.5, 0.1],
        [0.34, 0.12],
        [0.34, 0.8],
        [0, 0.8],
      ],
      body,
    );
    group.add(can);
    const yoke = new Mesh(new TorusGeometry(0.36, 0.035, 12, 40), body);
    yoke.rotation.x = Math.PI / 2;
    yoke.position.y = 0.2;
    group.add(yoke);
    const head = new Mesh(new SphereGeometry(0.27, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2), body);
    head.rotation.x = Math.PI;
    head.position.y = 0.26;
    group.add(head);
    const glass = new Mesh(new CylinderGeometry(0.25, 0.25, 0.02, 36), lens);
    glass.position.y = 0.09;
    group.add(glass);
    emitterY = 0.08;
  } else if (shape === "track-spot") {
    // A head on its three-circuit track adaptor.
    const track = new Mesh(new BoxGeometry(2.4, 0.14, 0.34), body);
    track.position.y = 1.32;
    group.add(track);
    const adaptor = new Mesh(new BoxGeometry(0.3, 0.2, 0.26), body);
    adaptor.position.y = 1.16;
    group.add(adaptor);
    const stem = new Mesh(new CylinderGeometry(0.05, 0.05, 0.3, 16), body);
    stem.position.y = 0.96;
    group.add(stem);
    const knuckle = new Mesh(new SphereGeometry(0.1, 20, 14), body);
    knuckle.position.y = 0.8;
    group.add(knuckle);
    const barrel = lathe(
      [
        [0.3, 0],
        [0.32, 0.1],
        [0.28, 0.58],
        [0.2, 0.68],
        [0, 0.7],
      ],
      body,
    );
    barrel.position.y = 0.1;
    group.add(barrel);
    const glass = new Mesh(new CylinderGeometry(0.27, 0.29, 0.02, 36), lens);
    glass.position.y = 0.11;
    group.add(glass);
    emitterY = 0.1;
  } else if (shape === "pendant") {
    // A spun shade on its cord.
    const cord = new Mesh(new CylinderGeometry(0.018, 0.018, 1.5, 10), body);
    cord.position.y = 1.5;
    group.add(cord);
    const canopy = new Mesh(new CylinderGeometry(0.16, 0.16, 0.06, 24), body);
    canopy.position.y = 2.26;
    group.add(canopy);
    const shade = lathe(
      [
        [0.0, 0.92],
        [0.22, 0.88],
        [0.52, 0.6],
        [0.66, 0.26],
        [0.68, 0.04],
        [0.66, 0.0],
      ],
      body,
    );
    group.add(shade);
    const glass = new Mesh(new CylinderGeometry(0.6, 0.62, 0.02, 40), lens);
    glass.position.y = 0.04;
    group.add(glass);
    emitterY = 0.03;
  } else {
    // A surface-mounted cylinder for exposed ceilings.
    const plate = new Mesh(new CylinderGeometry(0.44, 0.44, 0.05, 36), body);
    plate.position.y = 1.08;
    group.add(plate);
    const barrel = new Mesh(new CylinderGeometry(0.38, 0.38, 1.04, 40, 1, true), body);
    barrel.position.y = 0.54;
    group.add(barrel);
    const cap = new Mesh(new RingGeometry(0.3, 0.38, 40), body);
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 0.04;
    group.add(cap);
    const glass = new Mesh(new CylinderGeometry(0.3, 0.3, 0.02, 36), lens);
    glass.position.y = 0.05;
    group.add(glass);
    emitterY = 0.04;
  }

  return { group, emitterY, materials };
}

/**
 * The cone of light below the fitting. Its half-angle matches the beam, so the
 * drawn spread follows the same geometry as the published pool diameter.
 */
export function buildCone(beamDeg: number, cctK: number, height: number): { mesh: Mesh; material: MeshStandardMaterial } {
  const radius = height * Math.tan((beamDeg / 2) * (Math.PI / 180));
  const material = new MeshStandardMaterial({
    color: cctColour(cctK),
    emissive: cctColour(cctK),
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
  });
  const mesh = new Mesh(new CylinderGeometry(0.02, radius, height, 44, 1, true), material);
  return { mesh, material };
}

/** The floor pool, drawn at its computed diameter and tinted by colour temperature. */
export function buildPool(diameterMm: number, cctK: number, mmPerUnit: number): { mesh: Mesh; material: MeshStandardMaterial } {
  const radius = diameterMm / 2 / mmPerUnit;
  const material = new MeshStandardMaterial({
    color: cctColour(cctK),
    emissive: cctColour(cctK),
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const mesh = new Mesh(new CylinderGeometry(radius, radius, 0.004, 52), material);
  mesh.rotation.x = 0;
  return { mesh, material };
}
