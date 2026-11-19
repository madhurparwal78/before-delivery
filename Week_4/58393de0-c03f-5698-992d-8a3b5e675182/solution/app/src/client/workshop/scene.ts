import {
  Box3, BoxGeometry, BufferGeometry, Color, DoubleSide, EdgesGeometry, Float32BufferAttribute,
  Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera,
  Plane, PlaneGeometry, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from "three";
import type { DesignObject, Vec3, Workplane } from "../../shared/types";
import { createDesignMeshes, toyLights } from "../render";
import { CAMERA_TARGET, cameraPosition, START_CAMERA, type Camera } from "./camera";
import { snapFace, type Face } from "./model";
import type { Hit, PickView } from "./pointer";
import type { WorkshopStore } from "./store";

/** A design token (a CSS custom property of the page) as a three.js colour, so the scene shares the page's palette. */
function token(name: string): Color {
  return new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/** Read when a view is made, once the page's styles are in. */
function tones() {
  const azure = token("--azure");
  const edge = token("--edge");
  return {
    azure,
    edge,
    major: edge.clone().lerp(token("--slate"), 0.5),
    planeMinor: azure.clone().lerp(new Color(1, 1, 1), 0.55),
    background: token("--surface"),
  };
}
const GRID_HALF_MM = 150;
const GRID_STEP_MM = 10;
const GRID_MAJOR_EVERY = 5;
const PLANE_HALF_MM = 60;
const MAX_PIXEL_RATIO = 2;
const HANDLE_SCREEN_SHARE = 0.008;
const MIN_HANDLE_MM = 0.8;
const NEAR_PARALLEL = 0.04;
const MARK_MM = 6;

function gridGeometry(half: number, step: number, majorEvery: number, minorColor: Color, majorColor: Color): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const count = Math.round(half / step);
  for (let i = -count; i <= count; i++) {
    const at = i * step;
    const color = i % majorEvery === 0 ? majorColor : minorColor;
    positions.push(at, -half, 0, at, half, 0, -half, at, 0, half, at, 0);
    for (let k = 0; k < 4; k++) colors.push(color.r, color.g, color.b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

function ownerId(object: Object3D): string | null {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const id: unknown = node.userData.objectId;
    if (typeof id === "string") return id;
  }
  return null;
}

/**
 * The WebGL view of the design: toy-bright meshes on a ground grid, the workplane drawn where it stands, and the
 * selection outlined in the azure field colour with corner handles. It follows the store and redraws on animation
 * frames when something changed.
 */
export class SceneView implements PickView {
  private readonly tones = tones();
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 1, 8000);
  private readonly meshes = createDesignMeshes();
  private readonly ground: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly plane = new Group();
  private readonly selection = new Group();
  private readonly raycaster = new Raycaster();
  private readonly handle = new BoxGeometry(1, 1, 1);
  private readonly handleMaterial = new MeshBasicMaterial({ color: this.tones.azure, depthTest: false });
  private readonly outline = new LineBasicMaterial({ color: this.tones.azure, depthTest: false });
  private readonly planeParts: { geometry: BufferGeometry; material: LineBasicMaterial | MeshBasicMaterial }[] = [];
  private readonly unsubscribe: () => void;
  private readonly observer: ResizeObserver;
  private frame = 0;
  private drawnObjects: DesignObject[] | null = null;
  private drawnPlane: Workplane | null = null;
  private drawnCamera: Camera | null = null;
  private drawnSelection: readonly string[] | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly store: WorkshopStore) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, failIfMajorPerformanceCaveat: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setClearColor(this.tones.background, 1);
    this.camera.up.set(0, 0, 1);
    const [startX, startY] = cameraPosition(START_CAMERA);
    this.scene.add(toyLights({ x: startX - CAMERA_TARGET[0], y: startY - CAMERA_TARGET[1] }));

    this.ground = new LineSegments(
      gridGeometry(GRID_HALF_MM, GRID_STEP_MM, GRID_MAJOR_EVERY, this.tones.edge, this.tones.major),
      new LineBasicMaterial({ vertexColors: true, depthWrite: false }),
    );
    this.ground.position.z = -0.05;
    this.ground.renderOrder = -2;
    this.plane.matrixAutoUpdate = false;
    this.plane.renderOrder = -1;
    this.selection.renderOrder = 10;
    this.scene.add(this.ground, this.plane, this.meshes.root, this.selection);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.unsubscribe = store.subscribe(() => this.follow());
    this.resize();
    this.follow();
    this.draw();
  }

  pick(clientX: number, clientY: number): Hit | null {
    this.aim(clientX, clientY);
    this.meshes.root.updateMatrixWorld(true);
    for (const hit of this.raycaster.intersectObjects(this.meshes.root.children, true)) {
      const id = ownerId(hit.object);
      if (!id) continue;
      const normal = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : hit.point.clone().sub(new Box3().setFromObject(hit.object).getCenter(new Vector3()));
      return { id, normal: [normal.x, normal.y, normal.z] };
    }
    return null;
  }

  planePoint(clientX: number, clientY: number, origin: Vec3, normal: Vec3): Vec3 | null {
    this.aim(clientX, clientY);
    const direction = this.raycaster.ray.direction;
    if (Math.abs(direction.x * normal[0] + direction.y * normal[1] + direction.z * normal[2]) < NEAR_PARALLEL) return null;
    const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(...normal), new Vector3(...origin));
    const point = this.raycaster.ray.intersectPlane(plane, new Vector3());
    return point ? [point.x, point.y, point.z] : null;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.observer.disconnect();
    this.meshes.dispose();
    this.clearGroup(this.selection);
    this.clearPlane();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.handle.dispose();
    this.handleMaterial.dispose();
    this.outline.dispose();
    this.renderer.dispose();
    if (!this.canvas.isConnected) this.renderer.forceContextLoss();
  }

  private aim(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(pointer, this.camera);
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = aspect >= 1 ? 40 : (2 * Math.atan(Math.tan((20 * Math.PI) / 180) / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  /** Brings the scene in line with the store and asks for a redraw. */
  private follow(): void {
    const next = this.store.getState();
    const objectsChanged = next.design.objects !== this.drawnObjects;
    const handlesChanged = objectsChanged || next.selected !== this.drawnSelection || next.camera.distance !== this.drawnCamera?.distance;
    if (objectsChanged) this.meshes.setObjects(next.design.objects, () => this.refreshSelection());
    if (next.design.workplane !== this.drawnPlane) this.drawPlane(next.design.workplane);
    this.drawnObjects = next.design.objects;
    this.drawnPlane = next.design.workplane;
    this.drawnCamera = next.camera;
    this.drawnSelection = next.selected;
    if (handlesChanged) this.refreshSelection();
    this.requestDraw();
  }

  private aimCamera(): void {
    const { camera } = this.store.getState();
    this.camera.position.set(...cameraPosition(camera));
    this.camera.lookAt(...CAMERA_TARGET);
    this.camera.updateMatrixWorld(true);
  }

  private requestDraw(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    this.aimCamera();
    this.renderer.render(this.scene, this.camera);
  }

  private clearGroup(group: Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof LineSegments) child.geometry.dispose();
    }
  }

  private refreshSelection(): void {
    this.clearGroup(this.selection);
    const size = Math.max(MIN_HANDLE_MM, this.store.getState().camera.distance * HANDLE_SCREEN_SHARE);
    this.meshes.root.updateMatrixWorld(true);
    for (const id of this.store.getState().selected) {
      const node = this.meshes.meshFor(id);
      if (!node) continue;
      const box = new Box3().setFromObject(node);
      if (box.isEmpty()) continue;
      const extent = box.getSize(new Vector3());
      const frame = new LineSegments(new EdgesGeometry(new BoxGeometry(extent.x, extent.y, extent.z)), this.outline);
      frame.position.copy(box.getCenter(new Vector3()));
      frame.renderOrder = 10;
      this.selection.add(frame);
      for (let corner = 0; corner < 8; corner++) {
        const knob = new Mesh(this.handle, this.handleMaterial);
        knob.scale.setScalar(size);
        knob.position.set(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z);
        knob.renderOrder = 11;
        this.selection.add(knob);
      }
    }
    this.requestDraw();
  }

  private clearPlane(): void {
    this.plane.clear();
    for (const part of this.planeParts) {
      part.geometry.dispose();
      part.material.dispose();
    }
    this.planeParts.length = 0;
  }

  /** The workplane drawn as a pale azure sheet with its own grid and an origin mark; the ground grid already shows the default one. */
  private drawPlane(workplane: Workplane): void {
    this.clearPlane();
    const atGround = workplane.origin.every((v) => v === 0) && workplane.normal[2] === 1;
    const face = snapFace(workplane.normal);
    const markGeometry = new BufferGeometry();
    markGeometry.setAttribute("position", new Float32BufferAttribute([-MARK_MM, 0, 0, MARK_MM, 0, 0, 0, -MARK_MM, 0, 0, MARK_MM, 0], 3));
    const markMaterial = new LineBasicMaterial({ color: this.tones.azure, depthTest: false });
    this.planeParts.push({ geometry: markGeometry, material: markMaterial });
    const mark = new LineSegments(markGeometry, markMaterial);
    mark.renderOrder = 5;
    this.plane.add(mark);
    if (!atGround) this.drawSheet();
    this.placePlane(face, workplane.origin);
  }

  private drawSheet(): void {
    const sheetGeometry = new PlaneGeometry(PLANE_HALF_MM * 2, PLANE_HALF_MM * 2);
    const sheetMaterial = new MeshBasicMaterial({
      color: this.tones.azure, transparent: true, opacity: 0.12, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const gridMaterial = new LineBasicMaterial({ vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const gridGeo = gridGeometry(PLANE_HALF_MM, GRID_STEP_MM, GRID_MAJOR_EVERY, this.tones.planeMinor, this.tones.azure);
    this.planeParts.push({ geometry: sheetGeometry, material: sheetMaterial }, { geometry: gridGeo, material: gridMaterial });
    this.plane.add(new Mesh(sheetGeometry, sheetMaterial), new LineSegments(gridGeo, gridMaterial));
  }

  /** Stands the workplane drawing on its face: its own x and y along the face's axes, at the workplane origin. */
  private placePlane(face: Face, origin: Vec3): void {
    this.plane.matrix.makeBasis(new Vector3(...face.across), new Vector3(...face.up), new Vector3(...face.normal)).setPosition(...origin);
    this.plane.matrixWorldNeedsUpdate = true;
    this.plane.updateMatrixWorld(true);
    this.requestDraw();
  }
}
