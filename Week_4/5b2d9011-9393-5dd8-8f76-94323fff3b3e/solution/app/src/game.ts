import { api, ApiError, NetworkError } from "./api";
import { Controls, touchControls } from "./controls";
import { Car } from "./convoy";
import { dialogOpen, openDialog, type DialogHandle } from "./dialogs";
import { byId, h } from "./dom";
import { formatLap } from "./format";
import { Hud } from "./hud";
import { Lobby } from "./lobby";
import { heading, openHistory, openSettings } from "./panels";
import { RoomClient } from "./room";
import { ShopDrawer } from "./shop";
import { app, emit, notify, on } from "./state";
import { stage } from "./stage";
import type { GameMap, HistoryMatch, ReportResult, RoomEvent, RoomState } from "./types";

const FIRE_REPEAT_MS = 110;
const INPUT_GAP_MS = 100;
const POSE_MS = 100;
const GRENADE_AHEAD_M = 8;
const DEBRIEF_ATTEMPTS = 6;
const DEBRIEF_RETRY_MS = 300;
const REJECTED_SHOTS: Record<string, string> = { fire_interval: "Too fast", reloading: "Reloading", empty: "Empty — reload" };

let current: Game | null = null;

export function enterRoom(state: RoomState): void {
  current?.dispose();
  const me = app.session;
  if (!me) return;
  current = new Game(state, me.id);
}

function touchLayout(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 0 && window.innerWidth <= 820);
}

export class Game {
  private readonly client: RoomClient;
  private readonly mapMode: "siege" | "convoy";
  private lobby: Lobby | null = null;
  private hud: Hud | null = null;
  private controls: Controls | null = null;
  private touch: HTMLElement | null = null;
  private shopDrawer: ShopDrawer | null = null;
  private pauseDialog: DialogHandle | null = null;
  private debriefed = false;
  private aim = 90;
  private intent = { x: 0, z: 0 };
  private inputSeq = 0;
  private lastInputAt = -Infinity;
  private inputTimer = 0;
  private fireTimer = 0;
  private readonly car = new Car();
  private driving = { throttle: 0, brake: 0, steer: 0 };
  private poseSeq = 0;
  private poseInFlight = false;
  private poseTimer = 0;
  private carFrame = 0;
  private lastCarFrame = 0;
  private vehicleState = "";
  private offlineTimer = 0;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(state: RoomState, private readonly playerId: string) {
    this.client = new RoomClient(state, playerId);
    this.mapMode = state.mode;
    stage().setKind(state.mode);
    void this.loadMap(state.mode === "siege" ? "breakwater-yard" : "saltpan-loop");
    this.unsubscribe.push(
      on("room", (data) => { const d = data as { state: RoomState; events: RoomEvent[] }; this.render(d.state, d.events); }),
      on("connection", () => this.refreshHud()),
      on("report-result", (data) => this.reportResult(data as ReportResult)),
      on("room-gone", (code) => { notify(`Room ${String(code)} has ended.`); void this.leave(); }),
    );
    window.addEventListener("resize", this.syncTouch);
    this.render(state, []);
  }

  private async loadMap(id: string): Promise<void> {
    try {
      stage().setMap(await api<GameMap>("GET", `/api/maps/${id}`));
    } catch {
      return;
    }
  }

  // ---- rendering

  private get state(): RoomState {
    return this.client.state;
  }

  private get seat() {
    return this.client.seat;
  }

  private render(state: RoomState, events: RoomEvent[]): void {
    const me = state.players.find((p) => p.id === this.playerId);
    byId("room-banner").textContent = state.degraded ? "Room paused — the room registry dropped. Timers are frozen and resume when it's back." : "";
    byId("room-banner").classList.toggle("has-text", state.degraded !== null);
    if (!me || me.connection === "left") {
      if (me) notify(`Your seat in ${state.code} was released.`);
      void this.leave(false);
      return;
    }
    if (state.phase === "lobby") {
      if (!this.lobby) {
        this.lobby = new Lobby(state.code, this.playerId, () => void this.leave());
        byId("world").replaceChildren(this.lobby.root);
      }
      this.lobby.update(state);
      return;
    }
    if (!this.hud) this.mountHud(state);
    this.hud?.update(state, this.playerId, this.client.offlineMs);
    this.feed(events);
    this.syncVehicle(state);
    this.syncShop(state);
    stage().setView({ state, me: this.playerId, car: this.mapMode === "convoy" ? this.car : null, aim: this.aim });
    if (state.phase === "over" && !this.debriefed) {
      this.debriefed = true;
      void this.debrief(state);
    }
  }

