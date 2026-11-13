// One full-bleed WebGL canvas behind the page; each registered view renders its scene into its element's rectangle.
// Every view's `tick` runs each frame whether or not WebGL exists, so its data-* values stay the source of truth.
import * as THREE from "three";

export type Rect = { left: number; top: number; width: number; height: number };
type View = {
  el: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  tick: (now: number) => void;
  /** Overrides where the view draws (the shared-element morph); null draws in the element's own box. */
  rect?: () => Rect | null;
};

const GROUND = 0x0b0d12;
const views = new Set<View>();
let renderer: THREE.WebGLRenderer | null = null;
let canvas: HTMLCanvasElement | null = null;
let started = false;
let probed: boolean | null = null;

/** Whether this browser gives us WebGL; decided once, before any scene mounts. */
function webglAvailable(): boolean {
  if (probed !== null) return probed;
  canvas = document.createElement("canvas");
  canvas.className = "stage-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
  if (!context) {
    probed = false;
    return probed;
  }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: false });
    renderer.setClearColor(GROUND, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    document.body.prepend(canvas);
    probed = true;
  } catch {
    renderer = null;
    probed = false;
  }
  return probed;
}

function resize(): void {
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (renderer) {
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
  }
  const height = window.innerHeight;
  for (const view of views) {
    if (!view.el.isConnected) continue;
    view.tick(now);
    if (!renderer) continue;
    const box = view.rect?.() ?? view.el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2 || box.top > height || box.top + box.height < 0) continue;
    const y = height - (box.top + box.height);
    renderer.setViewport(box.left, y, box.width, box.height);
    renderer.setScissor(box.left, y, box.width, box.height);
    view.camera.aspect = box.width / box.height;
    view.camera.updateProjectionMatrix();
    renderer.render(view.scene, view.camera);
  }
}

/** Registers a view for as long as its component is mounted. */
export function addView(view: View): () => void {
  webglAvailable();
  views.add(view);
  view.el.dataset.webgl = renderer ? "on" : "off";
  if (!started) {
    started = true;
    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(frame);
  }
  return () => void views.delete(view);
}
