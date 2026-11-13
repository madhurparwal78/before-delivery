import { Pose, Solid } from './api';
import { ACCENT, GHOST, Layer, MATERIAL, Scene } from './gl';
import { MeshData, solidMesh } from './mesh';
import { apply, clear, el, on, reducedMotion, svg } from './dom';
import { machineNumber, roundTo } from '../shared/numbers';
import { Box, poseOfBox } from '../shared/pose';

export const CAMERA_GLIDE_MS = 460;
export const CROSS_FADE_MS = 150;
export const TAPE_SETTLE_MS = 240;

/** House rule H5: the painted epoch, kept per tab in sessionStorage. */
export class Epoch {
  private value: number;

  constructor(private readonly key: string) {
    const stored = Number(sessionStorage.getItem(key) ?? '0');
    this.value = Number.isFinite(stored) && stored > 0 ? stored : 0;
  }

  current(): number {
    return this.value;
  }

  advance(): number {
    this.value += 1;
    sessionStorage.setItem(this.key, String(this.value));
    return this.value;
  }
}

export type Readouts = {
  digest?: string | null;
  volume?: number;
  bbox?: [number, number, number];
  faces?: number;
  seq?: number;
  tapeOperation?: number | null;
};

type Spherical = { radius: number; theta: number; phi: number };

function sphericalOf(pose: Pose): Spherical {
  const dx = pose.position[0] - pose.target[0];
  const dy = pose.position[1] - pose.target[1];
  const dz = pose.position[2] - pose.target[2];
  const radius = Math.hypot(dx, dy, dz) || 1;
  return { radius, theta: Math.atan2(dy, dx), phi: Math.acos(Math.max(-1, Math.min(1, dz / radius))) };
}

function poseFrom(target: [number, number, number], spherical: Spherical, fov: number): Pose {
  const sinPhi = Math.sin(spherical.phi);
  return {
    position: [
      target[0] + spherical.radius * sinPhi * Math.cos(spherical.theta),
      target[1] + spherical.radius * sinPhi * Math.sin(spherical.theta),
      target[2] + spherical.radius * Math.cos(spherical.phi),
    ],
    target,
    up: [0, 0, 1],
    fov,
  };
}

export type ViewportOptions = {
  epochKey: string;
  fallbackAlt?: string;
  fallbackSrc?: string;
};

export class Viewport {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly pinLayer: HTMLElement;
  readonly epoch: Epoch;
  private scene: Scene | null = null;
  private fading: { mesh: MeshData; until: number } | null = null;
  private solid: Solid | null = null;
  private extraLayers: Layer[] = [];
  private mesh: MeshData | null = null;
  private defaultPose: Pose = poseOfBox({ min: [0, 0, 0], max: [1, 1, 1] });
  private pose: Pose = this.defaultPose;
  private spherical: Spherical = sphericalOf(this.defaultPose);
  private frame = 0;
  private pendingDraw = false;
  private glide: { from: Pose; to: Pose; started: number } | null = null;
  private pins: { point: [number, number, number]; kind: string; label: string }[] = [];

  constructor(options: ViewportOptions) {
    this.epoch = new Epoch(options.epochKey);
    this.canvas = el('canvas', { class: 'viewport-canvas' });
    this.pinLayer = el('div', { class: 'pin-layer', 'aria-hidden': 'true' });
    this.root = el(
      'div',
      {
        'data-ui': 'viewport',
        class: 'viewport',
        'data-epoch': this.epoch.current(),
        'data-eval-state': 'settled',
        'data-camera-moving': 'false',
        'data-projection': 'perspective',
      },
      [this.canvas, this.pinLayer, this.toolbar(), this.chrome()],
    );
    this.setupPointer();
    try {
      this.scene = new Scene(this.canvas);
    } catch {
      this.scene = null;
      this.showFallback(options.fallbackSrc ?? '', options.fallbackAlt ?? '');
    }
    this.applyCamera();
    this.loop();
    on(window, 'resize', () => this.draw());
    // The canvas is laid out after it is built, so redraw whenever its size settles.
    new ResizeObserver(() => this.draw()).observe(this.root);
  }

