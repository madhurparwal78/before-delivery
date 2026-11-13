import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { EngravedSystem } from '../shared/types.js';

const IDLE_TURN = 0.05;
const RADIUS = 3.2;
const STRIP_HEIGHT = 0.85;
/** Chosen so a lifted strip comes to rest within about 0.9 seconds. */
const SETTLE_RATE = 7;
const STAFF_STAGGER_MS = 40;

let fontFaceCss: string | null = null;

/** The Bravura subset is inlined so an SVG drawn into a texture keeps its notation glyphs. */
async function embeddedFontCss(): Promise<string> {
  if (fontFaceCss !== null) return fontFaceCss;
  const bytes = await (await fetch('/fonts/bravura-subset.woff2')).arrayBuffer();
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  fontFaceCss = `@font-face{font-family:'Bravura';src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2');}`;
  return fontFaceCss;
}

async function systemTexture(svg: string): Promise<CanvasTexture> {
  const css = await embeddedFontCss();
  const withFont = svg.replace('>', `><defs><style>${css}</style></defs>`);
  const blob = new Blob([withFont], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  await new Promise<void>((resolve) => {
    image.addEventListener('load', () => resolve());
    image.addEventListener('error', () => resolve());
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#faf6ef';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (image.width > 0) context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  return texture;
}

export interface HelixHandle {
  canvas: HTMLCanvasElement;
  setSystems: (systems: EngravedSystem[]) => Promise<void>;
  peel: (staffCount: number) => Promise<void>;
  windBack: () => void;
  setPlayhead: (systemIndex: number | null) => void;
  dispose: () => void;
}

export function webglAvailable(): boolean {
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
}

/** The engraved systems wound on a slowly turning drum, lit from the side. */
export function createHelix(reducedMotion: boolean): HelixHandle {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.className = 'helix-canvas';

  const scene = new Scene();
  scene.background = new Color('#080c12');
  const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 100);
  camera.position.set(0, 0.4, 9.2);
  scene.add(new AmbientLight(0xfaf6ef, 0.9));
  const key = new DirectionalLight(0xfff2e0, 1.4);
  key.position.set(-6, 4, 6);
  scene.add(key);

  const drum = new Group();
  scene.add(drum);
  const strips: Mesh[] = [];
  let dragging = false;
  let dragFrom = 0;
  let angleFrom = 0;
  let last = performance.now();
  let running = true;
  let peeled = false;
  let playhead: number | null = null;

  const resize = (): void => {
    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 360;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const frame = (now: number): void => {
    if (!running) return;
    const delta = (now - last) / 1000;
    last = now;
    if (!reducedMotion && !dragging && !peeled) drum.rotation.y += IDLE_TURN * delta;
    advanceLifts(now);
    for (const [index, strip] of strips.entries()) {
      const material = strip.material as MeshStandardMaterial;
      material.emissiveIntensity = playhead === index + 1 ? 0.85 : 0;
    }
    resize();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    dragFrom = event.clientX;
    angleFrom = drum.rotation.y;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    drum.rotation.y = angleFrom + (event.clientX - dragFrom) * 0.006;
  });
  const release = (): void => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const place = (): void => {
    const count = Math.max(strips.length, 1);
    strips.forEach((strip, index) => {
      const angle = (index / count) * Math.PI * 2;
      strip.position.set(Math.sin(angle) * RADIUS, 0, Math.cos(angle) * RADIUS);
      strip.rotation.set(0, angle, 0);
      strip.scale.set(1, 1, 1);
      (strip.material as MeshStandardMaterial).opacity = 1;
    });
  };

  /** Critically damped: it reaches rest without overshoot or bounce. */
  const settle = (elapsed: number): number => {
    const omega = SETTLE_RATE * elapsed;
    return 1 - (1 + omega) * Math.exp(-omega);
  };

  const lifts = new Map<Mesh, { startedAt: number; from: Vector3; to: Vector3 }>();

  const advanceLifts = (now: number): void => {
    for (const [strip, lift] of lifts) {
      const elapsed = (now - lift.startedAt) / 1000;
      if (elapsed < 0) continue;
      const progress = reducedMotion ? 1 : Math.min(1, settle(elapsed));
      strip.position.lerpVectors(lift.from, lift.to, progress);
      strip.rotation.y *= 1 - progress * 0.5;
      (strip.material as MeshStandardMaterial).opacity = 1 - progress;
      if (progress >= 0.999) lifts.delete(strip);
    }
  };

  return {
    canvas,
    async setSystems(systems) {
      for (const strip of strips) {
        drum.remove(strip);
        (strip.material as MeshStandardMaterial).dispose();
        strip.geometry.dispose();
      }
      strips.length = 0;
      for (const system of systems) {
        const texture = await systemTexture(system.svg);
        const mesh = new Mesh(
          new PlaneGeometry(3.6, STRIP_HEIGHT * 2.2),
          new MeshStandardMaterial({
            map: texture,
            emissive: new Color('#c8431f'),
            emissiveIntensity: 0,
            roughness: 0.85,
            transparent: true,
          }),
        );
        strips.push(mesh);
        drum.add(mesh);
      }
      place();
    },
    /** Each staff of the part lifts off in score order, 40 ms after the one above it. */
    async peel(staffCount) {
      peeled = true;
      const now = performance.now();
      strips.forEach((strip, index) => {
        const staff = index % Math.max(1, staffCount);
        lifts.set(strip, {
          startedAt: now + staff * (reducedMotion ? 0 : STAFF_STAGGER_MS),
          from: strip.position.clone(),
          to: new Vector3(0, 0.2, 7.4),
        });
      });
      await new Promise((resolve) =>
        setTimeout(resolve, reducedMotion ? 0 : 900 + staffCount * STAFF_STAGGER_MS),
      );
    },
    windBack() {
      peeled = false;
      lifts.clear();
      place();
    },
    setPlayhead(systemIndex) {
      playhead = systemIndex;
    },
    dispose() {
      running = false;
      renderer.dispose();
    },
  };
}
