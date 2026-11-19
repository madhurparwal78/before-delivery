import { clear, glyph, h } from "./dom";
import { Fuse } from "./fuse";
import { formatLap } from "./format";
import { notify } from "./state";
import type { RoomState, SeatState } from "./types";

interface TimerEntry {
  fuse: Fuse;
  name: string;
  wrapper: HTMLElement;
}

const FEED_LINES = 6;

/** A labelled readout group whose value text is updated in place. */
function readout(label: string, icon: string[]): { el: HTMLElement; value: HTMLElement } {
  const value = h("span", { class: "readout-value" });
  const el = h("div", { class: "readout", role: "group", "aria-label": label },
    h("span", { class: "cap", "aria-hidden": "true" }, label), h("span", { class: "readout-icon" }, glyph(icon, 14)), value);
  return { el, value };
}

const ICONS = {
  wave: ["M5 21V4", "M5 4h11l-2 4 2 4H5"],
  credits: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 8v8"],
  score: ["M12 3l2.7 5.5 6 .9-4.4 4.2 1 6L12 16.8l-5.3 2.8 1-6L3.3 9.4l6-.9z"],
  status: ["M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"],
  ammo: ["M9 3h6l1 5v13H8V8z", "M8 8h8"],
  grenades: ["M10 7h4l1 3H9z", "M8 10a5 5 0 1 0 8 0", "M12 7V4l3-1"],
  lap: ["M4 12a8 8 0 0 1 14-5l2 2", "M20 4v5h-5"],
  checkpoint: ["M12 21s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10z", "M12 9v4"],
  best: ["M8 4h8v5a4 4 0 0 1-8 0z", "M8 6H5v2a3 3 0 0 0 3 3", "M16 6h3v2a3 3 0 0 1-3 3", "M12 13v4", "M8 20h8"],
};

/** The siege and convoy HUD: server readouts only, never local game arithmetic. */
export class Hud {
  readonly root: HTMLElement;
  private readonly wave = readout("Wave", ICONS.wave);
  private readonly waveText = this.wave.value;
  private readonly waveTimer = h("span", { class: "readout-clock" });
  private readonly feed = h("div", { class: "feed", role: "status", "aria-label": "Match feed", "aria-live": "polite" });
  private readonly credits = readout("Credits", ICONS.credits);
  private readonly score = readout("Score", ICONS.score);
  private readonly health = h("div", { class: "meter", role: "meter", "aria-label": "Health", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "100" });
  private readonly healthFill = h("span", { class: "meter-fill" });
  private readonly healthText = h("span", { class: "meter-text" }, "100");
  private readonly status = readout("Status", ICONS.status);
  private readonly ammo = readout("Ammo", ICONS.ammo);
  private readonly grenades = readout("Grenades", ICONS.grenades);
  private readonly reload = h("div", { class: "clocks" });
  private readonly revives = h("div", { class: "clocks" });
  private readonly lap = readout("Lap", ICONS.lap);
  private readonly checkpoint = readout("Checkpoint", ICONS.checkpoint);
  private readonly bestLap = readout("Best lap", ICONS.best);
  private readonly lapClock = h("div", { class: "clocks" });
  private readonly resetClock = h("div", { class: "clocks reset-clock" });
  private readonly shopButton: HTMLButtonElement;
  private readonly timersButton: HTMLButtonElement;
  private timersList: HTMLElement | null = null;
  private readonly timers = new Map<string, TimerEntry>();
  private readonly lastStatus = new Map<string, string>();

