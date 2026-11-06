// The Board viewer contract: data-* instruments, camera views, orbit, zoom, keys, part swap, ghosting and the
// battery charge bar.
import { CURVES, h, reducedMotion, replace } from "../dom.ts";
import type { Build, Catalog, Component, Slot } from "../catalog.ts";
import { cameraAttr, clamp, FOV, lerp, orbitParam, pitchAttr, PRESET_BUTTONS, PRESETS, STEPS, yawAttr, zoomAttr, type Pose, type Preset } from "./camera.ts";
import { sideDrawing } from "./fallback.ts";
import type { SceneBuild } from "./types.ts";
import type { createScene } from "./scene.ts";

type SceneRenderer = ReturnType<typeof createScene>;

export interface ViewerBuild extends SceneBuild {
  boardSku: string;
  boardName: string;
}

const SLOTS: Slot[] = ["wing", "mast", "propulsion", "battery", "controller"];

/** The viewer's picture of a server build: finish and size from its board package, colours and mast length from the catalog. */
export function viewerBuild(build: Build, catalog: Catalog): ViewerBuild {
  const board = catalog.boards.find((b) => b.sku === build.board_sku);
  const part = (sku: string) => catalog.components.find((c) => c.sku === sku) as Component;
  return {
    boardSku: build.board_sku,
    boardName: `${build.board_name} ${board?.size ?? ""}`,
    finish: board?.finish ?? "",
    spares: build.spares,
    mastM: part(build.slots.mast.sku).mast_m ?? "",
    parts: Object.fromEntries(SLOTS.map((s) => [s, { sku: build.slots[s].sku, name: build.slots[s].name, colour: part(build.slots[s].sku).colour }])) as ViewerBuild["parts"],
  };
}
const GLIDE_MS = 600;
const STEP_MS = 200;
const SWAP = { oldMs: 250, newStart: 100, newMs: 350, restMs: 450 };

function webglAvailable(): boolean {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}

export class BoardViewer {
  private pose: Pose;
  private preset: Preset | "custom";
  private glide: { from: Pose; to: Pose; start: number; duration: number } | null = null;
  private swap: { slot: Slot; label: string; start: number } | null = null;
  private scene: SceneRenderer | null = null;
  private build: ViewerBuild | null = null;
  private ghostSku = "";
  private fill = 1;
  private ready = false;
  private dirty = true;
  private settled = false;
  private readonly stage = h("div", { class: "viewer-stage" });
  private readonly canvas = h("canvas", { class: "viewer-canvas" });
  private readonly buttons = new Map<Preset, HTMLButtonElement>();
  private readonly views: HTMLElement;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private wheelTimer = 0;

  constructor(readonly el: HTMLElement, initial: { pose: Pose; preset: Preset | "custom" }, private readonly onSettle: () => void) {
    this.pose = initial.pose;
    this.preset = initial.preset;
    const reset = h("button", { type: "button", class: "view-pill" }, "Reset view");
    reset.addEventListener("click", () => this.toPreset("three-quarter"));
    this.views = h("div", { role: "group", "aria-label": "Camera views", class: "view-buttons" },
      PRESET_BUTTONS.map(([preset, label]) => {
        const button = h("button", { type: "button", class: "view-pill", "aria-pressed": "false" }, label);
        button.addEventListener("click", () => this.toPreset(preset));
        this.buttons.set(preset, button);
        return button;
      }), reset);
    el.setAttribute("tabindex", "0");
    el.setAttribute("data-target", "0.000,-0.300,0.000");
    el.setAttribute("data-fov", String(FOV));
    el.setAttribute("data-ready", "false");
    el.setAttribute("data-ghost", "");
    el.setAttribute("data-swap", "");
    el.append(this.stage, this.views);
    el.addEventListener("keydown", (event) => this.onKey(event));
  }

