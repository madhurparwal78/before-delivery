import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { qsa, reducedMotion } from './core.js';

export const COBALT = 0x1f4bff;
export const VIOLET = 0x8a2bff;
export const EMBER = 0xff6a1f;
export const OFF_WHITE = 0xf5efe6;

let shared: THREE.WebGLRenderer | null = null;
let probed = false;
let available = false;

export const webglAvailable = (): boolean => {
  if (probed) return available;
  probed = true;
  try {
    const canvas = document.createElement('canvas');
    available = canvas.getContext('webgl2') !== null;
  } catch {
    available = false;
  }
  return available;
};

const renderer = (): THREE.WebGLRenderer | null => {
  if (!webglAvailable()) return null;
  if (shared === null) {
    shared = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    shared.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    shared.setClearColor(0x080a11, 1);
  }
  return shared;
};

export type SceneHandle = {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update?: (seconds: number) => void;
  visible: boolean;
};

const handles: SceneHandle[] = [];
let looping = false;

const blit = (handle: SceneHandle): void => {
  const engine = renderer();
  if (engine === null) return;
  const width = Math.max(1, Math.round(handle.canvas.clientWidth));
  const height = Math.max(1, Math.round(handle.canvas.clientHeight));
  if (handle.canvas.width !== width || handle.canvas.height !== height) {
    handle.canvas.width = width;
    handle.canvas.height = height;
  }
  handle.camera.aspect = width / height;
  handle.camera.updateProjectionMatrix();
  engine.setSize(width, height, false);
  engine.render(handle.scene, handle.camera);
  const context = handle.canvas.getContext('2d');
  if (context === null) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(engine.domElement, 0, 0, width, height);
};

const loop = (): void => {
  const seconds = performance.now() / 1000;
  for (const handle of handles) {
    if (!handle.visible || !handle.element.isConnected) continue;
    handle.update?.(seconds);
    blit(handle);
  }
  requestAnimationFrame(loop);
};

export const registerScene = (handle: SceneHandle): void => {
  handles.push(handle);
  handle.element.dataset.webgl = 'on';
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) handle.visible = entry.isIntersecting;
  });
  observer.observe(handle.element);
  handle.visible = true;
  if (!looping) {
    looping = true;
    requestAnimationFrame(loop);
  }
};

export const standardScene = (): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } => {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(OFF_WHITE, 0.25));
  const cobalt = new THREE.DirectionalLight(COBALT, 2.6);
  cobalt.position.set(-3, 2.5, 2);
  const violet = new THREE.DirectionalLight(VIOLET, 2.2);
  violet.position.set(3, -1.5, 2.5);
  const key = new THREE.DirectionalLight(OFF_WHITE, 0.8);
  key.position.set(0.5, 3, 3);
  scene.add(cobalt, violet, key);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
  camera.position.set(0, 0.5, 4);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
};

const surface = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: OFF_WHITE, roughness: 0.42, metalness: 0.35 });

const primitiveGeometry = (name: string, size: number): THREE.BufferGeometry => {
  switch (name) {
    case 'cylinder':
      return new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 1.1, 48);
    case 'sphere':
      return new THREE.SphereGeometry(size * 0.55, 40, 28);
    case 'torus':
      return new THREE.TorusGeometry(size * 0.55, size * 0.18, 26, 60);
    case 'capsule':
      return new THREE.CapsuleGeometry(size * 0.33, size * 0.8, 14, 28);
    default:
      return new THREE.BoxGeometry(size, size * 0.8, size * 0.8);
  }
};

const ACCENTS: Record<string, number> = { ember: EMBER, cobalt: COBALT, violet: VIOLET };

