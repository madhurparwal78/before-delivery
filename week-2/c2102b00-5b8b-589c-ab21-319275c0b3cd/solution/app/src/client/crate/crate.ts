// A crate on the page: one canvas per case block that shows the block's line and nothing else, and
// the ruled TURN strip that turns it. Every draw goes through `Crate.paint`, which decides whether a
// frame is drawn: only for a published cause, never while hidden, never when nothing would change.
import { h } from "../dom.js";
import type { Line } from "../line.js";
import { GlRenderer, CrateScene } from "./gl.js";
import { type CrateView, crateView, palette } from "./model.js";
import { type Plan, type Pose, planEnd, poseAt, restPose } from "./pose.js";
import { drawStill } from "./still.js";
import { displayFaceReady, loadDisplayFace } from "./textures.js";

const TURN_MAX = 75;
const TURN_KEY_STEP = 15;
const DEGREES_PER_PIXEL = 0.5;
const MAX_RATIO = 2;

// ---- The one WebGL context of the document --------------------------------------------------------

const crates = new Set<Crate>();
let shared: { gl: GlRenderer | null; lost: boolean } | null = null;

/** The shared renderer, created when the first crate is made; null without WebGL. */
function environment(): { gl: GlRenderer | null; lost: boolean } {
  if (shared) return shared;
  const gl = GlRenderer.create();
  shared = { gl, lost: false };
  if (gl) {
    gl.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      shared!.lost = true;
      crates.forEach((c) => c.setPaused(true));
    });
    gl.canvas.addEventListener("webglcontextrestored", () => {
      shared!.lost = false;
      crates.forEach((c) => c.setPaused(false));
    });
  }
  void loadDisplayFace().then(() => crates.forEach((c) => c.paint()));
  return shared;
}

const sizes = new ResizeObserver((entries) => {
  for (const entry of entries) for (const crate of crates) if (crate.canvas === entry.target) crate.paint();
});

export class Crate {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly slider: HTMLElement | null;
  private readonly mark: HTMLElement | null;
  private view: CrateView;
  private from: CrateView;
  private plan: Plan | null = null;
  private started = 0;
  private frame = 0;
  private turn = 0;
  private paused = false;
  private signature = "";
  private scene: CrateScene | null = null;

  constructor(line: Line) {
    const name = line.case_name;
    this.view = this.from = crateView(line);
    this.canvas = h("canvas", { class: "crate-canvas", role: "img", "aria-label": this.view.name });
    const turnable = environment().gl !== null;
    this.mark = turnable ? h("span", { class: "turn-mark", "aria-hidden": "true" }) : null;
    this.slider = turnable
      ? h("div", {
          class: "turn", role: "slider", tabindex: 0, "aria-label": `Turn crate of ${name}`,
          "aria-valuemin": -TURN_MAX, "aria-valuemax": TURN_MAX, "aria-valuenow": 0, "aria-valuetext": "0 degrees",
        }, h("span", { class: "turn-label" }, "TURN"), this.mark)
      : null;
    this.el = h("div", { class: "crate" }, this.canvas, this.slider);
    this.bindCanvas();
    if (this.slider) this.bindSlider(this.slider);
    crates.add(this);
    sizes.observe(this.canvas);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    sizes.unobserve(this.canvas);
    crates.delete(this);
    this.scene?.dispose();
  }

  // ---- The line ------------------------------------------------------------------------------

  /** Jumps to a line on the spot: any running sequence is cancelled and never runs another step. */
  show(line: Line): void {
    this.stop();
    this.view = this.from = crateView(line);
    this.canvas.setAttribute("aria-label", this.view.name);
    this.paint();
  }

  /** Runs a sequence to a line; a sequence still running is first snapped to its end. */
  play(line: Line, plan: Plan): void {
    this.stop();
    this.from = this.view;
    this.view = crateView(line);
    this.canvas.setAttribute("aria-label", this.view.name);
    this.plan = plan;
    this.started = performance.now();
    this.tick();
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    this.plan = null;
  }

