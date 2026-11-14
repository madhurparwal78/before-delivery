import { abovePose, ease, insidePose, mixPose, ringPose, type Pose } from "./camera.js";
import { moveFocus, reducedMotion, revealInStrip } from "./focus.js";
import { fetchModels, hasWebGL, RingScene } from "./scene.js";
import { esc, numeral, renderPlate } from "../shared/render.js";
import { industryName, RING_SIZE, worldsOf, worldYaw } from "../shared/rules.js";
import type { Content, Project } from "../shared/types.js";

type Mode = "loading" | "3d" | "still";
type CameraState = "ring" | "descending" | "entering" | "inside" | "leaving";
type StillReason = "no-webgl" | "failure";
type Context = { kind: "home"; section: HTMLElement } | { kind: "world" } | null;

const TURN_MS = 450;
const FLIGHT_MS = 700;
const DESCENT_MS = 900;
const EMBLEM_DEGREES_PER_MS = 15 / 1000;
const DRAG_DEGREES_PER_PX = 0.1875;
const DRAG_SELECT_PX = 80;
const SWIPE_PX = 60;

const notices: Record<StillReason, string> = {
  "no-webgl": "Your browser cannot show the 3D worlds, so here they are as a still gallery.",
  failure: "Some 3D scenes could not load, so the worlds are shown as a still gallery.",
};

interface Flight {
  from: Pose;
  to: () => Pose;
  start: number;
  duration: number;
  end: CameraState;
}

interface Drag {
  pointerId: number;
  pressX: number;
  yawAtPress: number;
  moved: boolean;
}

type EnterWorld = (slug: string) => void;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Decides the active world from the scroll position on the home page. */
function worldAtScroll(scrollY: number, sectionTop: number, viewportHeight: number): number {
  const p = (scrollY - sectionTop) / viewportHeight;
  return clamp(Math.floor(p + 0.5), 0, RING_SIZE - 1) + 1;
}

export class Stage {
  readonly el = document.createElement("div");
  private readonly announcer = document.createElement("div");
  private readonly canvas: HTMLCanvasElement | null;
  private readonly worlds: Project[];
  private readonly content: Content;
  private readonly enterWorld: EnterWorld;
  private mode: Mode;
  private stillReason: StillReason | null = null;
  private active = 1;
  private yaw = 0;
  private turn: { from: number; start: number } | null = null;
  private camera: CameraState = "ring";
  private flight: Flight | null = null;
  private pose: Pose = ringPose(0);
  private emblemStart = 0;
  private emblemAngle = 0;
  private scene: RingScene | null = null;
  private context: Context = null;
  private frame = 0;
  private drag: Drag | null = null;
  private touch: { x: number; y: number } | null = null;
  private retrying = false;
  private homeListeners: AbortController | null = null;

  constructor(content: Content, enterWorld: EnterWorld) {
    this.content = content;
    this.enterWorld = enterWorld;
    this.worlds = worldsOf(content);
    this.el.className = "stage";
    this.el.dataset.stage = "";
    this.announcer.className = "visually-hidden";
    this.announcer.setAttribute("role", "status");
    this.announcer.setAttribute("aria-label", "World announcer");
    if (hasWebGL()) {
      this.mode = "loading";
      this.canvas = document.createElement("canvas");
      this.canvas.className = "stage-canvas";
      this.canvas.setAttribute("aria-hidden", "true");
      void this.load();
    } else {
      this.mode = "still";
      this.stillReason = "no-webgl";
      this.canvas = null;
    }
    this.el.addEventListener("click", (event) => this.onClick(event));
    this.el.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.el.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.el.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.el.addEventListener("pointerup", (event) => this.endDrag(event.pointerId, event.clientX));
    this.el.addEventListener("pointercancel", (event) => this.endDrag(event.pointerId, this.drag?.pressX ?? 0));
    this.el.addEventListener("touchstart", (event) => this.onTouchStart(event), { passive: true });
    this.el.addEventListener("touchend", (event) => this.onTouchEnd(event));
    this.writeAll();
  }

