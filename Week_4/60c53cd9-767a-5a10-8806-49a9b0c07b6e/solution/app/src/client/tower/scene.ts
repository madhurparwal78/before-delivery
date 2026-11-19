/** The WebGL tower: Draco models from storage drawn with a hard-edged two-tone shader, in the two field colours only. */
import {
  BufferGeometry,
  Color,
  ColorManagement,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  BackSide,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { TowerAssets } from "../../shared/api-types.js";
import { BANDS, BOTTOM_FLOOR, STACKS, TOP_FLOOR, bandOf, type Band } from "../../shared/domain.js";
import { APOTHEM, STOREY_HEIGHT, TOWER_HEIGHT, normalOf } from "../../shared/tower-geometry.js";
import { EYE_DISTANCE, FRONT_STACK, VISIBLE_DOT, type ViewFrame } from "./projection.js";

// The tower is drawn in exactly the palette's hex values: no sRGB-to-linear conversion of the shader's two colours.
ColorManagement.enabled = false;

const GROUND = "#2A1FD0";
const INK = "#FFFFFF";

/** The shell's three parts, told apart by the material name the model carries. */
interface ShellPart {
  readonly geometry: BufferGeometry;
  readonly part: string;
}

interface TowerModels {
  readonly shell: readonly ShellPart[];
  readonly plates: ReadonlyMap<Band, BufferGeometry>;
  readonly facade: Texture;
  readonly ramp: Texture;
}

const geometryOf = (root: Group): BufferGeometry => {
  let found: BufferGeometry | null = null;
  root.traverse((node) => {
    if (found === null && node instanceof Mesh) found = node.geometry as BufferGeometry;
  });
  if (found === null) throw new Error("model has no mesh");
  return found;
};

const shellParts = (root: Group): ShellPart[] => {
  const parts: ShellPart[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh) parts.push({ geometry: node.geometry as BufferGeometry, part: (node.material as ShaderMaterial).name });
  });
  return parts;
};

/** Loads the shell, the five floor plates and both textures from the signed links. Rejects when any file fails. */
export const loadModels = async (assets: TowerAssets): Promise<TowerModels> => {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  const textures = new TextureLoader();
  try {
    const [shell, facade, ramp, ...plates] = await Promise.all([
      gltf.loadAsync(assets.shell),
      textures.loadAsync(assets.facade),
      textures.loadAsync(assets.ramp),
      ...BANDS.map((band) => gltf.loadAsync(assets.plates[band] as string)),
    ]);
    facade.wrapS = RepeatWrapping;
    facade.wrapT = RepeatWrapping;
    facade.minFilter = LinearMipmapLinearFilter;
    facade.generateMipmaps = true;
    ramp.minFilter = NearestFilter;
    ramp.magFilter = NearestFilter;
    ramp.generateMipmaps = false;
    return {
      shell: shellParts(shell.scene),
      plates: new Map(BANDS.map((band, index) => [band, geometryOf((plates[index] as { scene: Group }).scene)])),
      facade,
      ramp,
    };
  } finally {
    draco.dispose();
  }
};

/** A face is in the light when it turns at most about 32 degrees from the light; neighbouring stacks are at least 36 apart, so one face is lit at rest. */
const LIT_DOT = 0.85;

