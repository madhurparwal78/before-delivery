import type { Placement, Wall } from './types.js';

export interface SceneState {
  view: 'plan' | 'wall' | 'light';
  cameraHeightCm: number;
  cameraYawDeg: number;
  hangLine: 'visible' | 'hidden';
  transitioning: boolean;
}

export interface SceneCallbacks {
  onStateChanged(state: SceneState): void;
  onMarkerClick(placementId: string): void;
  onDragMove(placementId: string, deltaMm: number): void;
  onDragEnd(placementId: string): void;
  onOrbit(deltaDeg: number): void;
  onZoom(scale: number): void;
}

const EYE_CM = 145;
const PLAN_CM = 1800;

/** Compass yaw each wall faces, as the brief defines. */
export function wallFacingYaw(wallId: string): number {
  switch (wallId) {
    case 'wall-north': return 0;
    case 'wall-east': return 90;
    case 'wall-south': return 180;
    case 'wall-west': return 270;
    default: return 0;
  }
}

export interface SceneGeometry {
  walls: Wall[];
  placements: Placement[];
  selectedId: string | null;
  luxOverlay: boolean;
}

/**
 * The 3D gallery, drawn with WebGL on a canvas. Positions are computed
 * in centimetres in gallery space; the camera orbits at yaw only.
 */
export class Scene3D {
  private gl: WebGLRenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private program: WebGLProgram | null = null;
  private buffers: { wall: WebGLBuffer; floor: WebGLBuffer; work: WebGLBuffer } | null = null;
  private yawDeg = 0;
  private heightCm = PLAN_CM;
  private zoom = 1;
  private state: SceneState = {
    view: 'plan', cameraHeightCm: PLAN_CM, cameraYawDeg: 0,
    hangLine: 'hidden', transitioning: false,
  };
  private targetState: SceneState = { ...this.state };
  private geometry: SceneGeometry = { walls: [], placements: [], selectedId: null, luxOverlay: false };
  private markers: Map<string, HTMLElement> = new Map();
  private container: HTMLElement;
  private raf = 0;
  private pointer: { active: boolean; x: number; y: number; placementId: string | null; moved: boolean } | null = null;

  constructor(container: HTMLElement, private callbacks: SceneCallbacks) {
    this.container = container;
  }

