import type { Pair, Point, StrokeFile } from "../../shared/types";
import { serialiseStrokeFile } from "../../shared/stroke";

export type Mode = "pencil" | "star" | "measure";
export type Width = "fine" | "medium" | "broad";

export interface Stroke {
  width: Width;
  points: Point[];
}

export interface Star {
  at: Point;
  brightness: number;
}

type UndoEntry =
  | { t: "stroke" }
  | { t: "star" }
  | { t: "pair"; before: Point[] }
  | { t: "clear"; strokes: Stroke[]; stars: Star[] };

export interface SketchSnapshot {
  strokes: Stroke[];
  stars: Star[];
  pairMarks: Point[];
  undo: UndoEntry[];
  cursor: Point;
}

/** The drawing on the eyepiece circle, in sky coordinates, with its undo stack. */
export class Sketch {
  strokes: Stroke[] = [];
  stars: Star[] = [];
  pairMarks: Point[] = [];
  undoStack: UndoEntry[] = [];
  cursor: Point = [0, 0];
  mode: Mode = "pencil";
  width: Width = "medium";
  brightness = 3;
  /** The stroke being drawn right now, not yet in `strokes`. */
  live: Stroke | null = null;
  /** True while the stored sketch could not be read: nothing may be marked. */
  locked = false;
  private listeners = new Set<() => void>();
  version = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  load(file: StrokeFile | null, pair: Pair | null): void {
    this.strokes = file ? file.strokes.map((s) => ({ width: s.width, points: s.points.map((p) => [...p] as Point) })) : [];
    this.stars = file ? file.stars.map((s) => ({ at: [...s.at] as Point, brightness: s.brightness })) : [];
    this.pairMarks = pair ? [[...pair.primary] as Point, [...pair.secondary] as Point] : [];
    this.undoStack = [];
    this.live = null;
    this.cursor = [0, 0];
    this.changed();
  }

  restore(snapshot: SketchSnapshot): void {
    this.strokes = snapshot.strokes;
    this.stars = snapshot.stars;
    this.pairMarks = snapshot.pairMarks;
    this.undoStack = snapshot.undo;
    this.cursor = snapshot.cursor;
    this.live = null;
    this.changed();
  }

  snapshot(): SketchSnapshot {
    return {
      strokes: this.strokes,
      stars: this.stars,
      pairMarks: this.pairMarks,
      undo: this.undoStack,
      cursor: this.cursor,
    };
  }

  get empty(): boolean {
    return this.strokes.length === 0 && this.stars.length === 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  file(): StrokeFile {
    return { format: "lowlamp-strokes/1", strokes: this.strokes, stars: this.stars };
  }

  text(): string {
    return serialiseStrokeFile(this.file());
  }

  setCursor(point: Point): void {
    this.cursor = point;
    this.changed();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.changed();
  }

  setWidth(width: Width): void {
    this.width = width;
    this.changed();
  }

  setBrightness(value: number): void {
    this.brightness = value;
    this.changed();
  }

  addStar(at: Point): void {
    if (this.locked) return;
    this.stars = [...this.stars, { at, brightness: this.brightness }];
    this.undoStack = [...this.undoStack, { t: "star" }];
    this.changed();
  }

  markPair(at: Point): void {
    if (this.locked) return;
    const before = this.pairMarks;
    const [first] = before;
    if (before.length === 1 && first && first[0] === at[0] && first[1] === at[1]) return;
    this.pairMarks = before.length === 2 ? [at] : [...before, at];
    this.undoStack = [...this.undoStack, { t: "pair", before }];
    this.changed();
  }

  beginStroke(at: Point): void {
    if (this.locked) return;
    this.live = { width: this.width, points: [at] };
    this.changed();
  }

  extendStroke(at: Point): void {
    if (!this.live) return;
    const last = this.live.points[this.live.points.length - 1];
    if (last && last[0] === at[0] && last[1] === at[1]) return;
    this.live = { width: this.live.width, points: [...this.live.points, at] };
    this.changed();
  }

  /** Finishes the stroke in progress as one undo step. */
  endStroke(): void {
    const stroke = this.live;
    if (!stroke) return;
    this.live = null;
    const first = stroke.points[0];
    const points = stroke.points.length === 1 && first ? [first, first] : stroke.points;
    this.strokes = [...this.strokes, { width: stroke.width, points }];
    this.undoStack = [...this.undoStack, { t: "stroke" }];
    this.changed();
  }

  /** Throws the stroke in progress away: no mark, no undo entry. */
  discardStroke(): void {
    if (!this.live) return;
    this.live = null;
    this.changed();
  }

  clear(): void {
    if (this.locked || this.empty) return;
    this.undoStack = [...this.undoStack, { t: "clear", strokes: this.strokes, stars: this.stars }];
    this.strokes = [];
    this.stars = [];
    this.changed();
  }

  /** Removes the last mark; false when there was nothing to remove. */
  undo(): boolean {
    if (this.locked) return false;
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return false;
    this.undoStack = this.undoStack.slice(0, -1);
    if (entry.t === "stroke") this.strokes = this.strokes.slice(0, -1);
    else if (entry.t === "star") this.stars = this.stars.slice(0, -1);
    else if (entry.t === "pair") this.pairMarks = entry.before;
    else {
      this.strokes = entry.strokes;
      this.stars = entry.stars;
    }
    this.changed();
    return true;
  }

  pair(): [Point, Point] | null {
    const [a, b] = this.pairMarks;
    return a && b && this.pairMarks.length === 2 ? [a, b] : null;
  }
}
