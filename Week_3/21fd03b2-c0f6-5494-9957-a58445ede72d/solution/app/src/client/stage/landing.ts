import {
  AmbientLight,
  Color,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { STAGE, makeCart, makeWedge } from "./rigs";

/** Landing scene geometry in metres: a 5 m ramp at 30 degrees, a pendulum on a frame, a capsule cart. */
const RAMP_LENGTH = 5;
const RAMP_ANGLE = 30;
const RAD = Math.PI / 180;
const RUN = RAMP_LENGTH * Math.cos(RAMP_ANGLE * RAD);
const RISE = RAMP_LENGTH * Math.sin(RAMP_ANGLE * RAD);
const RAMP_X = -2.2;
const PIVOT = new Vector3(3.6, 3.2, 0);
const ROD = 2.4;
const RELEASE = 38 * RAD;
const TARGET = new Vector3(0.8, 1.4, 0);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: Vector3, b: Vector3, t: number): Vector3 => new Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const CAMERA_OPENING = new Vector3(8.5, 4.6, 10.5);
const CAMERA_SIDE = new Vector3(0.8, 2.2, 12.5);
const CAMERA_HIGH = new Vector3(9.5, 10, 9.5);

/** The camera as a pure function of scroll progress: opening shot, ramp side, a quarter orbit, then a high three-quarter view. */
function cameraAt(progress: number): { position: Vector3; target: Vector3 } {
  const first = clamp01(progress * 3);
  const second = clamp01(progress * 3 - 1);
  const third = clamp01(progress * 3 - 2);
  if (progress <= 1 / 3) return { position: lerp3(CAMERA_OPENING, CAMERA_SIDE, first), target: TARGET };
  const radius = Math.hypot(CAMERA_SIDE.x - TARGET.x, CAMERA_SIDE.z - TARGET.z);
  const start = Math.atan2(CAMERA_SIDE.x - TARGET.x, CAMERA_SIDE.z - TARGET.z);
  const turned = start + second * (Math.PI / 2);
  const orbit = new Vector3(TARGET.x + Math.sin(turned) * radius, CAMERA_SIDE.y, TARGET.z + Math.cos(turned) * radius);
  if (progress <= 2 / 3) return { position: orbit, target: TARGET };
  const orbitEnd = new Vector3(TARGET.x + Math.sin(start + Math.PI / 2) * radius, CAMERA_SIDE.y, TARGET.z + Math.cos(start + Math.PI / 2) * radius);
  return { position: lerp3(orbitEnd, CAMERA_HIGH, third), target: TARGET };
}

/** Cart position along the ramp (0 at the top, 1 at the foot), world coordinates. */
function cartAt(progress: number): { x: number; y: number } {
  const t = clamp01(progress * 3);
  const top = { x: RAMP_X - RUN / 2, y: RISE };
  const foot = { x: RAMP_X + RUN / 2, y: 0 };
  return { x: lerp(top.x, foot.x, t), y: lerp(top.y, foot.y, t) };
}

function pendulumAngle(progress: number): number {
  const t = clamp01(progress * 3 - 1);
  return RELEASE * Math.cos(Math.PI * t);
}

export class LandingScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(46, 1, 0.1, 400);
  private readonly cart = makeCart();
  private readonly bob: Mesh;
  private readonly rod: Mesh;
  private readonly observer: ResizeObserver;
  private last = -1;
  /** Pulls the camera back on portrait screens so the ramp, pendulum and cart stay in frame. */
  private dolly = 1;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.className = "stage-canvas";
    container.appendChild(this.renderer.domElement);
    this.scene.background = new Color(STAGE.sky);
    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(5, 10, 6);
    this.scene.add(sun);
    const ground = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial({ color: STAGE.grass }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    const grid = new GridHelper(120, 120, 0x1e1e2e, 0x1e1e2e);
    const gridMaterial = grid.material as LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.1;
    const ramp = makeWedge(RAMP_LENGTH, RAMP_ANGLE, 1.4);
    ramp.position.set(RAMP_X, 0, 0);
    const frame = new Group();
    const post = (z: number): Mesh => {
      const mesh = new Mesh(new CylinderGeometry(0.06, 0.06, PIVOT.y + 0.1, 10), new MeshLambertMaterial({ color: STAGE.frame }));
      mesh.position.set(PIVOT.x, PIVOT.y / 2, z);
      return mesh;
    };
    const beam = new Mesh(new CylinderGeometry(0.06, 0.06, 1.8, 10), new MeshLambertMaterial({ color: STAGE.frame }));
    beam.rotation.x = Math.PI / 2;
    beam.position.copy(PIVOT);
    frame.add(post(-0.9), post(0.9), beam);
    this.rod = new Mesh(new CylinderGeometry(0.025, 0.025, ROD, 8), new MeshLambertMaterial({ color: STAGE.frame }));
    this.bob = new Mesh(new SphereGeometry(0.34, 24, 16), new MeshLambertMaterial({ color: STAGE.bob }));
    this.cart.scale.setScalar(1.7);
    this.scene.add(ground, grid, ramp, frame, this.rod, this.bob, this.cart);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = width / height;
    this.dolly = Math.min(3, Math.max(1, Math.pow(1.6 / this.camera.aspect, 0.8)));
    this.camera.updateProjectionMatrix();
    this.last = -1;
  }

  /** Poses every moving part from the progress alone and draws, only when the progress or the size changed. */
  draw(progress: number): void {
    if (progress === this.last) return;
    this.last = progress;
    const cart = cartAt(progress);
    const slope = -RAMP_ANGLE * RAD;
    this.cart.position.set(cart.x, cart.y, 0);
    this.cart.rotation.z = slope;
    const phi = pendulumAngle(progress);
    const bob = new Vector3(PIVOT.x + Math.sin(phi) * ROD, PIVOT.y - Math.cos(phi) * ROD, 0);
    this.bob.position.copy(bob);
    this.rod.position.copy(PIVOT).lerp(bob, 0.5);
    this.rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), bob.clone().sub(PIVOT).normalize());
    const { position, target } = cameraAt(progress);
    this.camera.position.copy(target).addScaledVector(position.clone().sub(target), this.dolly);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function createLanding(container: HTMLElement): LandingScene | null {
  try {
    return new LandingScene(container);
  } catch {
    return null;
  }
}