  private chrome(): HTMLElement {
    return el('div', { class: 'viewport-chrome', 'aria-hidden': 'true' }, [
      el('div', { 'data-ui': 'frame', class: 'drawn-frame viewport-frame' }, [
        el('span', { 'data-ui': 'vertex-dot', class: 'vertex-dot vertex-dot-1' }),
        el('span', { 'data-ui': 'vertex-dot', class: 'vertex-dot vertex-dot-2' }),
        el('span', { 'data-ui': 'vertex-dot', class: 'vertex-dot vertex-dot-3' }),
        el('span', { 'data-ui': 'vertex-dot', class: 'vertex-dot vertex-dot-4' }),
      ]),
      el('span', { 'data-ui': 'crosshair', class: 'crosshair' }, [
        svg('svg', { viewBox: '0 0 16 16', focusable: 'false' }, [
          svg('path', { d: 'M8 2 L8 14 M2 8 L14 8', stroke: 'currentColor', 'stroke-width': '1' }),
        ]),
      ]),
    ]);
  }

  private toolbar(): HTMLElement {
    const reset = el('button', { type: 'button', class: 'toolbar-item', tabindex: '0' }, ['Reset view']);
    const ortho = el(
      'button',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': 'false',
        class: 'toolbar-item',
        tabindex: '-1',
      },
      ['Orthographic'],
    );
    const items = [reset, ortho];
    let lastFocused = 0;

    on(reset, 'click', () => this.resetView());
    on(ortho, 'click', () => {
      const next = ortho.getAttribute('aria-checked') !== 'true';
      ortho.setAttribute('aria-checked', next ? 'true' : 'false');
      this.scene?.setProjection(next ? 'orthographic' : 'perspective');
      this.root.setAttribute('data-projection', next ? 'orthographic' : 'perspective');
      this.draw();
    });

