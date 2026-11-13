import {
  BUNDLE_MATCHES,
  FLARE_MS,
  SPARK_MS,
  STORY_BURN_MS,
  STRIKE_CHAPTERS,
  VISION_MS,
  type Chapter,
} from "../../../shared/domain.js";
import type { MatchKind } from "./types.js";

type Phase = "idle" | "burning" | "sinking";

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * The story's strike state machine, with no rendering in it: spark, flare, steady burn, match-out, sinking.
 * Times are milliseconds on the clock the caller passes to `update`, normally the animation frame time; a strike
 * takes the time of the next update as its start, so no second clock has to agree with it.
 * In discrete mode a strike lights the vision at once and fully, and it stays lit until `reset`.
 */
export class StoryState {
  private phase: Phase = "idle";
  private startedAt: number | null = null;
  private sinkStartedAt = 0;
  private current: MatchKind = "match";
  private levelNow = 0;
  private visionNow = 0;
  private glowNow = 0;
  private matches = 0;
  private lit = false;

  constructor(private readonly discrete: boolean) {}

  /** The reported light level: exactly 0, a ramp to exactly `peak`, exactly `peak`, then exactly 0. */
  get level(): number {
    return this.levelNow;
  }

  /** How far the chapter's vision has risen, 0..1. */
  get vision(): number {
    return this.visionNow;
  }

  /** The decorative glow: follows the level while burning, then fades with the sinking vision. */
  get glow(): number {
    return this.glowNow;
  }

  get litMatches(): number {
    return this.matches;
  }

  get burning(): boolean {
    return this.lit;
  }

  /** True during the spark, before the light has any intensity. */
  get sparking(): boolean {
    return this.phase === "burning" && this.levelNow === 0;
  }

  /** Milliseconds since the strike while a match burns. */
  elapsed(now: number): number {
    return this.startedAt === null ? 0 : Math.max(0, now - this.startedAt);
  }

  get peak(): number {
    return this.current === "bundle" ? 2 : 1;
  }

  /** Starts a strike if the chapter allows one and no match burns; returns whether it did. */
  strike(chapter: Chapter): boolean {
    if (!STRIKE_CHAPTERS.includes(chapter) || this.lit) return false;
    this.current = chapter === "grandmother" ? "bundle" : "match";
    this.matches = this.current === "bundle" ? BUNDLE_MATCHES : 1;
    this.lit = true;
    this.startedAt = null;
    if (this.discrete) {
      this.phase = "idle";
      this.levelNow = this.peak;
      this.visionNow = 1;
      this.glowNow = this.peak;
    } else {
      this.phase = "burning";
      this.levelNow = 0;
      this.visionNow = 0;
      this.glowNow = 0;
    }
    return true;
  }

  /** Puts everything out at once (the chapter changed in discrete mode). */
  reset(): void {
    this.phase = "idle";
    this.lit = false;
    this.matches = 0;
    this.levelNow = 0;
    this.visionNow = 0;
    this.glowNow = 0;
  }

  /** Advances the clock; returns the kind of match that just went out, if one did. */
  update(now: number): MatchKind | null {
    if (this.phase === "burning") {
      if (this.startedAt === null) this.startedAt = now;
      const elapsed = this.elapsed(now);
      if (elapsed >= STORY_BURN_MS) {
        this.phase = "sinking";
        this.sinkStartedAt = now;
        this.lit = false;
        this.matches = 0;
        this.levelNow = 0;
        this.glowNow = this.peak;
        return this.current;
      }
      this.levelNow = elapsed < SPARK_MS ? 0 : this.peak * clamp01((elapsed - SPARK_MS) / FLARE_MS);
      if (elapsed >= SPARK_MS + FLARE_MS) this.levelNow = this.peak;
      this.visionNow = easeOut(clamp01((elapsed - SPARK_MS) / VISION_MS));
      this.glowNow = this.levelNow;
    } else if (this.phase === "sinking") {
      const gone = clamp01((now - this.sinkStartedAt) / VISION_MS);
      this.visionNow = 1 - easeOut(gone);
      this.glowNow = this.peak * (1 - gone) * (1 - gone);
      if (gone >= 1) {
        this.phase = "idle";
        this.visionNow = 0;
        this.glowNow = 0;
      }
    }
    return null;
  }

  /** True while the vision or the light is changing, so a renderer must keep drawing. */
  get animating(): boolean {
    return this.phase !== "idle";
  }
}