const VERTEX = `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = `
uniform sampler2D uRamp;
uniform sampler2D uFacade;
uniform vec3 uLight;
uniform vec3 uView;
uniform vec3 uHigh;
uniform vec3 uLow;
uniform float uFacadeOn;
uniform float uPane;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vNormal);
  float lit = max(step(${LIT_DOT.toFixed(2)}, dot(n, uLight)), step(0.5, n.y));
  float pane = uFacadeOn > 0.5 ? step(0.5, texture2D(uFacade, vUv).r) * step(${VISIBLE_DOT.toFixed(2)}, dot(n, uView)) : uPane;
  float tone = mix(lit, 1.0 - lit, pane);
  float ramp = step(0.5, texture2D(uRamp, vec2(0.05 + 0.9 * tone, 0.5)).r);
  gl_FragColor = vec4(mix(uLow, uHigh, ramp), 1.0);
}`;

const OUTLINE_FRAGMENT = `
uniform vec3 uHigh;
void main() {
  gl_FragColor = vec4(uHigh, 1.0);
}`;

class TowerLook {
  readonly wall: ShaderMaterial;
  readonly roof: ShaderMaterial;
  readonly slab: ShaderMaterial;
  readonly outline: ShaderMaterial;
  private readonly materials: ShaderMaterial[];
  private readonly view: Vector3;
  private readonly colours: { uHigh: { value: Color }; uLow: { value: Color } };

  constructor(models: TowerModels) {
    const front = normalOf(STACKS[FRONT_STACK].bearing);
    const light = new Vector3(front.x, 0, front.z);
    this.view = light.clone();
    const shared = { uHigh: { value: new Color(INK) }, uLow: { value: new Color(GROUND) } };
    const make = (facadeOn: number, pane: number): ShaderMaterial =>
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          ...shared,
          uRamp: { value: models.ramp },
          uFacade: { value: models.facade },
          uLight: { value: light },
          uView: { value: this.view },
          uFacadeOn: { value: facadeOn },
          uPane: { value: pane },
        },
      });
    this.wall = make(1, 0);
    this.roof = make(0, 0);
    this.slab = make(0, 1);
    this.outline = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: OUTLINE_FRAGMENT, uniforms: { uHigh: shared.uHigh }, side: BackSide });
    this.materials = [this.wall, this.roof, this.slab, this.outline];
    this.colours = shared;
  }

  /** Swaps the tower's two colours so it stays readable on the other field. */
  setInverted(inverted: boolean): void {
    this.colours.uHigh.value.set(inverted ? GROUND : INK);
    this.colours.uLow.value.set(inverted ? INK : GROUND);
  }

  /** Plan direction towards the viewer: windows on faces turned further away than the cells are not drawn. */
  setView(x: number, z: number): void {
    this.view.set(x, 0, z).normalize();
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
  }
}

interface TowerBuild {
  /** Vertical scale of the floor plates: the finder draws them as thin floor lines. */
  readonly slabHeight: number;
  /** Plan scale of the podium relative to the model. */
  readonly podiumPlan: number;
}

/** Floor plates are modelled proud of the wall; drawn flush they keep the tower's silhouette clean. */
const PLATE_FLUSH = 1.006 / 1.04;

/** The shell with its silhouette line, and one floor plate under every residential storey. */
const buildTower = (models: TowerModels, look: TowerLook, build: TowerBuild): { tower: Group; outlines: Mesh[] } => {
  const tower = new Group();
  const outlines: Mesh[] = [];
  for (const { geometry, part } of models.shell) {
    const mesh = new Mesh(geometry, part === "roof" ? look.roof : look.wall);
    const outline = new Mesh(geometry, look.outline);
    if (part === "podium") {
      mesh.scale.set(build.podiumPlan, 1, build.podiumPlan);
      outline.userData["plan"] = build.podiumPlan;
    }
    tower.add(mesh, outline);
    outlines.push(outline);
  }
  for (let floor = BOTTOM_FLOOR; floor <= TOP_FLOOR; floor += 1) {
    const plate = new Mesh(models.plates.get(bandOf(floor)) as BufferGeometry, look.slab);
    plate.position.y = (floor - 1) * STOREY_HEIGHT;
    plate.scale.set(PLATE_FLUSH, build.slabHeight, PLATE_FLUSH);
    tower.add(plate);
  }
  return { tower, outlines };
};

/** Pushes the silhouette line out by the given number of world units around the plan and above the roof. */
const fitOutlines = (outlines: readonly Mesh[], planUnits: number, heightUnits: number): void => {
  for (const outline of outlines) {
    const plan = ((outline.userData["plan"] as number | undefined) ?? 1) + planUnits / APOTHEM;
    outline.scale.set(plan, 1 + heightUnits / TOWER_HEIGHT, plan);
  }
};

const supportedContext = (canvas: HTMLCanvasElement): boolean => {
  const attempt = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  return attempt !== null;
};

let available: boolean | null = null;

/** Whether this browser can make a WebGL context at all (asked once). */
export const webglAvailable = (): boolean => (available ??= supportedContext(document.createElement("canvas")));

const makeRenderer = (canvas: HTMLCanvasElement, field: string): WebGLRenderer => {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "default" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new Color(field), 1);
  return renderer;
};

/** Width in pixels of the line around the tower's silhouette. */
const OUTLINE_PIXELS = 2;

/** The finder's turntable: a level camera beside the tower, whose pixel mapping matches the DOM cell grid exactly. */
export class FinderScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, EYE_DISTANCE / 2, EYE_DISTANCE * 2);
  private readonly tower: Group;
  private readonly outlines: Mesh[];
  private readonly look: TowerLook;
  private width = 1;
  private height = 1;
  private requested = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, models: TowerModels, onLost: () => void) {
    this.renderer = makeRenderer(canvas, GROUND);
    this.look = new TowerLook(models);
    const built = buildTower(models, this.look, { slabHeight: 0.28, podiumPlan: 0.8 });
    this.tower = built.tower;
    this.outlines = built.outlines;
    this.tower.position.y = -TOWER_HEIGHT / 2;
    this.scene.add(this.tower);
    const toward = normalOf(STACKS[FRONT_STACK].bearing);
    this.camera.position.set(toward.x * EYE_DISTANCE, 0, toward.z * EYE_DISTANCE);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.disposed = true;
      onLost();
    });
  }

  resize(width: number, height: number, frame: ViewFrame): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    // Off-centre projection: the front plane maps at frame.xScale and frame.scale pixels per world unit around the frame's centre.
    const focal = EYE_DISTANCE - APOTHEM;
    const elements = this.camera.projectionMatrix.elements;
    elements[0] = (2 * frame.xScale * focal) / width;
    elements[5] = (2 * frame.scale * focal) / height;
    elements[8] = 1 - (2 * frame.centreX) / width;
    elements[9] = (2 * frame.centreY) / height - 1;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    fitOutlines(this.outlines, OUTLINE_PIXELS / frame.xScale, OUTLINE_PIXELS / frame.scale);
    this.render();
  }

  setRotation(theta: number): void {
    this.tower.rotation.y = theta;
    this.render();
  }

  /** Draws on the next animation frame; many requests in one frame cost one draw. */
  render(): void {
    if (this.requested || this.disposed) return;
    this.requested = true;
    requestAnimationFrame(() => {
      this.requested = false;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.look.dispose();
    this.renderer.dispose();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}

export interface LandingPose {
  /** Storey the camera is level with, fractional between floors. */
  readonly floor: number;
  /** 0 when the roof is in view, 1 at the podium. */
  readonly progress: number;
  /** Which field is behind the tower. */
  readonly inverted: boolean;
}

const LANDING_FOV = 32;
const LANDING_DISTANCE = 74;
/** World units either side of the axis the landing stage must show: the podium and a margin of field. */
const FIT_HALF_WIDTH = 22;
/** World units the camera rises above floor 38 at the top of the page, so the roof is in view. */
const ROOF_LIFT = 12;
/** World units below the eye's floor that the camera aims at the top of the page, so the roof sits high in the stage. */
const ROOF_DROP = 10;
/** World units above the eye's floor that the camera aims at the podium, so the podium sits low in the stage. */
const PODIUM_RISE = 9;

/** The landing's descent: a perspective camera that falls from the roof to the podium beside the tower. */
export class LandingScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(LANDING_FOV, 1, 20, 500);
  private readonly look: TowerLook;
  private requested = false;
  private disposed = false;
  private pose: LandingPose = { floor: 38, progress: 0, inverted: false };

  constructor(canvas: HTMLCanvasElement, models: TowerModels, onLost: () => void) {
    this.renderer = makeRenderer(canvas, GROUND);
    this.look = new TowerLook(models);
    const built = buildTower(models, this.look, { slabHeight: 1, podiumPlan: 1 });
    fitOutlines(built.outlines, 0.1, 0.1);
    this.scene.add(built.tower);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.disposed = true;
      onLost();
    });
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  setPose(pose: LandingPose): void {
    if (pose.floor === this.pose.floor && pose.progress === this.pose.progress && pose.inverted === this.pose.inverted) return;
    this.pose = pose;
    this.draw();
  }

  private place(): void {
    const { floor, progress, inverted } = this.pose;
    const height = (floor - 0.5) * STOREY_HEIGHT;
    const toward = normalOf(STACKS[FRONT_STACK].bearing - 28 + progress * 56);
    // A narrow stage pulls the camera back until the tower's full width fits, with the field beside it.
    const halfWidth = Math.tan((LANDING_FOV * Math.PI) / 360) * this.camera.aspect;
    const distance = Math.max(LANDING_DISTANCE, FIT_HALF_WIDTH / halfWidth);
    const reach = distance / LANDING_DISTANCE;
    // Above the roof the camera looks down on it; at the podium it looks up the tower.
    const eye = height + reach * ROOF_LIFT * (1 - progress) + 2;
    const target = height + reach * (ROOF_DROP * (progress - 1) + PODIUM_RISE * progress);
    this.camera.position.set(toward.x * distance, eye, toward.z * distance);
    this.camera.lookAt(0, target, 0);
    this.look.setView(toward.x, toward.z);
    this.look.setInverted(inverted);
    this.renderer.setClearColor(new Color(inverted ? INK : GROUND), 1);
  }

  private draw(): void {
    if (this.requested || this.disposed) return;
    this.requested = true;
    requestAnimationFrame(() => {
      this.requested = false;
      if (this.disposed) return;
      this.place();
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.look.dispose();
    this.renderer.dispose();
  }
}
