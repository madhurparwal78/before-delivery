/**
 * Procedural shard geometry. Every shard sits on the ray that runs from the sightline
 * camera through one sampled point of the chapter's numeral and title, at its own depth,
 * so the cloud reads as the numeral from the sightline and as scatter from anywhere else.
 */

export interface Shard {
  position: [number, number, number];
  target: [number, number, number];
  size: number;
  tilt: number;
}

const ORBIT_RADIUS = 9;
const PLANE_WIDTH = 7.2;
const PLANE_HEIGHT = 4.4;

export function cameraPosition(yawDegrees: number): [number, number, number] {
  const yaw = (yawDegrees * Math.PI) / 180;
  return [Math.sin(yaw) * ORBIT_RADIUS, 0.6, Math.cos(yaw) * ORBIT_RADIUS];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Samples the lit pixels of the numeral and title drawn on an offscreen canvas. */
export function sampleText(numeral: string, title: string, maximum: number): [number, number][] {
  const width = 360;
  const height = 220;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return [];
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 120px Georgia, serif';
  context.fillText(numeral, width / 2, height * 0.36);
  context.font = '500 24px Georgia, serif';
  context.fillText(title, width / 2, height * 0.76);
  const { data } = context.getImageData(0, 0, width, height);
  const lit: [number, number][] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      if ((data[index] as number) > 128) lit.push([x / width - 0.5, 0.5 - y / height]);
    }
  }
  const random = mulberry32(numeral.length * 977 + title.length * 31 + 7);
  for (let i = lit.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = lit[i] as [number, number];
    lit[i] = lit[j] as [number, number];
    lit[j] = swap;
  }
  return lit.slice(0, maximum);
}

export function buildShards(sightlineDeg: number, points: [number, number][], seed: number): Shard[] {
  const random = mulberry32(seed);
  const camera = cameraPosition(sightlineDeg);
  return points.map(([u, v]) => {
    const target: [number, number, number] = [u * PLANE_WIDTH, v * PLANE_HEIGHT, 0];
    const ray: [number, number, number] = [target[0] - camera[0], target[1] - camera[1], target[2] - camera[2]];
    const length = Math.hypot(ray[0], ray[1], ray[2]);
    const depth = -1.9 + random() * 3.8;
    return {
      target,
      position: [
        target[0] + (ray[0] / length) * depth,
        target[1] + (ray[1] / length) * depth,
        target[2] + (ray[2] / length) * depth,
      ],
      size: 0.05 + random() * 0.06,
      tilt: random() * Math.PI * 2,
    };
  });
}
