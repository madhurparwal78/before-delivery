// A room session: the snapshot stream, the lobby, the HUD, the input intents, the
// reports with their reconnect buffer, and the convoy driving model.

import { ApiError, RoomState, ShopItem, api } from './api';
import { App, Panel } from './app';
import { comfort } from './comfort';
import { el, on } from './core';
import { feedLine, shotRejection } from './feed';
import { FuseGroup } from './fuseclock';
import { buildConvoyHud, buildShopDrawer, buildSiegeHud, buildTimersList, ConvoyHud, ShopDrawer, SiegeHud } from './hud';
import { buildLobby, LobbyView, openDebrief, openPause } from './panels';
import { closeDialog, OpenDialog, openDialog } from './core';

/** Convoy driving, exactly as the browser models it between poses. */
const car = {
  accelerate: 10,
  topSpeed: 25,
  brake: 20,
  reverseTop: 8,
  coast: 5,
  turnRate: 90,
};

const aimTurnRate = 180;
const inputIntervalMS = 100;
// A stream that has gone this long without a snapshot has stalled, whatever the
// browser says about it.
const streamSilenceMS = 3000;
const poseIntervalMS = 100;
const grenadeAhead = 8;
const grenadeRange = 15;

interface BufferedReport {
  body: Record<string, unknown>;
}

/** RoomSession drives one room from the lobby to the debrief. */
export class RoomSession {
  private app: App;
  private code: string;
  private state: RoomState;
  private clocks = new FuseGroup();

  private lobby: LobbyView | null = null;
  private lobbyPanel: Panel | null = null;
  private siegeHud: SiegeHud | null = null;
  private convoyHud: ConvoyHud | null = null;
  private hudRoot: HTMLElement | null = null;
  private touchRoot: HTMLElement | null = null;
  private shop: ShopDrawer | null = null;
  private shopDialog: OpenDialog | null = null;
  private timers: { root: HTMLElement; refresh: () => void } | null = null;
  private pausePanel: Panel | null = null;

  private stream: EventSource | null = null;
  private connected = true;
  private pendingSnapshot: string | null = null;
  private lastSnapshotAt = 0;
  private buffer: BufferedReport[] = [];
  private reportSeq = 0;
  private reportPrefix = Math.random().toString(36).slice(2, 8);
  private purchaseSeq = 0;

  private held = new Set<string>();
  private pointerAim: number | null = null;
  private inputSeq = 0;
  private aim = 90;
  private moveIntent = { x: 0, z: 0 };
  private sentAim = -1;
  private touchMove = { x: 0, z: 0 };
  private touchAim: number | null = null;
  private touchFire = false;
  private lastFireAt = 0;
  private seenEventSeq = 0;
  private debriefed = false;

  // The browser's local car, which the server judges through poses.
  private localCar = { x: 0, z: 0, heading: 0, speed: 0, started: false };
  private poseSeq = 0;

  private detach: (() => void)[] = [];
  private loop = 0;
  private lastFrame = performance.now();
  private lastInputSent = 0;
  private lastPoseSent = 0;

  constructor(app: App, state: RoomState) {
    this.app = app;
    this.code = state.code;
    this.state = state;
    this.aim = this.self()?.aim ?? 90;
  }

  /** open shows the lobby and starts the stream. */
  open(): void {
    this.app.hideTitle();
    this.app.setRoomSession(this);
    this.openStream();
    this.bindKeys();
    this.startLoop();
    this.applyState(this.state, true);
  }

  /** leave tears the session down. */
  leave(): void {
    window.cancelAnimationFrame(this.loop);
    this.stream?.close();
    this.stream = null;
    for (const off of this.detach) off();
    this.detach = [];
    this.lobbyPanel?.close();
    this.pausePanel?.close();
    this.closeShop();
    this.timers?.root.remove();
    this.hudRoot?.remove();
    this.touchRoot?.remove();
    this.app.setRoomSession(null);
    void api.leave(this.code).catch(() => undefined);
  }

  private self() {
    return this.state.players.find((player) => player.id === this.app.player?.id);
  }

