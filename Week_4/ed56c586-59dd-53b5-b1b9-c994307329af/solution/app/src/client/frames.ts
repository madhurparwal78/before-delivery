import { FRAMES_PER_PROJECT } from "../shared/catalog.js";
import { all, must, play, whenFinished } from "./dom.js";

/** A preview's six frames, one shown at a time. A new frame crossfades in over 200 ms; the frame that leaves is hidden
 * from screen readers at once. The frames do not wrap. */

const CROSSFADE_MS = 200;

export class FramePlayer {
  private current = 1;
  private crossfade: { readonly leaving: HTMLElement; readonly animation: Animation | undefined } | undefined;

  constructor(private readonly container: HTMLElement) {}

  get frame(): number {
    return this.current;
  }

  private slot(frame: number): HTMLElement {
    return must<HTMLElement>(this.container, `[data-frame-slot="${frame}"]`);
  }

  slots(): HTMLElement[] {
    return all<HTMLElement>(this.container, "[data-frame-slot]");
  }

  private settle(): void {
    if (this.crossfade === undefined) return;
    this.crossfade.animation?.cancel();
    this.crossfade.leaving.hidden = true;
    this.crossfade.leaving.removeAttribute("aria-hidden");
    this.crossfade = undefined;
  }

  show(frame: number): void {
    if (frame === this.current || frame < 1 || frame > FRAMES_PER_PROJECT) return;
    this.settle();
    const leaving = this.slot(this.current);
    const arriving = this.slot(frame);
    this.current = frame;
    this.container.dataset["frame"] = String(frame);
    arriving.hidden = false;
    arriving.style.zIndex = "2";
    leaving.style.zIndex = "1";
    leaving.setAttribute("aria-hidden", "true");
    const animation = play(arriving, [{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: "linear" });
    this.crossfade = { leaving, animation };
    whenFinished(animation, () => {
      if (this.crossfade?.leaving === leaving) this.settle();
    });
  }
}
