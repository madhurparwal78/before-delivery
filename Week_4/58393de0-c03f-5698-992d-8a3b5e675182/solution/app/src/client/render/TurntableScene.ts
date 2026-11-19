import { Box3, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { Snapshot } from "../../shared/types";
import { createDesignMeshes } from "./designMeshes";
import { toyLights } from "./lights";
import { modelObjects } from "./model";
import type { DesignMeshes } from "./types";

const CROSSFADE_MS = 250;
const FOV_DEGREES = 30;
const ELEVATION_DEGREES = 30;
/** The camera looks from +X +Y (see `frame`); the model turns under fixed lights. */
const TURNTABLE_VIEW = { x: 1, y: 1 } as const;
const FIT_MARGIN = 1.1;
const DEFAULT_REACH_MM = 30;
const TAU = Math.PI * 2;

/** What the camera must fit: the model turns about its vertical axis, so only its horizontal reach and half height matter. */
interface View {
  reach: number;
  half: number;
  centre: Vector3;
}

interface Model {
  meshes: DesignMeshes;
  stage: Group;
  view: View;
}

function emptyView(): View {
  return { reach: DEFAULT_REACH_MM, half: DEFAULT_REACH_MM / 2, centre: new Vector3() };
}

function framing(meshes: DesignMeshes): View {
  const box = new Box3().setFromObject(meshes.root);
  if (box.isEmpty()) return emptyView();
  const size = box.getSize(new Vector3());
  return { reach: Math.hypot(size.x, size.y) / 2, half: size.z / 2, centre: box.getCenter(new Vector3()) };
}

/**
 * One WebGL canvas that turns a snapshot's model once every `turnSeconds`. The angle is a function of
 * performance.now() read inside requestAnimationFrame, so a stepped page clock gives the same camera at the same phase.
 */
export class TurntableScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.1, 5000);
  private readonly pivot = new Group();
  private readonly observer: ResizeObserver;
  private active: Model | null = null;
  private leaving: Model | null = null;
  private fadeStart = 0;
  private fadeFrom: View | null = null;
  private playing = false;
  private phase = 0;
  private playedAt = 0;
  private frameHandle = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly turnMs: number) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, failIfMajorPerformanceCaveat: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xffffff, 0);
    this.camera.up.set(0, 0, 1);
    this.scene.add(toyLights(TURNTABLE_VIEW), this.pivot);
    this.observer = new ResizeObserver(() => {
      this.resize();
      this.requestFrame();
    });
    this.observer.observe(canvas);
    this.resize();
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Turns on or off. Pausing holds the angle; resuming carries on from it. */
  setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    this.phase = this.angle(performance.now());
    this.playedAt = performance.now();
    this.playing = playing;
    this.requestFrame();
  }

  private angle(now: number): number {
    return this.playing ? (this.phase + ((now - this.playedAt) / this.turnMs) * TAU) % TAU : this.phase;
  }

  /** Shows a new snapshot's model. With `crossfade` the old one fades out in place while the new one fades in. */
  setSnapshot(snapshot: Snapshot, crossfade: boolean, onReady?: () => void): void {
    const meshes = createDesignMeshes();
    const stage = new Group();
    stage.add(meshes.root);
    const model: Model = { meshes, stage, view: emptyView() };
    const refit = () => {
      model.view = framing(meshes);
      stage.position.copy(model.view.centre).negate();
      this.requestFrame();
    };
    this.dropLeaving();
    const previous = this.active;
    this.active = model;
    this.pivot.add(stage);
    if (previous && crossfade) {
      this.leaving = previous;
      this.fadeFrom = previous.view;
      this.fadeStart = performance.now();
      meshes.setOpacity(0);
    } else if (previous) {
      this.dispose3d(previous);
    }
    meshes.setObjects(modelObjects(snapshot), refit, () => {
      if (this.disposed || this.active !== model) return;
      refit();
      this.draw();
      onReady?.();
    });
    this.draw();
    this.requestFrame();
  }

  private dispose3d(model: Model): void {
    this.pivot.remove(model.stage);
    model.meshes.dispose();
  }

  private dropLeaving(): void {
    if (!this.leaving) return;
    this.dispose3d(this.leaving);
    this.leaving = null;
    this.fadeFrom = null;
  }

  private get fading(): boolean {
    return this.leaving !== null;
  }

  private requestFrame(): void {
    if (this.disposed || this.frameHandle) return;
    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = 0;
      this.draw();
      if (this.playing || this.fading) this.requestFrame();
    });
  }

  private draw(): void {
    const now = performance.now();
    let view = this.active?.view ?? emptyView();
    if (this.leaving && this.active && this.fadeFrom) {
      const progress = Math.min(1, (now - this.fadeStart) / CROSSFADE_MS);
      this.leaving.meshes.setOpacity(1 - progress);
      this.active.meshes.setOpacity(progress);
      const from = this.fadeFrom;
      view = { reach: from.reach + (view.reach - from.reach) * progress, half: from.half + (view.half - from.half) * progress, centre: view.centre };
      if (progress >= 1) {
        this.active.meshes.setOpacity(1);
        this.dropLeaving();
      }
    }
    this.pivot.rotation.z = this.angle(now);
    this.place(view);
    this.renderer.render(this.scene, this.camera);
  }

  /** Puts the camera at a classic three-quarter angle, far enough that the whole turning model fits the canvas. */
  private place(view: View): void {
    const vertical = (FOV_DEGREES * Math.PI) / 360;
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    const elevation = (ELEVATION_DEGREES * Math.PI) / 180;
    const tallest = view.reach * Math.sin(elevation) + view.half * Math.cos(elevation);
    const fit = Math.max(tallest / Math.tan(vertical), view.reach / Math.tan(horizontal));
    const distance = fit * FIT_MARGIN + view.reach * Math.cos(elevation);
    const flat = distance * Math.cos(elevation) * Math.SQRT1_2;
    this.camera.position.set(flat, flat, distance * Math.sin(elevation));
    this.camera.lookAt(0, 0, 0);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.observer.disconnect();
    this.dropLeaving();
    if (this.active) this.dispose3d(this.active);
    this.active = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