    const toolbar = el('div', { role: 'toolbar', 'aria-label': 'View', class: 'view-toolbar' }, items);
    const focus = (index: number): void => {
      lastFocused = index;
      items.forEach((item, position) => item.setAttribute('tabindex', position === index ? '0' : '-1'));
      items[index].focus();
    };
    for (const [index, item] of items.entries()) {
      on(item, 'focus', () => {
        lastFocused = index;
        items.forEach((other, position) =>
          other.setAttribute('tabindex', position === index ? '0' : '-1'),
        );
      });
    }
    on(toolbar, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'ArrowRight') focus(Math.min(items.length - 1, lastFocused + 1));
      else if (key === 'ArrowLeft') focus(Math.max(0, lastFocused - 1));
      else if (key === 'Home') focus(0);
      else if (key === 'End') focus(items.length - 1);
      else return;
      event.preventDefault();
    });
    return toolbar;
  }

  /** Dragging orbits the camera and the wheel or a pinch zooms, also with reduced motion. */
  private setupPointer(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pinch: number | null = null;

    on(this.canvas, 'pointerdown', (event) => {
      const pointer = event as unknown as PointerEvent;
      dragging = true;
      lastX = pointer.clientX;
      lastY = pointer.clientY;
      this.canvas.setPointerCapture(pointer.pointerId);
    });
    on(this.canvas, 'pointermove', (event) => {
      if (!dragging) return;
      const pointer = event as unknown as PointerEvent;
      const dx = pointer.clientX - lastX;
      const dy = pointer.clientY - lastY;
      lastX = pointer.clientX;
      lastY = pointer.clientY;
      this.spherical.theta -= dx * 0.01;
      this.spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.spherical.phi - dy * 0.01));
      this.pose = poseFrom(this.pose.target, this.spherical, this.pose.fov);
      this.applyCamera();
    });
    const end = (): void => {
      dragging = false;
    };
    on(this.canvas, 'pointerup', end);
    on(this.canvas, 'pointercancel', end);
    on(
      this.canvas,
      'wheel',
      (event) => {
        const wheel = event as unknown as WheelEvent;
        wheel.preventDefault();
        this.spherical.radius = Math.max(2, this.spherical.radius * Math.exp(wheel.deltaY * 0.001));
        this.pose = poseFrom(this.pose.target, this.spherical, this.pose.fov);
        this.applyCamera();
      },
      { passive: false },
    );
    on(
      this.canvas,
      'touchmove',
      (event) => {
        const touch = event as unknown as TouchEvent;
        touch.preventDefault();
        if (touch.touches.length !== 2) return;
        const spread = Math.hypot(
          touch.touches[0].clientX - touch.touches[1].clientX,
          touch.touches[0].clientY - touch.touches[1].clientY,
        );
        if (pinch !== null && spread > 0) {
          this.spherical.radius = Math.max(2, this.spherical.radius * (pinch / spread));
          this.pose = poseFrom(this.pose.target, this.spherical, this.pose.fov);
          this.applyCamera();
        }
        pinch = spread;
      },
      { passive: false },
    );
    on(this.canvas, 'touchend', () => {
      pinch = null;
    });
  }

  mount(parent: Element, position: 'append' | 'prepend' = 'append'): void {
    if (position === 'prepend') parent.prepend(this.root);
    else parent.append(this.root);
    this.draw();
  }

  setDefaultPose(pose: Pose, apply2 = true): void {
    this.defaultPose = pose;
    if (apply2) {
      this.pose = pose;
      this.spherical = sphericalOf(pose);
      this.applyCamera();
    }
  }

  resetView(): void {
    this.glideTo(this.defaultPose);
  }

  getPose(): Pose {
    return this.pose;
  }

  /** Selecting a finding, hunk or thread glides the camera to the stored pose. */
  glideTo(pose: Pose): void {
    if (reducedMotion()) {
      this.pose = pose;
      this.spherical = sphericalOf(pose);
      this.root.setAttribute('data-camera-moving', 'false');
      this.applyCamera();
      return;
    }
    this.glide = { from: this.pose, to: pose, started: performance.now() };
    this.root.setAttribute('data-camera-moving', 'true');
  }

  setEvalState(state: string): void {
    this.root.setAttribute('data-eval-state', state);
  }

  setReadouts(readouts: Readouts): void {
    const attributes: Record<string, string | null> = {};
    if (readouts.digest !== undefined) attributes['data-digest'] = readouts.digest ?? '';
    if (readouts.volume !== undefined) {
      attributes['data-volume'] = roundTo(readouts.volume, 2).toFixed(2);
    }
    if (readouts.bbox !== undefined) {
      attributes['data-bbox'] = readouts.bbox.map((value) => machineNumber(roundTo(value, 3))).join(',');
    }
    if (readouts.faces !== undefined) attributes['data-faces'] = String(readouts.faces);
    if (readouts.seq !== undefined) attributes['data-seq'] = String(readouts.seq);
    if (readouts.tapeOperation !== undefined) {
      attributes['data-tape-operation'] = readouts.tapeOperation === null ? null : String(readouts.tapeOperation);
    }
    apply(this.root, attributes);
  }

  setViewerId(viewerId: string): void {
    this.root.setAttribute('data-viewer-id', viewerId);
  }

  /** Each painted result advances the epoch by exactly one. */
  paint(): void {
    this.root.setAttribute('data-epoch', String(this.epoch.advance()));
  }

  setSolid(solid: Solid | null, options: { crossfade?: boolean; extraLayers?: Layer[] } = {}): void {
    const previous = this.mesh;
    this.solid = solid;
    this.mesh = solid ? solidMesh(solid) : null;
    this.extraLayers = options.extraLayers ?? [];
    if (options.crossfade && previous && !reducedMotion()) {
      this.fading = { mesh: previous, until: performance.now() + CROSS_FADE_MS };
    } else {
      this.fading = null;
    }
    this.draw();
  }

  getSolid(): Solid | null {
    return this.solid;
  }

  setPins(pins: { point: [number, number, number]; kind: string; label: string }[]): void {
    this.pins = pins;
    this.drawPins();
  }

  private drawPins(): void {
    clear(this.pinLayer);
    if (!this.scene) return;
    for (const pin of this.pins) {
      const at = this.scene.project(pin.point);
      if (!at) continue;
      const node = el('span', {
        'data-ui': pin.kind,
        class: 'viewport-pin',
        style: `left:${at.x}px;top:${at.y}px`,
        'data-label': pin.label,
      });
      this.pinLayer.append(node);
    }
  }

  setOutage(on2: boolean, lastGoodLine: string): void {
    const existing = this.root.querySelector('[data-ui="outage-panel"]');
    if (!on2) {
      existing?.remove();
      this.canvas.hidden = false;
      return;
    }
    this.canvas.hidden = true;
    if (existing) {
      existing.textContent = `Replay is paused: part storage is unreachable. ${lastGoodLine}`;
      return;
    }
    this.root.append(
      el('div', { 'data-ui': 'outage-panel', class: 'outage-panel' }, [
        `Replay is paused: part storage is unreachable. ${lastGoodLine}`,
      ]),
    );
  }

  showFallback(src: string, alt: string): void {
    this.canvas.hidden = true;
    const existing = this.root.querySelector('[data-ui="no-webgl"]');
    existing?.remove();
    this.root.append(
      el('div', { 'data-ui': 'no-webgl', class: 'no-webgl' }, [
        src ? el('img', { src, alt }) : el('span', {}, [alt]),
        el('p', {}, ['3D view needs WebGL. Values and checks still work.']),
      ]),
    );
  }

  private applyCamera(): void {
    this.scene?.setPose(this.pose);
    this.root.setAttribute(
      'data-camera',
      [
        ...this.pose.position.map((value) => machineNumber(roundTo(value, 3))),
        ...this.pose.target.map((value) => machineNumber(roundTo(value, 3))),
        machineNumber(roundTo(this.pose.fov, 3)),
      ].join(','),
    );
    this.draw();
  }

  /** Draws are coalesced into one animation frame, so a paint never races layout. */
  private draw(): void {
    if (this.pendingDraw) return;
    this.pendingDraw = true;
    requestAnimationFrame(() => {
      this.pendingDraw = false;
      this.paintScene();
    });
  }

  private paintScene(): void {
    if (!this.scene) return;
    const layers: Layer[] = [];
    if (this.fading && performance.now() < this.fading.until) {
      const left = (this.fading.until - performance.now()) / CROSS_FADE_MS;
      layers.push({ mesh: this.fading.mesh, colour: MATERIAL, alpha: left });
    }
    if (this.mesh) {
      const fade = this.fading ? 1 - Math.max(0, (this.fading.until - performance.now()) / CROSS_FADE_MS) : 1;
      layers.push({ mesh: this.mesh, colour: MATERIAL, alpha: this.fading ? Math.max(0.15, fade) : 1 });
    }
    layers.push(...this.extraLayers);
    this.scene.setLayers(layers);
    this.scene.render();
    this.drawPins();
  }

  private loop(): void {
    const step = (): void => {
      if (this.glide) {
        const elapsed = performance.now() - this.glide.started;
        const ratio = Math.min(1, elapsed / CAMERA_GLIDE_MS);
        const eased = 1 - (1 - ratio) ** 3;
        const mix = (from: number, to: number): number => from + (to - from) * eased;
        const pose: Pose = {
          position: [0, 1, 2].map((axis) =>
            mix(this.glide!.from.position[axis], this.glide!.to.position[axis]),
          ) as [number, number, number],
          target: [0, 1, 2].map((axis) => mix(this.glide!.from.target[axis], this.glide!.to.target[axis])) as [
            number,
            number,
            number,
          ],
          up: [0, 0, 1],
          fov: mix(this.glide!.from.fov, this.glide!.to.fov),
        };
        this.pose = ratio === 1 ? this.glide.to : pose;
        this.spherical = sphericalOf(this.pose);
        if (ratio === 1) {
          this.glide = null;
          this.root.setAttribute('data-camera-moving', 'false');
        }
        this.applyCamera();
      } else if (this.fading) {
        if (performance.now() >= this.fading.until) this.fading = null;
        this.paintScene();
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  poseForBox(box: Box): Pose {
    return poseOfBox(box);
  }

  accentLayer(mesh: MeshData): Layer {
    return { mesh, colour: ACCENT, alpha: 1 };
  }

  ghostLayer(mesh: MeshData): Layer {
    return { mesh, colour: GHOST, alpha: 0.55, hatch: true };
  }
}
