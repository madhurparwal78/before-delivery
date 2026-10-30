import * as THREE from 'three';
import { glowSprite, mix, repaintSky, skyPlane, type SceneModule } from './stage.js';
import { sceneTextures } from './textures.js';

/** 21:00 — a landscape of glowing contour lines under a low ember sun. */
export function heroScene(): SceneModule {
  const textures = sceneTextures();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600);
  camera.position.set(0, 2.4, 26);
  camera.lookAt(0, 2, 0);

  scene.background = new THREE.Color(0x1a1230);
  const sky = skyPlane(new THREE.Color(0x1a1230), new THREE.Color(0x6b4a6e));
  sky.position.set(0, 18, -120);
  scene.add(sky);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(4.6, 64),
    new THREE.MeshBasicMaterial({ color: 0xffe2be, depthWrite: false }),
  );
  sun.position.set(0, 7, -90);
  scene.add(sun);

  const halo = glowSprite(textures.glow, 70, 0xff9a4d);
  halo.position.copy(sun.position);
  scene.add(halo);

  // Contour lines of the dark land, built in code from a ridge function.
  const lines: THREE.Line[] = [];
  const ridge = (x: number, band: number): number =>
    Math.sin(x * 0.17 + band * 0.6) * 1.5 + Math.sin(x * 0.07 - band * 0.3) * 2.4 + Math.sin(x * 0.4) * 0.35;
  for (let band = 0; band < 16; band += 1) {
    const points: THREE.Vector3[] = [];
    const depth = -70 + band * 4.3;
    for (let step = 0; step <= 160; step += 1) {
      const x = -90 + (step / 160) * 180;
      points.push(new THREE.Vector3(x, -1.2 - band * 0.42 + ridge(x, band) * (1 - band / 20), depth));
    }
    const material = new THREE.LineBasicMaterial({
      color: 0xff8a3d,
      transparent: true,
      opacity: 0.16 + 0.5 * (1 - band / 16),
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    lines.push(line);
    scene.add(line);
  }

  const land = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 120),
    new THREE.MeshBasicMaterial({ color: 0x120d20 }),
  );
  land.rotation.x = -Math.PI / 2;
  land.position.set(0, -8, -40);
  scene.add(land);

  const highSky = new THREE.Color();
  const lowSky = new THREE.Color();

  return {
    name: 'hero',
    scene,
    camera,
    update(progress) {
      sun.position.y = mix(7, -1.6, progress);
      halo.position.copy(sun.position);
      halo.scale.setScalar(mix(78, 46, progress));
      (halo.material as THREE.SpriteMaterial).opacity = mix(1, 0.5, progress);
      highSky.setHex(0x1a1230).lerp(new THREE.Color(0x0b0914), progress * 0.85);
      lowSky.setHex(0x6b4a6e).lerp(new THREE.Color(0x2e2148), progress);
      repaintSky(sky, highSky, lowSky);
      for (const [index, line] of lines.entries()) {
        const material = line.material as THREE.LineBasicMaterial;
        material.opacity = (0.16 + 0.5 * (1 - index / 16)) * mix(1, 0.45, progress);
      }
    },
  };
}
