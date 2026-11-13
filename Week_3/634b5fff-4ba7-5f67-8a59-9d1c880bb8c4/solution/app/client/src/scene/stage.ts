import {
  CanvasTexture,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  WebGLRenderer,
} from "three";
import { buildAlley } from "./alley.js";
import { FOV_DEG } from "./path.js";
import { seeded } from "./random.js";

/** A power of two, so `light.intensity / GAIN` reports the level exactly. */
export const GAIN = 64;
const MATCH_COLOR = 0xffa24a;
const HORIZON = "#0b1424";

const grainTexture = (): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const rand = seeded(5);
    const image = context.createImageData(size, size);
    for (let i = 0; i < size * size; i += 1) {
      const v = 205 + Math.floor(rand() * 50);
      image.data[i * 4] = v;
      image.data[i * 4 + 1] = v;
      image.data[i * 4 + 2] = Math.min(255, v + 6);
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

const skyTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#04070e");
    gradient.addColorStop(0.55, "#081020");
    gradient.addColorStop(1, HORIZON);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 256);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

/** A black wash over the whole view; its opacity is the scene's dimming. */
const washMaterial = (amount: { value: number }): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { uAmount: amount },
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform float uAmount; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uAmount); }",
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

/** The renderer, the scene graph's fixed parts (lights, ground and houses, fog, sky) and the camera. */
/** Software GL (the CPU draws every pixel) renders fewer pixels than the canvas shows, fewest while the picture moves. */
const SOFTWARE_PIXEL_RATIO = { moving: 0.6, still: 1 } as const;

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 170);
  readonly hemisphere = new HemisphereLight(0x8394b3, 0x1a2030, 1.1);
  readonly moon = new DirectionalLight(0xa6bbe0, 1.0);
  readonly matchLight = new PointLight(MATCH_COLOR, 0, 0, 2);
  readonly glowLight = new PointLight(MATCH_COLOR, 0, 0, 2);
  readonly heldLight = new PointLight(MATCH_COLOR, 0, 4, 2);
  readonly software: boolean;
  private readonly alleyMaterial: MeshLambertMaterial;
  private readonly alley: Mesh;
  private readonly wash: Mesh;
  private readonly washAmount = { value: 0 };
  private readonly washMaterial: ShaderMaterial;
  private readonly textures = [grainTexture(), skyTexture()];

  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.renderer = new WebGLRenderer({ canvas, context, powerPreference: "high-performance" });
    const info = context.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    this.software = /swiftshader|software|llvmpipe/i.test(name);
    this.renderer.setPixelRatio(this.software ? SOFTWARE_PIXEL_RATIO.still : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.scene.background = this.textures[1] ?? null;
    this.scene.fog = new FogExp2(new Color(HORIZON), 0.026);

    this.moon.position.set(-7, 11, 14);
    this.matchLight.castShadow = true;
    this.matchLight.shadow.mapSize.set(256, 256);
    this.matchLight.shadow.camera.near = 0.2;
    this.matchLight.shadow.camera.far = 30;
    this.matchLight.shadow.bias = -0.002;
    this.matchLight.shadow.normalBias = 0.03;
    this.scene.add(this.hemisphere, this.moon, this.moon.target, this.matchLight, this.glowLight, this.heldLight, this.camera);

    this.alleyMaterial = new MeshLambertMaterial({ vertexColors: true, map: this.textures[0] ?? null });
    this.alley = new Mesh(buildAlley(), this.alleyMaterial);
    this.alley.receiveShadow = true;
    this.scene.add(this.alley);

    this.washMaterial = washMaterial(this.washAmount);
    this.wash = new Mesh(new PlaneGeometry(2, 2), this.washMaterial);
    this.wash.frustumCulled = false;
    this.wash.renderOrder = 100;
    this.wash.visible = false;
    this.scene.add(this.wash);
  }

  private width = 0;
  private height = 0;
  private moving = false;
  private lastFrameDone: WebGLSync | null = null;

  /** Software GL only: trades sharpness for speed while the picture moves. Returns whether the buffer was resized. */
  setMoving(moving: boolean): boolean {
    if (!this.software || moving === this.moving) return false;
    this.moving = moving;
    this.renderer.setPixelRatio(moving ? SOFTWARE_PIXEL_RATIO.moving : SOFTWARE_PIXEL_RATIO.still);
    this.renderer.setSize(this.width, this.height, false);
    return true;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Software GL only: false while the last frame is still being drawn, so a slow CPU never builds a queue of frames. */
  get readyToDraw(): boolean {
    if (!this.lastFrameDone) return true;
    const context = this.renderer.getContext() as WebGL2RenderingContext;
    if (context.getSyncParameter(this.lastFrameDone, context.SYNC_STATUS) !== context.SIGNALED) return false;
    context.deleteSync(this.lastFrameDone);
    this.lastFrameDone = null;
    return true;
  }

  /** Marks the end of a frame's drawing commands (software GL only). */
  frameDrawn(): void {
    if (!this.software) return;
    const context = this.renderer.getContext() as WebGL2RenderingContext;
    this.lastFrameDone = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
    context.flush();
  }

  /** Pixels of the drawing buffer per unit of view height at distance 1 (for point sprites). */
  get pixelsPerUnit(): number {
    const height = this.renderer.domElement.height;
    return height / (2 * Math.tan((FOV_DEG * Math.PI) / 360));
  }

  /** A sheet lies over the scene. */
  get dimmed(): boolean {
    return this.washAmount.value > 0;
  }

  setDim(amount: number): void {
    this.washAmount.value = amount;
    this.wash.visible = amount > 0;
  }
}
