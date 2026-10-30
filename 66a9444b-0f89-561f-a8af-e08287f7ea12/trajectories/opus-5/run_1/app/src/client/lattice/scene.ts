import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { FestivalDay, Named, Session } from '../lib/types.js';

export const DISCIPLINE_COLOURS: Record<string, string> = {
  sound: '#1b1ae5',
  light: '#f6f2e9',
  performance: '#ff3b14',
   'moving-image': '#6e6df2',
  code: '#ff8a6b',
};

export const LIME = '#cff50a';
export const VERMILION = '#ff3b14';
export const PAPER = '#f6f2e9';

export interface LatticeSelection {
  day: string | null;
  venue: string | null;
  discipline: string | null;
}

export interface LatticeData {
  days: FestivalDay[];
  venues: Named[];
  disciplines: Named[];
  sessions: Session[];
}

export interface LatticeCallbacks {
  onPick: (kind: 'day' | 'venue' | 'discipline', id: string) => void;
  onReport: (attributes: Record<string, string>) => void;
}

/** Durations, in seconds: a quick beat, a settle, a section change and the opening camera move. */
const BEAT = 0.18;
const SETTLE = 0.33;
const SECTION = 0.55;
const INTRO = 1.4;

const SCROLL_RANGE = 900;
const SLAB_GAP = 3.4;
const VENUE_GAP = 1.5;
const SLAB_HEIGHT = 7;
const BAR_DEPTH = 0.42;
const SWATCH_SIZE = 0.44;

