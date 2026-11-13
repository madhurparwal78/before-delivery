import * as THREE from 'three';

/**
 * Procedural 3D scenes. All scenes are built from primitives; cobalt and
 * violet exist only as light inside the scenes.
 */

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dispose(): void;
  render(): void;
  setSize(width: number, height: number): void;
}

export const EMBER = 0xff5a1f;
export const COBALT = 0x2b4bff;
export const VIOLET = 0x8b3dff;
export const OFFWHITE = 0xf4efe6;

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createScene(container: HTMLElement): SceneHandle | null {
  const canvas = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    container.setAttribute('data-webgl', 'off');
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  container.setAttribute('data-webgl', 'on');
  container.appendChild(canvas);

  const handle: SceneHandle = {
    renderer,
    scene,
    camera,
    render: () => renderer.render(scene, camera),
    setSize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },
    dispose() {
      renderer.dispose();
      canvas.remove();
    },
  };
  return handle;
}

export function fit(handle: SceneHandle, container: HTMLElement): void {
  const rect = container.getBoundingClientRect();
  handle.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1));
}

/** Standard studio lighting: two coloured lights on 3D surfaces only. */
export function addStudioLights(scene: THREE.Scene): void {
  const key = new THREE.DirectionalLight(0xfff3e4, 1.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const cobalt = new THREE.PointLight(COBALT, 44, 12);
  cobalt.position.set(-3.4, 1.6, 2.2);
  scene.add(cobalt);
  const violet = new THREE.PointLight(VIOLET, 38, 12);
  violet.position.set(3.2, 0.6, -2.6);
  scene.add(violet);
  const rim = new THREE.DirectionalLight(0xd8d2c6, 0.5);
  rim.position.set(-2, -1, -4);
  scene.add(rim);
}

/** Build a procedural product from primitive names + accent colour. */
export function buildSubject(primitives: string[], accent: number, clay: boolean): THREE.Group {
  const group = new THREE.Group();
  const geometryFactories: Record<string, () => THREE.BufferGeometry> = {
    box: () => new THREE.BoxGeometry(0.9, 0.9, 0.9),
    cylinder: () => new THREE.CylinderGeometry(0.45, 0.45, 1.0, 48),
    sphere: () => new THREE.SphereGeometry(0.55, 48, 32),
    torus: () => new THREE.TorusGeometry(0.5, 0.16, 24, 64),
    capsule: () => new THREE.CapsuleGeometry(0.32, 0.7, 12, 24),
  };
  const material = clay
    ? new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.95, metalness: 0, flatShading: true })
    : new THREE.MeshStandardMaterial({ color: 0x2c2f38, roughness: 0.28, metalness: 0.72 });
  const accentLight = new THREE.PointLight(accent, 16, 4);
  accentLight.position.set(0, 0.9, 1.4);
  group.add(accentLight);
  const count = Math.max(1, Math.min(primitives.length, 8));
  let y = 0;
  for (let i = 0; i < count; i++) {
    const name = primitives[i] ?? 'box';
    const factory = geometryFactories[name] ?? geometryFactories.box;
    const mesh = new THREE.Mesh(factory(), material.clone());
    if (clay) {
      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x6b665e, transparent: true, opacity: 0.6 }),
      );
      mesh.add(wire);
    }
    const scale = 1 - i * 0.06;
    mesh.scale.setScalar(scale * 0.62);
    mesh.position.y = y;
    y += 0.34 * scale;
    group.add(mesh);
  }
  return group;
}

/** Slow idle turn once every 30 seconds. */
export const IDLE_TURN_SECONDS = 30;

export function animateLoop(frames: () => void): () => void {
  let stopped = false;
  const tick = (): void => {
    if (stopped) {
      return;
    }
    frames();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    stopped = true;
  };
}

export const EASE_OUT = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Animate a value from 0 to 1 over a duration with a long ease-out. */
export function tween(durationMs: number, onUpdate: (t: number) => void, onComplete?: () => void): () => void {
  const start = performance.now();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    onUpdate(1);
    onComplete?.();
    return () => undefined;
  }
  let stopped = false;
  const tick = (now: number): void => {
    if (stopped) {
      return;
    }
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    onUpdate(EASE_OUT(t));
    if (t >= 1) {
      onComplete?.();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    stopped = true;
  };
}