  // ---------- Stream ----------

  private openStream(): void {
    const source = new EventSource(`/api/rooms/${encodeURIComponent(this.code)}/stream`);
    this.stream = source;

    // Snapshots arrive at the server tick rate. Only the latest one matters, so
    // the listener just stashes it and the animation frame applies it. A page
    // that falls behind drops superseded snapshots instead of queueing work.
    source.addEventListener('snapshot', (event) => {
      if (!this.connected) this.onReconnected();
      this.connected = true;
      this.lastSnapshotAt = performance.now();
      this.pendingSnapshot = (event as MessageEvent).data;
    });

    source.addEventListener('error', () => this.dropStream(source));
    this.lastSnapshotAt = performance.now();
  }

  /** dropStream reports the loss and retries about every second, while the
   *  client keeps buffering whatever the player does. */
  private dropStream(source: EventSource): void {
    if (this.connected) {
      this.connected = false;
      this.app.notify('Connection lost — reconnecting. Your seat is held.');
    }
    source.close();
    if (this.stream !== source) return;
    window.setTimeout(() => {
      if (this.stream === source) this.openStream();
    }, 1000);
  }

  /** watchStream notices a stream that has gone quiet without erroring, which a
   *  flaky connection can leave behind, and treats it as a drop. */
  private watchStream(now: number): void {
    const source = this.stream;
    if (!source) return;
    if (now - this.lastSnapshotAt < streamSilenceMS) return;
    this.lastSnapshotAt = now;
    this.dropStream(source);
  }

  private onReconnected(): void {
    const pending = this.buffer;
    this.buffer = [];
    if (pending.length === 0) {
      this.app.notify('Reconnected — 0 buffered reports sent.');
      return;
    }
    void api
      .reportBatch(this.code, pending.map((entry) => entry.body))
      .then(() => this.app.notify(`Reconnected — ${pending.length} buffered reports sent.`))
      .catch((error) => this.app.reportError(error));
  }

  // ---------- State ----------

  private applyState(state: RoomState, first: boolean): void {
    const previousPhase = this.state.phase;
    this.state = state;

    this.app.stage.setSnapshot(state, this.app.player?.id ?? null);
    if (first || previousPhase !== state.phase) {
      this.app.stage.setScene(state.mode === 'convoy' ? 'convoy' : 'siege', undefined);
    }

    if (state.phase === 'lobby') {
      this.showLobby(state);
    } else {
      this.showHud(state);
    }

    if (state.mode === 'convoy') this.syncCar(state);
    this.drainEvents(state);

    if (state.phase === 'over' && !this.debriefed) {
      this.debriefed = true;
      this.finish(state);
    }
  }

  private drainEvents(state: RoomState): void {
    const hud = this.siegeHud ?? this.convoyHud;
    for (const event of state.events) {
      if (event.seq <= this.seenEventSeq) continue;
      this.seenEventSeq = event.seq;
      const line = feedLine(event, state);
      if (line && hud) hud.pushFeed(line);
      if (event.type === 'released' && event.player === this.app.player?.id) {
        this.app.notify(`Your seat in ${state.code} was released.`);
      }
    }
  }

  private showLobby(state: RoomState): void {
    if (!this.lobby) {
      this.lobby = buildLobby(this.app, {
        ready: (ready) => void this.setReady(ready),
        start: () => void this.startMatch(),
        copyInvite: () => void this.copyInvite(),
        leave: () => this.leaveToTitle(),
      });
      this.lobbyPanel = { root: this.lobby.root, close: () => this.lobby?.root.remove() };
      this.app.layer(this.lobby.root);
    }
    this.lobby.update(state);
  }