  private get world(): Project {
    return this.worlds[this.active - 1];
  }

  private get targetYaw(): number {
    return worldYaw(this.active);
  }

  private async load(): Promise<void> {
    const ready = await this.prepareScene();
    if (ready) this.becomeLive();
    else this.becomeStill("failure");
  }

  private async prepareScene(): Promise<boolean> {
    const models = await fetchModels(this.worlds.map((w) => w.slug));
    if (models === null || this.canvas === null) return false;
    this.scene ??= await RingScene.create(this.canvas, models);
    return this.scene !== null;
  }

  private becomeLive(): void {
    const wasStill = this.mode === "still";
    this.mode = "3d";
    this.stillReason = null;
    this.emblemStart = performance.now();
    this.emblemAngle = 0;
    if (wasStill) this.render();
    else {
      this.el.querySelector(".stage-loading")?.remove();
      this.writeAll();
    }
    this.ensureLoop();
  }

  private becomeStill(reason: StillReason): void {
    this.mode = "still";
    this.stillReason = reason;
    this.turn = null;
    this.yaw = this.targetYaw;
    this.flight = null;
    this.camera = this.context?.kind === "world" ? "inside" : "ring";
    this.render();
  }

  private line(k: number): string {
    const world = this.worlds[k - 1];
    return `World ${k} of ${RING_SIZE}: ${world.name}, ${industryName(this.content, world.industry_id)}`;
  }

  private announce(k: number): void {
    if (this.context?.kind !== "home" || this.mode === "still") return;
    const line = this.line(k);
    if (this.announcer.textContent !== line) this.announcer.textContent = line;
  }

  private instant(): boolean {
    return reducedMotion() || this.mode === "still";
  }

  private setActive(k: number, announce: boolean): void {
    if (k === this.active) return;
    this.active = k;
    if (this.instant()) {
      this.yaw = this.targetYaw;
      this.turn = null;
    } else {
      this.turn = { from: this.yaw, start: performance.now() };
    }
    this.syncActive();
    if (announce) this.announce(k);
    else if (this.context?.kind !== "home") this.announcer.textContent = "";
  }

  private settleYaw(): void {
    if (this.instant()) {
      this.yaw = this.targetYaw;
      this.turn = null;
    } else if (this.yaw !== this.targetYaw) {
      this.turn = { from: this.yaw, start: performance.now() };
    }
    this.writeAll();
  }

  private restingPose(): Pose {
    return this.camera === "inside" || this.camera === "entering" ? insidePose(this.active) : ringPose(this.yaw);
  }

  private fly(kind: CameraState, end: CameraState, from: Pose, to: () => Pose, duration: number): void {
    if (this.instant()) {
      this.camera = end;
      this.flight = null;
      this.pose = this.restingPose();
    } else {
      this.camera = kind;
      this.flight = { from, to, start: performance.now(), duration, end };
    }
    this.writeAll();
  }

  private sectionTop(): number {
    if (this.context?.kind !== "home") return 0;
    return this.context.section.getBoundingClientRect().top + window.scrollY;
  }

  private positionOf(k: number): number {
    return this.sectionTop() + (k - 1) * window.innerHeight;
  }

  private select(k: number): void {
    if (k < 1 || k > RING_SIZE || this.context?.kind !== "home") return;
    this.setActive(k, true);
    window.scrollTo(0, this.positionOf(k));
  }

  private railButton(k: number): HTMLButtonElement | null {
    return this.el.querySelector<HTMLButtonElement>(`.rail button[data-index="${k}"]`);
  }

  private exploreLink(k: number): HTMLAnchorElement | null {
    return this.el.querySelector<HTMLAnchorElement>(`a[href="/worlds/${this.worlds[k - 1].slug}"]`);
  }

  // Home page