export const buildAssembly = (primitives: string[], accent: string): THREE.Group => {
  const group = new THREE.Group();
  const accentColour = ACCENTS[accent] ?? EMBER;
  primitives.forEach((primitive, index) => {
    const mesh = new THREE.Mesh(primitiveGeometry(primitive, 0.9 - index * 0.08), surface());
    mesh.position.y = index * 0.42 - (primitives.length - 1) * 0.21;
    mesh.userData.axis = new THREE.Vector3(0, 1, 0);
    if (index % 3 === 1) mesh.userData.axis = new THREE.Vector3(1, 0.2, 0);
    if (index % 3 === 2) mesh.userData.axis = new THREE.Vector3(0, 0.2, 1);
    mesh.userData.home = mesh.position.clone();
    group.add(mesh);
  });
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.35, 0.008, 8, 90),
    new THREE.MeshBasicMaterial({ color: accentColour, transparent: true, opacity: 0.5 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -(primitives.length - 1) * 0.21 - 0.5;
  group.add(halo);
  return group;
};

const poster = (element: HTMLElement, canvas: HTMLCanvasElement, seed: number): void => {
  element.dataset.webgl = 'off';
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.fillStyle = '#0d1019';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(245,239,230,0.55)';
  context.lineWidth = 1.5;
  const centreX = width / 2;
  const centreY = height / 2;
  for (let index = 0; index < 4; index += 1) {
    const radius = (Math.min(width, height) / 2.6) * (1 - index * 0.18);
    context.beginPath();
    if ((seed + index) % 2 === 0) context.arc(centreX, centreY, radius, 0, Math.PI * 2);
    else context.rect(centreX - radius, centreY - radius * 0.7, radius * 2, radius * 1.4);
    context.stroke();
  }
};

type MountOptions = {
  element: HTMLElement;
  build: () => THREE.Group;
  update?: (group: THREE.Group, seconds: number, handle: SceneHandle) => void;
  distance?: number;
};

export const mountScene = (options: MountOptions): { handle: SceneHandle; group: THREE.Group } | null => {
  const canvas = options.element.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  if (!webglAvailable()) {
    poster(options.element, canvas, options.element.textContent?.length ?? 1);
    return null;
  }
  const { scene, camera } = standardScene();
  camera.position.z = options.distance ?? 4;
  const group = options.build();
  scene.add(group);
  const handle: SceneHandle = { element: options.element, canvas, scene, camera, visible: true };
  handle.update = (seconds) => options.update?.(group, seconds, handle);
  registerScene(handle);
  return { handle, group };
};

const IDLE_TURN_SECONDS = 28;

export const initHero = (): void => {
  const region = document.querySelector<HTMLElement>('[data-hero]');
  const sceneElement = region?.querySelector<HTMLElement>('[data-hero-scene]') ?? null;
  if (region === null || sceneElement === null) return;

  const mounted = mountScene({
    element: sceneElement,
    distance: 5.2,
    build: () => buildAssembly(['cylinder', 'torus', 'box', 'cylinder', 'box'], 'cobalt'),
    update: (group) => {
      const progress = Number(region.dataset.scrubProgress ?? '0');
      for (const child of group.children) {
        const home = child.userData.home as THREE.Vector3 | undefined;
        const axis = child.userData.axis as THREE.Vector3 | undefined;
        if (home === undefined || axis === undefined) continue;
        child.position.copy(home).addScaledVector(axis, progress * 1.5);
      }
    },
  });

  const paint = (): void => {
    const progress = reducedMotion() ? 1 : Math.min(1, Math.max(0, window.scrollY / 2400));
    region.dataset.scrubProgress = progress.toFixed(3);
  };

  if (reducedMotion()) {
    region.dataset.scrubProgress = '1.000';
  } else {
    window.addEventListener('scroll', () => requestAnimationFrame(paint), { passive: true });
    paint();
  }
  void mounted;
};

export const initCaseStudySubjects = (): void => {
  for (const element of qsa<HTMLElement>('[data-scene="case-study"]')) {
    const primitives = (element.dataset.primitives ?? 'box').split(',').filter(Boolean);
    const accent = element.dataset.accent ?? 'ember';
    const still = reducedMotion();
    element.dataset.idle = still ? 'still' : 'turning';
    const mounted = mountScene({
      element,
      distance: 4.4,
      build: () => buildAssembly(primitives, accent),
      update: (group, seconds) => {
        if (element.dataset.idle === 'turning')
          group.rotation.y = (seconds / IDLE_TURN_SECONDS) * Math.PI * 2;
        const morph = Number(element.dataset.morph ?? '0');
        for (const child of group.children) {
          if (!(child instanceof THREE.Mesh)) continue;
          const material = child.material as THREE.MeshStandardMaterial;
          if (material.color === undefined) continue;
          material.roughness = 0.42 + morph * 0.55;
          material.metalness = 0.35 * (1 - morph);
          material.wireframe = morph > 0.75;
          material.color.setHex(morph > 0.5 ? 0x9a948b : OFF_WHITE);
        }
      },
    });
    void mounted;
  }
};

export const initServiceObjects = (): void => {
  for (const element of qsa<HTMLElement>('[data-scene="service"]')) {
    const still = reducedMotion();
    element.dataset.idle = still ? 'still' : 'turning';
    element.dataset.tilt = '0';
    const row = element.closest('tr');
    let target = 0;
    let current = 0;

    const mounted = mountScene({
      element,
      distance: 3.2,
      build: () => buildAssembly([element.dataset.code === 'turntable_360' ? 'torus' : 'box'], 'ember'),
      update: (group, seconds) => {
        if (element.dataset.idle === 'turning')
          group.rotation.y = (seconds / IDLE_TURN_SECONDS) * Math.PI * 2;
        current += (target - current) * 0.18;
        const degrees = Math.round(Math.abs(current) < 0.4 ? 0 : current);
        element.dataset.tilt = String(Math.min(12, Math.max(0, Math.abs(degrees))));
        group.rotation.z = (-current * Math.PI) / 180;
      },
    });

    if (row !== null && !still) {
      row.addEventListener('pointermove', (event) => {
        const box = element.getBoundingClientRect();
        const centre = box.left + box.width / 2;
        const distance = Math.abs(event.clientX - centre);
        const ratio = distance / (box.width / 2);
        target = Math.sign(event.clientX - centre) * Math.min(12, Math.round(12 * ratio));
      });
      row.addEventListener('pointerleave', () => {
        target = 0;
      });
      row.querySelector('a')?.addEventListener('focus', () => {
        target = 12;
      });
      row.querySelector('a')?.addEventListener('blur', () => {
        target = 0;
      });
    }
    void mounted;
  }
};

export const initProcess = (): void => {
  const region = document.querySelector<HTMLElement>('[data-process]');
  const sceneElement = region?.querySelector<HTMLElement>('[data-process-scene]') ?? null;
  if (region === null || sceneElement === null) return;
  const stages = qsa<HTMLElement>('[data-process-stages] li');

  const stations: THREE.Vector3[] = [];
  const mounted = mountScene({
    element: sceneElement,
    distance: 6,
    build: () => {
      const group = new THREE.Group();
      const shapes = ['box', 'cylinder', 'sphere', 'torus', 'capsule'];
      for (let index = 0; index < 5; index += 1) {
        const angle = (-0.6 + index * 0.3) * Math.PI * 0.5;
        const x = Math.sin(angle) * 4;
        const z = -Math.cos(angle) * 2.2;
        const plinth = new THREE.Mesh(
          new THREE.CylinderGeometry(0.62, 0.68, 0.22, 36),
          new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.9, metalness: 0.05 }),
        );
        plinth.position.set(x, -0.6, z);
        const piece = new THREE.Mesh(primitiveGeometry(shapes[index], 0.62), surface());
        piece.position.set(x, -0.1, z);
        group.add(plinth, piece);
        stations.push(new THREE.Vector3(x, 0.45, z + 2.6));
      }
      return group;
    },
    update: (_group, _seconds, handle) => {
      if (reducedMotion()) {
        handle.camera.position.set(0, 1.4, 6.4);
        handle.camera.lookAt(0, -0.2, -1);
        return;
      }
      const progress = Number(region.dataset.processProgress ?? '0');
      const span = progress * 4;
      const index = Math.min(3, Math.floor(span));
      const blend = span - index;
      const from = stations[index] ?? stations[0];
      const to = stations[index + 1] ?? from;
      if (from !== undefined && to !== undefined) {
        handle.camera.position.lerpVectors(from, to, blend);
        handle.camera.lookAt(
          from.x + (to.x - from.x) * blend,
          -0.15,
          from.z + (to.z - from.z) * blend - 2.6,
        );
      }
    },
  });

  const paint = (): void => {
    if (reducedMotion()) {
      region.dataset.processStep = 'all';
      for (const stage of stages) stage.setAttribute('aria-current', 'step');
      return;
    }
    const box = region.getBoundingClientRect();
    const scrolled = -box.top;
    const span = Math.max(1, region.offsetHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, scrolled / span));
    region.dataset.processProgress = progress.toFixed(4);
    const step = Math.min(5, 1 + Math.floor(progress * 5));
    region.dataset.processStep = String(step);
    stages.forEach((stage, index) => {
      if (index === step - 1) stage.setAttribute('aria-current', 'step');
      else stage.removeAttribute('aria-current');
    });
  };

  if (reducedMotion()) paint();
  else {
    window.addEventListener('scroll', () => requestAnimationFrame(paint), { passive: true });
    paint();
  }
  void mounted;
};