/** A fast start that settles softly. */
function ease(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** A springy settle for the selection raise. */
function spring(t: number): number {
  return 1 - Math.cos(t * Math.PI * 1.5) * (1 - t) ** 2;
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

interface Raisable {
  group: Group;
  baseY: number;
  raise: number;
  target: number;
  opacity: number;
  opacityTarget: number;
  meshes: Mesh[];
  lines: LineSegments[];
}

interface BarEntry extends Raisable {
  session: Session;
  colour: Color;
  litAmount: number;
  litTarget: number;
}

interface Seam {
  mesh: Mesh;
  pair: string;
  grow: number;
}

export class LatticeScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private readonly bars = new Map<string, BarEntry>();
  private readonly slabs = new Map<string, Raisable>();
  private readonly pillars = new Map<string, Raisable>();
  private readonly swatches = new Map<string, Raisable>();
  private seams: Seam[] = [];

  private readonly pickables: Array<{ mesh: Mesh; kind: 'day' | 'venue' | 'discipline'; id: string }> = [];

  private introStarted = 0;
  private introDone = false;
  private progress = 0;
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private pointerInside = false;
  private running = false;
  private lastFrame = 0;
  private selection: LatticeSelection = { day: null, venue: null, discipline: null };
  private agenda: string[] = [];
  private clashes: Array<[string, string]> = [];
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private data: LatticeData,
    private readonly callbacks: LatticeCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(new Color('#0e0e10'), 1);
    this.camera = new PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.build();
    this.introStarted = performance.now();
    this.resize();
    this.start();
  }

  static supported(): boolean {
    try {
      const probe = document.createElement('canvas');
      return (
        probe.getContext('webgl2') !== null ||
        probe.getContext('webgl') !== null
      );
    } catch {
      return false;
    }
  }

  private dayIndex(date: string): number {
    return Math.max(0, this.data.days.findIndex((day) => day.date === date));
  }

  private venueIndex(id: string): number {
    return Math.max(0, this.data.venues.findIndex((venue) => venue.id === id));
  }

  private venueX(id: string): number {
    const centre = (this.data.venues.length - 1) / 2;
    return (this.venueIndex(id) - centre) * VENUE_GAP;
  }

  private dayZ(date: string): number {
    return -this.dayIndex(date) * SLAB_GAP;
  }

  /** Each session's start and end map to a height inside its own festival day. */
  private timeSpan(session: Session): { start: number; end: number } {
    const day = this.data.days.find((candidate) => candidate.date === session.festival_day);
    const dayStart = new Date(day?.starts_at ?? session.starts_at).getTime();
    const dayEnd = new Date(day?.ends_at ?? session.ends_at).getTime();
    const length = Math.max(1, dayEnd - dayStart);
    const start = (new Date(session.starts_at).getTime() - dayStart) / length;
    const end = (new Date(session.ends_at).getTime() - dayStart) / length;
    return {
      start: Math.max(0, Math.min(1, start)) * SLAB_HEIGHT,
      end: Math.max(0, Math.min(1, end)) * SLAB_HEIGHT,
    };
  }

  private makeRaisable(group: Group, baseY: number, meshes: Mesh[], lines: LineSegments[]): Raisable {
    return { group, baseY, raise: 0, target: 0, opacity: 1, opacityTarget: 1, meshes, lines };
  }

  private build(): void {
    for (const day of this.data.days) {
      const group = new Group();
      const geometry = new BoxGeometry(
        this.data.venues.length * VENUE_GAP + 1.1,
        0.08,
        BAR_DEPTH * 2.4,
      );
      const material = new MeshBasicMaterial({
        color: new Color('#2a2a30'),
        transparent: true,
        opacity: 1,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(0, -0.3, this.dayZ(day.date));
      group.add(mesh);
      const edges = new LineSegments(
        new EdgesGeometry(geometry),
        new LineBasicMaterial({ color: new Color(PAPER), transparent: true, opacity: 0.55 }),
      );
      edges.position.copy(mesh.position);
      group.add(edges);
      this.scene.add(group);
      this.slabs.set(day.date, this.makeRaisable(group, 0, [mesh], [edges]));
      this.pickables.push({ mesh, kind: 'day', id: day.date });
    }

    const depth = (this.data.days.length - 1) * SLAB_GAP + BAR_DEPTH * 3;
    for (const venue of this.data.venues) {
      const group = new Group();
      const geometry = new BoxGeometry(0.1, SLAB_HEIGHT + 0.6, depth);
      const material = new MeshBasicMaterial({
        color: new Color('#3a3a45'),
        transparent: true,
        opacity: 1,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(this.venueX(venue.id), SLAB_HEIGHT / 2, -((this.data.days.length - 1) * SLAB_GAP) / 2);
      group.add(mesh);
      this.scene.add(group);
      this.pillars.set(venue.id, this.makeRaisable(group, mesh.position.y, [mesh], []));
      this.pickables.push({ mesh, kind: 'venue', id: venue.id });
    }

    const swatchCentre = (this.data.disciplines.length - 1) / 2;
    for (const [index, discipline] of this.data.disciplines.entries()) {
      const group = new Group();
      const geometry = new BoxGeometry(SWATCH_SIZE, SWATCH_SIZE, SWATCH_SIZE);
      const material = new MeshBasicMaterial({
        color: new Color(DISCIPLINE_COLOURS[discipline.id] ?? PAPER),
        transparent: true,
        opacity: 1,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set((index - swatchCentre) * (SWATCH_SIZE * 2.1), -1.25, 1.6);
      group.add(mesh);
      this.scene.add(group);
      this.swatches.set(discipline.id, this.makeRaisable(group, mesh.position.y, [mesh], []));
      this.pickables.push({ mesh, kind: 'discipline', id: discipline.id });
    }

    this.buildBars();
  }

  private buildBars(): void {
    for (const bar of this.bars.values()) this.scene.remove(bar.group);
    this.bars.clear();

    for (const session of this.data.sessions) {
      const span = this.timeSpan(session);
      const height = Math.max(0.22, span.end - span.start);
      const width = session.admission === 'seat' ? 0.72 : 0.5;
      const geometry = new BoxGeometry(width, height, BAR_DEPTH);
      const colour = new Color(DISCIPLINE_COLOURS[session.discipline] ?? PAPER);
      const group = new Group();
      const meshes: Mesh[] = [];
      const lines: LineSegments[] = [];
      const centreY = span.start + height / 2;

      if (session.status === 'cancelled') {
        const outline = new LineSegments(
          new EdgesGeometry(geometry),
          new LineBasicMaterial({ color: colour, transparent: true, opacity: 1 }),
        );
        outline.position.set(this.venueX(session.venue_id), centreY, this.dayZ(session.festival_day));
        group.add(outline);
        lines.push(outline);
      } else {
        const material = new MeshBasicMaterial({ color: colour, transparent: true, opacity: 1 });
        const mesh = new Mesh(geometry, material);
        mesh.position.set(this.venueX(session.venue_id), centreY, this.dayZ(session.festival_day));
        group.add(mesh);
        meshes.push(mesh);
      }

      this.scene.add(group);
      this.bars.set(session.id, {
        ...this.makeRaisable(group, centreY, meshes, lines),
        session,
        colour,
        litAmount: 0,
        litTarget: 0,
      });
    }
  }

  setData(data: LatticeData): void {
    this.data = data;
    this.buildBars();
    this.applySelection();
    this.applyAgenda();
    this.request();
  }

  setSelection(selection: LatticeSelection): void {
    this.selection = selection;
    this.applySelection();
    this.request();
  }

  setAgenda(agenda: string[], clashes: Array<[string, string]>): void {
    this.agenda = agenda;
    this.clashes = clashes;
    this.applyAgenda();
    this.request();
  }

  /** Selecting an object raises it, while every unselected object fades to a quarter opacity. */
  private applySelection(): void {
    const anySelection =
      this.selection.day !== null ||
      this.selection.venue !== null ||
      this.selection.discipline !== null;

    const matches = (kind: 'day' | 'venue' | 'discipline', id: string): boolean => {
      if (kind === 'day') return this.selection.day === id;
      if (kind === 'venue') return this.selection.venue === id;
      return this.selection.discipline === id;
    };

    for (const [id, slab] of this.slabs) {
      const selected = matches('day', id);
      slab.target = selected ? 0.55 : 0;
      slab.opacityTarget = !anySelection || selected ? 1 : 0.25;
    }
    for (const [id, pillar] of this.pillars) {
      const selected = matches('venue', id);
      pillar.target = selected ? 0.55 : 0;
      pillar.opacityTarget = !anySelection || selected ? 1 : 0.25;
    }
    for (const [id, swatch] of this.swatches) {
      const selected = matches('discipline', id);
      swatch.target = selected ? 0.4 : 0;
      swatch.opacityTarget = !anySelection || selected ? 1 : 0.25;
    }
    for (const bar of this.bars.values()) {
      const kept =
        (this.selection.day === null || bar.session.festival_day === this.selection.day) &&
        (this.selection.venue === null || bar.session.venue_id === this.selection.venue) &&
        (this.selection.discipline === null || bar.session.discipline === this.selection.discipline);
      bar.opacityTarget = !anySelection || kept ? 1 : 0.25;
      bar.target = anySelection && kept ? 0.3 : 0;
    }
  }

  /** Adding a session lights its bar lime; a clash draws a vermilion seam between two bars. */
  private applyAgenda(): void {
    for (const [id, bar] of this.bars) {
      bar.litTarget = this.agenda.includes(id) ? 1 : 0;
    }

    for (const seam of this.seams) this.scene.remove(seam.mesh);
    this.seams = [];

    for (const [a, b] of this.clashes) {
      const first = this.bars.get(a);
      const second = this.bars.get(b);
      if (first === undefined || second === undefined) continue;
      const from = this.barCentre(first);
      const to = this.barCentre(second);
      const length = from.distanceTo(to);
      if (length < 0.001) continue;
      const geometry = new BoxGeometry(length, 0.08, 0.08);
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({ color: new Color(VERMILION), transparent: true, opacity: 1 }),
      );
      mesh.position.copy(from.clone().add(to).multiplyScalar(0.5));
      mesh.lookAt(to);
      mesh.rotateY(Math.PI / 2);
      mesh.scale.x = 0.001;
      this.scene.add(mesh);
      this.seams.push({ mesh, pair: `${a}+${b}`, grow: 0 });
    }
  }

  private barCentre(bar: BarEntry): Vector3 {
    const target = bar.meshes[0] ?? bar.lines[0];
    const position = target === undefined ? new Vector3() : target.position.clone();
    position.y += bar.raise;
    return position;
  }

  setScroll(scrollY: number): void {
    const next = Math.max(0, Math.min(1, scrollY / SCROLL_RANGE));
    if (Math.abs(next - this.progress) < 0.0005) return;
    this.progress = next;
    this.request();
  }

  /** Pointer position maps to camera yaw from −8° to +8° and pitch from +5° to −5°. */
  setPointer(x: number | null, y: number | null): void {
    if (x === null || y === null) {
      this.pointerInside = false;
      this.yawTarget = 0;
      this.pitchTarget = 0;
    } else {
      this.pointerInside = true;
      this.yawTarget = radians(-8 + x * 16);
      this.pitchTarget = radians(5 - y * 10);
      this.pointer.set(x * 2 - 1, -(y * 2 - 1));
    }
    this.request();
  }

  pick(x: number, y: number): void {
    this.pointer.set(x * 2 - 1, -(y * 2 - 1));
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.pickables.map((entry) => entry.mesh),
      false,
    );
    const first = hits[0];
    if (first === undefined) return;
    const found = this.pickables.find((entry) => entry.mesh === first.object);
    if (found === undefined) return;
    this.callbacks.onPick(found.kind, found.id);
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  private start(): void {
    this.lastFrame = performance.now();
    this.request();
  }

  private request(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    requestAnimationFrame((now) => this.frame(now));
  }

  /** The loop stops as soon as everything has settled, so nothing animates while idle. */
  private frame(now: number): void {
    this.running = false;
    if (this.disposed) return;
    const delta = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    let busy = false;
    const introElapsed = (now - this.introStarted) / 1000;
    const introProgress = Math.min(1, introElapsed / INTRO);
    if (introProgress < 1) busy = true;
    else if (!this.introDone) this.introDone = true;

    const follow = this.pointerInside ? BEAT : SECTION;
    const tilt = 1 - Math.exp((-delta / follow) * 3);
    if (Math.abs(this.yawTarget - this.yaw) > 0.0004 || Math.abs(this.pitchTarget - this.pitch) > 0.0004) {
      this.yaw += (this.yawTarget - this.yaw) * tilt;
      this.pitch += (this.pitchTarget - this.pitch) * tilt;
      busy = true;
    } else {
      this.yaw = this.yawTarget;
      this.pitch = this.pitchTarget;
    }

    const step = delta / SETTLE;
    const raiseStep = (item: Raisable): void => {
      if (Math.abs(item.target - item.raise) > 0.001) {
        const towards = item.target > item.raise ? 1 : -1;
        const distance = Math.abs(item.target - item.raise);
        const move = Math.min(distance, Math.max(0.004, spring(Math.min(1, step * 3)) * distance));
        item.raise += towards * move;
        busy = true;
      } else {
        item.raise = item.target;
      }
      if (Math.abs(item.opacityTarget - item.opacity) > 0.004) {
        item.opacity += (item.opacityTarget - item.opacity) * Math.min(1, step * 2.2);
        busy = true;
      } else {
        item.opacity = item.opacityTarget;
      }
      item.group.position.y = item.raise;
      for (const mesh of item.meshes) {
        (mesh.material as MeshBasicMaterial).opacity = item.opacity;
      }
      for (const line of item.lines) {
        (line.material as LineBasicMaterial).opacity = item.opacity;
      }
    };

    for (const slab of this.slabs.values()) raiseStep(slab);
    for (const pillar of this.pillars.values()) raiseStep(pillar);
    for (const swatch of this.swatches.values()) raiseStep(swatch);

    const litStep = delta / BEAT;
    for (const bar of this.bars.values()) {
      raiseStep(bar);
      if (Math.abs(bar.litTarget - bar.litAmount) > 0.004) {
        bar.litAmount += (bar.litTarget - bar.litAmount) * Math.min(1, litStep);
        busy = true;
      } else {
        bar.litAmount = bar.litTarget;
      }
      const lit = new Color(LIME);
      const blended = bar.colour.clone().lerp(lit, bar.litAmount);
      for (const mesh of bar.meshes) (mesh.material as MeshBasicMaterial).color.copy(blended);
      for (const line of bar.lines) (line.material as LineBasicMaterial).color.copy(blended);
    }

    for (const seam of this.seams) {
      if (seam.grow < 1) {
        seam.grow = Math.min(1, seam.grow + delta / SETTLE);
        busy = true;
      }
      seam.mesh.scale.x = Math.max(0.001, ease(seam.grow));
    }

    this.placeCamera(introProgress);
    this.renderer.render(this.scene, this.camera);
    this.report(introProgress);

    if (busy) this.request();
  }

  /**
   * Scroll position alone sets the camera depth, so scrolling back retraces each step exactly; the
   * opening move eases from a high oblique view down to a three-quarter view.
   */
  private placeCamera(introProgress: number): void {
    const baseYaw = radians(-26);
    const basePitch = radians(-17);
    const introEase = ease(introProgress);
    const yaw = baseYaw + this.yaw;
    const pitch = basePitch + this.pitch + radians(-34) * (1 - introEase);
    const radius = 13.5 + 5.5 * (1 - introEase);

    const depth = -this.progress * (this.data.days.length - 1) * SLAB_GAP;
    const target = new Vector3(0, SLAB_HEIGHT / 2, depth);
    const offset = new Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      -Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(radius);
    this.camera.position.copy(target.clone().add(offset));
    this.camera.lookAt(target);
  }

  private report(introProgress: number): void {
    const nearest = Math.round(this.progress * (this.data.days.length - 1)) + 1;
    const raised: string[] = [];
    if (this.selection.day !== null) raised.push(`day:${this.selection.day}`);
    if (this.selection.venue !== null) raised.push(`venue:${this.selection.venue}`);
    if (this.selection.discipline !== null) raised.push(`discipline:${this.selection.discipline}`);

    this.callbacks.onReport({
      'data-intro': introProgress < 1 ? 'running' : 'done',
      'data-camera-progress': this.progress.toFixed(2),
      'data-camera-day': String(nearest),
      'data-yaw': degrees(this.yaw).toFixed(1),
      'data-pitch': degrees(this.pitch).toFixed(1),
      'data-raised': raised.join(','),
      'data-lit': this.agenda.filter((id) => this.bars.has(id)).join(','),
      'data-seams': this.seams.map((seam) => seam.pair).join(','),
    });
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
  }
}
