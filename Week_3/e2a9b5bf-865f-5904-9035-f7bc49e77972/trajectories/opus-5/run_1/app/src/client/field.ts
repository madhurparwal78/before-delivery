import {
  brightnessChosen,
  FIELD_COPY,
  pairReadout,
  starPlaced,
  swapSentence,
} from '../shared/messages.js';
import { readoutLine, train as trainOf } from '../shared/optics.js';
import { derivePair, formatSeparation, samePoint } from '../shared/pair.js';
import {
  clampToField,
  moveCursor,
  pixelToSky,
  skyToPixel,
  type ArrowDirection,
} from '../shared/projection.js';
import type {
  DerivedOptics,
  SkyPoint,
  Star,
  Stroke,
  StrokeFile,
  StrokeWidth,
  TrainId,
} from '../shared/types.js';
import { el, prefersReducedMotion, setStatus } from './dom.js';
import { announceField, regions } from './regions.js';

const SCALE_MS = 320;
const ORIENT_MS = 180;
const SWAP_MS = SCALE_MS + ORIENT_MS;
const REFERENCE_RADIUS = 171;

export type SketchMode = 'pencil' | 'star' | 'measure';

export interface PairMarks {
  primary: SkyPoint | null;
  secondary: SkyPoint | null;
}

export interface FieldMarks {
  strokes: Stroke[];
  stars: Star[];
  pair: PairMarks;
}

type UndoEntry =
  | { kind: 'stroke' }
  | { kind: 'star' }
  | { kind: 'pair'; previous: PairMarks }
  | { kind: 'clear'; strokes: Stroke[]; stars: Star[] };

export interface FieldSnapshot {
  marks: FieldMarks;
  undo: UndoEntry[];
  cursor: SkyPoint;
  brightness: 1 | 2 | 3 | 4 | 5;
  mode: SketchMode;
  width: StrokeWidth;
}

interface Transform {
  scale: number;
  rotation: number;
  flip: number;
}

interface SwapRun {
  startedAt: number;
  from: Transform;
  to: Transform;
  animatedScale: number;
  fromValues: { magnification: number; trueField: number; exitPupil: number };
  toValues: { magnification: number; trueField: number; exitPupil: number };
  sentence: string;
  announce: boolean;
}

export interface FieldHooks {
  /** A bracket key asked for the next eyepiece in the kit. */
  onEyepieceStep: (direction: 1 | -1) => void;
  /** Marks or the pair changed, so the draft needs writing. */
  onMarksChanged: () => void;
  /** The chosen object's kind decides whether Measure and the Pair readout show. */
  isDoubleStar: () => boolean;
  onClearRequest: (confirmed: () => void) => void;
}

let dialogIsOpen = false;

export function setDialogOpen(open: boolean): void {
  dialogIsOpen = open;
}

