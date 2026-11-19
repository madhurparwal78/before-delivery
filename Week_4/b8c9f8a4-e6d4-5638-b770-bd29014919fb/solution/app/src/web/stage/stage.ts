// The stage: one scene, two renderers. It publishes the camera that drew the frame on screen, so
// a finding's world point can be projected onto the canvas, and it draws only when the scroll
// position, the viewport or the server's state changes.

import { el, setAttr, svg } from '../dom.js';
import { formatMatrix, formatPoint, project, restingNdc, type CameraFrame } from '../../shared/camera.js';
import { worldPoint, type Vec3 } from '../../shared/panels.js';
import { StageRenderer, type MarkerInput } from './renderer.js';
import { stillSvg, type StillPin } from './still.js';
import {
  cameraFor, emptyState, restingState, stateAt,
  type StageFinding, type StageState, type StageTrack,
} from './model.js';

const LOST_CONTEXT_MS = 1200;

type StageMode = 'scroll' | 'still';

interface StageDraw {
  state: StageState;
  mode: StageMode;
  listing: string;
  dim: number;
}

export class Stage {
  readonly element: HTMLElement;
  private readonly carName: () => string;
  private readonly preview: boolean;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: StageRenderer | null = null;
  private stillHolder: HTMLElement;
  private frames = 0;
  private signature = '';
  private track: StageTrack | null = null;
  private pins: StillPin[] = [];
  private markers: MarkerInput[] = [];
  private openAdvisories = -1;
  private trackKey = '';
  private markerKey = '';
  private onPick: ((finding: StageFinding) => void) | null = null;
  private onStill: (() => void) | null = null;
  private lastDraw: StageDraw | null = null;
  private lastFrame: CameraFrame | null = null;

  constructor(options: { label: string; carName: () => string; preview?: boolean }) {
    this.carName = options.carName;
    this.preview = options.preview ?? false;
    this.stillHolder = el('div', { class: 'stage-still' });
    this.element = el('div', {
      role: 'region',
      'aria-label': options.label,
      class: this.preview ? 'stage-preview' : 'stage-surface',
      'data-frame-count': '0',
    }, [this.stillHolder]);
    this.element.addEventListener('click', (event) => {
      const press = event as MouseEvent;
      this.pickAt(press.clientX, press.clientY);
    });
    this.useWebgl();
  }

  private useWebgl(): void {
    const canvas = el('canvas', { class: 'stage-canvas' });
    // The context is made here, so a browser that cannot give one simply gets the drawn still.
    const attributes = { antialias: true, preserveDrawingBuffer: true, alpha: false };
    const context = (canvas.getContext('webgl2', attributes)
      ?? canvas.getContext('webgl', attributes)) as WebGLRenderingContext | WebGL2RenderingContext | null;
    let renderer: StageRenderer | null = null;
    if (context) {
      try {
        renderer = new StageRenderer(canvas, context);
      } catch {
        renderer = null;
      }
    }
    if (!renderer) {
      this.setAttribute('data-renderer', 'svg');
      return;
    }
    canvas.addEventListener('webglcontextlost', (event) => {
      // The still takes over within the published two seconds; the context is never asked back.
      event.preventDefault();
      window.setTimeout(() => this.dropToStill(), LOST_CONTEXT_MS);
    });
    this.canvas = canvas;
    this.renderer = renderer;
    this.element.prepend(canvas);
    this.setAttribute('data-renderer', 'webgl');
  }

  private dropToStill(): void {
    if (!this.canvas) return;
    this.canvas.remove();
    this.canvas = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.setAttribute('data-renderer', 'svg');
    this.signature = '';
    this.onStill?.();
    if (this.lastDraw) {
      this.draw({ ...this.lastDraw, mode: 'still', state: this.stateFor(0, 'still') });
    }
  }

  /** Told when the stage drops to the drawn still, so the page can take the track away. */
  onStillDrop(handler: () => void): void {
    this.onStill = handler;
  }

  get usesWebgl(): boolean {
    return this.canvas !== null;
  }

  private setAttribute(name: string, value: string): void {
    setAttr(this.element, name, value);
  }

  setTrack(track: StageTrack): void {
    const key = JSON.stringify([track.angles, track.elevations, track.aims]);
    if (key !== this.trackKey) {
      this.trackKey = key;
      this.signature = '';
    }
    this.track = track;
  }

  setMarkers(findings: StageFinding[]): void {
    const key = findings.map((finding) => `${finding.id}:${finding.seen ? 1 : 0}:${finding.u},${finding.v}`).join('|');
    if (key === this.markerKey) return;
    this.markerKey = key;
    this.markers = findings.map((finding) => ({
      point: worldPoint(finding.panelId, finding.u, finding.v),
      seen: finding.seen,
    }));
    this.pins = findings.map((finding) => ({
      id: finding.id,
      point: worldPoint(finding.panelId, finding.u, finding.v),
      seen: finding.seen,
      title: `Finding ${finding.position}: ${finding.title}`,
    }));
    this.renderer?.setMarkers(this.markers);
    this.signature = '';
  }