  private showHud(state: RoomState): void {
    this.lobbyPanel?.close();
    this.lobbyPanel = null;
    this.lobby = null;

    if (!this.hudRoot) {
      if (state.mode === 'convoy') {
        this.convoyHud = buildConvoyHud(this.app, this.clocks);
        this.hudRoot = this.convoyHud.root;
        this.convoyHud.timersButton.addEventListener('click', () => this.toggleTimers(this.convoyHud!.timersButton));
        this.convoyHud.pauseButton.addEventListener('click', () => this.togglePause());
      } else {
        this.siegeHud = buildSiegeHud(this.app, this.clocks);
        this.hudRoot = this.siegeHud.root;
        this.siegeHud.timersButton.addEventListener('click', () => this.toggleTimers(this.siegeHud!.timersButton));
        this.siegeHud.pauseButton.addEventListener('click', () => this.togglePause());
        this.siegeHud.shopButton.addEventListener('click', () => this.openShop(this.siegeHud!.shopButton));
      }
      this.app.layer(this.hudRoot);
      this.buildTouchControls(state.mode);
    }

    this.siegeHud?.update(state);
    this.convoyHud?.update(state);

    // The drawer closes on its own when the intermission ends.
    if (this.shopDialog && !state.shop.open) this.closeShop(true);
    if (this.shop && state.shop.open) {
      this.shop.update(state.shop.items, this.self()?.credits ?? 0);
    }
    this.timers?.refresh();
  }

  /** finish shows the Debrief over the HUD. The HUD stays so the last readouts
   *  and the closing match-feed lines remain on screen, with its controls spent. */
  private finish(state: RoomState): void {
    this.app.stage.setSnapshot(state, this.app.player?.id ?? null);
    this.touchRoot?.remove();
    this.touchRoot = null;
    this.closeShop();
    this.timers?.root.remove();
    this.timers = null;
    this.pausePanel?.close();
    this.pausePanel = null;
    for (const button of this.hudRoot?.querySelectorAll('button') ?? []) {
      (button as HTMLButtonElement).disabled = true;
    }
    window.cancelAnimationFrame(this.loop);
    this.stream?.close();
    this.stream = null;
    this.app.setRoomSession(null);
    openDebrief(this.app, state, () => {
      this.hudRoot?.remove();
      this.hudRoot = null;
      this.siegeHud = null;
      this.convoyHud = null;
      for (const off of this.detach) off();
      this.detach = [];
    });
  }

  private leaveToTitle(): void {
    this.leave();
    this.app.closePanel();
    this.app.showTitle();
    this.app.focusStartBar();
  }

  // ---------- Lobby actions ----------

  private async setReady(ready: boolean): Promise<void> {
    try {
      const state = await api.ready(this.code, ready);
      this.applyState(state, false);
      this.app.notify(ready ? "You're ready." : "You're not ready.");
    } catch (error) {
      this.app.notify(this.app.errorCopy(error, { wrong_phase: 'The match has already started.' }));
    }
  }

  private async startMatch(): Promise<void> {
    this.app.notify('Starting match…');
    try {
      const state = await api.start(this.code);
      this.applyState(state, false);
      this.app.notify('Match starting.');
    } catch (error) {
      this.app.notify(
        this.app.errorCopy(error, {
          not_all_ready: 'Everyone must be ready first.',
          not_host: 'Only the host can start.',
        }),
      );
    }
  }

  private async copyInvite(): Promise<void> {
    const invite = `${window.location.origin}/room/${this.code}`;
    try {
      await navigator.clipboard.writeText(invite);
      this.app.notify(`Invite copied — ${invite}`);
    } catch {
      this.app.notify(`Invite link: ${invite}`);
    }
  }

  // ---------- Shop ----------

  private openShop(opener: HTMLElement | null): void {
    if (this.shopDialog || !this.state.shop.open) return;
    this.shop = buildShopDrawer(this.clocks, {
      buy: (item, button) => void this.buy(item, button),
      close: () => this.closeShop(),
    });
    this.app.layer(this.shop.root);
    const entry: OpenDialog = {
      root: this.shop.root,
      opener,
      close: () => this.closeShop(),
    };
    openDialog(entry);
    this.shopDialog = entry;
    this.shop.update(this.state.shop.items, this.self()?.credits ?? 0);
    this.shop.focusFirst();
  }

