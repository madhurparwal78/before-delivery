import * as THREE from 'three';
import { glowSprite, mix, skyPlane, type SceneModule } from './stage.js';
import { sceneTextures } from './textures.js';

/** 22:00 — a paper lantern whose flame goes out as the page ends. */
export function lanternScene(): SceneModule {
  const textures = sceneTextures();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
  camera.position.set(0, 0.6, 24);
  camera.lookAt(0, 0.4, 0);

  scene.background = new THREE.Color(0x080610);
  const sky = skyPlane(new THREE.Color(0x080610), new THREE.Color(0x160f28), 260, 140);
  sky.position.set(0, 0, -70);
  scene.add(sky);

  const paper = new THREE.MeshBasicMaterial({
    map: textures.paper,
    color: 0xffb070,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.2, 4.4, 24, 1, true), paper);
  body.position.y = 0.2;
  scene.add(body);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.08, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0x6b5894 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 2.4;
  scene.add(rim);

  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 26, 6),
    new THREE.MeshBasicMaterial({ color: 0x5a4a78 }),
  );
  cord.position.y = 15.4;
  scene.add(cord);

  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 16, 14),
    new THREE.MeshBasicMaterial({ color: 0xfff0d2 }),
  );
  flame.position.y = -0.3;
  scene.add(flame);

  const halo = glowSprite(textures.glow, 22, 0xff8a3d);
  halo.position.set(0, -0.1, 0.4);
  scene.add(halo);

  return {
    name: 'lantern',
    scene,
    camera,
    update(progress, elapsed) {
      const life = 1 - progress;
      const flicker = 1 + Math.sin(elapsed * 7.3) * 0.05 + Math.sin(elapsed * 3.1) * 0.03;
      flame.scale.setScalar(Math.max(0.001, life * flicker));
      flame.visible = life > 0.01;
      halo.scale.setScalar(Math.max(0.001, mix(4, 26, life) * flicker));
      (halo.material as THREE.SpriteMaterial).opacity = life;
      paper.color.setRGB(mix(0.28, 1, life), mix(0.22, 0.69, life), mix(0.34, 0.44, life));
      paper.opacity = mix(0.5, 0.95, life);
    },
  };
}
