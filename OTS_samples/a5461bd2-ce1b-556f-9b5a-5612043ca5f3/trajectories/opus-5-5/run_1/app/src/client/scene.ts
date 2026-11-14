import {
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { islandPosition, type Pose } from "./camera.js";

const BACKGROUND = "#0A0E15";

export function hasWebGL(): boolean {
  const probe = document.createElement("canvas");
  return probe.getContext("webgl2") !== null || probe.getContext("webgl") !== null;
}

/** Fetches every world's model; resolves null when any of them fails. */
export async function fetchModels(slugs: readonly string[]): Promise<ArrayBuffer[] | null> {
  try {
    return await Promise.all(
      slugs.map(async (slug) => {
        const response = await fetch(`/scenes/${slug}/world.glb`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Scene ${slug} answered ${response.status}`);
        return response.arrayBuffer();
      }),
    );
  } catch {
    return null;
  }
}

export class RingScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(52, 1, 0.1, 200);
  private readonly emblems: Object3D[] = [];
  private readonly canvas: HTMLCanvasElement;

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new Color(BACKGROUND);
    this.scene.fog = new FogExp2(BACKGROUND, 0.035);
    this.scene.add(new HemisphereLight("#FFF4E0", "#1A2230", 1.6));
    const sun = new DirectionalLight("#FFFFFF", 2.2);
    sun.position.set(4, 12, 6);
    this.scene.add(sun);
  }

  /** Resolves null when a model cannot be parsed or WebGL cannot start. */
  static async create(canvas: HTMLCanvasElement, models: ArrayBuffer[]): Promise<RingScene | null> {
    let ring: RingScene;
    try {
      ring = new RingScene(canvas);
    } catch {
      return null;
    }
    const loader = new GLTFLoader();
    try {
      const gltfs = await Promise.all(models.map((model) => loader.parseAsync(model, "")));
      gltfs.forEach((gltf, i) => {
        const island = gltf.scene;
        island.position.set(...islandPosition(i + 1));
        island.rotation.y = (-(i * 45) * Math.PI) / 180;
        island.traverse((node) => {
          if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) node.material.side = DoubleSide;
        });
        const emblem = island.getObjectByName("emblem");
        if (emblem === undefined) throw new Error("Model has no emblem");
        ring.emblems.push(emblem);
        ring.scene.add(island);
      });
    } catch {
      ring.renderer.dispose();
      return null;
    }
    return ring;
  }

  render(pose: Pose, emblemAngle: number): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.floor(width * ratio) || this.canvas.height !== Math.floor(height * ratio)) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.fov = this.camera.aspect < 1 ? 72 : 52;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(...pose.position);
    this.camera.lookAt(...pose.target);
    const radians = (emblemAngle * Math.PI) / 180;
    for (const emblem of this.emblems) emblem.rotation.y = radians;
    this.renderer.render(this.scene, this.camera);
  }
}
