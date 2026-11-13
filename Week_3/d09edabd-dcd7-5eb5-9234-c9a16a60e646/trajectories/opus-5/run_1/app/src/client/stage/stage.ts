import * as THREE from 'three';
import type { Placement } from '../../shared/types.js';
import { clear, el } from '../dom.js';
import { entryPose, gridFloor, lights, placementMesh, roomShell, toMetres } from './geometry.js';
import type { RoomSize } from './geometry.js';
import { floorPlan } from './plan.js';

export type CameraWord = 'Overview' | 'Walking in' | 'Player height';

export interface TesterMarker {
  displayName: string;
  xMm: number;
  zMm: number;
  headingDeg: number;
}

interface Pose {
  yaw: number;
  pitch: number;
  distance: number;
}

const overviewPose: Pose = { yaw: 30, pitch: 35, distance: 1 };

export class RoomStage {
  readonly element: HTMLElement;
  readonly webgl: boolean;
  private readonly canvasHolder: HTMLElement;
  private readonly cameraStatus: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private roomGroup: THREE.Group | null = null;
  private meshes = new Map<string, THREE.Object3D>();
  private markers = new Map<string, THREE.Object3D>();
  private selectionRing: THREE.Object3D | null = null;
  private room: RoomSize | null = null;
  private placements: Placement[] = [];
  private pose: Pose = { ...overviewPose };
  private mode: 'overview' | 'player' = 'overview';
  private player = { x: 0, z: 0, heading: 0 };

  onPick: (placementId: string | null) => void = () => undefined;
  onOrbit: () => void = () => undefined;
  onDragPlacement: (placementId: string, dx: number, dy: number) => void = () => undefined;
  onDragEnd: (placementId: string) => void = () => undefined;

  constructor() {
    this.canvasHolder = el('div', { class: 'stage-inner' });
    this.cameraStatus = el('div', {
      role: 'status',
      'aria-label': 'Camera',
      class: 'visually-hidden',
      text: 'Overview',
    });
    this.element = el('div', { class: 'stage', role: 'region', 'aria-label': 'Room stage', tabindex: '0' }, [
      this.canvasHolder,
      this.cameraStatus,
    ]);
    this.webgl = this.start();
    this.writeCamera();
    this.bindPointer();
  }

  private start(): boolean {
    let renderer: THREE.WebGLRenderer;
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (context === null) return false;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    for (const light of lights()) this.scene.add(light);
    this.scene.add(gridFloor());
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);
    this.canvasHolder.append(renderer.domElement);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const loop = (): void => {
      this.draw();
      window.requestAnimationFrame(loop);
    };
    window.requestAnimationFrame(loop);
    return true;
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const width = this.element.clientWidth || window.innerWidth;
    const height = this.element.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  get yaw(): number {
    return Math.round(this.pose.yaw);
  }

  get pitch(): number {
    return Math.round(this.pose.pitch);
  }

  setRoom(room: RoomSize, placements: Placement[]): void {
    this.room = room;
    this.placements = placements;
    if (!this.webgl || !this.scene) {
      this.drawPlan();
      return;
    }
    if (this.roomGroup) this.scene.remove(this.roomGroup);
    this.roomGroup = new THREE.Group();
    this.roomGroup.add(roomShell(room));
    this.meshes = new Map();
    for (const placement of placements) {
      const mesh = placementMesh(placement);
      this.meshes.set(placement.id, mesh);
      this.roomGroup.add(mesh);
    }
    this.scene.add(this.roomGroup);
  }

  updatePlacement(placement: Placement): void {
    if (!this.webgl) {
      this.placements = this.placements.map((item) =>
        item.id === placement.id ? placement : item,
      );
      this.drawPlan();
      return;
    }
    const mesh = this.meshes.get(placement.id);
    if (!mesh) {
      if (this.room) this.setRoom(this.room, [...this.placements, placement]);
      return;
    }
    this.placements = this.placements.map((item) => (item.id === placement.id ? placement : item));
    this.roomGroup?.remove(mesh);
    const replacement = placementMesh(placement);
    this.meshes.set(placement.id, replacement);
    this.roomGroup?.add(replacement);
  }