  mount(): void {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    this.container.appendChild(canvas);
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true }) as WebGLRenderingContext | null;
    if (this.gl === null) return;
    this.initGl();
    this.attachPointer();
    this.renderLoop();
  }

  private initGl(): void {
    const gl = this.gl!;
    const vertex = `
      attribute vec3 aPos;
      uniform mat4 uView;
      uniform mat4 uProj;
      void main() { gl_Position = uProj * uView * vec4(aPos, 1.0); }
    `;
    const fragment = `
      precision mediump float;
      uniform vec4 uColour;
      void main() { gl_FragColor = uColour; }
    `;
    const compile = (type: number, src: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    this.program = program;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.POLYGON_OFFSET_FILL);
  }

  private attachPointer(): void {
    const canvas = this.canvas!;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const marker = this.hitMarker(e);
      this.pointer = { active: true, x: e.clientX, y: e.clientY, placementId: marker, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointer === null || !this.pointer.active) return;
      const dx = e.clientX - this.pointer.x;
      if (this.pointer.placementId !== null) {
        this.pointer.moved = true;
        this.callbacks.onDragMove(this.pointer.placementId, dx);
      } else {
        this.callbacks.onOrbit(dx);
      }
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
    });
    const end = () => {
      if (this.pointer !== null && this.pointer.placementId !== null && this.pointer.moved) {
        this.callbacks.onDragEnd(this.pointer.placementId);
      }
      this.pointer = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.callbacks.onZoom(e.deltaY > 0 ? 1.05 : 0.95);
    }, { passive: false });
  }

  private hitMarker(e: PointerEvent): string | null {
    const target = e.target as HTMLElement;
    const marker = target.closest('.work-marker') as HTMLElement | null;
    if (marker === null) return null;
    return marker.dataset['placementId'] ?? null;
  }

  // Markers are DOM overlays so they stay focusable and testable.
  rebuildMarkers(geometry: SceneGeometry, viewport: { width: number; height: number }): void {
    this.geometry = geometry;
    for (const [id, el] of this.markers) {
      if (!geometry.placements.some((p) => p.id === id)) {
        el.remove();
        this.markers.delete(id);
      }
    }
    for (const p of geometry.placements) {
      let el = this.markers.get(p.id);
      if (el === undefined) {
        el = document.createElement('button');
        el.className = 'work-marker';
        el.dataset['placementId'] = p.id;
        el.setAttribute('aria-label', p.objectTitle);
        el.addEventListener('click', () => this.callbacks.onMarkerClick(p.id));
        this.container.appendChild(el);
        this.markers.set(p.id, el);
      }
      const pos = this.markerScreenPos(p, viewport);
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      el.style.width = `${pos.w}px`;
      el.style.height = `${pos.h}px`;
      el.dataset['luxStatus'] = p.luxStatus;
      el.dataset['overlay'] = geometry.luxOverlay
        ? (p.luxStatus === 'over' ? 'red-hatch' : 'ink-outline')
        : 'none';
      el.dataset['selected'] = geometry.selectedId === p.id ? 'true' : 'false';
    }
  }

  private markerScreenPos(p: Placement, viewport: { width: number; height: number }): { x: number; y: number; w: number; h: number } {
    // Simplified projection: the elevation view of the wall the work is on.
    const wall = this.geometry.walls.find((w) => w.id === p.wallId);
    if (wall === undefined) return { x: 0, y: 0, w: 0, h: 0 };
    const scale = Math.min(viewport.width / wall.lengthMm, viewport.height / wall.heightMm) * 0.9;
    const w = p.widthMm * scale / 10;
    const h = p.heightMm * scale / 10;
    const x = (p.offsetMm - p.widthMm / 2) * scale / 10 + (viewport.width - wall.lengthMm * scale / 10) / 2;
    const y = viewport.height - ((p.centreHeightMm + p.heightMm / 2) * scale / 10) - 24;
    return { x, y, w, h };
  }

  /** Applies the view's final camera state, possibly with a transition. */
  applyView(target: Omit<SceneState, 'transitioning'>, reducedMotion: boolean): void {
    this.targetState = { ...target, transitioning: true };
    if (reducedMotion) {
      this.state = { ...target, transitioning: false };
      this.yawDeg = target.cameraYawDeg;
      this.heightCm = target.cameraHeightCm;
      this.emit();
      return;
    }
    const startTime = performance.now();
    const duration = target.view === this.state.view ? 0 : 750;
    const from = { yaw: this.yawDeg, height: this.heightCm };
    const to = { yaw: target.cameraYawDeg, height: target.cameraHeightCm };
    this.state.transitioning = true;
    this.emit();
    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.yawDeg = from.yaw + (to.yaw - from.yaw) * eased;
      this.heightCm = from.height + (to.height - from.height) * eased;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.state = { ...target, transitioning: false };
        this.emit();
      }
    };
    requestAnimationFrame(step);
  }

  orbitBy(deltaDeg: number): void {
    const next = ((this.yawDeg + deltaDeg) % 360 + 360) % 360;
    this.yawDeg = next;
    this.state.cameraYawDeg = Math.round(next);
    this.emit();
  }

  currentYaw(): number {
    return Math.round(((this.yawDeg % 360) + 360) % 360);
  }

  zoomBy(scale: number): void {
    this.zoom = Math.min(2, Math.max(0.5, this.zoom * scale));
  }

  private emit(): void {
    this.state.cameraHeightCm = Math.round(this.heightCm);
    this.state.cameraYawDeg = Math.round(((this.yawDeg % 360) + 360) % 360);
    this.callbacks.onStateChanged({ ...this.state });
  }

  private renderLoop(): void {
    const draw = () => {
      this.draw();
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const el of this.markers.values()) el.remove();
    this.markers.clear();
  }

  private draw(): void {
    const gl = this.gl;
    const canvas = this.canvas;
    if (gl === null || canvas === null || this.program === null) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.965, 0.945, 0.91, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const proj = perspective(0.6, width / height, 10, 40000);
    const yawRad = (this.yawDeg * Math.PI) / 180;
    const eye = [Math.sin(yawRad) * -600, this.heightCm * 10, Math.cos(yawRad) * -600];
    const centre = [Math.sin(yawRad) * 600, this.state.view === 'plan' ? 0 : EYE_CM * 10, Math.cos(yawRad) * 600];
    const view = lookAt(eye, centre, [0, 1, 0]);
    const viewLoc = gl.getUniformLocation(this.program, 'uView');
    const projLoc = gl.getUniformLocation(this.program, 'uProj');
    gl.uniformMatrix4fv(viewLoc, false, view);
    gl.uniformMatrix4fv(projLoc, false, proj);
    const colourLoc = gl.getUniformLocation(this.program, 'uColour');
    const posLoc = gl.getAttribLocation(this.program, 'aPos');

    // Floor
    const floor = quad([-6000, 0, -4500], [6000, 0, 4500]);
    this.drawQuad(gl, floor, posLoc, colourLoc, [0.85, 0.82, 0.76, 1]);

    // Walls: place each at its compass position, facing inward.
    for (const wall of this.geometry.walls) {
      const { corners, colour } = wallQuad(wall, this.geometry.luxOverlay ? wall.plannedLux : null);
      this.drawQuad(gl, corners, posLoc, colourLoc, colour);
    }

    // Works as thin panels.
    for (const p of this.geometry.placements) {
      const wall = this.geometry.walls.find((w) => w.id === p.wallId);
      if (wall === undefined) continue;
      const corners = workQuad(p, wall);
      const over = p.luxStatus === 'over' && this.geometry.luxOverlay;
      this.drawQuad(gl, corners, posLoc, colourLoc, over ? [0.55, 0.18, 0.13, 1] : [0.95, 0.95, 0.92, 1]);
    }

    // Hang line in wall and light-at-eye views.
    if (this.state.hangLine === 'visible') {
      const line = hangLineQuad(this.geometry.walls);
      for (const wall of this.geometry.walls) {
        this.drawQuad(gl, hangLineQuad([wall]), posLoc, colourLoc, [0.76, 0.37, 0.12, 1]);
      }
      void line;
    }
  }

  private drawQuad(
    gl: WebGLRenderingContext,
    corners: number[],
    posLoc: number,
    colourLoc: WebGLUniformLocation | null,
    colour: number[]
  ): void {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.uniform4fv(colourLoc, colour);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.deleteBuffer(buffer);
  }
}

