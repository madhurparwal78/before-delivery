import { roundTo } from './numbers';

export type Triple = [number, number, number];
export type Box = { min: Triple; max: Triple };
export type Pose = { position: Triple; target: Triple; up: Triple; fov: number };

/** The published camera pose of a box. */
export function poseOfBox(box: Box): Pose {
  const target: Triple = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const diagonal = Math.hypot(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  );
  const distance = Math.max(40, 2.5 * diagonal);
  const unit = 1 / Math.sqrt(3);
  return {
    position: [
      roundTo(target[0] + distance * unit, 3),
      roundTo(target[1] - distance * unit, 3),
      roundTo(target[2] + distance * unit, 3),
    ],
    target: [roundTo(target[0], 3), roundTo(target[1], 3), roundTo(target[2], 3)],
    up: [0, 0, 1],
    fov: 35,
  };
}

export function boxOfBbox(bbox: readonly number[]): Box {
  return { min: [-bbox[0] / 2, -bbox[1] / 2, 0], max: [bbox[0] / 2, bbox[1] / 2, bbox[2]] };
}

export function poseText(pose: Pose): string {
  return [
    ...pose.position.map((value) => roundTo(value, 3)),
    ...pose.target.map((value) => roundTo(value, 3)),
    roundTo(pose.fov, 3),
  ].join(',');
}
