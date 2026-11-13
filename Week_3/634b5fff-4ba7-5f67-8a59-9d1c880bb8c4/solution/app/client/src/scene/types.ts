import type { CellState, Chapter } from "../../../shared/domain.js";

export type MatchKind = "match" | "bundle";

export interface StoryOptions {
  discrete: boolean;
}

/** The server's latest answer about the reader's hold. */
export interface HoldInput {
  number: number;
  remainingMs: number;
  holdMs: number;
}

/** Where the DOM grid sits, in CSS pixels (see `shelfMapping` in `index.ts`). */
export interface ShelfLayout {
  columns: number;
  rows: number;
  cellPx: number;
  left: number;
  top: number;
  scrollTop: number;
  width: number;
  height: number;
}

export interface ShelfMapping {
  visible: boolean;
  k: number;
  tx: number;
  ty: number;
}

export interface FrameInfo {
  progress: number;
  chapter: Chapter;
  mapping: ShelfMapping;
  litMatches: number;
}

export interface StoryController {
  readonly mode: "webgl" | "still";
  setProgress(progress: number): void;
  stepToChapter(chapter: Chapter): void;
  strike(): boolean;
  readonly chapter: Chapter;
  readonly litMatches: number;
  onMatchOut(listener: (kind: MatchKind) => void): () => void;
  onChange(listener: () => void): () => void;
  subscribe(listener: (info: FrameInfo) => void): () => void;
  setBoxes(states: readonly CellState[]): void;
  setHold(hold: HoldInput | null): void;
  setShelfLayout(layout: ShelfLayout): void;
  shelfMapping(): ShelfMapping;
  setDim(amount: number): void;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
