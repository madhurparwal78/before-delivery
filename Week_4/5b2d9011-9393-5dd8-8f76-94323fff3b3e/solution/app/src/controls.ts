import { dialogOpen } from "./dialogs";
import { glyph, h } from "./dom";
import { remapActive } from "./panels";
import { app } from "./state";
import type { Game } from "./game";
import type { Stage } from "./stage";

const TURN_DEGREES_PER_SECOND = 180;

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input:not([type="button"]):not([type="checkbox"]), textarea, select, [contenteditable="true"]');
}

/** Keyboard, mouse and pointer controls. Game keys work whichever HUD control has focus. */
export class Controls {
  private readonly held = new Set<string>();
  private aimFrame = 0;
  private lastFrame = 0;

  constructor(private readonly sink: Game, private readonly stage: Stage, private readonly canvas: HTMLElement) {
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
    window.addEventListener("blur", this.releaseAll);
    canvas.addEventListener("pointermove", this.pointermove);
    canvas.addEventListener("pointerdown", this.pointerdown);
    canvas.addEventListener("pointerup", this.pointerup);
    canvas.addEventListener("pointercancel", this.pointerup);
    canvas.addEventListener("contextmenu", this.contextmenu);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
    window.removeEventListener("blur", this.releaseAll);
    this.canvas.removeEventListener("pointermove", this.pointermove);
    this.canvas.removeEventListener("pointerdown", this.pointerdown);
    this.canvas.removeEventListener("pointerup", this.pointerup);
    this.canvas.removeEventListener("pointercancel", this.pointerup);
    this.canvas.removeEventListener("contextmenu", this.contextmenu);
    cancelAnimationFrame(this.aimFrame);
    this.releaseAll();
  }

  private actionOf(code: string): string | undefined {
    return Object.entries(app.settings.bindings).find(([, bound]) => bound === code)?.[0];
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code === "Escape") {
      if (!dialogOpen() && !remapActive() && this.sink.mode() !== null) {
        event.preventDefault();
        this.sink.pause();
      }
      return;
    }
    if (dialogOpen() || remapActive() || typingTarget(event.target) || this.sink.mode() === null) return;
    const action = this.actionOf(event.code);
    if (!action) return;
    event.preventDefault();
    if (event.repeat) return;
    const siege = this.sink.mode() === "siege";
    switch (action) {
      case "move_up": case "move_down": case "move_left": case "move_right":
        this.held.add(action);
        this.pushMove();
        break;
      case "aim_left": case "aim_right":
        if (!siege) return;
        this.held.add(action);
        this.startAimLoop();
        break;
      case "fire": if (siege) { this.held.add(action); this.sink.fireStart(); } break;
      case "reload": if (siege) this.sink.reload(); break;
      case "grenade": if (siege) this.sink.grenadeAhead(); break;
      case "revive": if (siege) this.sink.revive(); break;
      case "shop": if (siege) this.sink.shop(); break;
      case "timers": this.sink.timers(); break;
    }
  };

  private readonly keyup = (event: KeyboardEvent): void => {
    const action = this.actionOf(event.code);
    if (!action || !this.held.delete(action)) return;
    if (action === "fire") this.sink.fireStop();
    else if (action.startsWith("move_")) this.pushMove();
  };

  private readonly releaseAll = (): void => {
    const wasFiring = this.held.has("fire");
    this.held.clear();
    if (wasFiring) this.sink.fireStop();
    this.pushMove();
  };

  private pushMove(): void {
    const x = Number(this.held.has("move_right")) - Number(this.held.has("move_left"));
    const z = Number(this.held.has("move_up")) - Number(this.held.has("move_down"));
    if (this.sink.mode() === "convoy") this.sink.drive(Number(this.held.has("move_up")), Number(this.held.has("move_down")), -x);
    else this.sink.move(x, z);
  }

  private startAimLoop(): void {
    if (this.aimFrame) return;
    this.lastFrame = performance.now();
    const turn = (now: number): void => {
      const turning = Number(this.held.has("aim_left")) - Number(this.held.has("aim_right"));
      if (turning === 0) {
        this.aimFrame = 0;
        return;
      }
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.sink.setAim((((this.sink.aimDegrees() + turning * TURN_DEGREES_PER_SECOND * dt) % 360) + 360) % 360);
      this.aimFrame = requestAnimationFrame(turn);
    };
    this.aimFrame = requestAnimationFrame(turn);
  }

  // ---- pointer aim, click to fire, right click to throw

  private pointerAim(event: PointerEvent): { x: number; z: number } | null {
    const me = this.sink.playerPosition();
    const ground = this.stage.pickGround(event.clientX, event.clientY);
    if (!me || !ground) return null;
    this.sink.setAim((((Math.atan2(ground.z - me.z, ground.x - me.x) * 180) / Math.PI) + 360) % 360);
    return ground;
  }

  private readonly pointermove = (event: PointerEvent): void => {
    if (this.sink.mode() !== "siege" || event.pointerType === "touch") return;
    this.pointerAim(event);
  };

  private readonly pointerdown = (event: PointerEvent): void => {
    if (this.sink.mode() !== "siege" || event.pointerType === "touch" || event.button !== 0 || dialogOpen()) return;
    this.pointerAim(event);
    this.sink.fireStart();
  };

  private readonly pointerup = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") this.sink.fireStop();
  };

  private readonly contextmenu = (event: MouseEvent): void => {
    if (this.sink.mode() !== "siege") return;
    event.preventDefault();
    const me = this.sink.playerPosition();
    const ground = this.stage.pickGround(event.clientX, event.clientY);
    if (!me || !ground) return;
    const distance = Math.hypot(ground.x - me.x, ground.z - me.z);
    const reach = Math.min(distance, 14.9);
    const scale = distance === 0 ? 0 : reach / distance;
    this.sink.grenadeAt(me.x + (ground.x - me.x) * scale, me.z + (ground.z - me.z) * scale);
  };
}