  setOpenAdvisories(count: number): void {
    if (this.openAdvisories === count) return;
    this.openAdvisories = count;
    this.setAttribute('data-open-advisories', String(Math.max(0, count)));
    this.signature = '';
  }

  onMarkerPick(handler: (finding: StageFinding) => void): void {
    this.onPick = handler;
  }

  size(): { width: number; height: number } {
    const rect = this.element.getBoundingClientRect();
    return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }

  /** The nearest marker within the published distance of a point on the canvas. */
  pickAt(clientX: number, clientY: number, radius = 22): StageFinding | null {
    if (!this.track || !this.lastFrame) return null;
    const rect = this.element.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { finding: StageFinding; distance: number } | null = null;
    for (const finding of this.track.findings) {
      const at = project(
        this.lastFrame.viewProjection,
        worldPoint(finding.panelId, finding.u, finding.v),
        rect.width,
        rect.height,
      );
      if (at.w <= 0 || at.x < 0 || at.y < 0 || at.x > rect.width || at.y > rect.height) continue;
      const distance = Math.hypot(at.x - x, at.y - y);
      if (distance <= radius && (!best || distance < best.distance)) best = { finding, distance };
    }
    if (best && this.onPick) this.onPick(best.finding);
    return best ? best.finding : null;
  }

  /** The state for a scroll position, or the resting state in the still modes. */
  stateFor(scrollY: number, mode: StageMode): StageState {
    if (!this.track) return emptyState();
    return mode === 'still' ? restingState(this.track) : stateAt(this.track, scrollY);
  }

  draw(input: StageDraw): void {
    if (!this.track) return;
    const { width, height } = this.size();
    const state = input.state;
    const frame = cameraFor(state, width, height, { closeUp: this.preview });
    this.lastFrame = frame;
    this.lastDraw = input;

    const heroPoint: Vec3 = this.track.aims[0];
    const heroNdc = restingNdc(width);
    const matrix = formatMatrix(frame.viewProjection);

    if (!this.preview) {
      this.setAttribute('data-mode', input.mode);
      this.setAttribute('data-beat', String(state.beat));
      this.setAttribute('data-beat-progress', state.progress.toFixed(2));
      this.setAttribute('data-rim-glow', state.rim.toFixed(3));
      this.setAttribute('data-card-travel', state.travel.toFixed(3));
      this.setAttribute('data-camera-angle', state.angle.toFixed(3));
      this.setAttribute('data-listing', input.listing);
    }
    this.setAttribute('data-panel', state.panelId);
    this.setAttribute('data-anchor', state.panelId === '' ? '' : `${state.u.toFixed(3)},${state.v.toFixed(3)}`);
    this.setAttribute('data-camera-position', formatPoint(frame.eye));
    this.setAttribute('data-view-projection', matrix);

    const signature = [
      matrix, width, height, input.mode, input.dim, state.rim.toFixed(3), state.panelId,
      state.bloom.toFixed(3), this.openAdvisories, this.markers.map((m) => (m.seen ? 1 : 0)).join(''),
      this.canvas ? 'gl' : 'svg',
    ].join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    if (this.canvas && this.renderer) {
      this.canvas.hidden = false;
      this.stillHolder.replaceChildren();
      this.renderer.draw({
        frame,
        width,
        height,
        heroNdc,
        bloom: state.bloom,
        dim: input.dim,
        rimPanelId: state.panelId,
        rimGlow: state.rim,
        ticks: this.preview ? this.openAdvisories : -1,
      });
    } else {
      this.stillHolder.replaceChildren(svg(stillSvg({
        frame,
        width,
        height,
        heroPoint,
        pins: this.preview ? [] : this.pins,
        dim: input.dim,
        label: this.preview ? 'Stage preview still' : `Facet still of ${this.carName()}`,
        ticks: this.preview ? this.openAdvisories : -1,
      })));
    }
    this.frames += 1;
    this.setAttribute('data-frame-count', String(this.frames));
  }

  /** An empty stage: a dim still with one line of copy, drawing nothing. */
  showEmpty(line: string): void {
    if (this.canvas) this.canvas.hidden = true;
    this.setAttribute('data-panel', '');
    this.setAttribute('data-anchor', '');
    this.signature = '';
    this.stillHolder.replaceChildren(
      svg(stillSvg({
        frame: cameraFor(this.stateFor(0, 'still'), 320, 240, { closeUp: true }),
        width: 320,
        height: 240,
        heroPoint: null,
        pins: [],
        dim: 0.5,
        label: 'Stage preview still',
        ticks: -1,
      })),
      el('p', { class: 'stage-empty' }, [line]),
    );
  }
}
