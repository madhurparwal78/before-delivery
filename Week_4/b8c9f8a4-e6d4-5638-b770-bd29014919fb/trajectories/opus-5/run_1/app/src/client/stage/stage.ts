import {
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { worldPoint, type Vec3 } from '../../shared/panels';
import type { ListingStatus } from '../../shared/types';
import { el, svgFrom } from '../shared/dom';
import { prefersReducedMotion } from '../shared/motion';
import {
  anchorAttribute,
  beatStateOf,
  buildProjection,
  buildTrack,
  matrixAttribute,
  panelOf,
  poseOf,
  positionAttribute,
  projectToBox,
  trackLength,
  type BeatState,
  type StageFinding,
  type StageTrack,
} from './camera';
import { StageScene, makeRenderer, type MarkerState } from './scene';
import { facetStillSvg } from './still';

const TICK_STRIP_HEIGHT = 24;
const MARKER_TAP_RADIUS = 22;
const TOUCH_SCROLL_SLOP = 10;

export type StageKind = 'walkround' | 'preview';

export interface StageOptions {
  kind: StageKind;
  carName: string;
  /** A marker tap goes to that finding and writes nothing. */
  onMarkerChosen?: (finding: StageFinding, position: number) => void;
}

/** The dark strip of advisory ticks along the bottom of the owner's stage preview. */
class TickStrip {
  readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(0, 1, 0, 1, -1, 1);
  private readonly strip: Mesh;
  private readonly ticks: Mesh[] = [];

  constructor() {
    this.strip = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: new Color(0.043, 0.035, 0.125) }));
    this.scene.add(this.strip);
    for (let index = 0; index < 12; index += 1) {
      const tick = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({ color: new Color(0.95, 0.96, 1) }));
      tick.visible = false;
      this.ticks.push(tick);
      this.scene.add(tick);
    }
  }

  layout(width: number, height: number, openAdvisories: number): void {
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = 0;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();

    this.strip.scale.set(width, TICK_STRIP_HEIGHT, 1);
    this.strip.position.set(width / 2, height - TICK_STRIP_HEIGHT / 2, 0);

    this.ticks.forEach((tick, index) => {
      const lit = index < Math.min(12, openAdvisories);
      tick.visible = lit;
      tick.position.set(16 * (index + 1), height - 12, 0);
    });
  }

  render(renderer: WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}

export class Stage {
  readonly region: HTMLElement;
  private readonly canvasHolder: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: WebGLRenderer | null = null;
  private stageScene: StageScene | null = null;
  private tickStrip: TickStrip | null = null;
  private stillHolder: HTMLElement | null = null;

  private track: StageTrack = buildTrack([], null);
  private seen = new Map<string, boolean>();
  private listing: ListingStatus = 'live';
  private openAdvisories: number | null = null;
  private restOverride: StageFinding | null = null;
  private frameCount = 0;
  private renderQueued = false;
  private disposed = false;
  private lostContext = false;
  private lastBox = { width: 0, height: 0 };
  private touchStart: { x: number; y: number } | null = null;
  private trackFingerprint = '';
  private restFingerprint = '';
  private seenFingerprint = '';