function identity(): Transform {
  return { scale: 1, rotation: 0, flip: 1 };
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function emptyMarks(): FieldMarks {
  return { strokes: [], stars: [], pair: { primary: null, secondary: null } };
}

export class FieldRegion {
  readonly element: HTMLElement;
  readonly circle: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly compass: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly counting: HTMLElement;
  private readonly countingFigures: HTMLElement[];
  private readonly pairStatus: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly toolButtons = new Map<string, HTMLButtonElement>();

  private marks: FieldMarks = emptyMarks();
  private undoStack: UndoEntry[] = [];
  private cursor: SkyPoint = [0, 0];
  private brightness: 1 | 2 | 3 | 4 | 5 = 3;
  private mode: SketchMode = 'pencil';
  private width: StrokeWidth = 'medium';

  private base: { train: TrainId; trueField: number } = { train: 'straight', trueField: 60 };
  private transform: Transform = identity();
  private target: DerivedOptics;
  private displayed: { magnification: number; trueField: number; exitPupil: number };
  private swap: SwapRun | null = null;
  private frame: number | null = null;
  private radius = REFERENCE_RADIUS;
  private readable = true;

  private activeStroke: Stroke | null = null;
  private strokePointer: number | null = null;
  private pendingTap: { pointerId: number; at: SkyPoint; mode: SketchMode } | null = null;
  private readonly livePointers = new Set<number>();
  private penDown = false;

  constructor(
    optics: DerivedOptics,
    private readonly hooks: FieldHooks,
  ) {
    this.target = optics;
    this.base = { train: optics.orientation.train, trueField: optics.true_field_arcmin };
    this.displayed = {
      magnification: optics.magnification,
      trueField: optics.true_field_arcmin,
      exitPupil: optics.exit_pupil_mm,
    };

    this.canvas = el('canvas', { class: 'field-canvas' });
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('the field needs a 2d canvas');
    this.context = context;

    this.compass = el('div', {
      class: 'compass',
      attrs: { role: 'img', 'aria-label': `Compass: ${optics.orientation.sentence}` },
    });
    this.circle = el(
      'div',
      {
        class: 'field-circle',
        attrs: { role: 'application', 'aria-label': 'Eyepiece field', tabindex: '0' },
      },
      [this.canvas, this.compass],
    );

    this.readout = el('div', {
      class: 'readout',
      attrs: { role: 'status', 'aria-label': 'Optics readout', 'aria-live': 'polite' },
      text: readoutLine(optics),
    });
    this.countingFigures = [0, 1, 2].map(() =>
      el('span', { class: 'counting-figure', attrs: { 'aria-hidden': 'true' } }),
    );
    this.counting = el('div', { class: 'counting hidden' }, this.countingFigures);
    this.pairStatus = el('div', {
      class: 'readout pair-readout',
      attrs: { role: 'status', 'aria-label': 'Pair readout', 'aria-live': 'polite' },
      text: FIELD_COPY.pair_none,
    });
    this.toolbar = el('div', {
      class: 'tools',
      attrs: { role: 'toolbar', 'aria-label': 'Sketch tools' },
    });

    const announcements = el('div', {
      class: 'visually-hidden',
      attrs: { role: 'status', 'aria-label': 'Field announcements', 'aria-live': 'polite' },
    });

    // One grid, so each viewport can place the circle, tools and readouts.
    this.element = el(
      'section',
      { class: 'field-region', attrs: { 'aria-label': 'Field', role: 'region' } },
      [
        this.circle,
        this.toolbar,
        el('div', { class: 'readouts' }, [this.readout, this.counting, this.pairStatus]),
        announcements,
      ],
    );

    regions.opticsReadout = this.readout;
    regions.pairReadout = this.pairStatus;
    regions.fieldAnnouncements = announcements;

    this.buildTools();
    this.attachPointer();
    this.attachKeyboard();
    this.observeSize();
  }

  // ---- tools -------------------------------------------------------------

  private toolButton(name: string, onPress: () => void, pressed?: boolean): HTMLButtonElement {
    const node = el('button', {
      class: 'tool',
      text: name,
      attrs: {
        type: 'button',
        ...(pressed === undefined ? {} : { 'aria-pressed': String(pressed) }),
      },
      on: { click: onPress },
    });
    this.toolButtons.set(name, node);
    return node;
  }

  private buildTools(): void {
    const children: HTMLElement[] = [];
    children.push(
      this.toolButton('Pencil', () => this.setMode('pencil'), this.mode === 'pencil'),
      this.toolButton('Star', () => this.setMode('star'), this.mode === 'star'),
    );
    if (this.hooks.isDoubleStar()) {
      children.push(this.toolButton('Measure', () => this.setMode('measure'), this.mode === 'measure'));
    }
    children.push(
      this.toolButton('Fine', () => this.setWidth('fine'), this.width === 'fine'),
      this.toolButton('Medium', () => this.setWidth('medium'), this.width === 'medium'),
      this.toolButton('Broad', () => this.setWidth('broad'), this.width === 'broad'),
      this.toolButton('Undo', () => this.undo()),
      this.toolButton('Clear sketch', () => this.hooks.onClearRequest(() => this.clearSketch())),
    );
    this.toolbar.replaceChildren(...children);
    this.applyReadableState();
  }

  /** Measure and the Pair readout follow the chosen object's kind. */
  refreshForObjectKind(): void {
    const isDouble = this.hooks.isDoubleStar();
    if (!isDouble && this.mode === 'measure') this.mode = 'pencil';
    this.buildTools();
    this.pairStatus.classList.toggle('hidden', !isDouble);
    if (isDouble) this.paintPairReadout();
  }

  private setMode(mode: SketchMode): void {
    this.mode = mode;
    this.updatePressed();
  }

  private setWidth(width: StrokeWidth): void {
    this.width = width;
    this.updatePressed();
  }

  private updatePressed(): void {
    for (const [name, node] of this.toolButtons) {
      if (name === 'Pencil') node.setAttribute('aria-pressed', String(this.mode === 'pencil'));
      if (name === 'Star') node.setAttribute('aria-pressed', String(this.mode === 'star'));
      if (name === 'Measure') node.setAttribute('aria-pressed', String(this.mode === 'measure'));
      if (name === 'Fine') node.setAttribute('aria-pressed', String(this.width === 'fine'));
      if (name === 'Medium') node.setAttribute('aria-pressed', String(this.width === 'medium'));
      if (name === 'Broad') node.setAttribute('aria-pressed', String(this.width === 'broad'));
    }
  }

  /** A sketch storage refused to serve disables marking but nothing else. */
  setReadable(readable: boolean): void {
    this.readable = readable;
    this.applyReadableState();
    if (!readable) announceField(FIELD_COPY.sketch_unreadable);
  }

  private applyReadableState(): void {
    for (const [name, node] of this.toolButtons) {
      if (name === 'Undo' || name === 'Clear sketch' || name === 'Pencil' || name === 'Star' || name === 'Measure') {
        node.disabled = !this.readable;
      }
    }
  }

  // ---- marks -------------------------------------------------------------

  snapshot(): FieldSnapshot {
    return {
      marks: {
        strokes: this.marks.strokes.map((stroke) => ({
          width: stroke.width,
          points: stroke.points.map((point) => [...point] as SkyPoint),
        })),
        stars: this.marks.stars.map((star) => ({ at: [...star.at] as SkyPoint, brightness: star.brightness })),
        pair: { ...this.marks.pair },
      },
      undo: [...this.undoStack],
      cursor: [...this.cursor] as SkyPoint,
      brightness: this.brightness,
      mode: this.mode,
      width: this.width,
    };
  }

  restore(snapshot: FieldSnapshot): void {
    this.marks = snapshot.marks;
    this.undoStack = snapshot.undo;
    this.cursor = snapshot.cursor;
    this.brightness = snapshot.brightness;
    this.mode = snapshot.mode;
    this.width = snapshot.width;
    this.buildTools();
    this.paintPairReadout();
    this.draw();
  }

  loadStrokeFile(file: StrokeFile | null, pair: PairMarks): void {
    this.marks = {
      strokes: file ? file.strokes.map((stroke) => ({ ...stroke })) : [],
      stars: file ? file.stars.map((star) => ({ ...star })) : [],
      pair,
    };
    this.undoStack = [];
    this.cursor = [0, 0];
    this.paintPairReadout();
    this.draw();
  }

  strokeFile(): StrokeFile {
    return {
      format: 'lowlamp-strokes/1',
      strokes: this.marks.strokes,
      stars: this.marks.stars,
    };
  }

  pair(): PairMarks {
    return this.marks.pair;
  }

  hasMarks(): boolean {
    return this.marks.strokes.length > 0 || this.marks.stars.length > 0;
  }

  private changed(): void {
    this.draw();
    this.hooks.onMarksChanged();
  }

  private undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (entry.kind === 'stroke') this.marks.strokes.pop();
    if (entry.kind === 'star') this.marks.stars.pop();
    if (entry.kind === 'pair') {
      this.marks.pair = entry.previous;
      this.paintPairReadout();
    }
    if (entry.kind === 'clear') {
      this.marks.strokes = entry.strokes;
      this.marks.stars = entry.stars;
    }
    announceField(FIELD_COPY.removed_mark);
    this.changed();
  }

  private clearSketch(): void {
    this.undoStack.push({
      kind: 'clear',
      strokes: this.marks.strokes,
      stars: this.marks.stars,
    });
    this.marks.strokes = [];
    this.marks.stars = [];
    this.changed();
  }

  private placeStar(at: SkyPoint): void {
    this.marks.stars.push({ at, brightness: this.brightness });
    this.undoStack.push({ kind: 'star' });
    announceField(starPlaced(this.brightness));
    this.changed();
  }

  private markPair(at: SkyPoint): void {
    const current = this.marks.pair;
    const previous: PairMarks = { ...current };
    if (current.primary === null) {
      this.marks.pair = { primary: at, secondary: null };
    } else if (current.secondary === null) {
      if (samePoint(current.primary, at)) return;
      this.marks.pair = { primary: current.primary, secondary: at };
    } else {
      this.marks.pair = { primary: at, secondary: null };
    }
    this.undoStack.push({ kind: 'pair', previous });
    this.paintPairReadout();
    this.changed();
  }

  private paintPairReadout(): void {
    if (!this.hooks.isDoubleStar()) return;
    const { primary, secondary } = this.marks.pair;
    if (primary === null) {
      setStatus(this.pairStatus, FIELD_COPY.pair_none);
      return;
    }
    if (secondary === null) {
      setStatus(this.pairStatus, FIELD_COPY.pair_one);
      return;
    }
    const measured = derivePair({ primary, secondary });
    setStatus(
      this.pairStatus,
      pairReadout(formatSeparation(measured.separation_arcmin), measured.position_angle_deg),
    );
  }

  // ---- optics and the Field swap ----------------------------------------

  currentOptics(): DerivedOptics {
    return this.target;
  }

  /** The newest local pick. A server reply never calls this. */
  applyPick(optics: DerivedOptics): void {
    const previousSentence = this.target.orientation.sentence;
    const fromTransform = { ...this.currentTransform() };
    const fromValues = { ...this.displayed };
    this.target = optics;
    setStatus(this.readout, readoutLine(optics));

    const to = this.targetTransform();
    const toValues = {
      magnification: optics.magnification,
      trueField: optics.true_field_arcmin,
      exitPupil: optics.exit_pupil_mm,
    };

    if (this.swap) this.swap.announce = false;

    if (prefersReducedMotion()) {
      this.swap = null;
      this.settle(optics, true);
      return;
    }

    const ratio = to.scale / (fromTransform.scale === 0 ? 1 : fromTransform.scale);
    const limited = fromTransform.scale * Math.min(5, Math.max(0.2, ratio));
    this.swap = {
      startedAt: performance.now(),
      from: fromTransform,
      to,
      animatedScale: limited,
      fromValues,
      toValues,
      sentence: swapSentence(
        optics.true_field_arcmin,
        optics.magnification,
        optics.orientation.sentence,
      ),
      announce: true,
    };
    void previousSentence;
    this.readout.classList.add('clipped');
    this.counting.classList.remove('hidden');
    this.tick();
  }

  /** Opening an observation or a server reply sets the display with no swap. */
  setOpticsWithoutSwap(optics: DerivedOptics): void {
    this.swap = null;
    this.target = optics;
    this.settle(optics, false);
  }

  private settle(optics: DerivedOptics, announce: boolean): void {
    this.base = { train: optics.orientation.train, trueField: optics.true_field_arcmin };
    this.transform = identity();
    this.displayed = {
      magnification: optics.magnification,
      trueField: optics.true_field_arcmin,
      exitPupil: optics.exit_pupil_mm,
    };
    this.cursor = clampToField(this.cursor, optics.true_field_arcmin);
    setStatus(this.readout, readoutLine(optics));
    this.readout.classList.remove('clipped');
    this.counting.classList.add('hidden');
    this.compass.setAttribute('aria-label', `Compass: ${optics.orientation.sentence}`);
    if (announce) {
      announceField(
        swapSentence(
          optics.true_field_arcmin,
          optics.magnification,
          optics.orientation.sentence,
        ),
      );
    }
    this.draw();
  }

  /** A pointer landing during a swap finishes it in that frame. */
  completeSwap(): void {
    const swap = this.swap;
    if (!swap) return;
    this.swap = null;
    this.settle(this.target, swap.announce);
  }

  /** Open, New observation, a route change or a reload ends a swap silently. */
  abandonSwap(): void {
    if (!this.swap) return;
    this.swap = null;
    this.base = {
      train: this.target.orientation.train,
      trueField: this.target.true_field_arcmin,
    };
    this.transform = identity();
    this.displayed = {
      magnification: this.target.magnification,
      trueField: this.target.true_field_arcmin,
      exitPupil: this.target.exit_pupil_mm,
    };
    setStatus(this.readout, readoutLine(this.target));
    this.readout.classList.remove('clipped');
    this.counting.classList.add('hidden');
    this.draw();
  }

  private targetTransform(): Transform {
    const baseTrain = trainOf(this.base.train);
    const newTrain = trainOf(this.target.orientation.train);
    return {
      scale: this.base.trueField / this.target.true_field_arcmin,
      rotation: ((newTrain.rotation_deg - baseTrain.rotation_deg) * Math.PI) / 180,
      flip: newTrain.mirrored === baseTrain.mirrored ? 1 : -1,
    };
  }

  private currentTransform(): Transform {
    return this.transform;
  }

  private tick(): void {
    if (this.frame !== null) return;
    const step = (): void => {
      this.frame = null;
      const swap = this.swap;
      if (!swap) return;
      const elapsed = performance.now() - swap.startedAt;
      if (elapsed >= SWAP_MS) {
        this.swap = null;
        this.settle(this.target, swap.announce);
        return;
      }
      if (elapsed < SCALE_MS) {
        const t = easeOut(elapsed / SCALE_MS);
        this.transform = {
          scale: swap.from.scale + (swap.animatedScale - swap.from.scale) * t,
          rotation: swap.from.rotation,
          flip: swap.from.flip,
        };
        this.displayed = {
          magnification: Math.round(
            swap.fromValues.magnification +
              (swap.toValues.magnification - swap.fromValues.magnification) * t,
          ),
          trueField: Math.round(
            swap.fromValues.trueField + (swap.toValues.trueField - swap.fromValues.trueField) * t,
          ),
          exitPupil:
            Math.round(
              (swap.fromValues.exitPupil +
                (swap.toValues.exitPupil - swap.fromValues.exitPupil) * t) *
                10,
            ) / 10,
        };
      } else {
        const t = easeOut((elapsed - SCALE_MS) / ORIENT_MS);
        this.transform = {
          scale: swap.to.scale,
          rotation: swap.from.rotation + (swap.to.rotation - swap.from.rotation) * t,
          flip:
            swap.to.flip === swap.from.flip
              ? swap.to.flip
              : swap.from.flip * Math.cos(Math.PI * t),
        };
        this.displayed = { ...swap.toValues };
      }
      this.paintCounting();
      this.draw();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private paintCounting(): void {
    const [magnification, field, exit] = this.countingFigures;
    if (magnification) magnification.textContent = `${this.displayed.magnification}×`;
    if (field) field.textContent = `${this.displayed.trueField}′`;
    if (exit) exit.textContent = `${this.displayed.exitPupil.toFixed(1)} mm`;
  }

  // ---- drawing -----------------------------------------------------------

  private observeSize(): void {
    const resize = (): void => {
      const box = this.circle.getBoundingClientRect();
      const size = Math.min(box.width, box.height) || REFERENCE_RADIUS * 2;
      const ratio = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(size * ratio);
      this.canvas.height = Math.round(size * ratio);
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
      this.radius = size / 2;
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.draw();
    };
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resize).observe(this.circle);
    }
    window.addEventListener('resize', resize);
    queueMicrotask(resize);
  }

  private pixelFor(point: SkyPoint): { x: number; y: number } {
    return skyToPixel(point, this.base.train, this.base.trueField, this.radius);
  }

  private draw(): void {
    const ctx = this.context;
    const size = this.radius * 2;
    ctx.clearRect(0, 0, size, size);
    // The rim of the field, drawn rather than bordered.
    ctx.beginPath();
    ctx.arc(this.radius, this.radius, this.radius - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.radius, this.radius, this.radius - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(this.radius, this.radius);
    ctx.save();
    ctx.rotate(this.transform.rotation);
    ctx.scale(this.transform.scale * this.transform.flip, this.transform.scale);

    const unit = this.radius / REFERENCE_RADIUS;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const widths: Record<StrokeWidth, number> = {
      fine: 1.5 * unit,
      medium: 3 * unit,
      broad: 5.5 * unit,
    };
    for (const stroke of this.marks.strokes) {
      if (stroke.points.length === 0) continue;
      ctx.lineWidth = widths[stroke.width] / Math.max(this.transform.scale, 0.0001);
      ctx.beginPath();
      for (const [index, point] of stroke.points.entries()) {
        const pixel = this.pixelFor(point);
        if (index === 0) ctx.moveTo(pixel.x, pixel.y);
        else ctx.lineTo(pixel.x, pixel.y);
      }
      ctx.stroke();
    }
    for (const star of this.marks.stars) {
      const pixel = this.pixelFor(star.at);
      const r = (0.008 + star.brightness * 0.006) * REFERENCE_RADIUS * unit;
      ctx.beginPath();
      ctx.arc(pixel.x, pixel.y, r / Math.max(this.transform.scale, 0.0001), 0, Math.PI * 2);
      ctx.fill();
    }
    const { primary, secondary } = this.marks.pair;
    if (primary) {
      const a = this.pixelFor(primary);
      ctx.lineWidth = 1.2 * unit / Math.max(this.transform.scale, 0.0001);
      if (secondary) {
        const b = this.pixelFor(secondary);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        for (const point of [a, b]) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 5 * unit / Math.max(this.transform.scale, 0.0001), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.arc(a.x, a.y, 5 * unit / Math.max(this.transform.scale, 0.0001), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const cursorPixel = this.pixelFor(this.cursor);
    ctx.lineWidth = 1.2 * unit / Math.max(this.transform.scale, 0.0001);
    const arm = 7 * unit / Math.max(this.transform.scale, 0.0001);
    ctx.beginPath();
    ctx.moveTo(cursorPixel.x - arm, cursorPixel.y);
    ctx.lineTo(cursorPixel.x + arm, cursorPixel.y);
    ctx.moveTo(cursorPixel.x, cursorPixel.y - arm);
    ctx.lineTo(cursorPixel.x, cursorPixel.y + arm);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    this.paintCompass();
  }

  private paintCompass(): void {
    const half = this.displayed.trueField / 2;
    const north = skyToPixel(
      [0, half * 0.85],
      this.target.orientation.train,
      this.displayed.trueField,
      this.radius,
    );
    const east = skyToPixel(
      [half * 0.85, 0],
      this.target.orientation.train,
      this.displayed.trueField,
      this.radius,
    );
    this.compass.replaceChildren(
      el('span', {
        class: 'compass-mark',
        text: 'N',
        attrs: { style: `left:${this.radius + north.x}px;top:${this.radius + north.y}px` },
      }),
      el('span', {
        class: 'compass-mark',
        text: 'E',
        attrs: { style: `left:${this.radius + east.x}px;top:${this.radius + east.y}px` },
      }),
    );
  }

  // ---- pointer -----------------------------------------------------------

  private skyAt(event: PointerEvent): SkyPoint {
    const box = this.canvas.getBoundingClientRect();
    return pixelToSky(
      {
        x: event.clientX - box.left - box.width / 2,
        y: event.clientY - box.top - box.height / 2,
      },
      this.target.orientation.train,
      this.target.true_field_arcmin,
      box.width / 2,
    );
  }

  private attachPointer(): void {
    const circle = this.circle;
    circle.addEventListener('pointerdown', (event: PointerEvent) => {
      if (dialogIsOpen || !this.readable) return;
      // A pen down on the circle makes touch contacts irrelevant.
      if (event.pointerType === 'pen') this.penDown = true;
      if (event.pointerType === 'touch' && this.penDown) return;
      this.livePointers.add(event.pointerId);

      if (this.livePointers.size > 1) {
        // A second finger discards the stroke in progress, and a pinch places
        // no star and marks no pair point.
        if (this.strokePointer !== null) {
          this.marks.strokes.pop();
          this.activeStroke = null;
          this.strokePointer = null;
          this.draw();
        }
        this.pendingTap = null;
        return;
      }

      this.completeSwap();
      event.preventDefault();
      circle.focus();
      const at = this.skyAt(event);
      if (this.mode === 'star' || this.mode === 'measure') {
        // A tap places its mark on lift, so a pinch leaves nothing behind.
        this.pendingTap = { pointerId: event.pointerId, at, mode: this.mode };
        return;
      }
      this.activeStroke = { width: this.width, points: [at] };
      this.marks.strokes.push(this.activeStroke);
      this.strokePointer = event.pointerId;
      circle.setPointerCapture(event.pointerId);
      this.draw();
    });

    circle.addEventListener('pointermove', (event: PointerEvent) => {
      if (this.strokePointer !== event.pointerId || !this.activeStroke) return;
      if (event.pointerType === 'touch' && this.penDown) return;
      event.preventDefault();
      this.activeStroke.points.push(this.skyAt(event));
      this.draw();
    });

    const finish = (event: PointerEvent, cancelled: boolean): void => {
      this.livePointers.delete(event.pointerId);
      if (event.pointerType === 'pen' && this.livePointers.size === 0) this.penDown = false;

      const tap = this.pendingTap;
      if (tap && tap.pointerId === event.pointerId) {
        this.pendingTap = null;
        if (!cancelled) {
          if (tap.mode === 'star') this.placeStar(tap.at);
          else this.markPair(tap.at);
        }
        return;
      }

      if (this.strokePointer !== event.pointerId) return;
      this.strokePointer = null;
      const stroke = this.activeStroke;
      this.activeStroke = null;
      if (!stroke) return;
      if (cancelled) {
        // A cancelled contact discards the stroke with no undo entry.
        this.marks.strokes.pop();
        this.draw();
        return;
      }
      this.undoStack.push({ kind: 'stroke' });
      this.changed();
    };

    circle.addEventListener('pointerup', (event: PointerEvent) => finish(event, false));
    circle.addEventListener('pointercancel', (event: PointerEvent) => finish(event, true));
    circle.addEventListener('pointerleave', (event: PointerEvent) => {
      if (this.strokePointer === event.pointerId && !circle.hasPointerCapture(event.pointerId)) {
        finish(event, false);
      }
    });
  }

  /** An optics change during a stroke ends the stroke where it is. */
  endStrokeForOpticsChange(): void {
    if (!this.activeStroke) return;
    this.activeStroke = null;
    this.strokePointer = null;
    this.undoStack.push({ kind: 'stroke' });
    this.changed();
  }

  // ---- keyboard ----------------------------------------------------------

  private attachKeyboard(): void {
    this.element.addEventListener('keydown', (event: KeyboardEvent) => {
      if (dialogIsOpen) return;
      const key = event.key;
      const arrows: Record<string, ArrowDirection> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const direction = arrows[key];
      if (direction) {
        event.preventDefault();
        this.cursor = moveCursor(
          this.cursor,
          direction,
          this.target.orientation.train,
          this.target.true_field_arcmin,
          event.shiftKey ? 5 : 1,
        );
        this.draw();
        return;
      }
      if (key >= '1' && key <= '5') {
        event.preventDefault();
        this.brightness = Number(key) as 1 | 2 | 3 | 4 | 5;
        announceField(brightnessChosen(this.brightness));
        return;
      }
      if (key === 'Enter') {
        if (!this.readable) return;
        event.preventDefault();
        if (this.mode === 'measure') this.markPair([...this.cursor] as SkyPoint);
        else this.placeStar([...this.cursor] as SkyPoint);
        return;
      }
      if (key === ']' || key === '[') {
        event.preventDefault();
        this.endStrokeForOpticsChange();
        this.hooks.onEyepieceStep(key === ']' ? 1 : -1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'Z')) {
        if (!this.readable) return;
        event.preventDefault();
        this.undo();
      }
    });
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.swap = null;
  }
}
