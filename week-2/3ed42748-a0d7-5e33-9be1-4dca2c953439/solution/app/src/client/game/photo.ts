// Photo mode: a paper frame round the edges with a see-through centre. The photo camera's yaw
// and field of view step under arrow keys, the wheel, drags and pinches; the camera eases to
// each new target from wherever it is. "Take postcard" captures the view at 1200×800 with a
// perforated stamp edge and a Bramble postmark drawn into the picture.
import { errorCode, get, send } from "../lib/api";
import { closeDialog, openDialog, type OpenDialog } from "../lib/dialogs";
import { h, setText } from "../lib/dom";
import { clamp01, easePrint } from "../lib/motion";
import type { Notices } from "../lib/notices";
import { paper, perforatedPath } from "../lib/paper";
import { icon } from "../lib/icons";
import { PHOTO_FOV } from "./world";

const YAW_STEP = 15;
const ZOOM_STEP = 5;
const FOV_MIN = 30;
const FOV_MAX = 70;
const EASE_MS = 220;
const STATUS_MS = 5000;
const DARKROOM_CLOSED_COPY =
  "The darkroom is closed. Your walk isn't affected — postcards will develop again when it reopens.";

const clampFov = (v: number): number => Math.min(FOV_MAX, Math.max(FOV_MIN, Math.round(v)));
const wrap = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;

interface PhotoHooks {
  capture: (yaw: number, fov: number) => ImageData | null;
  signedIn: () => boolean;
  uploaded: () => void;
  closed: () => void;
}

export class PhotoMode {
  readonly el: HTMLElement;
  readonly status = h("div", { role: "status", "aria-label": "Darkroom", class: "photo-status" }, "Checking the darkroom…");
  private readonly shutter = h(
    "button",
    { type: "button", class: "button button-primary photo-shutter" },
    svgIcon("camera"),
    "Take postcard",
  );
  private readonly leave = h("button", { type: "button", class: "button" }, "Leave photo mode");
  private readonly hint = h("p", { id: "photo-hint", class: "photo-hint" });
  private dialog: OpenDialog | null = null;
  private timer = 0;
  private darkroomOpen = false;
  private developing = false;
  yawTarget = 0;
  fovTarget = PHOTO_FOV;
  private yawFrom = 0;
  private fovFrom = PHOTO_FOV;
  private changedAt = -Infinity;
  private drag: { id: number; x: number; yaw: number } | null = null;
  private pinch = new Map<number, { x: number; y: number }>();
  private pinchStart: { distance: number; fov: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly notices: Notices,
    private readonly hooks: PhotoHooks,
  ) {
    this.el = h(
      "div",
      { role: "dialog", "aria-modal": "true", "aria-label": "Photo mode", class: "photo-frame" },
      paper(h("div", { class: "photo-strip photo-top" }, h("span", { class: "photo-title" }, "Photo mode"), this.status)),
      paper(h("div", { class: "photo-strip photo-bottom" }, this.hint, this.shutter, this.leave)),
      h("div", { class: "photo-rail photo-left", "aria-hidden": "true" }),
      h("div", { class: "photo-rail photo-right", "aria-hidden": "true" }),
    );
    this.shutter.addEventListener("click", () => void this.take());
    this.leave.addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    window.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", (e) => this.onPointerUp(e));
  }

  get open(): boolean {
    return this.dialog !== null;
  }

  show(opener: HTMLElement, now: number): void {
    if (this.open) return;
    this.yawTarget = this.yawFrom = 0;
    this.fovTarget = this.fovFrom = PHOTO_FOV;
    this.changedAt = -Infinity;
    this.host.append(this.el);
    this.refreshShutter();
    this.dialog = openDialog({ el: this.el, opener, onEscape: () => this.close() });
    void this.checkDarkroom();
    this.timer = window.setInterval(() => void this.checkDarkroom(), STATUS_MS);
    void now;
  }

  close(): void {
    if (!this.dialog) return;
    window.clearInterval(this.timer);
    this.el.remove();
    closeDialog(this.dialog);
    this.dialog = null;
    this.drag = null;
    this.pinch.clear();
    this.hooks.closed();
  }

  /** The eased yaw and field of view the photo camera shows now. */
  shown(now: number, reduced: boolean): { yaw: number; fov: number; settled: boolean } {
    const t = reduced ? 1 : clamp01((now - this.changedAt) / EASE_MS);
    const e = easePrint(t);
    let dy = this.yawTarget - this.yawFrom;
    if (dy > 180) dy -= 360;
    if (dy < -180) dy += 360;
    return { yaw: this.yawFrom + dy * e, fov: this.fovFrom + (this.fovTarget - this.fovFrom) * e, settled: t >= 1 };
  }

