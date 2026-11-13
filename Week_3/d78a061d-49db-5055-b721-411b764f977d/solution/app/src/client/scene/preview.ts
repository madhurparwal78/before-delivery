import {
  AmbientLight,
  CircleGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildHero, buildWeapon, type HeroFigure, type HeroLook } from './hero.js';
import { el, prefersReducedMotion } from '../dom.js';
import type { Stroke } from '../../shared/types.js';

export type CameraFocus = 'none' | 'head' | 'torso' | 'arms' | 'legs' | 'material' | 'sockets';

const FOCUS_HEIGHTS: Record<CameraFocus, number> = {
  none: 0.9,
  head: 1.62,
  torso: 1.15,
  arms: 1.3,
  legs: 0.45,
  material: 0.9,
  sockets: 1.4,
};

const TURNTABLE_SECONDS = 35;
const CAMERA_MOVE_MS = 400;

interface PreviewOptions {
  label: string;
  turntable: boolean;
}

/** A soft graphite shadow and a pencilled ground ring under the hero. */
function groundSketch(): Group {
  const ground = new Group();
  const shadow = new Mesh(
    new CircleGeometry(0.42, 40),
    new MeshBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.12, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  const ring = new Mesh(
    new RingGeometry(0.78, 0.8, 64),
    new MeshBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.001;
  ground.add(shadow, ring);
  return ground;
}

export class HeroPreview {
  readonly element: HTMLElement;
  readonly webglAvailable: boolean;

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer | null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(42, 1, 0.1, 100);
  private readonly heroRoot = new Group();
  private figure: HeroFigure | null = null;
  private orbit = 0;
  private tilt = 15;
  private distance = 4;
  private gesture: 'none' | 'orbit' | 'zoom' = 'none';
  private turntable: boolean;
  private focusFrom = FOCUS_HEIGHTS.none;
  private focusTo = FOCUS_HEIGHTS.none;
  private focusStartedAt = 0;
  private cameraMoving = false;
  private lastDragAt = Number.NEGATIVE_INFINITY;
  private running = true;
  private pointerId: number | null = null;
  private lastPointerX = 0;
  private pinchDistance: number | null = null;

  constructor(options: PreviewOptions) {
    this.turntable = options.turntable && !prefersReducedMotion();
    this.canvas = el('canvas', { class: 'scene-canvas' });
    this.element = el(
      'div',
      {
        class: 'hero-preview',
        role: 'application',
        'aria-label': options.label,
        tabindex: '0',
        'data-renderer': 'still',
        'data-orbit': '0',
        'data-tilt': '15',
        'data-distance': '4.00',
        'data-gesture': 'none',
        'data-hand-px': '0,0',
        'data-turntable': 'off',
        'data-camera-focus': 'none',
        'data-camera-moving': 'false',
      },
      [this.canvas],
    );

    let renderer: WebGLRenderer | null = null;
    try {
      renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
    this.webglAvailable = renderer !== null;
    this.element.dataset.renderer = this.webglAvailable ? 'webgl' : 'still';
    // The still drawing never turns; only the live scene has the idle turntable.
    this.turntable = this.turntable && this.webglAvailable;

    this.scene.add(new AmbientLight(0xffffff, 0.9));
    const sun = new DirectionalLight(0xffffff, 0.8);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    this.scene.add(this.heroRoot);
    this.scene.add(groundSketch());

    this.bindInput();
    this.frame();
  }

  setHero(look: HeroLook): void {
    this.heroRoot.clear();
    this.figure = buildHero(look);
    this.heroRoot.add(this.figure.group);
  }

  setArmRaiseRadians(radians: number): void {
    this.figure?.setArmRaise(radians);
  }

  setWeapon(strokes: readonly Stroke[] | null): void {
    if (this.figure === null) return;
    this.figure.attachWeapon(strokes === null || strokes.length === 0 ? null : buildWeapon(strokes));
  }

  attachToHand(object: Object3D | null): void {
    this.figure?.attachWeapon(object);
  }

  get handSocket(): Object3D | null {
    return this.figure?.rightHandSocket ?? null;
  }

  setTurntable(on: boolean): void {
    this.turntable = on && !prefersReducedMotion() && this.webglAvailable;
  }

  setCameraFocus(focus: CameraFocus): void {
    this.element.dataset.cameraFocus = focus;
    this.focusFrom = this.focusTo;
    this.focusTo = FOCUS_HEIGHTS[focus];
    if (prefersReducedMotion()) {
      this.focusFrom = this.focusTo;
      this.cameraMoving = false;
      this.element.dataset.cameraMoving = 'false';
      return;
    }
    this.focusStartedAt = performance.now();
    this.cameraMoving = true;
    this.element.dataset.cameraMoving = 'true';
  }

  /** The hero's posed right-hand socket in whole CSS pixels from the element's top-left. */
  handPixels(): { x: number; y: number } {
    const socket = this.figure?.rightHandSocket;
    const rect = this.element.getBoundingClientRect();
    if (socket === undefined || socket === null || rect.width === 0) return { x: 0, y: 0 };
    const world = socket.getWorldPosition(new Vector3());
    const projected = world.clone().project(this.camera);
    return {
      x: Math.round(((projected.x + 1) / 2) * rect.width),
      y: Math.round(((1 - projected.y) / 2) * rect.height),
    };
  }

  destroy(): void {
    this.running = false;
    this.renderer?.dispose();
  }

  private bindInput(): void {
    this.element.addEventListener('keydown', (event) => {
      const step = (): void => {
        event.preventDefault();
      };
      switch (event.key) {
        case 'ArrowRight':
          this.orbit = (this.orbit + 15 + 360) % 360;
          step();
          break;
        case 'ArrowLeft':
          this.orbit = (this.orbit - 15 + 360) % 360;
          step();
          break;
        case 'ArrowUp':
          this.tilt = Math.min(60, this.tilt + 10);
          step();
          break;
        case 'ArrowDown':
          this.tilt = Math.max(-10, this.tilt - 10);
          step();
          break;
        case '+':
          this.distance = Math.max(2, this.distance - 0.5);
          step();
          break;
        case '-':
          this.distance = Math.min(6, this.distance + 0.5);
          step();
          break;
        default:
          break;
      }
    });

    this.element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && this.pinchDistance !== null) return;
      this.pointerId = event.pointerId;
      this.lastPointerX = event.clientX;
      this.gesture = 'orbit';
      this.element.dataset.gesture = 'orbit';
      this.turntableOff();
      this.element.setPointerCapture(event.pointerId);
    });

    this.element.addEventListener('pointermove', (event) => {
      if (this.pointerId !== event.pointerId) return;
      const delta = event.clientX - this.lastPointerX;
      if (delta === 0) return;
      this.lastPointerX = event.clientX;
      this.orbit = (this.orbit + Math.sign(delta) * 2 + 360) % 360;
      this.lastDragAt = performance.now();
    });

    const endPointer = (event: PointerEvent): void => {
      if (this.pointerId !== event.pointerId) return;
      this.pointerId = null;
      this.gesture = 'none';
      this.element.dataset.gesture = 'none';
      this.lastDragAt = performance.now();
    };
    this.element.addEventListener('pointerup', endPointer);
    this.element.addEventListener('pointercancel', endPointer);

    this.element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.distance = Math.min(6, Math.max(2, this.distance + Math.sign(event.deltaY) * 0.5));
      },
      { passive: false },
    );

    this.element.addEventListener(
      'touchstart',
      (event) => {
        if (event.touches.length === 2) {
          this.pinchDistance = this.touchSpread(event);
          this.gesture = 'zoom';
          this.element.dataset.gesture = 'zoom';
          this.turntableOff();
          event.preventDefault();
        }
      },
      { passive: false },
    );

    this.element.addEventListener(
      'touchmove',
      (event) => {
        if (event.touches.length === 2 && this.pinchDistance !== null) {
          const spread = this.touchSpread(event);
          const delta = spread - this.pinchDistance;
          if (Math.abs(delta) > 0.5) {
            this.distance = Math.min(6, Math.max(2, this.distance - Math.sign(delta) * 0.5));
            this.pinchDistance = spread;
          }
          event.preventDefault();
        }
      },
      { passive: false },
    );

    const endTouch = (event: TouchEvent): void => {
      if (event.touches.length < 2) {
        this.pinchDistance = null;
        if (this.gesture === 'zoom') {
          this.gesture = 'none';
          this.element.dataset.gesture = 'none';
          this.lastDragAt = performance.now();
        }
      }
    };
    this.element.addEventListener('touchend', endTouch);
    this.element.addEventListener('touchcancel', endTouch);
  }

  private touchSpread(event: TouchEvent): number {
    const [a, b] = [event.touches[0], event.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private turntableOff(): void {
    this.element.dataset.turntable = 'off';
  }

  /** Without WebGL the preview is a still graphite drawing of the stick figure. */
  private drawStill(width: number, height: number): void {
    const context = this.canvas.getContext('2d');
    if (context === null) return;
    this.canvas.width = width;
    this.canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = '#1d1d1f';
    context.lineWidth = 3;
    context.lineCap = 'round';
    const cx = width / 2;
    const top = height * 0.2;
    const unit = height * 0.12;
    context.beginPath();
    context.arc(cx, top, unit * 0.5, 0, Math.PI * 2);
    context.moveTo(cx, top + unit * 0.5);
    context.lineTo(cx, top + unit * 2.4);
    context.moveTo(cx, top + unit);
    context.lineTo(cx - unit, top + unit * 1.8);
    context.moveTo(cx, top + unit);
    context.lineTo(cx + unit, top + unit * 1.8);
    context.moveTo(cx, top + unit * 2.4);
    context.lineTo(cx - unit * 0.8, top + unit * 4);
    context.moveTo(cx, top + unit * 2.4);
    context.lineTo(cx + unit * 0.8, top + unit * 4);
    context.stroke();
  }

  private frame(): void {
    if (!this.running) return;
    const now = performance.now();
    const rect = this.element.getBoundingClientRect();

    if (this.turntable && this.gesture === 'none' && now - this.lastDragAt > 3000) {
      this.orbit = (this.orbit + 360 / TURNTABLE_SECONDS / 60) % 360;
      this.element.dataset.turntable = 'on';
    } else if (this.element.dataset.turntable === 'on' && this.gesture !== 'none') {
      this.element.dataset.turntable = 'off';
    }

    let height = this.focusTo;
    if (this.cameraMoving) {
      const ratio = Math.min(1, (now - this.focusStartedAt) / CAMERA_MOVE_MS);
      height = this.focusFrom + (this.focusTo - this.focusFrom) * ratio;
      if (ratio >= 1) {
        this.cameraMoving = false;
        this.element.dataset.cameraMoving = 'false';
      }
    }

    const orbitRad = (this.orbit * Math.PI) / 180;
    const tiltRad = (this.tilt * Math.PI) / 180;
    const centre = new Vector3(0, height, 0);
    this.camera.position.set(
      centre.x + this.distance * Math.sin(orbitRad) * Math.cos(tiltRad),
      centre.y + this.distance * Math.sin(tiltRad),
      centre.z + this.distance * Math.cos(orbitRad) * Math.cos(tiltRad),
    );
    this.camera.lookAt(centre);

    if (rect.width > 0 && rect.height > 0) {
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
      if (this.renderer !== null) {
        this.renderer.setSize(rect.width, rect.height, false);
        this.renderer.render(this.scene, this.camera);
      } else {
        this.drawStill(rect.width, rect.height);
      }
    }

    this.element.dataset.orbit = String(Math.round(this.orbit) % 360);
    this.element.dataset.tilt = String(Math.round(this.tilt));
    this.element.dataset.distance = this.distance.toFixed(2);
    const hand = this.handPixels();
    this.element.dataset.handPx = `${hand.x},${hand.y}`;

    requestAnimationFrame(() => this.frame());
  }
}