  constructor(private readonly mode: "siege" | "convoy", actions: { shop: () => void; pause: () => void }, private readonly feedLine: (text: string) => void) {
    this.shopButton = h("button", { type: "button", class: "btn btn-hud", disabled: true, onclick: actions.shop }, "Shop");
    this.timersButton = h("button", { type: "button", class: "btn btn-hud", "aria-expanded": "false", onclick: () => this.toggleTimers() }, "Timers");
    const pause = h("button", { type: "button", class: "btn btn-hud", onclick: actions.pause }, glyph(["M8 5v14", "M16 5v14"], 14), "Pause");
    const buttons = h("div", { class: "hud-buttons" }, mode === "siege" ? this.shopButton : null, this.timersButton, pause);
    this.root = h("section", { class: "hud", role: "region", "aria-label": "HUD", tabindex: "-1" });
    if (mode === "siege") {
      this.wave.el.append(this.waveTimer);
      this.health.append(this.healthFill, this.healthText);
      this.root.append(
        h("div", { class: "hud-tl" }, this.wave.el, this.feed),
        buttons,
        h("div", { class: "hud-tr" }, this.credits.el, this.score.el),
        h("div", { class: "hud-bl" }, this.health, this.status.el, this.revives),
        h("div", { class: "hud-br" }, this.ammo.el, this.grenades.el, this.reload),
      );
    } else {
      this.root.append(
        h("div", { class: "hud-top-convoy" }, this.lap.el, this.lapClock, this.checkpoint.el, this.bestLap.el),
        buttons,
        h("div", { class: "hud-tl hud-tl-convoy" }, this.feed),
        h("div", { class: "hud-center" }, this.resetClock),
        h("div", { class: "hud-bl" }, this.reload),
      );
    }
  }

  line(text: string): void {
    this.feed.append(h("p", {}, text));
    if (this.feed.childElementCount > FEED_LINES) this.feed.firstElementChild?.remove();
  }

  private toggleTimers(open = this.timersList === null): void {
    this.timersButton.setAttribute("aria-expanded", String(open));
    if (!open) {
      this.timersList?.remove();
      this.timersList = null;
      return;
    }
    this.timersList = h("ul", { class: "timers-list", "aria-label": "Timers" });
    this.root.append(this.timersList);
    this.renderTimers();
  }

  toggle(): void {
    this.toggleTimers();
  }

  private renderTimers(): void {
    if (!this.timersList) return;
    clear(this.timersList);
    for (const { fuse, name } of this.timers.values()) this.timersList.append(h("li", {}, `${name} ${fuse.text}`));
  }

  /** Creates, feeds or resolves one timer by key. */
  private timer(key: string, name: string, outcome: string, ms: number | null, host: HTMLElement, options: { countUp?: boolean; word?: string; onResolve?: () => void } = {}): void {
    let entry = this.timers.get(key);
    if (entry?.fuse.resolved) {
      this.timers.delete(key);
      entry = undefined;
    }
    if (ms === null) {
      if (entry && options.countUp) {
        entry.fuse.destroy();
        entry.wrapper.remove();
        this.timers.delete(key);
      } else entry?.fuse.resolve(options.word);
      return;
    }
    if (!entry) {
      const wrapper = h("span", { class: "clock" }, h("span", { class: "cap", "aria-hidden": "true" }, name));
      const fuse = new Fuse({
        name, outcome, countUp: options.countUp, maxExtrapolateMs: key === "grace" ? Infinity : undefined,
        onResolve: () => options.onResolve?.(),
        onDone: () => {
          wrapper.remove();
          if (this.timers.get(key)?.fuse === fuse) this.timers.delete(key);
        },
      });
      wrapper.append(fuse.el);
      host.append(wrapper);
      entry = { fuse, name, wrapper };
      this.timers.set(key, entry);
    }
    entry.fuse.set(ms);
  }

  update(state: RoomState, meId: string, offlineMs: number): void {
    const me = state.players.find((p) => p.id === meId);
    if (!me) return;
    if (this.mode === "siege") this.updateSiege(state, me, offlineMs);
    else this.updateConvoy(state, me, offlineMs);
    this.renderTimers();
  }