function quad(min: [number, number, number], max: [number, number, number]): number[] {
  return [
    min[0], min[1], min[2],
    max[0], min[1], min[2],
    max[0], max[1], max[2],
    min[0], max[1], min[2],
  ];
}

function wallQuad(wall: Wall, lux: number | null): { corners: number[]; colour: number[] } {
  // North wall along z = -4500? Use compass layout: north at -z, east at +x.
  const h = wall.heightMm / 10; // cm
  let corners: number[];
  switch (wall.id) {
    case 'wall-north':
      corners = [-wall.lengthMm / 20, 0, -450, wall.lengthMm / 20, h, -450];
      break;
    case 'wall-south':
      corners = [wall.lengthMm / 20, 0, 450, -wall.lengthMm / 20, h, 450];
      break;
    case 'wall-east':
      corners = [600, 0, -wall.lengthMm / 20, 600, h, wall.lengthMm / 20];
      break;
    default: // west
      corners = [-600, h, -wall.lengthMm / 20, -600, 0, wall.lengthMm / 20];
      break;
  }
  const base = lux === null ? [0.85, 0.82, 0.77, 1] : luxColour(lux);
  return { corners, colour: base };
}

function luxColour(lux: number): number[] {
  // Pale (low) to warm (high).
  const t = Math.min(1, lux / 300);
  return [0.92 + 0.04 * t, 0.90 - 0.08 * t, 0.84 - 0.16 * t, 1];
}

function workQuad(p: Placement, wall: Wall): number[] {
  const halfW = p.widthMm / 20;
  const bottom = (p.centreHeightMm - p.heightMm / 2) / 10;
  const top = (p.centreHeightMm + p.heightMm / 2) / 10;
  const centreOffset = (p.offsetMm - wall.lengthMm / 2) / 10;
  const inset = 2;
  switch (wall.id) {
    case 'wall-north':
      return [centreOffset - halfW, bottom, -450 + inset, centreOffset + halfW, top, -450 + inset];
    case 'wall-south':
      return [centreOffset + halfW, bottom, 450 - inset, centreOffset - halfW, top, 450 - inset];
    case 'wall-east':
      return [600 - inset, bottom, centreOffset - halfW, 600 - inset, top, centreOffset + halfW];
    default:
      return [-600 + inset, top, centreOffset - halfW, -600 + inset, bottom, centreOffset + halfW];
  }
}

function hangLineQuad(walls: Wall[]): number[] {
  const wall = walls[0];
  if (wall === undefined) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const y = 145;
  const inset = 1.5;
  switch (wall.id) {
    case 'wall-north':
      return [-wall.lengthMm / 20, y, -450 + inset, wall.lengthMm / 20, y, -450 + inset];
    case 'wall-south':
      return [wall.lengthMm / 20, y, 450 - inset, -wall.lengthMm / 20, y, 450 - inset];
    case 'wall-east':
      return [600 - inset, y, -wall.lengthMm / 20, 600 - inset, y, wall.lengthMm / 20];
    default:
      return [-600 + inset, y, -wall.lengthMm / 20, -600 + inset, y, wall.lengthMm / 20];
  }
}

// Minimal matrix helpers.
function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye: number[], centre: number[], up: number[]): Float32Array {
  const z = normalise([eye[0]! - centre[0]!, eye[1]! - centre[1]!, eye[2]! - centre[2]!]);
  const x = normalise(cross(up, z));
  const y: [number, number, number] = cross(z, x);
  return new Float32Array([
    x[0]!, y[0]!, z[0]!, 0,
    x[1]!, y[1]!, z[1]!, 0,
    x[2]!, y[2]!, z[2]!, 0,
    -(x[0]! * eye[0]! + x[1]! * eye[1]! + x[2]! * eye[2]!),
    -(y[0]! * eye[0]! + y[1]! * eye[1]! + y[2]! * eye[2]!),
    -(z[0]! * eye[0]! + z[1]! * eye[1]! + z[2]! * eye[2]!),
    1,
  ]);
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

function normalise(v: number[]): [number, number, number] {
  const len = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / len, v[1]! / len, v[2]! / len];
}

/** True when the browser offers WebGL. */
export function webglAvailable(): boolean {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
  return gl !== null;
}