  private mountHud(state: RoomState): void {
    this.lobby = null;
    this.hud = new Hud(this.mapMode, { shop: () => this.shopOpen(), pause: () => this.pauseOpen() }, (text) => this.hud?.line(text));
    byId("world").replaceChildren(this.hud.root);
    byId("app").classList.add("playing");
    this.aim = this.seat?.aim ?? 90;
    this.controls = new Controls(this, stage(), byId("stage"));
    this.syncTouch();
    if (this.mapMode === "convoy") {
      this.car.restart(state.vehicles.find((v) => v.player === this.playerId) ?? { x: 0, z: 0, heading: 0 });
      this.poseTimer = window.setInterval(() => void this.sendPose(), POSE_MS);
      this.lastCarFrame = performance.now();
      this.carFrame = requestAnimationFrame(this.driveCar);
    }
  }

  private readonly syncTouch = (): void => {
    if (!this.hud) return;
    const wanted = touchLayout();
    if (wanted && !this.touch) {
      this.touch = touchControls(this);
      this.hud.root.append(this.touch);
    } else if (!wanted && this.touch) {
      this.touch.remove();
      this.touch = null;
    }
  };

  private refreshHud(): void {
    window.clearInterval(this.offlineTimer);
    this.hud?.update(this.state, this.playerId, this.client.offlineMs);
    if (!this.client.online) this.offlineTimer = window.setInterval(() => this.hud?.update(this.state, this.playerId, this.client.offlineMs), 500);
  }

  private nameOf(playerId: unknown): string {
    return this.state.players.find((p) => p.id === playerId)?.callsign ?? "A player";
  }

  private feed(events: RoomEvent[]): void {
    const line = (text: string): void => this.hud?.line(text);
    for (const event of events) {
      switch (event.type) {
        case "explosion": if (String(event.source).startsWith("grenade:")) line("Grenade detonated"); break;
        case "player_down": line(`${this.nameOf(event.player)} is down`); break;
        case "player_revived": line(`${this.nameOf(event.player)} revived`); break;
        case "player_out": line(`${this.nameOf(event.player)} is out`); break;
        case "player_respawned": line(`${this.nameOf(event.player)} is back`); break;
        case "wave_cleared": line(Number(event.wave) === 4 ? "Boss wave cleared" : `Wave ${event.wave} cleared`); break;
        case "host_changed": line(`${this.nameOf(event.host)} is now host`); break;
        case "phase": this.phaseLine(event, line); break;
        case "lap": if (event.player === this.playerId) line(`Lap ${event.lap}: ${formatLap(Number(event.lap_ms))}`); break;
        case "wrecked": if (event.player === this.playerId) line(`Wrecked — resetting at checkpoint ${event.checkpoint}`); break;
        case "reset": if (event.player === this.playerId) line("Reset"); break;
      }
    }
  }

  private phaseLine(event: RoomEvent, line: (text: string) => void): void {
    const wave = Number(event.wave);
    if (event.phase === "intermission") line(`Intermission — ${Math.floor(Number(event.remaining_ms) / 1000)} s to ${wave === 3 ? "boss wave" : `wave ${wave + 1}`}`);
    else if (event.phase === "boss_wave") line("Boss wave");
    else if (event.phase === "over" && event.result === "victory") line("Victory");
    else if (event.phase === "over" && event.result === "defeat") line("Defeat");
  }

  private reportResult(result: ReportResult): void {
    if (result.type === "shot" && !result.accepted && result.reason && REJECTED_SHOTS[result.reason]) this.hud?.line(REJECTED_SHOTS[result.reason]);
  }

  private syncShop(state: RoomState): void {
    if (this.shopDrawer && !state.shop.open) {
      this.shopDrawer.close();
      this.shopDrawer = null;
      this.hud?.focusRoot();
    } else this.shopDrawer?.update(state);
  }

