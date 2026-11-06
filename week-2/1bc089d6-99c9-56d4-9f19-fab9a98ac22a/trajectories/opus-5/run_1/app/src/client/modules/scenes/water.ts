import * as THREE from 'three';
import { glowSprite, mix, skyPlane, type SceneModule } from './stage.js';
import { sceneTextures } from './textures.js';

/** Still water: ripples settling to a mirror while a paper boat drifts to the centre. */
export function waterScene(): SceneModule {
  const textures = sceneTextures();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  camera.position.set(0, 4.2, 30);
  camera.lookAt(0, 3.2, -30);

  scene.background = new THREE.Color(0x120d26);
  const sky = skyPlane(new THREE.Color(0x120d26), new THREE.Color(0x2c2050), 400, 180);
  sky.position.set(0, 50, -200);
  scene.add(sky);

  const stars = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 150),
    new THREE.MeshBasicMaterial({ map: textures.stars, transparent: true, depthWrite: false, opacity: 0.7 }),
  );
  stars.position.set(0, 55, -190);
  scene.add(stars);

  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 48),
    new THREE.MeshBasicMaterial({ map: textures.moon, color: 0xf5eee6 }),
  );
  moon.position.set(26, 26, -150);
  scene.add(moon);
  const halo = glowSprite(textures.glow, 70, 0x9aa6d0);
  halo.position.copy(moon.position);
  scene.add(halo);

  const uniforms = {
    uTime: { value: 0 },
    uCalm: { value: 0 },
    uMoon: { value: new THREE.Vector2(26, -150) },
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 420, 120, 120),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        uniform float uTime;
        uniform float uCalm;
        varying vec3 vWorld;
        void main() {
          vec3 shifted = position;
          float amplitude = mix(0.95, 0.045, uCalm);
          shifted.z += sin(position.x * 0.5 + uTime * 1.5) * amplitude;
          shifted.z += sin(position.y * 0.34 - uTime * 1.1) * amplitude * 0.8;
          shifted.z += sin((position.x + position.y) * 0.17 + uTime * 0.6) * amplitude * 0.6;
          vec4 world = modelMatrix * vec4(shifted, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform float uCalm;
        uniform vec2 uMoon;
        varying vec3 vWorld;
        void main() {
          float depth = clamp((vWorld.z + 160.0) / 190.0, 0.0, 1.0);
          vec3 near = vec3(0.027, 0.022, 0.047);
          vec3 far = vec3(0.075, 0.062, 0.125);
          vec3 colour = mix(near, far, depth);
          float spread = mix(10.0, 2.6, uCalm);
          float path = exp(-abs(vWorld.x - uMoon.x) / spread) * pow(depth, 2.2);
          colour += vec3(0.68, 0.70, 0.78) * path * 0.75;
          gl_FragColor = vec4(colour, 1.0);
        }
      `,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, -60);
  scene.add(water);

  // A small paper boat: a folded hull and one sail.
  const boat = new THREE.Group();
  const paper = new THREE.MeshBasicMaterial({
    map: textures.paper,
    color: 0xe8e0ee,
    side: THREE.DoubleSide,
  });
  const hull = new THREE.BufferGeometry();
  hull.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1.5, 0, 0, 1.5, 0, 0, 0, 0.75, 0, -1.5, 0, 0, 0, 0.75, 0, 0, 0, 0.6], 3),
  );
  hull.computeVertexNormals();
  boat.add(new THREE.Mesh(hull, paper));
  const sail = new THREE.Mesh(new THREE.BufferGeometry(), paper);
  sail.geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0.7, 0, 1.1, 0.7, 0, 0, 2.6, 0], 3),
  );
  sail.geometry.computeVertexNormals();
  boat.add(sail);
  boat.position.set(-16, 0.9, -34);
  scene.add(boat);

  return {
    name: 'water',
    scene,
    camera,
    update(progress, elapsed) {
      uniforms.uCalm.value = progress;
      uniforms.uTime.value = elapsed;
      boat.position.x = mix(-16, 0, progress);
      boat.position.y = 0.9 + Math.sin(elapsed * 0.8) * 0.12 * (1 - progress);
      boat.rotation.z = Math.sin(elapsed * 0.6) * 0.06 * (1 - progress);
    },
  };
}