  private retarget(yaw: number, fov: number): void {
    const now = performance.now();
    const current = this.shown(now, false);
    this.yawFrom = current.yaw;
    this.fovFrom = current.fov;
    this.yawTarget = wrap(yaw);
    this.fovTarget = clampFov(fov);
    this.changedAt = now;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open) return;
    const steps: Record<string, [number, number]> = {
      ArrowRight: [YAW_STEP, 0],
      ArrowLeft: [-YAW_STEP, 0],
      ArrowUp: [0, -ZOOM_STEP],
      ArrowDown: [0, ZOOM_STEP],
    };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    this.retarget(this.yawTarget + step[0], this.fovTarget + step[1]);
  }

  private onWheel(e: WheelEvent): void {
    if (!this.open || e.deltaY === 0) return;
    e.preventDefault();
    this.retarget(this.yawTarget, this.fovTarget + (e.deltaY < 0 ? -ZOOM_STEP : ZOOM_STEP));
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.open || (e.target as Element).closest("button, .photo-strip")) return;
    if (e.pointerType === "touch") {
      this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch.size === 2) {
        const [a, b] = [...this.pinch.values()];
        this.pinchStart = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), fov: this.fovTarget };
        this.drag = null;
        return;
      }
    }
    this.drag = { id: e.pointerId, x: e.clientX, yaw: this.yawTarget };
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.open) return;
    if (this.pinch.has(e.pointerId)) this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinchStart && this.pinch.size === 2) {
      const [a, b] = [...this.pinch.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (distance > 0) this.retarget(this.yawTarget, (this.pinchStart.fov * this.pinchStart.distance) / distance);
      return;
    }
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const yaw = this.drag.yaw + Math.round((e.clientX - this.drag.x) / 4);
    if (wrap(yaw) !== this.yawTarget) this.retarget(yaw, this.fovTarget);
  }

  private onPointerUp(e: PointerEvent): void {
    this.pinch.delete(e.pointerId);
    if (this.pinch.size < 2) this.pinchStart = null;
    if (this.drag?.id === e.pointerId) this.drag = null;
  }

  private refreshShutter(): void {
    const usable = this.darkroomOpen && this.hooks.signedIn() && !this.developing;
    this.shutter.setAttribute("aria-disabled", usable ? "false" : "true");
    this.hint.textContent = this.hooks.signedIn() ? "" : "Claim your save to keep postcards.";
    if (this.hint.textContent) this.shutter.setAttribute("aria-describedby", this.hint.id);
    else this.shutter.removeAttribute("aria-describedby");
  }

  private async checkDarkroom(): Promise<void> {
    const answer = await get<{ darkroom: string }>("/api/status").catch(() => null);
    if (!this.open) return;
    this.darkroomOpen = answer?.status === 200 && answer.data.darkroom === "open";
    setText(this.status, answer?.status === 200 ? (this.darkroomOpen ? "Darkroom open" : DARKROOM_CLOSED_COPY) : "Checking the darkroom…");
    this.refreshShutter();
  }

  private async take(): Promise<void> {
    if (this.shutter.getAttribute("aria-disabled") === "true") {
      if (!this.hooks.signedIn()) this.notices.say("Claim your save to keep postcards.");
      return;
    }
    const view = this.hooks.capture(this.yawTarget, this.fovTarget);
    if (!view) return;
    this.developing = true;
    this.refreshShutter();
    this.notices.say("Developing…", true);
    const blob = await postcardImage(view);
    const answer = await send({ method: "POST", path: "/api/postcards", raw: blob }).catch(() => null);
    this.developing = false;
    this.refreshShutter();
    const code = answer ? errorCode(answer) : "";
    if (answer?.status === 201) {
      this.notices.say("Postcard saved to your postbox.");
      this.hooks.uploaded();
    } else if (code === "darkroom_closed") {
      this.notices.say(DARKROOM_CLOSED_COPY);
      void this.checkDarkroom();
    } else if (code === "sign_in_required") this.notices.say("Claim your save to keep postcards.");
    else if (code === "postbox_full") this.notices.say("Your postbox is full. Revoke a postcard to make room.");
    else if (code === "validation") this.notices.say("That photo didn't develop. Try again.");
    else this.notices.say("Something went wrong on Bramble.");
  }
}

function svgIcon(name: "camera"): HTMLElement {
  const span = h("span", { class: "icon-wrap", "aria-hidden": "true" });
  span.innerHTML = icon(name);
  return span;
}

/** The capture with a perforated stamp edge and a dated Bramble postmark, as a PNG. */
function postcardImage(view: ImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = view.width;
  canvas.height = view.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(view, 0, 0);
  const inset = 26;
  const stamp = new Path2D(perforatedPath(view.width - inset * 2, view.height - inset * 2));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, view.width, view.height);
  ctx.translate(inset, inset);
  ctx.fillStyle = "#f6eedd";
  const frame = new Path2D();
  frame.rect(-inset, -inset, view.width, view.height);
  frame.addPath(stamp);
  ctx.fill(frame, "evenodd");
  ctx.strokeStyle = "rgba(43,33,64,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke(stamp);
  ctx.restore();
  const cx = view.width - 150;
  const cy = 130;
  ctx.save();
  ctx.strokeStyle = "rgba(43,33,64,0.78)";
  ctx.fillStyle = "rgba(43,33,64,0.78)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 64, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 26px Fraunces, Georgia, serif";
  ctx.fillText("BRAMBLE", cx, cy - 14);
  ctx.font = "700 18px 'Atkinson Hyperlegible', sans-serif";
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  ctx.fillText(date, cx, cy + 18);
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    for (let x = 0; x <= 210; x += 6) {
      const y = cy - 30 + i * 20 + Math.sin(x / 14) * 5;
      if (x === 0) ctx.moveTo(cx - 300 + x, y);
      else ctx.lineTo(cx - 300 + x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}
