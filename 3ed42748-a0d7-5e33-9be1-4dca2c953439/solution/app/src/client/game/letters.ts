// Resident letters: a folded paper letter that unfolds from the resident's door on screen to
// its resting place near the top edge, and folds back toward the same point. Its state is a
// function of the page clock; a fold started mid-unfold falls from the current progress.
import { fixed, h, setData } from "../lib/dom";
import { closeDialog, openDialog, type OpenDialog } from "../lib/dialogs";
import { clamp01, easePrint } from "../lib/motion";
import { paper } from "../lib/paper";

const UNFOLD_MS = 400;
const FOLD_MS = 250;

type FoldState = "unfolding" | "open" | "folding";

export class Letter {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  readonly actions: HTMLElement;
  private state: FoldState = "unfolding";
  private startAt: number;
  private fromProgress = 0;
  private progress = 0;
  private dialog: OpenDialog | null = null;
  private onFolded: (() => void) | null = null;
  private restCentre: [number, number] = [0, 0];
  private onClosedForGood: (() => void) | null = null;
  /** While set, Escape does nothing (an accept is waiting for the depot). */
  locked = false;

  constructor(
    readonly residentName: string,
    lines: string[],
    private readonly from: [number, number],
    now: number,
    reduced: boolean,
  ) {
    this.body = h("div", { class: "letter-lines" }, ...lines.map((line) => h("p", {}, line)));
    this.actions = h("div", { class: "letter-actions" });
    this.el = paper(
      h(
        "div",
        { role: "dialog", "aria-modal": "true", "aria-label": `Letter from ${residentName}`, class: "letter" },
        h("h2", { class: "letter-from" }, `From ${residentName}`),
        this.body,
        this.actions,
        h("span", { class: "letter-crease letter-crease-1", "aria-hidden": "true" }),
        h("span", { class: "letter-crease letter-crease-2", "aria-hidden": "true" }),
      ),
    );
    setData(this.el, "data-unfold-from", `${from[0]},${from[1]}`);
    this.startAt = now;
    if (reduced) {
      this.state = "open";
      this.progress = 1;
    }
    this.render();
  }

  show(host: HTMLElement, opener: HTMLElement | null, focus: HTMLElement | null, onClosed: () => void): void {
    this.onClosedForGood = onClosed;
    host.append(this.el);
    const rest = this.el.getBoundingClientRect();
    this.restCentre = [rest.left + rest.width / 2, rest.top + rest.height / 2];
    this.render();
    this.dialog = openDialog({
      el: this.el,
      opener,
      focus,
      onEscape: () => {
        if (!this.locked) this.fold(performance.now(), false);
      },
    });
  }

  get foldState(): FoldState {
    return this.state;
  }

  /** Folds back toward the door point; resolves the callback once it has closed. */
  fold(now: number, reduced: boolean, then?: () => void): number {
    if (then) this.onFolded = then;
    if (this.state === "folding") return this.remaining(now);
    this.update(now, reduced);
    this.fromProgress = this.progress;
    this.state = "folding";
    this.startAt = now;
    if (reduced) {
      this.progress = 0;
      this.finish();
      return 0;
    }
    return this.remaining(now);
  }

  private remaining(now: number): number {
    return Math.max(0, this.startAt + FOLD_MS * this.fromProgress - now);
  }

  update(now: number, reduced: boolean): void {
    if (!this.el.isConnected) return;
    if (reduced && this.state === "unfolding") {
      this.state = "open";
      this.progress = 1;
    }
    if (this.state === "unfolding") {
      this.progress = clamp01((now - this.startAt) / UNFOLD_MS);
      if (this.progress >= 1) this.state = "open";
    } else if (this.state === "folding") {
      const span = FOLD_MS * this.fromProgress;
      this.progress = span <= 0 ? 0 : this.fromProgress * (1 - clamp01((now - this.startAt) / span));
      if (this.progress <= 0) return this.finish();
    }
    this.render();
  }

  private finish(): void {
    this.el.remove();
    if (this.dialog) closeDialog(this.dialog);
    this.dialog = null;
    const then = this.onFolded;
    this.onFolded = null;
    this.onClosedForGood?.();
    then?.();
  }

  private render(): void {
    setData(this.el, "data-fold", this.state);
    setData(this.el, "data-fold-progress", fixed(this.progress, 2));
    const e = easePrint(this.progress);
    const [cx, cy] = this.restCentre;
    const style = this.el.style;
    if (this.progress >= 1) {
      style.transform = "";
      style.opacity = "";
    } else {
      const dx = (this.from[0] - cx) * (1 - e);
      const dy = (this.from[1] - cy) * (1 - e);
      const scale = 0.08 + 0.92 * e;
      const crease = 0.35 + 0.65 * e;
      style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(3)}, ${(scale * crease).toFixed(3)})`;
      style.opacity = String(Math.min(1, 0.2 + e * 1.2));
    }
  }
}