  showHome(slot: Element, section: HTMLElement, how: "fresh" | "leave"): void {
    this.detachListeners();
    this.context = { kind: "home", section };
    slot.replaceWith(this.el);
    if (how === "fresh") {
      this.active = 1;
      this.yaw = 0;
      this.turn = null;
      this.flight = null;
      this.camera = "ring";
      this.pose = ringPose(0);
      this.announcer.textContent = "";
    }
    this.render();
    const listeners = new AbortController();
    this.homeListeners = listeners;
    window.addEventListener("scroll", () => this.onScroll(), { signal: listeners.signal, passive: true });
    document
      .querySelector(".enter-worlds")
      ?.addEventListener("click", () => this.enterTheWorlds(), { signal: listeners.signal });
    if (how === "leave") {
      this.fly("leaving", "ring", this.pose, () => ringPose(this.yaw), FLIGHT_MS);
      if (this.mode === "still") {
        moveFocus(this.exploreLink(this.active));
      } else {
        window.scrollTo(0, this.positionOf(this.active));
        moveFocus(this.el.querySelector<HTMLElement>(".enter-world"));
      }
    }
    this.ensureLoop();
  }

  private enterTheWorlds(): void {
    window.scrollTo(0, this.sectionTop());
    if (this.mode === "still") {
      moveFocus(this.exploreLink(1));
      return;
    }
    this.setActive(1, false);
    this.announce(1);
    this.fly("descending", "ring", abovePose(this.yaw), () => ringPose(this.yaw), DESCENT_MS);
    moveFocus(this.railButton(1));
  }

  private onScroll(): void {
    if (this.context?.kind !== "home" || this.mode === "still") return;
    const k = worldAtScroll(window.scrollY, this.sectionTop(), window.innerHeight);
    if (k !== this.active) this.setActive(k, true);
  }