  private tick = (): void => {
    const plan = this.plan;
    if (!plan) return;
    const t = performance.now() - this.started;
    if (t >= planEnd(plan)) {
      this.plan = null;
      this.paint();
      return;
    }
    this.paint();
    this.frame = requestAnimationFrame(this.tick);
  };

  private pose(): Pose {
    return this.plan ? poseAt(this.from, this.view, this.plan, performance.now() - this.started) : restPose(this.view);
  }

  // ---- Drawing -------------------------------------------------------------------------------

  /** The one place that decides whether a frame is drawn for this crate. */
  paint(): void {
    const { canvas } = this;
    if (canvas.getClientRects().length === 0) return;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO);
    const [w, h] = [Math.round(box.width * ratio), Math.round(box.height * ratio)];
    if (w === 0 || h === 0) return;
    const env = environment();
    const live = env.gl !== null && !env.lost;
    const pose = this.pose();
    const signature = [live, w, h, this.turn, displayFaceReady(), JSON.stringify(pose), JSON.stringify(palette())].join("|");
    if (canvas.width === w && canvas.height === h && signature === this.signature) return;
    this.signature = signature;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (live) {
      this.scene ??= new CrateScene(this.view);
      env.gl!.draw(this.scene, pose, this.turn, canvas);
    } else {
      drawStill(canvas.getContext("2d")!, this.view, pose, w, h);
    }
  }

  /** While the WebGL context is lost the still drawing stands in and the turn control rests. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.slider?.setAttribute("aria-disabled", String(paused));
    this.paint();
  }

  // ---- Turning -------------------------------------------------------------------------------

  private setTurn(degrees: number): void {
    if (this.paused) return;
    this.turn = Math.min(TURN_MAX, Math.max(-TURN_MAX, degrees));
    const whole = Math.round(this.turn);
    this.slider?.setAttribute("aria-valuenow", String(whole));
    this.slider?.setAttribute("aria-valuetext", `${whole} degrees`);
    if (this.mark) this.mark.style.left = `${((this.turn + TURN_MAX) / (2 * TURN_MAX)) * 100}%`;
    this.paint();
  }

  private bindSlider(slider: HTMLElement): void {
    slider.addEventListener("keydown", (event) => {
      const next: Record<string, number> = {
        ArrowRight: this.turn + TURN_KEY_STEP, ArrowUp: this.turn + TURN_KEY_STEP,
        ArrowLeft: this.turn - TURN_KEY_STEP, ArrowDown: this.turn - TURN_KEY_STEP,
        Home: -TURN_MAX, End: TURN_MAX,
      };
      if (!(event.key in next)) return;
      event.preventDefault();
      this.setTurn(next[event.key]!);
    });
    const along = (event: PointerEvent) => {
      const rect = slider.getBoundingClientRect();
      this.setTurn(-TURN_MAX + 2 * TURN_MAX * Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    };
    slider.addEventListener("pointerdown", (event) => {
      if (this.paused || event.button !== 0) return;
      slider.setPointerCapture(event.pointerId);
      slider.focus();
      along(event);
    });
    slider.addEventListener("pointermove", (event) => {
      if (slider.hasPointerCapture(event.pointerId)) along(event);
    });
  }

  /** Drag on the crate turns it half a degree per pixel, rightward positive; a vertical touch scrolls. */
  private bindCanvas(): void {
    let drag: { id: number; x: number; y: number; turn: number; sideways: boolean } | null = null;
    const { canvas } = this;
    canvas.addEventListener("mousedown", (event) => event.preventDefault());
    canvas.addEventListener("pointerdown", (event) => {
      if (this.paused || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, turn: this.turn, sideways: event.pointerType !== "touch" };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      if (!drag.sideways && Math.abs(dx) > Math.abs(event.clientY - drag.y) && Math.abs(dx) > 2) drag.sideways = true;
      if (drag.sideways) this.setTurn(drag.turn + dx * DEGREES_PER_PIXEL);
    });
    const end = (event: PointerEvent) => {
      if (drag?.id === event.pointerId) drag = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }
}
