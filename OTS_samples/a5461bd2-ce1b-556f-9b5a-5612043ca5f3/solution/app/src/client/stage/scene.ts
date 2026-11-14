import {
  CircleGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, MathUtils, Mesh, MeshStandardMaterial,
  Object3D, PerspectiveCamera, Scene, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { WORLD_STEP_DEG } from "../../shared/stage-rules";

/** The Three.js stage: eight islands on a ring, seen from its centre, drawn from the models the site serves. */

interface SceneState {
  yaw: number;
  inside: number;
  descent: number;
  emblem: number;
}

const RING_RADIUS = 11;
const SKY = 0x070b14;
const RING_EYE = { y: 3.4, lookY: 1.3 };
const INSIDE_EYE = { distance: 6.0, y: 3.2, lookY: 1.6 };

const degrees = (value: number) => MathUtils.degToRad(value);

export class StageScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 0.1, 120);
  private readonly ring = new Group();
  private readonly emblems: Object3D[] = [];
  private width = 0;
  private height = 0;
  private shift = { x: 0, y: 0 };
  /** Until the first frame is drawn nothing is culled, so every island's buffers reach the GPU at once. */
  private firstFrameDrawn = false;

  /** Throws when the browser offers no WebGL. */
  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute("aria-hidden", "true");
    this.renderer.setClearColor(SKY);
    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, 17, 50);
    const sky = new HemisphereLight(0xb7c8ff, 0x1b1523, 1.1);
    const sun = new DirectionalLight(0xfff0d8, 2.3);
    sun.position.set(6, 10, 7);
    const sea = new Mesh(new CircleGeometry(90, 72), new MeshStandardMaterial({ color: 0x0b1730, roughness: 0.3, metalness: 0.25 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.06;
    this.scene.add(sky, sun, sea, this.ring);
  }

  /** Fetches all eight models; rejects when any request fails. */
  async load(slugs: string[]): Promise<void> {
    const loader = new GLTFLoader();
    const models = await Promise.all(slugs.map((slug) => loader.loadAsync(`/scenes/${slug}/world.glb`)));
    this.ring.clear();
    this.emblems.length = 0;
    models.forEach((model, at) => {
      const island = new Group();
      const angle = at * WORLD_STEP_DEG;
      island.position.set(Math.sin(degrees(angle)) * RING_RADIUS, 0, -Math.cos(degrees(angle)) * RING_RADIUS);
      island.rotation.y = -degrees(angle);
      island.add(model.scene);
      model.scene.traverse((object) => {
        object.frustumCulled = false;
        if (object.name === "emblem") this.emblems.push(object);
      });
      this.ring.add(island);
    });
    this.firstFrameDrawn = false;
  }

  /** Sizes the canvas to its frame and moves the scene right and down by a share of the frame, so overlay text keeps clear. */
  layout(width: number, height: number, shiftX: number, shiftY: number): void {
    if (width === 0 || height === 0) return;
    if (width === this.width && height === this.height && shiftX === this.shift.x && shiftY === this.shift.y) return;
    this.width = width;
    this.height = height;
    this.shift = { x: shiftX, y: shiftY };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 1 ? 50 + (1 - this.camera.aspect) * 45 : 50;
    this.camera.setViewOffset(width, height, -shiftX * width, -shiftY * height, width, height);
    this.camera.updateProjectionMatrix();
  }

  render(state: SceneState): void {
    this.ring.rotation.y = degrees(state.yaw);
    for (const emblem of this.emblems) emblem.rotation.y = degrees(state.emblem);
    const eye = this.camera.position;
    const inside = state.inside;
    const lift = state.descent;
    eye.set(0, MathUtils.lerp(RING_EYE.y, INSIDE_EYE.y, inside) + lift * 13, MathUtils.lerp(0, -(RING_RADIUS - INSIDE_EYE.distance), inside) + lift * 7);
    this.camera.lookAt(0, MathUtils.lerp(MathUtils.lerp(RING_EYE.lookY, INSIDE_EYE.lookY, inside), 0.2, lift), MathUtils.lerp(-RING_RADIUS, -RING_RADIUS * 0.45, lift));
    this.renderer.render(this.scene, this.camera);
    if (!this.firstFrameDrawn) {
      this.firstFrameDrawn = true;
      this.ring.traverse((object) => (object.frustumCulled = true));
    }
  }
}