  constructor(private readonly options: StageOptions) {
    this.region = el('div', {
      class: `stage stage-${options.kind}`,
      role: 'region',
      'aria-label': options.kind === 'walkround' ? 'Walkround stage' : 'Stage preview',
    });
    this.canvasHolder = el('div', { class: 'stage-canvas-holder' });
    this.region.append(this.canvasHolder);

    this.startRenderer();
    this.bindPointer();
    window.addEventListener('resize', this.onResize);
    if (options.kind === 'walkround') window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  private startRenderer(): void {
    const canvas = el('canvas', { class: 'stage-canvas' }) as HTMLCanvasElement;
    const renderer = makeRenderer(canvas);
    if (renderer === null) {
      this.useStill();
      return;
    }
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lostContext = true;
      window.setTimeout(() => this.useStill(), 0);
    });
    this.canvas = canvas;
    this.renderer = renderer;
    this.stageScene = new StageScene();
    if (this.options.kind === 'preview') this.tickStrip = new TickStrip();
    this.canvasHolder.replaceChildren(canvas);
    this.region.dataset.renderer = 'webgl';
  }

  /** The drawn still, which replaces the canvas with no WebGL and after a lost context. */
  private useStill(): void {
    if (this.stillHolder !== null) return;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
    this.stageScene = null;
    this.tickStrip = null;
    this.stillHolder = el('div', {
      class: 'stage-still',
      role: 'img',
      'aria-label': `Facet still of ${this.options.carName}`,
    });
    this.canvasHolder.replaceChildren(this.stillHolder);
    this.region.dataset.renderer = 'svg';
    this.draw();
  }

  get contextIsLost(): boolean {
    return this.lostContext;
  }

  get stillMode(): boolean {
    return this.renderer === null || prefersReducedMotion();
  }

  /** The scene draws a frame only when the server state it shows has really changed. */
  setTrack(findings: readonly StageFinding[], heroFindingId: string | null): void {
    const next = JSON.stringify({ findings, heroFindingId });
    if (next === this.trackFingerprint) return;
    this.trackFingerprint = next;
    this.track = buildTrack(findings, heroFindingId);
    this.draw();
  }

  setSeen(seen: ReadonlyMap<string, boolean>): void {
    const next = [...seen].map(([id, value]) => `${id}:${value ? 1 : 0}`).sort().join(',');
    if (next === this.seenFingerprint) return;
    this.seenFingerprint = next;
    this.seen = new Map(seen);
    this.draw();
  }

  setListing(status: ListingStatus): void {
    if (this.listing === status) return;
    this.listing = status;
    this.draw();
  }

  setOpenAdvisories(count: number): void {
    if (this.openAdvisories === count) return;
    this.openAdvisories = count;
    this.region.dataset.openAdvisories = String(count);
    this.draw();
  }

  /** The preview rests on an unsaved pin while one is being placed. */
  setRestOverride(finding: StageFinding | null): void {
    const next = finding === null ? '' : `${finding.panelId}:${finding.u}:${finding.v}`;
    if (next === this.restFingerprint) return;
    this.restFingerprint = next;
    this.restOverride = finding;
    this.draw();
  }

  get trackScrollLength(): number {
    return trackLength(this.track.findings.length);
  }

  scrollToBeat(index: number): void {
    window.scrollTo({ top: (index + 1) * 720, behavior: 'auto' });
  }

  private onScroll = (): void => {
    if (prefersReducedMotion()) return;
    this.draw();
  };

  private onResize = (): void => {
    this.draw();
  };

  private currentTrack(): StageTrack {
    if (this.restOverride === null) return this.track;
    return buildTrack([this.restOverride], this.restOverride.id);
  }

  private boxSize(): { width: number; height: number } {
    const rect = this.canvasHolder.getBoundingClientRect();
    return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }

  /** Draws exactly one frame, queued so one scroll batch gives one frame. */
  private draw(): void {
    if (this.disposed || this.renderQueued) return;
    this.renderQueued = true;
    window.requestAnimationFrame(() => {
      this.renderQueued = false;
      this.paint();
    });
  }

  private markerStates(): MarkerState[] {
    return this.track.findings.map((finding) => ({ finding, seen: this.seen.get(finding.id) === true }));
  }

  private paint(): void {
    const track = this.currentTrack();
    const box = this.boxSize();
    const still = this.stillMode || this.options.kind === 'preview';
    const scroll = this.options.kind === 'walkround' ? window.scrollY : 0;
    const state = beatStateOf(track, scroll, still);
    const pose = poseOf(track, state);
    const projection = buildProjection(pose, box.width, box.height);

    this.writeAttributes(state, pose, projection.matrix, box);

    const anchorPoint: Vec3 =
      state.panelId === ''
        ? [0, 0.7, 0]
        : worldPoint(panelOf(state.panelId), state.anchor.u, state.anchor.v);

    if (this.renderer !== null && this.stageScene !== null && this.canvas !== null) {
      const ratio = Math.min(3, window.devicePixelRatio || 1);
      if (box.width !== this.lastBox.width || box.height !== this.lastBox.height) {
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(box.width, box.height, true);
        this.lastBox = box;
      }
      this.stageScene.apply({
        camera: projection.camera,
        panelId: state.panelId,
        anchor: anchorPoint,
        rimGlow: state.rimGlow,
        markers: this.markerStates(),
        dimmed: this.listingIsClosed(),
        cssHeight: box.height,
      });
      this.renderer.autoClear = true;
      this.renderer.render(this.stageScene.scene, projection.camera);
      if (this.tickStrip !== null && this.openAdvisories !== null) {
        this.tickStrip.layout(box.width, box.height, this.openAdvisories);
        this.renderer.autoClear = false;
        this.tickStrip.render(this.renderer);
      }
      this.frameCount += 1;
      this.region.dataset.frameCount = String(this.frameCount);
      return;
    }

    if (this.stillHolder !== null) {
      if (track.findings.length === 0 && this.options.kind === 'preview') {
        this.stillHolder.replaceChildren(el('p', { class: 'stage-empty', text: 'No findings yet' }));
        return;
      }
      this.stillHolder.replaceChildren(
        svgFrom(
          facetStillSvg({
            matrix: projection.matrix,
            eye: pose.eye,
            width: box.width,
            height: box.height,
            anchor: anchorPoint,
            findings: this.markerStates().map((marker) => ({ finding: marker.finding, seen: marker.seen })),
            dimmed: this.listingIsClosed(),
            openAdvisories: this.openAdvisories,
          }),
        ),
      );
      this.frameCount += 1;
      this.region.dataset.frameCount = String(this.frameCount);
    }
  }

  private listingIsClosed(): boolean {
    return this.listing === 'under_offer' || this.listing === 'sold' || this.listing === 'withdrawn';
  }

  private writeAttributes(
    state: BeatState,
    pose: ReturnType<typeof poseOf>,
    matrix: ReturnType<typeof buildProjection>['matrix'],
    box: { width: number; height: number },
  ): void {
    const data = this.region.dataset;
    data.mode = this.options.kind === 'preview' || this.stillMode ? 'still' : 'scroll';
    data.beat = String(state.beat);
    data.beatProgress = state.beatProgress.toFixed(2);
    data.panel = state.panelId;
    data.anchor = state.panelId === '' ? '' : anchorAttribute(state.anchor);
    data.rimGlow = state.rimGlow.toFixed(2);
    data.cardTravel = state.cardTravel.toFixed(2);
    data.cameraAngle = pose.angle.toFixed(3);
    data.cameraPosition = positionAttribute(pose.eye);
    data.viewProjection = matrixAttribute(matrix);
    data.listing = this.listing;
    this.lastProjection = { matrix, box };
  }

  private lastProjection: { matrix: ReturnType<typeof buildProjection>['matrix']; box: { width: number; height: number } } | null =
    null;

  /** The marker nearest a tap within 22 CSS pixels, with a tie going to the lower position. */
  private markerNear(clientX: number, clientY: number): { finding: StageFinding; position: number } | null {
    if (this.lastProjection === null) return null;
    const rect = this.canvasHolder.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const best: { finding: StageFinding; position: number; distance: number }[] = [];

    this.track.findings.forEach((finding, index) => {
      if (this.lastProjection === null) return;
      const point = projectToBox(
        this.lastProjection.matrix,
        worldPoint(panelOf(finding.panelId), finding.u, finding.v),
        this.lastProjection.box,
      );
      if (!point.inFront) return;
      if (point.x < 0 || point.y < 0 || point.x > this.lastProjection.box.width || point.y > this.lastProjection.box.height) {
        return;
      }
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance > MARKER_TAP_RADIUS) return;
      if (best.length === 0 || distance < best[0].distance) best[0] = { finding, position: index + 1, distance };
    });

    return best.length === 0 ? null : { finding: best[0].finding, position: best[0].position };
  }

  private bindPointer(): void {
    if (this.options.kind !== 'walkround') return;
    this.region.addEventListener('click', (event) => {
      const pinned = (event.target as HTMLElement | null)?.closest<SVGGElement>('.still-pin');
      if (pinned !== null && pinned !== undefined) {
        const id = pinned.dataset.findingId;
        const index = this.track.findings.findIndex((finding) => finding.id === id);
        if (index >= 0) this.options.onMarkerChosen?.(this.track.findings[index], index + 1);
        return;
      }
      const chosen = this.markerNear(event.clientX, event.clientY);
      if (chosen !== null) this.options.onMarkerChosen?.(chosen.finding, chosen.position);
    });

    this.region.addEventListener(
      'touchstart',
      (event) => {
        const touch = event.touches[0];
        this.touchStart = touch === undefined ? null : { x: touch.clientX, y: touch.clientY };
      },
      { passive: true },
    );
    this.region.addEventListener(
      'touchend',
      (event) => {
        const start = this.touchStart;
        this.touchStart = null;
        const touch = event.changedTouches[0];
        if (start === null || touch === undefined) return;
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TOUCH_SCROLL_SLOP) return;
        const chosen = this.markerNear(touch.clientX, touch.clientY);
        if (chosen !== null) this.options.onMarkerChosen?.(chosen.finding, chosen.position);
      },
      { passive: true },
    );
  }

  /** The projection of a finding's world point in the stage's own box. */
  projectionOf(finding: StageFinding): { x: number; y: number } | null {
    if (this.lastProjection === null) return null;
    const point = projectToBox(
      this.lastProjection.matrix,
      worldPoint(panelOf(finding.panelId), finding.u, finding.v),
      this.lastProjection.box,
    );
    return point.inFront ? { x: point.x, y: point.y } : null;
  }

  redraw(): void {
    this.draw();
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('scroll', this.onScroll);
    this.renderer?.dispose();
  }
}
