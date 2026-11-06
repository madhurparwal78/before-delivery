import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCameraKey,
  clampPose,
  detailFactor,
  eyeOf,
  flyHome,
  flyTarget,
  HOME_POSE,
  identity,
  interpolatePose,
  invert,
  lookAt,
  modelMatrix,
  multiply,
  orbit,
  perspective,
  pickNode,
  project,
  projectedRadius,
  radians,
  rayPlane,
  scale,
  sceneProjection,
  screenRay,
  translate,
  viewMatrix,
  zoom,
  type CameraPose,
  type Mat4,
  type Vec3,
} from './camera.ts';

const close = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// Reference readings of a view matrix, as the verifier reads them.
function refEye(v: Mat4): number[] {
  const t = [v[12] ?? 0, v[13] ?? 0, v[14] ?? 0];
  return [0, 1, 2].map((c) => -[0, 1, 2].reduce((s, r) => s + (v[c * 4 + r] ?? 0) * (t[r] ?? 0), 0));
}

function refAngles(v: Mat4): [number, number] {
  const z = [v[2] ?? 0, v[6] ?? 0, v[10] ?? 0];
  return [(Math.atan2(z[0] ?? 0, z[2] ?? 0) * 180) / Math.PI, (Math.asin(Math.max(-1, Math.min(1, z[1] ?? 0))) * 180) / Math.PI];
}

test('perspective: element 5 is 1/tan(22.5°) for a 45° field of view', () => {
  const p = sceneProjection(1280, 560);
  close(p[5] ?? NaN, 1 / Math.tan(radians(22.5)));
  close(p[0] ?? NaN, (1 / Math.tan(radians(22.5))) / (1280 / 560));
  assert.equal(p[11], -1);
  assert.equal(p[15], 0);
  const q = perspective(radians(90), 1, 1, 3);
  close(q[10] ?? NaN, -2);
  close(q[14] ?? NaN, -3);
});

test('lookAt is orthonormal and moves the eye to the origin', () => {
  const eye: Vec3 = [3, 7, -4];
  const m = lookAt(eye, [1, -2, 5], [0, 1, 0]);
  const cols = [0, 1, 2].map((r) => [m[r] ?? 0, m[4 + r] ?? 0, m[8 + r] ?? 0]);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const d = (cols[i] ?? []).reduce((s, x, k) => s + x * (cols[j]?.[k] ?? 0), 0);
      close(d, i === j ? 1 : 0, 1e-12);
    }
  }
  refEye(m).forEach((x, k) => close(x, eye[k] ?? NaN, 1e-12));
});

test('eyeOf and viewMatrix follow the pose', () => {
  const pose: CameraPose = { target: [1, 2, 3], yaw: 30, pitch: 20, distance: 40 };
  const e = eyeOf(pose);
  close(e[0], 1 + 40 * Math.cos(radians(20)) * Math.sin(radians(30)));
  close(e[1], 2 + 40 * Math.sin(radians(20)));
  close(e[2], 3 + 40 * Math.cos(radians(20)) * Math.cos(radians(30)));
  const v = viewMatrix(pose);
  refEye(v).forEach((x, k) => close(x, e[k] ?? NaN, 1e-9));
  const [yaw, pitch] = refAngles(v);
  close(yaw, 30, 1e-9);
  close(pitch, 20, 1e-9);
  const home = eyeOf(HOME_POSE);
  close(home[0], 0);
  close(Math.hypot(...home), 40);
});

test('matrix helpers', () => {
  const m = multiply(translate([1, 2, 3]), scale(2));
  assert.deepEqual(m, modelMatrix([1, 2, 3], 2));
  assert.deepEqual(multiply(identity(), m), m);
  const inv = invert(m);
  assert.ok(inv !== null);
  multiply(m, inv).forEach((x, i) => close(x, identity()[i] ?? NaN, 1e-12));
});