  /** Starts drawing `build` with its pack charged to `fill` bars. */
  async start(build: ViewerBuild, fill: number): Promise<void> {
    this.build = build;
    this.fill = fill;
    if (!webglAvailable()) {
      this.el.setAttribute("data-renderer", "fallback");
      this.views.hidden = true;
      this.drawFallback();
      this.writeAttributes();
      return;
    }
    const { createScene } = await import("./scene.ts");
    this.stage.append(this.canvas);
    this.scene = createScene(this.canvas);
    this.el.setAttribute("data-renderer", "webgl");
    this.scene.setFill(fill);
    this.scene.setBuild(build, null);
    new ResizeObserver(() => {
      const r = this.stage.getBoundingClientRect();
      this.scene?.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
      this.dirty = true;
    }).observe(this.stage);
    this.bindPointer();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(build: ViewerBuild): void {
    const before = this.build;
    this.build = build;
    this.ghost(null, null);
    if (!this.scene) {
      this.drawFallback();
      this.writeAttributes();
      return;
    }
    const changed = before && before.boardSku === build.boardSku ? SLOTS.filter((s) => before.parts[s].sku !== build.parts[s].sku) : null;
    if (this.swap) this.finishSwap();
    if (changed && changed.length === 1 && !reducedMotion()) {
      const slot = changed[0]!;
      this.swap = { slot, label: `${before!.parts[slot].sku} to ${build.parts[slot].sku}`, start: performance.now() };
      this.scene.setBuild(build, { slot });
      this.ready = false;
    } else if (!changed || changed.length || before?.spares !== build.spares) {
      // Painted at once, so the picture never lags data-parts by a frame.
      this.scene.setBuild(build, null);
      this.scene.render(this.pose);
    }
    this.dirty = true;
    this.writeAttributes();
  }

  /** The battery fill of the settled build: the charge bar and data-battery-fill. */
  setFill(bars: number): void {
    if (bars === this.fill) return;
    this.fill = bars;
    if (this.scene) {
      this.scene.setFill(bars);
      this.scene.render(this.pose);
    } else this.drawFallback();
    this.dirty = true;
    this.writeAttributes();
  }

  /** Shows `sku` at a quarter opacity in place of its slot's part, or clears the ghost. */
  ghost(slot: Slot | null, part: { sku: string; colour: string } | null): void {
    const sku = part?.sku ?? "";
    if (sku === this.ghostSku) return;
    this.ghostSku = sku;
    this.scene?.ghost(part ? slot : null, part?.sku ?? null, part?.colour ?? null);
    this.dirty = true;
    this.writeAttributes();
  }

  viewParam(): string {
    return this.preset === "custom" ? `orbit=${orbitParam(this.pose)}` : `view=${this.preset}`;
  }

  private drawFallback(): void {
    if (!this.build) return;
    replace(this.stage, sideDrawing(this.build, this.build.boardName, this.fill));
    this.ready = true;
  }

  private finishSwap(): void {
    if (!this.swap || !this.scene) return;
    this.scene.swapProgress(this.swap.slot, 1, 1);
    this.swap = null;
  }

  private toPreset(preset: Preset): void {
    this.preset = preset;
    this.moveTo(PRESETS[preset], GLIDE_MS);
  }

  private moveTo(target: Pose, duration: number): void {
    const to = clamp(target);
    if (reducedMotion()) {
      this.glide = null;
      this.pose = to;
      this.settled = true;
    } else {
      this.glide = { from: this.pose, to, start: performance.now(), duration };
    }
    this.dirty = true;
    this.writeAttributes();
    if (!this.scene) this.flushSettle();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.target !== this.el || !this.scene) return;
    const base = this.glide?.to ?? this.pose;
    const steps: Record<string, Partial<Pose>> = {
      ArrowLeft: { yaw: base.yaw - STEPS.yaw },
      ArrowRight: { yaw: base.yaw + STEPS.yaw },
      ArrowUp: { pitch: base.pitch + STEPS.pitch },
      ArrowDown: { pitch: base.pitch - STEPS.pitch },
      "+": { dist: base.dist - STEPS.dist },
      "=": { dist: base.dist - STEPS.dist },
      "-": { dist: base.dist + STEPS.dist },
    };
    if (event.key === "Home") {
      event.preventDefault();
      this.toPreset("three-quarter");
      return;
    }
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    this.preset = "custom";
    this.moveTo({ ...base, ...step }, STEP_MS);
  }