  /** closeShop shuts the drawer and hands focus back to the HUD region when the
   *  intermission ended on its own. */
  private closeShop(intermissionEnded = false): void {
    if (!this.shopDialog) return;
    const entry = this.shopDialog;
    this.shopDialog = null;
    if (intermissionEnded) entry.opener = null;
    closeDialog(entry);
    this.shop = null;
    if (intermissionEnded) {
      this.siegeHud?.focusRegion();
    }
  }

  private async buy(item: ShopItem, button: HTMLButtonElement): Promise<void> {
    this.purchaseSeq += 1;
    const purchaseID = `${this.reportPrefix}-buy-${this.purchaseSeq}`;
    button.disabled = true;
    this.app.notify(`Buying ${item.name}…`);
    try {
      const result = await api.purchase(this.code, purchaseID, item.item);
      this.app.notify(`Bought ${item.name} for ${result.unit_price} cr.`);
    } catch (error) {
      this.app.notify(
        this.app.errorCopy(error, {
          shop_closed: 'The ammo station is closed until the next intermission.',
          insufficient_credits: `Not enough credits — ${item.name} costs ${item.price} cr.`,
          at_capacity: "You're carrying as many as you can.",
        }),
      );
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Timers list and pause ----------

  private toggleTimers(button: HTMLButtonElement): void {
    if (this.timers) {
      this.timers.root.remove();
      this.timers = null;
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    this.timers = buildTimersList(this.clocks);
    this.app.layer(this.timers.root);
    button.setAttribute('aria-expanded', 'true');
  }

  private togglePause(): void {
    if (this.pausePanel) {
      this.pausePanel.close();
      this.pausePanel = null;
      return;
    }
    this.pausePanel = openPause(this.app, {
      resume: () => {
        const panel = this.pausePanel;
        this.pausePanel = null;
        panel?.close();
      },
      leave: () => {
        this.pausePanel = null;
        this.leaveToTitle();
      },
    });
  }

  // ---------- Reports ----------

  private sendReport(body: Record<string, unknown>, onResult?: (reason: string | null) => void): void {
    if (!this.connected) {
      this.buffer.push({ body });
      return;
    }
    void api
      .report(this.code, body)
      .then((result) => onResult?.(result.reason))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 0) {
          this.buffer.push({ body });
          return;
        }
        this.app.reportError(error);
      });
  }

  private nextReportID(): string {
    this.reportSeq += 1;
    return `${this.reportPrefix}-${this.reportSeq}`;
  }

  private fire(): void {
    const now = performance.now();
    // Holding Fire repeats no faster than the server's fire interval.
    if (now - this.lastFireAt < 100) return;
    this.lastFireAt = now;
    this.sendReport({ report_id: this.nextReportID(), type: 'shot', aim: round1(this.aim) }, (reason) => {
      const line = shotRejection(reason);
      if (line) this.siegeHud?.pushFeed(line);
    });
  }

  private reload(): void {
    this.sendReport({ report_id: this.nextReportID(), type: 'reload' });
  }

  private throwGrenade(target?: { x: number; z: number }): void {
    const self = this.self();
    if (!self) return;
    let point = target;
    if (!point) {
      const radians = (this.aim * Math.PI) / 180;
      point = { x: self.x + Math.cos(radians) * grenadeAhead, z: self.z + Math.sin(radians) * grenadeAhead };
    }
    // A pointer throw is clamped to grenade range.
    const dx = point.x - self.x;
    const dz = point.z - self.z;
    const distance = Math.hypot(dx, dz);
    if (distance > grenadeRange) {
      point = { x: self.x + (dx / distance) * grenadeRange, z: self.z + (dz / distance) * grenadeRange };
    }
    this.sendReport({
      report_id: this.nextReportID(),
      type: 'grenade',
      target: { x: round1(point.x), z: round1(point.z) },
    });
  }

  /** revive targets the nearest downed teammate. */
  private revive(): void {
    const self = this.self();
    if (!self) return;
    let nearest: string | null = null;
    let best = Infinity;
    for (const player of this.state.players) {
      if (player.id === self.id || player.status !== 'downed') continue;
      const distance = Math.hypot(player.x - self.x, player.z - self.z);
      if (distance < best) {
        best = distance;
        nearest = player.id;
      }
    }
    if (!nearest) return;
    this.sendReport({ report_id: this.nextReportID(), type: 'revive', target_player: nearest });
  }

