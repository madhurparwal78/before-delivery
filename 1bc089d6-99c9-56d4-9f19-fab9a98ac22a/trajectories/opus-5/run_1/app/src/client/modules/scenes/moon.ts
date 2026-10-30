import * as THREE from 'three';
import { skyPlane, type SceneModule } from './stage.js';
import { sceneTextures } from './textures.js';

/** The moon behind chapter four, turning from new to full and back to new. */
export function moonScene(): SceneModule {
  const textures = sceneTextures();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
  camera.position.set(0, 0, 40);

  scene.background = new THREE.Color(0x0a0814);
  const sky = skyPlane(new THREE.Color(0x0a0814), new THREE.Color(0x241a3c), 260, 150);
  sky.position.set(0, 0, -80);
  scene.add(sky);

  const stars = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 150),
    new THREE.MeshBasicMaterial({ map: textures.stars, transparent: true, depthWrite: false, opacity: 0.6 }),
  );
  stars.position.set(0, 0, -78);
  scene.add(stars);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(11, 64, 48),
    new THREE.MeshStandardMaterial({ map: textures.moon, roughness: 1, metalness: 0 }),
  );
  moon.position.set(0, 1, 0);
  scene.add(moon);

  const sunlight = new THREE.DirectionalLight(0xfff2e0, 2.6);
  scene.add(sunlight);
  scene.add(new THREE.AmbientLight(0x4c3f72, 0.35));

  return {
    name: 'moon',
    scene,
    camera,
    update(progress) {
      // New at both ends of the chapter, full in the middle.
      const phase = Math.PI * 2 * progress;
      sunlight.position.set(Math.sin(phase) * 60, 12, -Math.cos(phase) * 60);
      moon.rotation.y = progress * 0.6;
    },
  };
}