  // ---- debrief

  /** The server's credits earned per seat, read from the stored match (it is written moments after the match ends). */
  private async creditsEarned(code: string): Promise<number[]> {
    for (let attempt = 0; attempt < DEBRIEF_ATTEMPTS; attempt++) {
      try {
        const stored = (await api<{ matches: HistoryMatch[] }>("GET", "/api/history?limit=50")).matches.find((m) => m.code === code);
        if (stored) return stored.players.map((p) => p.credits_earned);
      } catch {
        return [];
      }
      await new Promise((resolve) => window.setTimeout(resolve, DEBRIEF_RETRY_MS));
    }
    return [];
  }

  private async debrief(state: RoomState): Promise<void> {
    const earned = await this.creditsEarned(state.code);
    if (current !== this) return;
    const word = state.result === "victory" ? "Victory" : state.result === "defeat" ? "Defeat" : "Ended";
    const table = h("table", { class: "table", "aria-label": "Squad results" },
      h("thead", {}, h("tr", {}, h("th", {}, "Callsign"), h("th", {}, "Score"), h("th", {}, "Kills"), h("th", {}, "Credits earned"))),
      h("tbody", {}, ...state.players.map((p, index) => h("tr", {}, h("td", {}, p.callsign), h("td", {}, String(p.score)), h("td", {}, String(p.kills)), h("td", {}, earned[index] === undefined ? "—" : String(earned[index]))))));
    const history = h("button", { type: "button", class: "btn btn-ghost" }, "View history");
    const back = h("button", { type: "button", class: "btn btn-primary" }, "Back to title");
    const handle = openDialog({ name: "Debrief", scrim: true, content: [heading("Debrief"), h("h3", { class: `result result-${state.result}` }, word), table, h("div", { class: "row-end" }, history, back)], initialFocus: () => back });
    history.addEventListener("click", () => openHistory(history));
    back.addEventListener("click", () => { handle.close(); this.dispose(); emit("left"); });
  }

  // ---- pause, shop

  private pauseOpen(): void {
    if (dialogOpen()) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.pauseDialog = openSettings({ opener, scrim: false, pause: { resume: () => this.pauseDialog?.close(), leave: () => { this.pauseDialog?.close(); void this.leave(); } } });
  }

  private shopOpen(): void {
    if (this.shopDrawer || this.state.phase !== "intermission" || dialogOpen()) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.shopDrawer = new ShopDrawer(this.state.code, opener, this.state, () => { this.shopDrawer = null; });
  }

  // ---- ControlSink

  mode(): "siege" | "convoy" | null {
    return this.hud ? this.mapMode : null;
  }

  playerPosition(): { x: number; z: number } | null {
    const seat = this.seat;
    return seat ? { x: seat.x, z: seat.z } : null;
  }

  aimDegrees(): number {
    return this.aim;
  }

  setAim(degrees: number): void {
    this.aim = degrees;
    stage().setView({ state: this.state, me: this.playerId, car: null, aim: this.aim });
    this.scheduleInput();
  }

  move(x: number, z: number): void {
    if (this.intent.x === x && this.intent.z === z) return;
    this.intent = { x, z };
    this.sendInput();
  }

  private scheduleInput(): void {
    const wait = INPUT_GAP_MS - (performance.now() - this.lastInputAt);
    if (wait <= 0) this.sendInput();
    else if (!this.inputTimer) this.inputTimer = window.setTimeout(() => this.sendInput(), wait);
  }

  private sendInput(): void {
    window.clearTimeout(this.inputTimer);
    this.inputTimer = 0;
    this.lastInputAt = performance.now();
    this.inputSeq += 1;
    api("POST", `/api/rooms/${this.state.code}/input`, { seq: this.inputSeq, move: this.intent, aim: Number(this.aim.toFixed(3)) }).catch((error: unknown) => {
      if (!(error instanceof NetworkError) && !(error instanceof ApiError)) throw error;
    });
  }

  private shootOnce(): void {
    void this.client.report({ type: "shot", aim: Number(this.aim.toFixed(3)) });
  }

  fireStart(): void {
    if (this.fireTimer) return;
    this.shootOnce();
    this.fireTimer = window.setInterval(() => this.shootOnce(), FIRE_REPEAT_MS);
  }

