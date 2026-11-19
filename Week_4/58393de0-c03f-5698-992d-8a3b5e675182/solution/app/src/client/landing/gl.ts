import { PCFShadowMap, WebGLRenderer, type PerspectiveCamera, type Scene } from "three";

/** The longest side the shared drawing buffer is ever grown to, so a huge hero never asks the GPU for more. */
const MAX_BUFFER = 4096;
const MAX_DPR = 2;

let renderer: WebGLRenderer | null | undefined;

/**
 * Every landing scene is drawn by ONE offscreen renderer and copied onto its own 2D canvas, so the page holds a single
 * WebGL context however many previews it shows. Null when the browser has no WebGL 2.
 */
function sharedRenderer(): WebGLRenderer | null {
  if (renderer !== undefined) return renderer;
  const canvas = document.createElement("canvas");
  const attributes: WebGLContextAttributes = { alpha: true, antialias: true, premultipliedAlpha: true, failIfMajorPerformanceCaveat: false };
  const context = canvas.getContext("webgl2", attributes);
  if (!context) {
    renderer = null;
    return null;
  }
  const created = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  created.setPixelRatio(1);
  created.setClearColor(0x000000, 0);
  created.shadowMap.enabled = true;
  created.shadowMap.type = PCFShadowMap;
  renderer = created;
  return created;
}

/** Size of the backing store a canvas needs to look sharp at its CSS size, with the device pixel ratio capped at 2. */
export function fitCanvas(canvas: HTMLCanvasElement): boolean {
  const ratio = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const width = Math.min(MAX_BUFFER, Math.round(canvas.clientWidth * ratio));
  const height = Math.min(MAX_BUFFER, Math.round(canvas.clientHeight * ratio));
  if (width === 0 || height === 0) return false;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return true;
}

/** Renders the scene on the shared renderer and copies the picture onto the target 2D canvas (already fitted). */
export function drawScene(target: HTMLCanvasElement, scene: Scene, camera: PerspectiveCamera): CanvasRenderingContext2D | null {
  const gl = sharedRenderer();
  const context = target.getContext("2d");
  if (!gl || !context) return null;
  const { width, height } = target;
  const buffer = gl.domElement;
  if (buffer.width < width || buffer.height < height) gl.setSize(Math.max(buffer.width, width), Math.max(buffer.height, height), false);
  gl.setViewport(0, 0, width, height);
  gl.setScissor(0, 0, width, height);
  gl.setScissorTest(true);
  gl.clear();
  gl.render(scene, camera);
  context.clearRect(0, 0, width, height);
  context.drawImage(buffer, 0, buffer.height - height, width, height, 0, 0, width, height);
  return context;
}
