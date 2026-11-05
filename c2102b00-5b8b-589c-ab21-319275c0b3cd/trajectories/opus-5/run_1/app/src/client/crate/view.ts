import * as THREE from 'three';
import { buildGlCrate, type CratePicture, type GlCrate } from './gl.ts';
import { drawStillCrate } from './still.ts';
import type { CrateModel } from './model.ts';
import { DISPLAY_FONT } from './textures.ts';

export type DrawCause = 'first' | 'font' | 'line' | 'turn' | 'size' | 'shown' | 'restored' | 'sequence';

interface Host {
  renderer: THREE.WebGLRenderer | null;
  lost: boolean;
}

const host: Host = { renderer: null, lost: false };
let contextTried = false;
let fontReady = false;
const views = new Set<CrateView>();
const contextListeners = new Set<(lost: boolean) => void>();

export function onContextStateChange(listener: (lost: boolean) => void): () => void {
  contextListeners.add(listener);
  return () => contextListeners.delete(listener);
}

function announceContextState(): void {
  for (const listener of contextListeners) listener(host.lost);
}

/** The document's single WebGL context, created the first time a crate must draw. */
function glRenderer(): THREE.WebGLRenderer | null {
  if (contextTried) return host.renderer;
  contextTried = true;
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setClearAlpha(0);
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      host.lost = true;
      announceContextState();
      for (const view of views) view.redrawAfterContextChange();
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      host.lost = false;
      announceContextState();
      for (const view of views) view.redrawAfterContextChange();
    });
    host.renderer = renderer;
  } catch {
    host.renderer = null;
  }
  return host.renderer;
}

export function webglIsAvailable(): boolean {
  return glRenderer() !== null;
}

export function contextIsLost(): boolean {
  return host.lost;
}

function whenFontReady(): void {
  if (fontReady) return;
  const fonts = document.fonts;
  if (!fonts) {
    fontReady = true;
    return;
  }
  void fonts.load(`800 40px ${DISPLAY_FONT.split(',')[0]}`).then(() => {
    fontReady = true;
    for (const view of views) view.requestDraw('font');
  });
}

export interface CrateViewOptions {
  background: () => string;
  isVisible: () => boolean;
}

export class CrateView {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly options: CrateViewOptions;
  private model: CrateModel;
  private turn = 0;
  private effect: { unitProgress: number[]; lidProgress: number; stampProgress: number };
  private glCrate: GlCrate | null = null;
  private lastSignature = '';
  private dirty = true;
  private observer: ResizeObserver | null = null;

  constructor(model: CrateModel, label: string, options: CrateViewOptions) {
    this.model = model;
    this.options = options;
    this.effect = { unitProgress: [], lidProgress: model.lidClosed ? 1 : 0, stampProgress: model.stamp ? 1 : 0 };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'crate-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', label);
    this.context = this.canvas.getContext('2d')!;
    views.add(this);
    whenFontReady();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.requestDraw('size'));
      this.observer.observe(this.canvas);
    }
  }

  setLabel(label: string): void {
    if (this.canvas.getAttribute('aria-label') !== label) this.canvas.setAttribute('aria-label', label);
  }

  get currentModel(): CrateModel {
    return this.model;
  }

  setModel(model: CrateModel, cause: DrawCause): void {
    this.model = model;
    this.requestDraw(cause);
  }

  /** Sets the model and the finished state of its effect in one step. */
  settle(model: CrateModel, cause: DrawCause): void {
    this.model = model;
    this.effect = { unitProgress: [], lidProgress: model.lidClosed ? 1 : 0, stampProgress: model.stamp ? 1 : 0 };
    this.requestDraw(cause);
  }

  setEffect(effect: { unitProgress: number[]; lidProgress: number; stampProgress: number }): void {
    this.effect = effect;
    this.requestDraw('sequence');
  }

  get turnDegrees(): number {
    return this.turn;
  }

  setTurn(degrees: number): void {
    const clamped = Math.max(-75, Math.min(75, degrees));
    if (clamped === this.turn) return;
    this.turn = clamped;
    this.requestDraw('turn');
  }

  redrawAfterContextChange(): void {
    this.lastSignature = '';
    this.requestDraw(host.lost ? 'line' : 'restored');
  }

  private picture(): CratePicture {
    return {
      model: this.model,
      turnDegrees: this.turn,
      unitProgress: this.effect.unitProgress,
      lidProgress: this.effect.lidProgress,
      stampProgress: this.effect.stampProgress,
    };
  }

  private signature(width: number, height: number): string {
    const picture = this.picture();
    return [
      host.lost || host.renderer === null ? 'still' : 'gl',
      fontReady ? 'f1' : 'f0',
      width,
      height,
      this.options.background(),
      picture.model.version,
      picture.model.status,
      picture.model.cells.join(''),
      picture.turnDegrees.toFixed(1),
      picture.lidProgress.toFixed(3),
      picture.stampProgress.toFixed(3),
      picture.unitProgress.map((value) => value.toFixed(2)).join(','),
    ].join('|');
  }

  /** Every draw request passes through here, which decides whether a frame is written. */
  requestDraw(_cause: DrawCause): void {
    if (!this.options.isVisible()) {
      this.dirty = true;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      this.dirty = true;
      return;
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    const signature = this.signature(width, height);
    if (signature === this.lastSignature && !this.dirty) return;
    this.lastSignature = signature;
    this.dirty = false;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const renderer = glRenderer();
    if (renderer === null || host.lost) {
      drawStillCrate(this.context, width, height, this.model, this.options.background());
      return;
    }
    if (!this.glCrate) this.glCrate = buildGlCrate(this.model);
    this.glCrate.update(this.picture());
    renderer.setSize(width, height, false);
    renderer.render(this.glCrate.scene, this.glCrate.camera);
    this.context.clearRect(0, 0, width, height);
    this.context.fillStyle = this.options.background();
    this.context.fillRect(0, 0, width, height);
    this.context.drawImage(renderer.domElement, 0, 0, width, height);
  }

  /** Called when a panel holding this crate is shown. */
  shown(): void {
    this.requestDraw('shown');
  }

  destroy(): void {
    this.observer?.disconnect();
    views.delete(this);
    this.glCrate?.dispose();
    this.glCrate = null;
  }
}