  removePlacement(placementId: string): void {
    this.placements = this.placements.filter((item) => item.id !== placementId);
    const mesh = this.meshes.get(placementId);
    if (mesh && this.roomGroup) this.roomGroup.remove(mesh);
    this.meshes.delete(placementId);
    if (!this.webgl) this.drawPlan();
  }

  setSelection(placementId: string | null): void {
    if (!this.webgl || !this.roomGroup) return;
    if (this.selectionRing) {
      this.roomGroup.remove(this.selectionRing);
      this.selectionRing = null;
    }
    const placement = this.placements.find((item) => item.id === placementId);
    if (!placement) return;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(
        Math.max(toMetres(placement.widthMm), toMetres(placement.depthMm)) * 0.6,
        Math.max(toMetres(placement.widthMm), toMetres(placement.depthMm)) * 0.7,
        24,
      ),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(toMetres(placement.xMm), toMetres(placement.yMm) + 0.01, toMetres(placement.zMm));
    this.selectionRing = ring;
    this.roomGroup.add(ring);
  }

  setTesters(testers: TesterMarker[]): void {
    if (!this.webgl || !this.roomGroup) return;
    for (const marker of this.markers.values()) this.roomGroup.remove(marker);
    this.markers = new Map();
    for (const tester of testers) {
      const marker = new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 0.5, 8),
        new THREE.MeshBasicMaterial({ color: 0x7dd3fc }),
      );
      marker.position.set(toMetres(tester.xMm), 0.8, toMetres(tester.zMm));
      marker.rotation.y = (tester.headingDeg * Math.PI) / 180;
      this.markers.set(tester.displayName, marker);
      this.roomGroup.add(marker);
    }
  }

  setCamera(yaw: number, pitch: number): void {
    this.pose.yaw = ((Math.round(yaw) % 360) + 360) % 360;
    this.pose.pitch = Math.min(80, Math.max(5, Math.round(pitch)));
    this.mode = 'overview';
    this.writeCamera();
  }

  turn(yawDelta: number, pitchDelta: number): void {
    this.setCamera(this.pose.yaw + yawDelta, this.pose.pitch + pitchDelta);
  }

  zoom(step: number): void {
    this.pose.distance = Math.min(3, Math.max(0.4, this.pose.distance + step));
  }

  savedPose(): { yaw: number; pitch: number; distance: number } {
    return { ...this.pose };
  }

  restorePose(pose: { yaw: number; pitch: number; distance: number }, word: CameraWord): void {
    this.pose = { ...pose };
    this.mode = 'overview';
    this.announce(word);
    this.writeCamera();
  }

  announce(word: CameraWord): void {
    this.cameraStatus.textContent = word;
  }

  /** The doorway walk-in: a dolly to the player-height pose, or a cut. */
  async walkIn(instant: boolean): Promise<void> {
    if (!this.room) return;
    const pose = entryPose(this.room, this.placements);
    this.player = { x: pose.x, z: pose.z, heading: pose.heading };
    if (instant || !this.webgl) {
      this.mode = 'player';
      this.announce('Player height');
      this.writeCamera();
      return;
    }
    this.announce('Walking in');
    const started = performance.now();
    const duration = 600;
    await new Promise<void>((resolve) => {
      const step = (): void => {
        const progress = Math.min(1, (performance.now() - started) / duration);
        this.walkProgress = progress;
        if (progress < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        this.walkProgress = null;
        this.mode = 'player';
        this.announce('Player height');
        resolve();
      };
      window.requestAnimationFrame(step);
    });
  }

  async toOverview(instant: boolean): Promise<void> {
    if (instant || !this.webgl) {
      this.mode = 'overview';
      this.announce('Overview');
      return;
    }
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const step = (): void => {
        const progress = Math.min(1, (performance.now() - started) / 600);
        this.walkProgress = 1 - progress;
        if (progress < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        this.walkProgress = null;
        this.mode = 'overview';
        this.announce('Overview');
        resolve();
      };
      window.requestAnimationFrame(step);
    });
  }

  private walkProgress: number | null = null;

  setPlayer(x: number, z: number, heading: number): void {
    this.player = { x, z, heading };
    this.mode = 'player';
  }

  get playerPose(): { x: number; z: number; heading: number } {
    return { ...this.player };
  }

  setTourProgress(progress: number): void {
    this.walkProgress = progress <= 0 ? null : Math.min(1, progress);
    if (progress >= 1) this.mode = 'player';
    else this.mode = 'overview';
  }

  private writeCamera(): void {
    this.element.setAttribute('data-cam-yaw', String(this.yaw));
    this.element.setAttribute('data-cam-pitch', String(this.pitch));
  }

  private overviewPosition(): THREE.Vector3 {
    const room = this.room ?? { widthMm: 4000, depthMm: 4000, heightMm: 2500 };
    const width = toMetres(room.widthMm);
    const depth = toMetres(room.depthMm);
    const radius =
      Math.max(width, depth) * 1.5 * this.pose.distance + toMetres(room.heightMm) * 0.5;
    const yaw = (this.pose.yaw * Math.PI) / 180;
    const pitch = (this.pose.pitch * Math.PI) / 180;
    return new THREE.Vector3(
      width / 2 + radius * Math.cos(pitch) * Math.sin(yaw),
      radius * Math.sin(pitch) + 0.5,
      depth / 2 + radius * Math.cos(pitch) * Math.cos(yaw),
    );
  }

  private draw(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const room = this.room;
    const target = room
      ? new THREE.Vector3(toMetres(room.widthMm) / 2, 0.6, toMetres(room.depthMm) / 2)
      : new THREE.Vector3(0, 0.6, 0);
    const overview = this.overviewPosition();
    const heading = (this.player.heading * Math.PI) / 180;
    const eye = new THREE.Vector3(this.player.x, 1.6, this.player.z);
    const look = new THREE.Vector3(
      this.player.x + Math.sin(heading) * 2,
      1.5,
      this.player.z + Math.cos(heading) * 2,
    );
    if (this.mode === 'player' && this.walkProgress === null) {
      this.camera.position.copy(eye);
      this.camera.lookAt(look);
    } else if (this.walkProgress !== null) {
      const t = this.walkProgress;
      this.camera.position.lerpVectors(overview, eye, t);
      const aim = new THREE.Vector3().lerpVectors(target, look, t);
      this.camera.lookAt(aim);
    } else {
      this.camera.position.copy(overview);
      this.camera.lookAt(target);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private drawPlan(): void {
    clear(this.canvasHolder);
    if (this.room) {
      this.canvasHolder.append(floorPlan(this.room, this.placements));
    }
  }

  private bindPointer(): void {
    let dragging = false;
    let placementId: string | null = null;
    let lastX = 0;
    let lastY = 0;
    this.element.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('.cluster, .sheet, .scrim')) return;
      lastX = event.clientX;
      lastY = event.clientY;
      placementId = this.pickAt(event.clientX, event.clientY);
      dragging = true;
      this.onPick(placementId);
      this.element.setPointerCapture(event.pointerId);
    });
    this.element.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (placementId === null) {
        this.pose.yaw = ((Math.round(this.pose.yaw + dx * 0.5) % 360) + 360) % 360;
        this.pose.pitch = Math.min(80, Math.max(5, Math.round(this.pose.pitch - dy * 0.5)));
        this.writeCamera();
        this.onOrbit();
        return;
      }
      this.onDragPlacement(placementId, dx, dy);
    });
    const stop = (event: PointerEvent): void => {
      if (dragging && placementId !== null) this.onDragEnd(placementId);
      dragging = false;
      placementId = null;
      if (this.element.hasPointerCapture(event.pointerId)) {
        this.element.releasePointerCapture(event.pointerId);
      }
    };
    this.element.addEventListener('pointerup', stop);
    this.element.addEventListener('pointercancel', stop);
    this.element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.zoom(event.deltaY > 0 ? 0.08 : -0.08);
      },
      { passive: false },
    );
  }

  private pickAt(clientX: number, clientY: number): string | null {
    if (!this.webgl || !this.camera || !this.roomGroup) return null;
    const bounds = this.element.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObjects([...this.meshes.values()], false);
    return hits.length > 0 ? hits[0].object.name : null;
  }
}