  private updateSiege(state: RoomState, me: SeatState, offlineMs: number): void {
    const phase = state.phase;
    this.waveText.textContent = phase === "countdown" ? "Countdown" : phase === "intermission" ? "Intermission" : phase === "boss_wave" ? "Boss wave" : `Wave ${Math.min(state.wave, 3)} of 3`;
    this.timer("countdown", "Countdown", "go", phase === "countdown" ? state.phase_remaining_ms : null, this.waveTimer, { onResolve: () => notify("Countdown — go") });
    this.timer("intermission", "Intermission", "go", phase === "intermission" ? state.phase_remaining_ms : null, this.waveTimer, { onResolve: () => notify("Intermission — go") });
    this.credits.value.textContent = `${me.credits} cr`;
    this.score.value.textContent = String(me.score);
    this.health.setAttribute("aria-valuenow", String(me.hp));
    this.healthText.textContent = String(me.hp);
    this.healthFill.style.width = `${me.hp}%`;
    this.health.classList.toggle("is-full", me.hp === 100);
    this.health.classList.toggle("is-low", me.hp < 30);
    this.status.value.textContent = me.status === "up" ? "Up" : me.status === "downed" ? "Downed" : "Out";
    this.status.value.className = `readout-value status-${me.status}`;
    this.ammo.value.textContent = `${me.mag} / ${me.reserve}`;
    this.grenades.value.textContent = String(me.grenades);
    this.timer("reload", "Reload", "reloaded", me.reload_remaining_ms, this.reload, { onResolve: () => this.feedLine("Reloaded") });
    const seen = new Set<string>();
    for (const g of state.grenades) {
      seen.add(`fuse:${g.id}`);
      this.timer(`fuse:${g.id}`, "Grenade fuse", "detonated", g.fuse_remaining_ms, this.reload);
    }
    for (const key of [...this.timers.keys()]) if (key.startsWith("fuse:") && !seen.has(key)) this.timer(key, "Grenade fuse", "detonated", null, this.reload);
    for (const p of state.players) {
      const key = `revive:${p.id}`;
      const before = this.lastStatus.get(p.id);
      this.lastStatus.set(p.id, p.status);
      if (p.status === "downed") this.timer(key, `Revive window ${p.callsign}`, "revived", p.revive_remaining_ms, this.revives);
      else if (before === "downed") this.timer(key, `Revive window ${p.callsign}`, "revived", null, this.revives, { word: p.status === "up" ? "revived" : "out" });
    }
    this.shopButton.disabled = !state.shop.open;
    this.reconnectClock(me, offlineMs, this.reload);
  }

  private reconnectClock(me: SeatState, offlineMs: number, host: HTMLElement): void {
    const stateMs = me.connection === "disconnected" ? me.grace_remaining_ms : null;
    const estimate = offlineMs > 0 ? Math.max(1, 35_000 - offlineMs) : null;
    this.timer("grace", "Reconnect grace", "released", stateMs ?? estimate, host);
  }

  private updateConvoy(state: RoomState, me: SeatState, offlineMs: number): void {
    const vehicle = state.vehicles.find((v) => v.player === me.id);
    if (!vehicle) return;
    this.lap.value.textContent = `Lap ${Math.min(vehicle.laps_done + 1, 3)} of 3`;
    this.checkpoint.value.textContent = vehicle.next_checkpoint === 0 ? "Finish" : `Next checkpoint ${vehicle.next_checkpoint} of 4`;
    this.bestLap.value.textContent = vehicle.best_lap_ms === null ? "—" : formatLap(vehicle.best_lap_ms);
    const racing = state.phase === "race" && vehicle.state !== "finished";
    this.timer("lap", "Lap", "lap", racing ? vehicle.lap_elapsed_ms : null, this.lapClock, { countUp: true });
    this.timer("reset", "Reset", "reset", vehicle.state === "wrecked" ? vehicle.reset_remaining_ms : null, this.resetClock, { onResolve: () => notify("Reset — reset") });
    if (state.phase === "countdown") this.timer("countdown", "Countdown", "go", state.phase_remaining_ms, this.lapClock, { onResolve: () => notify("Countdown — go") });
    else this.timer("countdown", "Countdown", "go", null, this.lapClock);
    this.reconnectClock(me, offlineMs, this.reload);
  }

  /** Focus returns here when the Ammo station closes on its own. */
  focusRoot(): void {
    this.root.focus();
  }
}