export type RigModel = {
  widthM: number;
  heightM: number;
  depthM: number;
  url: string | null;
  unitScale: number;
};

export type RigShot = { code: string; title: string; azimuth: number; elevation: number };

export type RigSceneApi = {
  setSelection: (codes: string[]) => void;
  setFocused: (code: string) => void;
  setAzimuth: (degrees: number) => void;
  setPip: (code: string) => void;
  setModel: (model: RigModel | null) => void;
  azimuth: () => number;
};

const CARD_WIDTH_M = 0.0856;
const CARD_HEIGHT_M = 0.054;

export const initRigScene = (
  element: HTMLElement,
  pipElement: HTMLElement,
  shots: RigShot[],
): RigSceneApi => {
  const state = {
    selection: new Set<string>(),
    focused: shots[0]?.code ?? '',
    azimuth: 0,
    pip: 'overview',
    radius: 0.2,
  };

  const frustums = new Map<string, THREE.Object3D>();
  let productGroup: THREE.Group | null = null;
  let mountedScene: THREE.Scene | null = null;
  let mainCamera: THREE.PerspectiveCamera | null = null;
  let pipCamera: THREE.PerspectiveCamera | null = null;

  const frameMain = (): void => {
    if (mainCamera === null) return;
    const distance = Math.max(0.35, state.radius * 4.2);
    const radians = (state.azimuth * Math.PI) / 180;
    mainCamera.position.set(
      Math.sin(radians) * distance,
      state.radius * 1.6,
      Math.cos(radians) * distance,
    );
    mainCamera.lookAt(0, state.radius * 0.6, 0);
  };

  const framePip = (): void => {
    if (pipCamera === null) return;
    const shot = shots.find((entry) => entry.code === state.pip);
    const azimuth = shot === undefined ? 25 : shot.azimuth;
    const elevation = shot === undefined ? 20 : shot.elevation;
    const distance = Math.max(0.3, state.radius * 3.1);
    const a = (azimuth * Math.PI) / 180;
    const e = (elevation * Math.PI) / 180;
    pipCamera.position.set(
      Math.sin(a) * Math.cos(e) * distance,
      Math.sin(e) * distance + state.radius * 0.4,
      Math.cos(a) * Math.cos(e) * distance,
    );
    pipCamera.lookAt(0, state.radius * 0.6, 0);
  };

  const makeFrustum = (): THREE.Object3D => {
    const geometry = new THREE.ConeGeometry(state.radius * 0.26, state.radius * 0.5, 4, 1, true);
    const material = new THREE.MeshBasicMaterial({ color: OFF_WHITE, wireframe: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };

  const placeFrustum = (object: THREE.Object3D, shot: RigShot, factor: number): void => {
    const a = (shot.azimuth * Math.PI) / 180;
    const e = (shot.elevation * Math.PI) / 180;
    const distance = state.radius * factor;
    object.position.set(
      Math.sin(a) * Math.cos(e) * distance,
      Math.sin(e) * distance + state.radius * 0.6,
      Math.cos(a) * Math.cos(e) * distance,
    );
    object.lookAt(0, state.radius * 0.6, 0);
  };

  const applySelection = (): void => {
    if (mountedScene === null) return;
    for (const shot of shots) {
      const selected = state.selection.has(shot.code);
      const existing = frustums.get(shot.code);
      if (selected && existing === undefined) {
        const frustum = makeFrustum();
        placeFrustum(frustum, shot, 1);
        mountedScene.add(frustum);
        frustums.set(shot.code, frustum);
      } else if (!selected && existing !== undefined) {
        mountedScene.remove(existing);
        frustums.delete(shot.code);
      }
      const current = frustums.get(shot.code);
      if (current instanceof THREE.Mesh) {
        const material = current.material as THREE.MeshBasicMaterial;
        material.color.setHex(state.focused === shot.code ? EMBER : OFF_WHITE);
      }
    }
  };

  const loadModel = (model: RigModel): void => {
    if (mountedScene === null) return;
    if (productGroup !== null) mountedScene.remove(productGroup);
    productGroup = new THREE.Group();
    const width = Math.max(0.001, model.widthM * model.unitScale);
    const height = Math.max(0.001, model.heightM * model.unitScale);
    const depth = Math.max(0.001, model.depthM * model.unitScale);
    state.radius = Math.max(width, height, depth) * 0.75 + CARD_WIDTH_M;

    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      surface(),
    );
    stand.position.y = height / 2;
    productGroup.add(stand);
    mountedScene.add(productGroup);

    frameMain();
    framePip();
    applySelection();

    if (model.url === null) return;
    new GLTFLoader().load(
      model.url,
      (gltf) => {
        if (mountedScene === null || productGroup === null) return;
        productGroup.remove(stand);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        gltf.scene.position.sub(centre);
        gltf.scene.position.y += size.y / 2;
        gltf.scene.scale.setScalar(model.unitScale);
        productGroup.add(gltf.scene);
      },
      undefined,
      () => undefined,
    );
  };

  const planView = (): void => {
    element.dataset.webgl = 'off';
    pipElement.dataset.webgl = 'off';
    const draw = (): void => {
      for (const target of [element, pipElement]) {
        const canvas = target.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) continue;
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (context === null) continue;
        context.fillStyle = '#0d1019';
        context.fillRect(0, 0, width, height);
        const centreX = width / 2;
        const centreY = height / 2;
        const ringRadius = Math.min(width, height) * 0.36;
        context.strokeStyle = 'rgba(245,239,230,0.45)';
        context.beginPath();
        context.arc(centreX, centreY, ringRadius, 0, Math.PI * 2);
        context.stroke();
        const footprint = ringRadius * 0.45;
        context.strokeStyle = 'rgba(245,239,230,0.85)';
        context.strokeRect(centreX - footprint / 2, centreY - footprint / 2, footprint, footprint);
        context.strokeRect(
          centreX + footprint,
          centreY - (footprint * CARD_HEIGHT_M) / CARD_WIDTH_M / 2,
          footprint,
          (footprint * CARD_HEIGHT_M) / CARD_WIDTH_M,
        );
        for (const shot of shots) {
          const angle = (shot.azimuth * Math.PI) / 180;
          const x = centreX + Math.sin(angle) * ringRadius;
          const y = centreY - Math.cos(angle) * ringRadius;
          context.fillStyle =
            state.focused === shot.code
              ? '#ff6a1f'
              : state.selection.has(shot.code)
                ? 'rgba(245,239,230,0.95)'
                : 'rgba(245,239,230,0.35)';
          context.beginPath();
          context.arc(x, y, 5, 0, Math.PI * 2);
          context.fill();
        }
      }
    };
    draw();
    window.addEventListener('resize', draw);
    redraw = draw;
  };

  let redraw: () => void = () => undefined;

  if (!webglAvailable()) {
    planView();
  } else {
    const main = standardScene();
    mountedScene = main.scene;
    mainCamera = main.camera;
    pipCamera = new THREE.PerspectiveCamera(34, 1, 0.005, 100);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.17, 0.02, 60),
      new THREE.MeshStandardMaterial({ color: 0x14171e, roughness: 0.95, metalness: 0.02 }),
    );
    plinth.position.y = -0.01;
    const card = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-CARD_WIDTH_M / 2, 0, -CARD_HEIGHT_M / 2),
        new THREE.Vector3(CARD_WIDTH_M / 2, 0, -CARD_HEIGHT_M / 2),
        new THREE.Vector3(CARD_WIDTH_M / 2, 0, CARD_HEIGHT_M / 2),
        new THREE.Vector3(-CARD_WIDTH_M / 2, 0, CARD_HEIGHT_M / 2),
      ]),
      new THREE.LineBasicMaterial({ color: OFF_WHITE }),
    );
    card.position.set(0.2, 0.001, 0);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.0008, 6, 120),
      new THREE.MeshBasicMaterial({ color: OFF_WHITE, transparent: true, opacity: 0.35 }),
    );
    ring.rotation.x = Math.PI / 2;
    mountedScene.add(plinth, card, ring);

    const canvas = element.querySelector('canvas');
    const pipCanvas = pipElement.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement) {
      registerScene({
        element,
        canvas,
        scene: mountedScene,
        camera: mainCamera,
        visible: true,
        update: () => frameMain(),
      });
    }
    if (pipCanvas instanceof HTMLCanvasElement) {
      registerScene({
        element: pipElement,
        canvas: pipCanvas,
        scene: mountedScene,
        camera: pipCamera,
        visible: true,
        update: () => framePip(),
      });
    }
    frameMain();
    framePip();
  }

  return {
    setSelection: (codes) => {
      state.selection = new Set(codes);
      applySelection();
      redraw();
    },
    setFocused: (code) => {
      state.focused = code;
      applySelection();
      redraw();
    },
    setAzimuth: (degrees) => {
      state.azimuth = ((Math.round(degrees) % 360) + 360) % 360;
      frameMain();
      redraw();
    },
    setPip: (code) => {
      state.pip = code;
      framePip();
      redraw();
    },
    setModel: (model) => {
      if (model !== null && webglAvailable()) loadModel(model);
      redraw();
    },
    azimuth: () => state.azimuth,
  };
};