  private onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (button === null || this.context?.kind !== "home") return;
    if (button.matches(".rail button")) this.select(Number(button.dataset.index));
    else if (button.matches(".previous-world")) this.select(this.active - 1);
    else if (button.matches(".next-world")) this.select(this.active + 1);
    else if (button.matches(".enter-world")) this.enterWorld(this.world.slug);
    else if (button.matches(".try-3d")) void this.retry();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!(event.target instanceof Element) || event.target.closest(".rail") === null) return;
    const targets: Record<string, number> = {
      ArrowRight: this.active + 1,
      ArrowDown: this.active + 1,
      ArrowLeft: this.active - 1,
      ArrowUp: this.active - 1,
      Home: 1,
      End: RING_SIZE,
    };
    const k = targets[event.key];
    if (k === undefined) return;
    event.preventDefault();
    const next = clamp(k, 1, RING_SIZE);
    this.select(next);
    moveFocus(this.railButton(next));
  }

  private dragAllowed(event: Event): boolean {
    return (
      this.context?.kind === "home" &&
      this.mode !== "still" &&
      event.target instanceof Element &&
      event.target.closest("button, a, nav") === null
    );
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch" || event.button !== 0 || !this.dragAllowed(event)) return;
    this.drag = { pointerId: event.pointerId, pressX: event.clientX, yawAtPress: this.yaw, moved: false };
    this.el.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId || event.clientX === drag.pressX) return;
    if (!drag.moved) {
      drag.moved = true;
      this.turn = null;
    }
    if (reducedMotion()) return;
    const turned = drag.yawAtPress + (drag.pressX - event.clientX) * DRAG_DEGREES_PER_PX;
    this.yaw = clamp(
      turned,
      Math.max(0, drag.yawAtPress - 45),
      Math.min(worldYaw(RING_SIZE), drag.yawAtPress + 45),
    );
    this.writeAll();
  }

  private endDrag(pointerId: number, x: number): void {
    const drag = this.drag;
    if (drag === null || pointerId !== drag.pointerId) return;
    this.drag = null;
    if (!drag.moved) return;
    const distance = drag.pressX - x;
    if (distance >= DRAG_SELECT_PX && this.active < RING_SIZE) this.select(this.active + 1);
    else if (distance <= -DRAG_SELECT_PX && this.active > 1) this.select(this.active - 1);
    else this.settleYaw();
  }

  private onTouchStart(event: TouchEvent): void {
    this.touch = null;
    if (event.touches.length !== 1 || !this.dragAllowed(event)) return;
    this.touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }

  private onTouchEnd(event: TouchEvent): void {
    const start = this.touch;
    this.touch = null;
    const end = event.changedTouches[0];
    if (start === null || end === undefined) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return;
    this.select(dx < 0 ? this.active + 1 : this.active - 1);
  }

  private async retry(): Promise<void> {
    if (this.retrying) return;
    this.retrying = true;
    const ready = await this.prepareScene();
    this.retrying = false;
    if (!ready) {
      const notice = this.el.querySelector(".still-notice");
      const fresh = document.createElement("p");
      fresh.className = "still-notice";
      fresh.textContent = notices.failure;
      notice?.replaceWith(fresh);
      return;
    }
    this.becomeLive();
    this.setActive(1, false);
    if (this.context?.kind !== "home") return;
    window.scrollTo(0, this.sectionTop());
    moveFocus(this.railButton(1));
  }

  // World pages

  showWorld(slot: Element, slug: string, how: "enter" | "between" | "direct"): void {
    this.detachListeners();
    this.context = { kind: "world" };
    slot.replaceWith(this.el);
    const k = this.worlds.findIndex((w) => w.slug === slug) + 1;
    if (how === "direct") {
      this.active = k;
      this.yaw = this.targetYaw;
      this.turn = null;
      this.flight = null;
      this.camera = "inside";
      this.pose = insidePose(k);
    } else {
      this.setActive(k, false);
      this.fly("entering", "inside", this.pose, () => insidePose(this.active), FLIGHT_MS);
    }
    this.render();
    this.ensureLoop();
  }

  hide(): void {
    this.detachListeners();
    this.context = null;
    this.drag = null;
    this.el.remove();
  }

  private detachListeners(): void {
    this.homeListeners?.abort();
    this.homeListeners = null;
  }

  // Drawing

  private ensureLoop(): void {
    if (this.frame !== 0 || this.context === null || this.mode === "still") return;
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.frame = 0;
    if (this.context === null || this.mode === "still") return;
    const now = performance.now();
    if (this.turn !== null) {
      const t = (now - this.turn.start) / TURN_MS;
      if (t >= 1) {
        this.yaw = this.targetYaw;
        this.turn = null;
      } else {
        this.yaw = this.turn.from + (this.targetYaw - this.turn.from) * ease(t);
      }
    }
    if (this.flight !== null) {
      const t = (now - this.flight.start) / this.flight.duration;
      if (t >= 1) {
        this.camera = this.flight.end;
        this.flight = null;
        this.pose = this.restingPose();
      } else {
        this.pose = mixPose(this.flight.from, this.flight.to(), ease(t));
      }
    } else {
      this.pose = this.restingPose();
    }
    if (this.mode === "3d" && !reducedMotion()) {
      this.emblemAngle = Math.floor(((now - this.emblemStart) * EMBLEM_DEGREES_PER_MS * 10) % 3600) / 10;
    }
    this.writeAll();
    if (this.mode === "3d") this.scene?.render(this.pose, this.emblemAngle);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private writeAll(): void {
    const data = this.el.dataset;
    data.mode = this.mode;
    data.activeWorld = this.world.slug;
    data.yaw = this.yaw.toFixed(1);
    data.targetYaw = this.targetYaw.toFixed(1);
    data.camera = this.camera;
    data.emblemAngle = this.emblemAngle.toFixed(1);
  }

  private render(): void {
    this.writeAll();
    const context = this.context;
    if (context === null) return;
    if (context.kind === "world") {
      this.el.className = "stage stage-band";
      this.el.style.backgroundColor = this.mode === "still" ? this.world.colours.ground : "";
      const parts: Node[] = [];
      if (this.mode !== "still" && this.canvas !== null) parts.push(this.canvas);
      if (this.mode === "loading") parts.push(this.loadingText());
      this.el.replaceChildren(...parts);
      return;
    }
    context.section.classList.toggle("is-still", this.mode === "still");
    this.el.style.backgroundColor = "";
    if (this.mode === "still") {
      this.el.className = "stage stage-still";
      this.el.innerHTML = this.stillMarkup();
      this.el.append(this.announcer);
      return;
    }
    this.el.className = "stage stage-ring";
    this.el.innerHTML = this.ringMarkup();
    if (this.canvas !== null) this.el.prepend(this.canvas);
    if (this.mode === "loading") this.el.append(this.loadingText());
    this.el.append(this.announcer);
    this.syncActive();
  }

  private loadingText(): HTMLElement {
    const p = document.createElement("p");
    p.className = "stage-loading";
    p.textContent = "Loading the worlds…";
    return p;
  }

  private ringMarkup(): string {
    return `<div class="stage-overlay">
  <p class="stage-numeral num" aria-hidden="true"></p>
  <h2 class="stage-name"></h2>
  <p class="stage-industry"></p>
</div>
<div class="stage-controls">
  <button type="button" class="button quiet previous-world">Previous world</button>
  <button type="button" class="button primary enter-world"></button>
  <button type="button" class="button quiet next-world">Next world</button>
</div>
<nav class="rail" aria-label="World rail"><ol class="strip">${this.worlds
      .map(
        (w, i) =>
          `<li><button type="button" data-index="${i + 1}"><span class="num" aria-hidden="true">${numeral(i + 1)}</span><span class="rail-name">${esc(w.name)}</span></button></li>`,
      )
      .join("")}</ol></nav>`;
  }

  private stillMarkup(): string {
    const notice = this.stillReason === null ? "" : notices[this.stillReason];
    return `<h2 class="still-heading">The eight worlds</h2>
<p class="still-notice">${notice}</p>
${this.stillReason === "failure" ? `<button type="button" class="button primary try-3d">Try 3D again</button>` : ""}
<ul class="world-cards" aria-label="Worlds">${this.worlds
      .map(
        (w, i) => `<li><article class="world-card">
  ${renderPlate(w.colours, i)}
  <h3>${esc(w.name)}</h3>
  <p class="secondary">${esc(industryName(this.content, w.industry_id))}</p>
  <p>${esc(w.world?.summary ?? "")}</p>
  <a href="/worlds/${w.slug}">Explore ${esc(w.name)}</a>
</article></li>`,
      )
      .join("")}</ul>`;
  }

  private syncActive(): void {
    this.writeAll();
    const k = this.active;
    const world = this.world;
    const set = (selector: string, text: string): void => {
      const el = this.el.querySelector(selector);
      if (el !== null) el.textContent = text;
    };
    set(".stage-numeral", `${numeral(k)} / ${numeral(RING_SIZE)}`);
    set(".stage-name", world.name);
    set(".stage-industry", industryName(this.content, world.industry_id));
    set(".enter-world", `Enter ${world.name}`);
    const previous = this.el.querySelector<HTMLButtonElement>(".previous-world");
    const next = this.el.querySelector<HTMLButtonElement>(".next-world");
    if (previous !== null) previous.disabled = k === 1;
    if (next !== null) next.disabled = k === RING_SIZE;
    for (const button of this.el.querySelectorAll<HTMLButtonElement>(".rail button")) {
      const current = Number(button.dataset.index) === k;
      button.tabIndex = current ? 0 : -1;
      if (current) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
    const railButton = this.railButton(k);
    if (railButton !== null) revealInStrip(railButton);
  }
}
