import type { CellState, Chapter } from "../../../shared/domain.js";
import { Listeners } from "./emitter.js";
import { stillPoint } from "./path.js";
import { StoryCore } from "./storyCore.js";
import type { FrameInfo, HoldInput, MatchKind, ShelfLayout, ShelfMapping, StoryController } from "./types.js";

/**
 * The story without WebGL: the same state machine as the discrete WebGL story, no three.js objects. It still
 * publishes `window.__scene` (the camera position is the path's point for the chapter's still pose), and the page
 * draws `StillChapter` for the current chapter.
 */
export class StillStory implements StoryController {
  readonly mode = "still" as const;
  private readonly core: StoryCore;
  private readonly frames = new Listeners<FrameInfo>();

  constructor() {
    this.core = new StoryCore(true, {
      cameraPosition: () => stillPoint(this.core.chapter),
      lightIntensity: () => this.core.state.level,
      litMatches: () => this.core.state.litMatches,
    });
  }

  get chapter(): Chapter {
    return this.core.chapter;
  }

  get litMatches(): number {
    return this.core.state.litMatches;
  }

  setProgress(): void {}

  stepToChapter(chapter: Chapter): void {
    this.core.stepToChapter(chapter);
    this.publish();
  }

  strike(): boolean {
    const struck = this.core.strike();
    if (struck) this.publish();
    return struck;
  }

  onMatchOut(listener: (kind: MatchKind) => void): () => void {
    return this.core.matchOut.add(listener);
  }

  onChange(listener: () => void): () => void {
    return this.core.change.add(() => listener());
  }

  subscribe(listener: (info: FrameInfo) => void): () => void {
    return this.frames.add(listener);
  }

  setBoxes(_states: readonly CellState[]): void {}

  setHold(hold: HoldInput | null): void {
    this.core.setHold(hold);
    this.publish();
  }

  setShelfLayout(_layout: ShelfLayout): void {}

  shelfMapping(): ShelfMapping {
    return { visible: this.core.chapter === "shelf", k: 1, tx: 0, ty: 0 };
  }

  setDim(_amount: number): void {}

  private publish(): void {
    this.frames.emit({
      progress: this.core.progress,
      chapter: this.core.chapter,
      mapping: this.shelfMapping(),
      litMatches: this.core.state.litMatches,
    });
  }
}
