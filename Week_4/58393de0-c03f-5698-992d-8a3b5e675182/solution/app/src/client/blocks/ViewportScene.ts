import { Box3, GridHelper, PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderer } from "three";
import type { DesignObject } from "../../shared/types";
import { createDesignMeshes, toyLights } from "../render";
import type { DesignMeshes } from "../render";

const FOV_DEGREES = 30;
const MIN_REACH_MM = 50;
const FIT_MARGIN = 1.25;
const START_AZIMUTH = 45;
const START_ELEVATION = 32;
const DRAG_DEGREES_PER_PIXEL = 0.5;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;

/** The Block Lab's 3D view: the output objects on a ground grid, dragged to orbit, wheel to zoom. */
export class ViewportScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.1, 20000);
  private readonly meshes: DesignMeshes = createDesignMeshes();
  private readonly observer: ResizeObserver;
  private readonly target = new Vector3();
  private reach = MIN_REACH_MM;
  private azimuth = START_AZIMUTH;
  private elevation = START_ELEVATION;
  private zoom = 1;
  private frame = 0;
  private dragFrom: { x: number; y: number } | null = null;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, failIfMajorPerformanceCaveat: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xffffff, 0);
    this.camera.up.set(0, 0, 1);
    const grid = new GridHelper(240, 12, 0xc4cad4, 0xe6e9ee);
    grid.rotation.x = Math.PI / 2;
    const start = (START_AZIMUTH * Math.PI) / 180;
    this.scene.add(toyLights({ x: Math.cos(start), y: Math.sin(start) }), grid, this.meshes.root);
    this.observer = new ResizeObserver(() => this.requestFrame());
    this.observer.observe(canvas);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerEnd);
    canvas.addEventListener("pointercancel", this.onPointerEnd);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragFrom = { x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragFrom) return;
    this.azimuth -= (event.clientX - this.dragFrom.x) * DRAG_DEGREES_PER_PIXEL;
    this.elevation = Math.min(85, Math.max(8, this.elevation + (event.clientY - this.dragFrom.y) * DRAG_DEGREES_PER_PIXEL));
    this.dragFrom = { x: event.clientX, y: event.clientY };
    this.requestFrame();
  };

  private readonly onPointerEnd = (): void => {
    this.dragFrom = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * Math.exp(event.deltaY * 0.001)));
    this.requestFrame();
  };

  /** Shows the objects; group results arrive later and redraw the view when they do. */
  setObjects(objects: DesignObject[]): void {
    this.meshes.setObjects(objects, () => {
      this.fit();
      this.requestFrame();
    });
  }

  private fit(): void {
    const box = new Box3().setFromObject(this.meshes.root);
    box.expandByPoint(new Vector3(0, 0, 0));
    this.target.copy(box.getCenter(new Vector3()));
    this.reach = Math.max(MIN_REACH_MM, box.getBoundingSphere(new Sphere()).radius);
  }

  private requestFrame(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw(): void {
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const vertical = (FOV_DEGREES * Math.PI) / 360;
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    const distance = ((this.reach * FIT_MARGIN) / Math.sin(Math.min(vertical, horizontal))) * this.zoom;
    const azimuth = (this.azimuth * Math.PI) / 180, elevation = (this.elevation * Math.PI) / 180;
    this.camera.position.set(
      this.target.x + distance * Math.cos(elevation) * Math.cos(azimuth),
      this.target.y + distance * Math.cos(elevation) * Math.sin(azimuth),
      this.target.z + distance * Math.sin(elevation),
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerEnd);
    this.canvas.removeEventListener("pointercancel", this.onPointerEnd);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.meshes.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