// ---- touch controls

const STICK_RADIUS = 48;

function stick(label: string, onChange: (x: number, y: number, active: boolean) => void): HTMLElement {
  const thumb = h("span", { class: "stick-thumb" });
  const base = h("div", { class: "stick", role: "group", "aria-label": label }, thumb);
  let pointer = -1;
  let origin = { x: 0, y: 0 };
  const offset = (event: PointerEvent): { x: number; y: number } => {
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const length = Math.hypot(dx, dy);
    const scale = length > STICK_RADIUS ? STICK_RADIUS / length : 1;
    return { x: dx * scale, y: dy * scale };
  };
  base.addEventListener("pointerdown", (event) => {
    if (pointer !== -1) return;
    pointer = event.pointerId;
    base.setPointerCapture(pointer);
    const rect = base.getBoundingClientRect();
    origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const o = offset(event);
    thumb.style.transform = `translate(${o.x}px, ${o.y}px)`;
    onChange(o.x / STICK_RADIUS, o.y / STICK_RADIUS, true);
  });
  base.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointer) return;
    const o = offset(event);
    thumb.style.transform = `translate(${o.x}px, ${o.y}px)`;
    onChange(o.x / STICK_RADIUS, o.y / STICK_RADIUS, true);
  });
  const release = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    pointer = -1;
    thumb.style.transform = "";
    onChange(0, 0, false);
  };
  base.addEventListener("pointerup", release);
  base.addEventListener("pointercancel", release);
  return base;
}

function actionButton(label: string, icon: string[], down: () => void, up?: () => void): HTMLButtonElement {
  const button = h("button", { type: "button", class: "btn btn-touch", "aria-label": label }, glyph(icon, 20), h("span", {}, label));
  let pointer = -1;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pointer = event.pointerId;
    button.setPointerCapture(pointer);
    down();
  });
  const release = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    pointer = -1;
    up?.();
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("click", (event) => {
    if (event.detail === 0) {
      down();
      up?.();
    }
  });
  return button;
}

/** Move and aim sticks with Fire, Reload, Grenade and Pause buttons, for touch devices. */
export function touchControls(sink: Game): HTMLElement {
  const convoy = sink.mode() === "convoy";
  const move = stick("Move stick", (x, y, active) => {
    if (convoy) sink.drive(active ? Math.max(0, -y) : 0, active ? Math.max(0, y) : 0, active ? -x : 0);
    else sink.move(x, -y);
  });
  const root = h("div", { class: "touch" }, h("div", { class: "touch-left" }, move));
  if (convoy) {
    root.append(h("div", { class: "touch-right" }, actionButton("Pause", ["M8 5v14", "M16 5v14"], () => sink.pause())));
    return root;
  }
  const aim = stick("Aim stick", (x, y, active) => {
    if (active && (x !== 0 || y !== 0)) sink.setAim((((Math.atan2(-y, x) * 180) / Math.PI) + 360) % 360);
  });
  root.append(h("div", { class: "touch-right" },
    h("div", { class: "touch-actions" },
      actionButton("Fire", ["M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4", "M12 12h.01"], () => sink.fireStart(), () => sink.fireStop()),
      actionButton("Reload", ["M4 12a8 8 0 0 1 14-5l2 2", "M20 4v5h-5", "M20 12a8 8 0 0 1-14 5l-2-2", "M4 20v-5h5"], () => sink.reload()),
      actionButton("Grenade", ["M10 8h4l1 3H9z", "M8 11a5 5 0 1 0 8 0", "M12 8V5l3-1"], () => sink.grenadeAhead()),
      actionButton("Pause", ["M8 5v14", "M16 5v14"], () => sink.pause())),
    aim));
  return root;
}