test('orbit, zoom and keys clamp pitch and distance', () => {
  assert.deepEqual(orbit(HOME_POSE, 10, 1000), { ...HOME_POSE, yaw: 4, pitch: 80 });
  assert.equal(zoom(HOME_POSE, -10000).distance, 12);
  assert.equal(zoom(HOME_POSE, 100).distance, 45);
  assert.equal(applyCameraKey(HOME_POSE, 'ArrowLeft', true)?.yaw, -15);
  assert.equal(applyCameraKey(HOME_POSE, 'ArrowUp', true)?.pitch, 30);
  assert.equal(applyCameraKey(HOME_POSE, 'ArrowDown', true)?.pitch, 10);
  assert.equal(applyCameraKey(HOME_POSE, '=', false)?.distance, 35);
  assert.equal(applyCameraKey(HOME_POSE, '-', false)?.distance, 45);
  assert.equal(applyCameraKey(HOME_POSE, 'ArrowLeft', false), null);
  assert.equal(clampPose({ ...HOME_POSE, pitch: -95, distance: 200 }).pitch, -80);
});

test('fly-to approaches yaw the short way round', () => {
  const pose = flyTarget([-1, 0, -1], 1.2, 170);
  close(pose.yaw, 225);
  assert.equal(pose.pitch, 15);
  close(pose.distance, 12 + 4 * 1.2);
  assert.equal(flyHome(350).yaw, 360);
  const mid = interpolatePose(HOME_POSE, pose, 0.5);
  close(mid.distance, (40 + 16.8) / 2);
  close(mid.target[0], -0.5);
});

test('projection matches the reference reading and labels use the detail factor', () => {
  const pose: CameraPose = { target: [0, 0, 0], yaw: 25, pitch: 10, distance: 30 };
  const v = viewMatrix(pose);
  const w = 1280;
  const h = 560;
  const p = sceneProjection(w, h);
  const pt: Vec3 = [2, -3, 4];
  const got = project(pt, v, p, w, h);
  const vec = [0, 1, 2, 3].map((r) => [...pt, 1].reduce((s, x, c) => s + (v[c * 4 + r] ?? 0) * x, 0));
  const depth = -(vec[2] ?? 0);
  const f = 1 / Math.tan(radians(22.5));
  close(got.depth, depth);
  close(got.x, ((f / (w / h)) * (vec[0] ?? 0) / depth + 1) / 2 * w, 1e-6);
  close(got.y, (1 - (f * (vec[1] ?? 0)) / depth) / 2 * h, 1e-6);
  close(projectedRadius(1, 560, 10), 280 / (Math.tan(radians(22.5)) * 10));
  const base = { s: 0.6, projected: got, width: w, height: h, selected: false, focused: false };
  assert.equal(detailFactor(base), projectedRadius(0.6, h, depth) >= 6 ? 1 : 0);
  assert.equal(detailFactor({ ...base, s: 0.01, selected: true }), 1);
  assert.equal(detailFactor({ ...base, projected: { ...got, depth: -1 }, selected: true }), 0);
  assert.equal(detailFactor({ ...base, projected: { ...got, depth: -1 }, focused: true }), 1);
});

test('screen ray through a projected node picks it', () => {
  const v = viewMatrix(HOME_POSE);
  const p = sceneProjection(800, 600);
  const nodes = [
    { id: 'far', pos: [0, 0, -5] as Vec3, s: 1 },
    { id: 'near', pos: [0, 0, 5] as Vec3, s: 1 },
    { id: 'off', pos: [10, 0, 0] as Vec3, s: 0.6 },
  ];
  const at = project([0, 0, 5], v, p, 800, 600);
  const ray = screenRay(at.x, at.y, 800, 600, v, p);
  assert.ok(ray !== null);
  assert.equal(pickNode(ray.origin, ray.dir, nodes)?.id, 'near');
  assert.equal(pickNode(ray.origin, [0, 1, 0], nodes), null);
  const hit = rayPlane(ray.origin, ray.dir, [0, 0, 5], [0, 0, 1]);
  assert.ok(hit !== null);
  hit.forEach((x, k) => close(x, [0, 0, 5][k] ?? NaN, 1e-6));
});
