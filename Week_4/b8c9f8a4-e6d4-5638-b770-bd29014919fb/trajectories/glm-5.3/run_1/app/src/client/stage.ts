import * as THREE from 'three';
import { PANEL_FRAMES, PANELS, panelPoint, type PanelId } from './panels.js';

export interface StageFinding {
  id: string;
  panelId: PanelId;
  u: number;
  v: number;
  position: number;
  severity: string;
  seen: boolean;
}

export interface StageObservables {
  renderer: 'webgl' | 'svg';
  mode: 'scroll' | 'still';
  beat: number;
  beatProgress: number;
  panel: string;
  anchor: string;
  rimGlow: number;
  cardTravel: number;
  cameraAngle: number;
  cameraPosition: string;
  viewProjection: string;
  listing: string;
  frameCount: number;
}

/** Beat math: the first 720px are the hero hold, then 720px per finding. */
export const BEAT_PX = 720;
export const HERO_HOLD_PX = 720;

export function scrollObservables(scrollY: number, findings: StageFinding[], heroId: string | null, viewportH: number): { beat: number; progress: number; finding: StageFinding | null } {
  const n = findings.length;
  if (n === 0) return { beat: 0, progress: 0, finding: null };
  const total = scrollY;
  if (total < HERO_HOLD_PX) return { beat: 0, progress: 0, finding: heroFinding(findings, heroId) };
  const beatIndex = Math.floor((total - HERO_HOLD_PX) / BEAT_PX);
  if (beatIndex >= n) return { beat: n, progress: 1, finding: findings[n - 1] };
  const within = (total - HERO_HOLD_PX) - beatIndex * BEAT_PX;
  return { beat: beatIndex + 1, progress: clamp01(within / BEAT_PX), finding: findings[beatIndex] };
}

function heroFinding(findings: StageFinding[], heroId: string | null): StageFinding | null {
  return findings.find(f => f.id === heroId) ?? findings[0] ?? null;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** The resting camera: an eye placed to frame the hero finding, computed from the world point. */
export function restingCamera(target: [number, number, number], aspect: number): { eye: [number, number, number]; look: [number, number, number]; fov: number } {
  const [x, y, z] = target;
  const azimuth = Math.atan2(x, -z);
  const distance = 7.2;
  const eye: [number, number, number] = [
    x + Math.sin(azimuth) * distance * 0.55,
    y + 2.6,
    z + Math.cos(azimuth) * distance,
  ];
  return { eye, look: [x, y, z], fov: 40 };
}

/** Camera pose during beat k: arcs clockwise along a fixed path to the finding's panel. */
export function beatCamera(finding: StageFinding, progress: number, scrollY: number): { eye: [number, number, number]; look: [number, number, number]; fov: number } {
  const point = panelPoint(finding.panelId, finding.u, finding.v);
  const baseAngle = Math.atan2(point[0], -point[2]);
  const heroAngle = 0;
  // The camera angle rises through the beat and never falls on forward scrolling:
  // each beat starts from an angle above the previous beat's start.
  const beatStartAngle = heroAngle + finding.position * 22 * (Math.PI / 180);
  const angle = beatStartAngle + (baseAngle - beatStartAngle) * Math.min(1, progress * 1.4);
  const distance = 7.2 - progress * 0.8;
  const eye: [number, number, number] = [
    Math.sin(angle) * distance,
    2.6 - progress * 0.5,
    Math.cos(angle) * distance,
  ];
  return { eye, look: point, fov: 40 };
}

export interface CameraPose { eye: [number, number, number]; look: [number, number, number]; fov: number }

/** Build the full faceted car scene. The planes are original geometry in this project. */
export function buildScene(): { group: THREE.Group; panelMeshes: Map<PanelId, THREE.Mesh[]>; markerGroup: THREE.Group } {
  const group = new THREE.Group();
  const panelMeshes = new Map<PanelId, THREE.Mesh[]>();
  for (const panel of PANELS) {
    const f = PANEL_FRAMES[panel.id];
    const surfaces: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
    const o = new THREE.Vector3(...f.origin);
    const u = new THREE.Vector3(...f.U);
    const v = new THREE.Vector3(...f.V);
    surfaces.push([o, o.clone().add(u), o.clone().add(u).add(v), o.clone().add(v)]);
    const meshes: THREE.Mesh[] = [];
    for (const quad of surfaces) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([
        quad[0].x, quad[0].y, quad[0].z, quad[1].x, quad[1].y, quad[1].z, quad[2].x, quad[2].y, quad[2].z,
        quad[0].x, quad[0].y, quad[0].z, quad[2].x, quad[2].y, quad[2].z, quad[3].x, quad[3].y, quad[3].z,
      ]);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshBasicMaterial({ color: 0x6a74c8, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(geometry, material);
      meshes.push(mesh);
      group.add(mesh);
    }
    // Rim edges along the frame.
    const frameGeometry = new THREE.BufferGeometry().setFromPoints([
      o, o.clone().add(u), o.clone().add(u).add(v), o.clone().add(v), o,
    ]);
    const frame = new THREE.Line(frameGeometry, new THREE.LineBasicMaterial({ color: 0x9fa8f0, transparent: true, opacity: 0.5 }));
    meshes.push(frame as unknown as THREE.Mesh);
    group.add(frame);
    panelMeshes.set(panel.id, meshes);
  }
  // The base plane dissolving into indigo.
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.MeshBasicMaterial({ color: 0x1a1330, transparent: true, opacity: 0.9 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.4;
  group.add(base);
  const markerGroup = new THREE.Group();
  return { group, panelMeshes, markerGroup };
}

/** Camera for a pose; returns position, matrix and angle as the observables need. */
export function cameraFor(pose: CameraPose, aspect: number): { camera: THREE.PerspectiveCamera; angleDeg: number } {
  const camera = new THREE.PerspectiveCamera(pose.fov, aspect, 0.1, 100);
  camera.position.set(...pose.eye);
  camera.lookAt(new THREE.Vector3(...pose.look));
  camera.updateMatrixWorld();
  const angle = (Math.atan2(pose.eye[0], -pose.eye[2]) * 180) / Math.PI;
  return { camera, angleDeg: ((angle % 360) + 360) % 360 };
}

export function viewProjectionString(camera: THREE.PerspectiveCamera): string {
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = vp.elements;
  return e.map(n => n.toFixed(6)).join(',');
}

export function projectPoint(world: [number, number, number], camera: THREE.PerspectiveCamera, box: { width: number; height: number; left: number; top: number }): { x: number; y: number; visible: boolean } {
  const v = new THREE.Vector3(...world).project(camera);
  return {
    x: box.left + ((v.x + 1) / 2) * box.width,
    y: box.top + ((1 - v.y) / 2) * box.height,
    visible: v.z > -1 && v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05,
  };
}