  // ---------- Input ----------

  private bindKeys(): void {
    const typing = (target: EventTarget | null): boolean => {
      const node = target as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || node.isContentEditable;
    };

    this.detach.push(
      on(document, 'keydown', (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          // Pause is always Escape, and the dialog manager handles open dialogs.
          if (this.shopDialog || this.pausePanel || this.app.currentPanel()) return;
          ev.preventDefault();
          this.togglePause();
          return;
        }
        if (typing(ev.target) || ev.repeat) return;
        // Game keys work whichever HUD control has focus, and are ignored only
        // while another dialog is open.
        if (this.pausePanel || this.app.currentPanel()) return;

        const action = comfort.actionForCode(ev.code);
        if (!action) return;
        if (this.state.mode === 'convoy' && !action.startsWith('move_') && action !== 'timers') return;

        this.held.add(action);
        switch (action) {
          case 'fire':
            ev.preventDefault();
            this.fire();
            break;
          case 'reload':
            this.reload();
            break;
          case 'grenade':
            this.throwGrenade();
            break;
          case 'revive':
            this.revive();
            break;
          case 'shop':
            this.openShop(this.siegeHud?.shopButton ?? null);
            break;
          case 'timers': {
            const button = this.siegeHud?.timersButton ?? this.convoyHud?.timersButton;
            if (button) this.toggleTimers(button);
            break;
          }
          default:
            break;
        }
      }),
      on(document, 'keyup', (ev: KeyboardEvent) => {
        const action = comfort.actionForCode(ev.code);
        if (action) this.held.delete(action);
      }),
      on(window, 'blur', () => this.held.clear()),
      on(document, 'pointermove', (ev: PointerEvent) => this.trackPointer(ev)),
      on(document, 'pointerdown', (ev: PointerEvent) => {
        if (this.state.mode === 'convoy' || this.pausePanel || this.app.currentPanel()) return;
        if ((ev.target as HTMLElement)?.closest('button, input, select, [role="dialog"]')) return;
        this.trackPointer(ev);
        if (ev.button === 2) return;
        this.fire();
      }),
      on(document, 'contextmenu', (ev: MouseEvent) => {
        if (this.state.mode === 'convoy' || this.pausePanel || this.app.currentPanel()) return;
        if ((ev.target as HTMLElement)?.closest('button, input, select, [role="dialog"]')) return;
        ev.preventDefault();
        this.throwGrenade(this.pointerTarget(ev));
      }),
    );
  }

  /** trackPointer turns the aim towards the pointer. The match camera holds a
   *  fixed bearing, so screen right is east and screen up is north. */
  private trackPointer(ev: PointerEvent | MouseEvent): void {
    if (this.state.mode === 'convoy') return;
    const dx = ev.clientX - window.innerWidth / 2;
    const dy = ev.clientY - window.innerHeight / 2;
    if (Math.hypot(dx, dy) < 12) return;
    this.pointerAim = normalise((Math.atan2(-dy, dx) * 180) / Math.PI);
    this.app.stage.aimAt(ev.clientX / window.innerWidth, ev.clientY / window.innerHeight);
  }

  /** pointerTarget turns a pointer position into a world point near the player. */
  private pointerTarget(ev: MouseEvent): { x: number; z: number } | undefined {
    const self = this.self();
    if (!self) return undefined;
    const dx = ev.clientX - window.innerWidth / 2;
    const dy = ev.clientY - window.innerHeight / 2;
    const metresPerPixel = 22 / Math.min(window.innerWidth, window.innerHeight);
    return { x: self.x + dx * metresPerPixel, z: self.z - dy * metresPerPixel };
  }

  private startLoop(): void {
    const step = () => {
      this.loop = window.requestAnimationFrame(step);
      const now = performance.now();
      const delta = Math.min((now - this.lastFrame) / 1000, 0.1);
      this.lastFrame = now;

      this.watchStream(now);
      if (this.pendingSnapshot !== null) {
        const raw = this.pendingSnapshot;
        this.pendingSnapshot = null;
        this.applyState(JSON.parse(raw) as RoomState, false);
      }

      this.clocks.tick();
      this.timers?.refresh();

      if (this.state.phase === 'lobby') {
        this.lobby?.inviteClock.tick();
        return;
      }
      if (this.state.mode === 'convoy') {
        this.driveCar(delta, now);
        return;
      }
      this.updateAim(delta);
      this.updateMove(now);
      if (this.held.has('fire') || this.touchFire) this.fire();
    };
    this.loop = window.requestAnimationFrame(step);
  }

  private updateAim(delta: number): void {
    if (this.touchAim !== null) {
      this.aim = this.touchAim;
      return;
    }
    if (this.held.has('aim_left')) this.aim = normalise(this.aim + aimTurnRate * delta);
    else if (this.held.has('aim_right')) this.aim = normalise(this.aim - aimTurnRate * delta);
    else if (this.pointerAim !== null) this.aim = this.pointerAim;
  }

  /** updateMove sends an intent only when it or the aim has actually moved. The
   *  server keeps the latest intent, so repeating an unchanged one would be
   *  traffic for nothing. */
  private updateMove(now: number): void {
    let x = this.touchMove.x;
    let z = this.touchMove.z;
    if (x === 0 && z === 0) {
      if (this.held.has('move_left')) x -= 1;
      if (this.held.has('move_right')) x += 1;
      if (this.held.has('move_up')) z += 1;
      if (this.held.has('move_down')) z -= 1;
    }

    const aim = round1(this.aim);
    const moved = x !== this.moveIntent.x || z !== this.moveIntent.z;
    const turned = Math.abs(aim - this.sentAim) >= 1;
    if (!moved && !turned) return;
    if (now - this.lastInputSent < inputIntervalMS) return;

    this.moveIntent = { x, z };
    this.sentAim = aim;
    this.lastInputSent = now;
    this.inputSeq += 1;
    void api.input(this.code, this.inputSeq, { x: clamp(x), z: clamp(z) }, aim).catch(() => undefined);
  }

  // ---------- Convoy driving ----------

  private syncCar(state: RoomState): void {
    const vehicle = state.vehicles.find((entry) => entry.player === this.app.player?.id);
    if (!vehicle) {
      this.localCar.started = false;
      return;
    }
    // At race start, after each reset and whenever the car is not running, the
    // browser holds it at the server's position.
    if (!this.localCar.started || vehicle.state !== 'running') {
      this.localCar = { x: vehicle.x, z: vehicle.z, heading: vehicle.heading, speed: 0, started: true };
      this.poseSeq = vehicle.last_seq;
    }
  }

  private driveCar(delta: number, now: number): void {
    const vehicle = this.state.vehicles.find((entry) => entry.player === this.app.player?.id);
    if (!vehicle || this.state.phase !== 'race' || vehicle.state !== 'running') return;

    const throttle = this.held.has('move_up') ? 1 : Math.max(0, this.touchMove.z);
    const brake = this.held.has('move_down') ? 1 : Math.max(0, -this.touchMove.z);
    let steer = 0;
    if (this.held.has('move_left')) steer += 1;
    if (this.held.has('move_right')) steer -= 1;
    if (steer === 0) steer = -this.touchMove.x;

    const local = this.localCar;
    if (throttle > 0) {
      local.speed = Math.min(local.speed + car.accelerate * throttle * delta, car.topSpeed);
    } else if (brake > 0) {
      local.speed -= car.brake * brake * delta;
      if (local.speed < -car.reverseTop) local.speed = -car.reverseTop;
    } else if (local.speed > 0) {
      local.speed = Math.max(0, local.speed - car.coast * delta);
    } else if (local.speed < 0) {
      local.speed = Math.min(0, local.speed + car.coast * delta);
    }

    if (local.speed !== 0 && steer !== 0) {
      local.heading = normalise(local.heading + car.turnRate * steer * delta);
    }
    const radians = (local.heading * Math.PI) / 180;
    local.x += Math.cos(radians) * local.speed * delta;
    local.z += Math.sin(radians) * local.speed * delta;

    // The car drives on through the island, a block or the map edge: the pose
    // reaches the server, which judges the wreck.
    if (now - this.lastPoseSent < poseIntervalMS) return;
    this.lastPoseSent = now;
    this.poseSeq += 1;
    const seq = this.poseSeq;
    void api
      .pose(this.code, seq, round3(local.x), round3(local.z), round1(local.heading))
      .then((result) => {
        if (result.accepted) return;
        // A refused pose snaps the car to the server's vehicle.
        this.localCar = {
          x: result.vehicle.x,
          z: result.vehicle.z,
          heading: result.vehicle.heading,
          speed: 0,
          started: true,
        };
        this.poseSeq = Math.max(this.poseSeq, result.vehicle.last_seq);
      })
      .catch(() => undefined);
  }

  // ---------- Touch ----------

  private buildTouchControls(mode: string): void {
    if (!matchMedia('(pointer: coarse)').matches && !('ontouchstart' in window)) return;

    const moveStick = this.buildStick('Move stick', 'move', (x, z) => {
      this.touchMove = { x, z };
    });
    const nodes: HTMLElement[] = [moveStick];
    const actions = el('div', { class: 'touch-actions' });

    if (mode !== 'convoy') {
      nodes.push(
        this.buildStick('Aim stick', 'aim', (x, z) => {
          this.touchAim = x === 0 && z === 0 ? null : normalise((Math.atan2(z, x) * 180) / Math.PI);
        }),
      );
      const fire = this.touchButton('Fire', () => this.fire());
      fire.addEventListener('pointerdown', () => {
        this.touchFire = true;
      });
      for (const event of ['pointerup', 'pointercancel', 'pointerleave']) {
        fire.addEventListener(event, () => {
          this.touchFire = false;
        });
      }
      actions.append(fire, this.touchButton('Reload', () => this.reload()), this.touchButton('Grenade', () => this.throwGrenade()));
    }
    actions.appendChild(this.touchButton('Pause', () => this.togglePause()));

    this.touchRoot = el('div', { class: 'touch-layer' }, ...nodes, actions);
    this.app.layer(this.touchRoot);
  }

  private touchButton(label: string, handler: () => void): HTMLButtonElement {
    const button = el('button', { class: 'btn-ghost', type: 'button' }, label) as HTMLButtonElement;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', handler);
    return button;
  }

  /** buildStick drives a move or aim intent from the thumb's offset divided by
   *  the stick radius. */
  private buildStick(
    label: string,
    kind: 'move' | 'aim',
    report: (x: number, z: number) => void,
  ): HTMLElement {
    const thumb = el('div', { class: 'thumb' });
    const stick = el('div', { class: `stick ${kind}`, role: 'group', 'aria-label': label }, thumb);
    let active = false;

    const place = (ev: PointerEvent) => {
      const box = stick.getBoundingClientRect();
      const radius = box.width / 2;
      let dx = ev.clientX - (box.left + radius);
      let dy = ev.clientY - (box.top + radius);
      const length = Math.hypot(dx, dy);
      if (length > radius) {
        dx = (dx / length) * radius;
        dy = (dy / length) * radius;
      }
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;
      report(dx / radius, -dy / radius);
    };

    stick.addEventListener('pointerdown', (ev) => {
      active = true;
      stick.setPointerCapture(ev.pointerId);
      place(ev);
    });
    stick.addEventListener('pointermove', (ev) => {
      if (active) place(ev);
    });
    for (const event of ['pointerup', 'pointercancel']) {
      stick.addEventListener(event, () => {
        active = false;
        thumb.style.transform = '';
        report(0, 0);
      });
    }
    return stick;
  }
}

function normalise(degrees: number): number {
  let value = degrees % 360;
  if (value < 0) value += 360;
  return value;
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, Math.round(value * 1000) / 1000));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
