import * as THREE from 'three';
import { skyPlane, type SceneModule } from './stage.js';
import { sceneTextures } from './textures.js';

export interface FlowersScene extends SceneModule {
  /** Closes one flower before its scroll position would, within a second. */
  closeEarly(index: number): void;
  /** Where each flower sits on screen, as fractions of the viewport. */
  hitPoints(): { x: number; y: number }[];
}

const PETALS = 6;
const FLOWERS = 34;

const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
};

/** A field of pale moonflowers, folding shut from the farthest in. */
export function flowersScene(): FlowersScene {
  const textures = sceneTextures();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
  camera.position.set(0, 5.2, 11);
  camera.lookAt(0, 0.4, -16);

  scene.background = new THREE.Color(0x0d0a1c);
  const sky = skyPlane(new THREE.Color(0x0d0a1c), new THREE.Color(0x362850), 300, 140);
  sky.position.set(0, 30, -120);
  scene.add(sky);

  const stars = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 120),
    new THREE.MeshBasicMaterial({ map: textures.stars, transparent: true, depthWrite: false, opacity: 0.55 }),
  );
  stars.position.set(0, 34, -115);
  scene.add(stars);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ color: 0x100c1e }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.2, -120);
  scene.add(ground);

  const petalGeometry = new THREE.ConeGeometry(0.2, 1.1, 8, 1, true);
  const petalMaterial = new THREE.MeshBasicMaterial({
    color: 0xe9e2f2,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a8 });

  interface Flower {
    group: THREE.Group;
    petals: THREE.Mesh[];
    order: number;
    early: number;
    closed: number;
    position: THREE.Vector3;
  }

  const stemMaterial = new THREE.MeshBasicMaterial({ color: 0x2a3a30 });
  const next = random(13331);
  const flowers: Flower[] = [];
  for (let index = 0; index < FLOWERS; index += 1) {
    const depth = -2 - next() * 34;
    const group = new THREE.Group();
    const height = 1.5 + next() * 0.7;
    group.position.set((next() - 0.5) * (14 + Math.abs(depth) * 1.5), 0, depth);
    group.scale.setScalar(0.85 + next() * 0.45);
    const petals: THREE.Mesh[] = [];
    for (let petal = 0; petal < PETALS; petal += 1) {
      // Each petal hangs on its own pivot, so opening is one clean tilt outwards.
      const pivot = new THREE.Object3D();
      pivot.rotation.y = (petal / PETALS) * Math.PI * 2;
      pivot.position.y = height;
      const mesh = new THREE.Mesh(petalGeometry, petalMaterial.clone());
      mesh.position.set(0, 0.42, 0.2);
      pivot.add(mesh);
      group.add(pivot);
      petals.push(mesh);
    }
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), coreMaterial);
    core.position.y = height + 0.05;
    group.add(core);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, height, 6), stemMaterial);
    stem.position.y = height / 2;
    group.add(stem);
    scene.add(group);
    flowers.push({
      group,
      petals,
      order: 0,
      early: 0,
      closed: 0,
      position: group.position.clone().setY(height),
    });
  }

  // The farthest flowers fold first.
  const byDepth = [...flowers].sort((left, right) => left.group.position.z - right.group.position.z);
  for (const [rank, flower] of byDepth.entries()) flower.order = rank / (FLOWERS - 1);

  const closeEarly = (index: number): void => {
    const flower = flowers[index];
    if (flower) flower.early = 1;
  };

  return {
    name: 'flowers',
    scene,
    camera,
    closeEarly,
    hitPoints: () =>
      flowers.map((flower) => {
        const projected = flower.position.clone().project(camera);
        return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
      }),
    update(progress) {
      for (const flower of flowers) {
        const start = flower.order * 0.55;
        const byScroll = Math.max(0, Math.min(1, (progress - start) / 0.45));
        // Scrolling back above the point where it would close opens the flower again.
        if (byScroll <= 0) flower.early = 0;
        const wanted = Math.max(byScroll, flower.early);
        flower.closed += (wanted - flower.closed) * 0.18;
        if (Math.abs(wanted - flower.closed) < 0.004) flower.closed = wanted;
        for (const petal of flower.petals) {
          const open = 1 - flower.closed;
          petal.rotation.x = 0.1 + open * 0.75;
          petal.position.z = 0.08 + open * 0.2;
          (petal.material as THREE.MeshBasicMaterial).opacity = 0.92 - flower.closed * 0.12;
        }
      }
    },
  };
}