  private bindPointer(): void {
    const stage = this.stage;
    stage.addEventListener("pointerdown", (event) => {
      stage.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    stage.addEventListener("pointermove", (event) => {
      const last = this.pointers.get(event.pointerId);
      if (!last) return;
      const others = [...this.pointers.entries()].filter(([id]) => id !== event.pointerId).map(([, p]) => p);
      if (others.length === 1) {
        const other = others[0]!;
        const before = Math.hypot(last.x - other.x, last.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (before > 0 && after > 0) this.directly({ ...this.pose, dist: (this.pose.dist * before) / after });
      } else {
        this.directly({ ...this.pose, yaw: this.pose.yaw - (event.clientX - last.x) * 0.4, pitch: this.pose.pitch + (event.clientY - last.y) * 0.3 });
      }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    const lift = (event: PointerEvent) => {
      if (this.pointers.delete(event.pointerId) && this.preset === "custom") this.settled = true;
    };
    stage.addEventListener("pointerup", lift);
    stage.addEventListener("pointercancel", lift);
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.directly({ ...this.pose, dist: this.pose.dist + event.deltaY * 0.0025 });
      clearTimeout(this.wheelTimer);
      this.wheelTimer = window.setTimeout(() => (this.settled = true), 150);
    }, { passive: false });
  }

  /** Dragging and zooming follow the input directly, with or without reduced motion. */
  private directly(target: Pose): void {
    this.glide = null;
    this.preset = "custom";
    this.pose = clamp(target);
    this.dirty = true;
    this.writeAttributes();
  }

  private frame(now: number): void {
    if (this.glide) {
      const t = Math.min(1, Math.max(0, (now - this.glide.start) / this.glide.duration));
      this.pose = t >= 1 ? this.glide.to : lerp(this.glide.from, this.glide.to, CURVES.inOut(t));
      if (t >= 1) {
        this.glide = null;
        this.settled = true;
      }
      this.dirty = true;
    }
    if (this.swap && this.scene) {
      const e = Math.max(0, now - this.swap.start);
      this.scene.swapProgress(this.swap.slot, CURVES.accelerate(Math.min(1, e / SWAP.oldMs)), CURVES.decelerate(Math.min(1, Math.max(0, (e - SWAP.newStart) / SWAP.newMs))));
      if (e >= SWAP.restMs) this.swap = null;
      this.dirty = true;
    }
    if (this.dirty && this.scene) {
      this.scene.render(this.pose);
      this.dirty = false;
      if (!this.swap) this.ready = true;
    }
    this.writeAttributes();
    this.flushSettle();
    requestAnimationFrame((t) => this.frame(t));
  }

  private flushSettle(): void {
    if (!this.settled) return;
    this.settled = false;
    this.onSettle();
  }

  private set(name: string, value: string): void {
    if (this.el.getAttribute(name) !== value) this.el.setAttribute(name, value);
  }

  private writeAttributes(): void {
    const b = this.build;
    if (b) {
      this.set("data-parts", [b.boardSku, ...SLOTS.map((s) => b.parts[s].sku)].join(","));
      this.set("data-colours", [b.finish, ...SLOTS.map((s) => b.parts[s].colour)].join(","));
      this.set("data-mast-m", b.mastM);
      this.set("data-spares", String(b.spares));
      this.set("data-finish", b.finish);
    }
    this.set("data-battery-fill", String(this.fill));
    this.set("data-ready", String(this.ready && !this.swap));
    this.set("data-ghost", this.ghostSku);
    this.set("data-swap", this.swap?.label ?? "");
    this.set("data-preset", this.preset);
    this.set("data-camera", cameraAttr(this.pose));
    this.set("data-camera-yaw", yawAttr(this.pose));
    this.set("data-camera-pitch", pitchAttr(this.pose));
    this.set("data-camera-zoom", zoomAttr(this.pose));
    for (const [preset, button] of this.buttons) button.setAttribute("aria-pressed", String(preset === this.preset));
  }
}
