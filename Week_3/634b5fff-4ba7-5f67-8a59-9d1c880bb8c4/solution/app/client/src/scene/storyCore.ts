import { chapterOf, type Chapter } from "../../../shared/domain.js";
import { Listeners } from "./emitter.js";
import { clampProgress, STILL_PROGRESS } from "./path.js";
import { StoryState } from "./storyState.js";
import type { HoldInput, MatchKind, Vec3 } from "./types.js";

/** The live values `window.__scene` is read from; each is taken from the object that really holds it. */
interface SceneReaders {
  cameraPosition(): Vec3;
  lightIntensity(): number;
  litMatches(): number;
}

interface PublishedScene {
  readonly progress: number;
  readonly chapter: Chapter;
  readonly cameraPosition: Readonly<Vec3>;
  readonly lightIntensity: number;
  readonly litMatches: number;
  readonly holdRemainingMs: number | null;
  readonly matchLength: number | null;
}

declare global {
  interface Window {
    __scene?: PublishedScene;
  }
}

/**
 * Everything about the story that does not need a renderer: progress and chapter, the strike state machine,
 * the hold the server last answered, listeners, and the read-only `window.__scene` object.
 */
export class StoryCore {
  readonly state: StoryState;
  readonly matchOut = new Listeners<MatchKind>();
  readonly change = new Listeners<undefined>();
  hold: HoldInput | null = null;
  private progressNow: number;
  private chapterNow: Chapter;

  constructor(readonly discrete: boolean, private readonly readers: SceneReaders) {
    this.state = new StoryState(discrete);
    this.progressNow = discrete ? STILL_PROGRESS.alley : 0;
    this.chapterNow = chapterOf(this.progressNow);
    Object.defineProperty(window, "__scene", {
      configurable: true,
      enumerable: true,
      get: (): PublishedScene => this.snapshot(),
      set: () => undefined,
    });
  }

  get progress(): number {
    return this.progressNow;
  }

  get chapter(): Chapter {
    return this.chapterNow;
  }

  /** Scroll progress; ignored by the discrete modes, which do not scrub. */
  setProgress(progress: number): boolean {
    if (this.discrete) return false;
    const next = clampProgress(Number.isFinite(progress) ? progress : 0);
    this.progressNow = next;
    const chapter = chapterOf(next);
    if (chapter === this.chapterNow) return false;
    this.chapterNow = chapter;
    this.change.emit(undefined);
    return true;
  }

  /** Moves a discrete story to a chapter at once and puts any light out. */
  stepToChapter(chapter: Chapter): void {
    if (!this.discrete) return;
    this.progressNow = STILL_PROGRESS[chapter];
    this.chapterNow = chapter;
    this.state.reset();
    this.change.emit(undefined);
  }

  strike(): boolean {
    if (!this.state.strike(this.chapterNow)) return false;
    this.change.emit(undefined);
    return true;
  }

  /** Advances the strike clock and tells listeners when a match went out. */
  tick(now: number): void {
    const out = this.state.update(now);
    if (out === null) return;
    this.matchOut.emit(out);
    this.change.emit(undefined);
  }

  setHold(hold: HoldInput | null): void {
    this.hold = hold ? { ...hold } : null;
  }

  private snapshot(): PublishedScene {
    const camera = this.readers.cameraPosition();
    const hold = this.hold;
    return Object.freeze({
      progress: this.progressNow,
      chapter: this.chapterNow,
      cameraPosition: Object.freeze({ x: camera.x, y: camera.y, z: camera.z }),
      lightIntensity: this.readers.lightIntensity(),
      litMatches: this.readers.litMatches(),
      holdRemainingMs: hold ? hold.remainingMs : null,
      matchLength: hold && hold.holdMs > 0 ? hold.remainingMs / hold.holdMs : null,
    });
  }
}