  fireStop(): void {
    window.clearInterval(this.fireTimer);
    this.fireTimer = 0;
  }

  reload(): void {
    void this.client.report({ type: "reload" });
  }

  grenadeAt(x: number, z: number): void {
    void this.client.report({ type: "grenade", target: { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) } });
  }

  grenadeAhead(): void {
    const me = this.playerPosition();
    if (!me) return;
    const radians = (this.aim * Math.PI) / 180;
    this.grenadeAt(me.x + Math.cos(radians) * GRENADE_AHEAD_M, me.z + Math.sin(radians) * GRENADE_AHEAD_M);
  }

  revive(): void {
    const me = this.playerPosition();
    if (!me) return;
    const downed = this.state.players.filter((p) => p.id !== this.playerId && p.status === "downed");
    downed.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    if (downed[0]) void this.client.report({ type: "revive", target_player: downed[0].id });
  }

  shop(): void {
    this.shopOpen();
  }

  timers(): void {
    this.hud?.toggle();
  }

  pause(): void {
    this.pauseOpen();
  }

  // ---- convoy driving

  drive(throttle: number, brake: number, steer: number): void {
    this.driving = { throttle, brake, steer };
  }

  private vehicle() {
    return this.state.vehicles.find((v) => v.player === this.playerId);
  }

  private syncVehicle(state: RoomState): void {
    if (this.mapMode !== "convoy") return;
    const vehicle = state.vehicles.find((v) => v.player === this.playerId);
    if (!vehicle) return;
    if (vehicle.state === "running" && (this.vehicleState !== "running" || state.phase === "countdown")) this.car.restart(vehicle);
    else if (vehicle.state !== "running") this.car.restart(vehicle);
    this.vehicleState = vehicle.state;
  }

  private readonly driveCar = (now: number): void => {
    const dt = Math.min(0.1, (now - this.lastCarFrame) / 1000);
    this.lastCarFrame = now;
    const vehicle = this.vehicle();
    if (this.state.phase === "race" && vehicle?.state === "running") this.car.step(dt, this.driving.throttle, this.driving.brake, this.driving.steer);
    this.carFrame = requestAnimationFrame(this.driveCar);
  };

  private async sendPose(): Promise<void> {
    const vehicle = this.vehicle();
    if (this.poseInFlight || this.state.phase !== "race" || vehicle?.state !== "running" || !this.client.online) return;
    this.poseInFlight = true;
    this.poseSeq += 1;
    const heading = ((this.car.heading % 360) + 360) % 360;
    try {
      const answer = await api<{ accepted: boolean; vehicle: { x: number; z: number; heading: number } }>("POST", `/api/rooms/${this.state.code}/pose`, {
        seq: this.poseSeq, x: Number(this.car.x.toFixed(3)), z: Number(this.car.z.toFixed(3)), heading: Number(heading.toFixed(3)),
      });
      if (!answer.accepted) this.car.snap(answer.vehicle);
    } catch (error) {
      if (!(error instanceof NetworkError) && !(error instanceof ApiError)) throw error;
    } finally {
      this.poseInFlight = false;
    }
  }

  // ---- leaving

  async leave(announce = true): Promise<void> {
    if (current !== this) return;
    if (announce) {
      try {
        await api("POST", `/api/rooms/${this.state.code}/leave`);
      } catch {
        notify("");
      }
    }
    this.dispose();
    emit("left");
  }

  dispose(): void {
    if (current !== this) return;
    current = null;
    this.client.close();
    this.controls?.destroy();
    this.shopDrawer?.close();
    this.pauseDialog?.close();
    this.fireStop();
    window.clearInterval(this.poseTimer);
    window.clearInterval(this.offlineTimer);
    window.clearTimeout(this.inputTimer);
    cancelAnimationFrame(this.carFrame);
    window.removeEventListener("resize", this.syncTouch);
    this.unsubscribe.forEach((fn) => fn());
    byId("room-banner").textContent = "";
    byId("room-banner").classList.remove("has-text");
    byId("app").classList.remove("playing");
    stage().setKind("title");
    stage().setView({ state: null, me: "", car: null, aim: null });
  }
}
