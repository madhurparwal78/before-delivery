import {
  DeviceId,
  CreatureId,
  Definition,
  HARBOUR_GENERATION,
  GENERATION_PERIOD,
  LIMITS,
  deviceById,
  creatureById,
  DeviceSeed,
  CreatureSeed,
} from './seed.js';
import { Rng, rngLaneChoice, divDown } from './numeric.js';

// ---------- Public wire shapes ----------

export type CommandType = 'deploy' | 'upgrade' | 'salvage';

export interface Command {
  seq: number;
  tick: number;
  type: CommandType | string;
  lane: number;
  cell: number;
  device: DeviceId | string | null;
}

export type TransferReason =
  | 'initial'
  | 'harbour-generation'
  | 'collector-generation'
  | 'deploy'
  | 'upgrade'
  | 'salvage-refund'
  | 'salvage-loss';

export interface Transfer {
  movementId: number;
  tick: number;
  account: string; // 'reserve' | 'source' | 'sink' | 'installed:<entityId>'
  delta: number;
  reason: TransferReason;
  deviceId: number | null;
}

export type Tier = 'base' | 'upgraded';

export interface DeviceState {
  id: number;
  device: DeviceId;
  lane: number;
  cell: number;
  tier: Tier;
  installedCharge: number;
  nextFireTick: number | null;
}

export interface CreatureState {
  id: number;
  creature: CreatureId;
  lane: number;
  position: number;
  health: number;
  movements: number;
}

export type Outcome = 'victory' | 'defeat' | null;

export interface DamageEvent {
  kind: 'damage';
  tick: number;
  deviceId: number;
  targetId: number;
  lane: number;
  cell: number;
  damage: number;
  resultingHealth: number;
}

export interface DeathEvent {
  kind: 'death';
  tick: number;
  creatureId: number;
  lane: number;
  cell: number;
}

export interface BreachEvent {
  kind: 'breach';
  tick: number;
  creatureId: number;
  lane: number;
  cell: number;
}

export type SimEvent = DamageEvent | DeathEvent | BreachEvent;

export interface Metrics {
  outcome: 'victory' | 'defeat';
  breaches: number;
  completionTick: number;
  remainingCharge: number;
  health: number;
}

export interface Failure {
  tick: number;
  seq: number | null;
  reason: string;
}

export interface Frame {
  tick: number;
  rngState: number;
  nextEntityId: number;
  nextMovementId: number;
  health: number;
  breaches: number;
  reserve: number;
  source: number;
  sink: number;
  devices: DeviceState[];
  creatures: CreatureState[];
  spawned: number[];
  events: SimEvent[];
  transfers: Transfer[];
  outcome: Outcome;
}

export interface CommandState {
  tick: number;
  rngState: number;
  nextEntityId: number;
  nextMovementId: number;
  health: number;
  breaches: number;
  reserve: number;
  source: number;
  sink: number;
  devices: DeviceState[];
  creatures: CreatureState[];
  spawned: number[];
  events: SimEvent[];
  transfers: Transfer[];
  outcome: Outcome;
  phase: 'after-commands';
}

// ---------- Internal mutable state ----------

interface Install {
  id: number;
  device: DeviceId;
  lane: number;
  cell: number;
  tier: Tier;
  installedCharge: number;
  nextFireTick: number | null;
}

interface Beast {
  id: number;
  creature: CreatureId;
  lane: number;
  position: number;
  health: number;
  movements: number;
}

interface PreparedHit {
  attacker: Install;
  target: Beast;
}

export type CommandReason =
  | 'Unknown command'
  | 'Command sequence is not increasing'
  | 'Command tick moved backwards'
  | 'Command follows terminal state'
  | 'Invalid cell'
  | 'Device is outside the loadout'
  | 'Cell is occupied'
  | 'No installed device'
  | 'Device is already upgraded'
  | 'Insufficient charge';

export function contactCell(position: number): number {
  const clamped = Math.min(8999, Math.max(0, position));
  return 1 + divDown(clamped, 1000);
}

export function deviceCentre(cell: number): number {
  return 1000 * cell - 500;
}

/** Per-hit damage with independent armour, minimum one unless ignored. */
export function creatureDamage(attacker: DeviceSeed, target: CreatureSeed): number {
  const armour = attacker.ignoresArmour ? 0 : target.armour;
  return Math.max(1, attacker.damage - armour);
}

/**
 * Pure deterministic simulation of one run. Browser play, forecasts, replay,
 * frame production and server verification all drive this single module.
 */
export class Simulation {
  readonly definition: Definition;
  readonly loadout: DeviceId[];
  readonly initialReserve: number;
  readonly initialHealth: number;

  tick = 0;
  private rngState: number;
  nextEntityId = 1;
  nextMovementId = 1;
  health: number;
  breaches = 0;
  reserve: number;
  source = 0;
  sink = 0;
  private installs: Install[] = [];
  private beasts: Beast[] = [];
  spawned: number[];
  private events: SimEvent[] = [];
  private transfers: Transfer[] = [];
  private outcomeValue: Outcome = null;
  private lastTransfers: Transfer[] = [];

  constructor(definition: Definition, loadout: DeviceId[], initialReserve: number, initialHealth: number, seed: number) {
    this.definition = definition;
    this.loadout = loadout.slice();
    this.initialReserve = initialReserve;
    this.initialHealth = initialHealth;
    this.health = initialHealth;
    this.reserve = initialReserve;
    this.spawned = definition.waves.map(() => 0);
    this.rngState = seed >>> 0;
    this.addMovement('source', -initialReserve, 'reserve', initialReserve, 'initial', null, 0);
  }

  get rng(): number {
    return this.rngState;
  }

  set rng(value: number) {
    this.rngState = value >>> 0;
  }

  get outcome(): Outcome {
    return this.outcomeValue;
  }

  get terminal(): boolean {
    return this.outcomeValue !== null;
  }

  get allTransfers(): Transfer[] {
    return this.transfers;
  }

  get transferCount(): number {
    return this.transfers.length;
  }

  private nextDraw(): number {
    const rng = new Rng(this.rngState);
    const draw = rng.next();
    this.rngState = rng.stateValue;
    return draw;
  }

  private addMovement(
    debitAccount: string,
    debitDelta: number,
    creditAccount: string,
    creditDelta: number,
    reason: TransferReason,
    deviceId: number | null,
    tick: number,
  ): void {
    this.transfers.push({ movementId: this.nextMovementId, tick, account: debitAccount, delta: debitDelta, reason, deviceId });
    this.transfers.push({ movementId: this.nextMovementId, tick, account: creditAccount, delta: creditDelta, reason, deviceId });
    this.nextMovementId++;
  }

  // ---------- Cell and installation queries ----------

  isBoardCell(lane: number, cell: number): boolean {
    return (
      Number.isInteger(lane) && Number.isInteger(cell) &&
      lane >= 1 && lane <= LIMITS.lanes &&
      cell >= 1 && cell <= LIMITS.cellsPerLane
    );
  }

  isBuildable(lane: number, cell: number): boolean {
    return this.definition.buildable.some((b) => b.lane === lane && b.cell === cell);
  }

  installAt(lane: number, cell: number): Install | undefined {
    return this.installs.find((i) => i.lane === lane && i.cell === cell);
  }

  installations(): Install[] {
    return this.installs.slice();
  }

  creatureList(): Beast[] {
    return this.beasts.slice();
  }

  // ---------- Command legality (single source of reason decisions) ----------

  commandReason(cmd: Command, lastSeq: number | null, lastTick: number | null): CommandReason | null {
    if (cmd.type !== 'deploy' && cmd.type !== 'upgrade' && cmd.type !== 'salvage') return 'Unknown command';
    if (lastSeq !== null && cmd.seq <= lastSeq) return 'Command sequence is not increasing';
    if (lastTick !== null && cmd.tick < lastTick) return 'Command tick moved backwards';
    if (this.terminal) return 'Command follows terminal state';
    if (cmd.type === 'deploy') {
      if (!this.isBoardCell(cmd.lane, cmd.cell) || !this.isBuildable(cmd.lane, cmd.cell)) return 'Invalid cell';
      const seed = deviceById(cmd.device ?? '');
      if (!seed || !this.loadout.includes(cmd.device as DeviceId)) return 'Device is outside the loadout';
      if (this.installAt(cmd.lane, cmd.cell)) return 'Cell is occupied';
      if (this.reserve - seed.cost < 0) return 'Insufficient charge';
    } else {
      if (!this.isBoardCell(cmd.lane, cmd.cell)) return 'Invalid cell';
      const install = this.installAt(cmd.lane, cmd.cell);
      if (!install) return 'No installed device';
      if (cmd.type === 'upgrade') {
        if (install.tier !== 'base') return 'Device is already upgraded';
        const seed = deviceById(install.device) as DeviceSeed;
        if (this.reserve - seed.upgradeCost < 0) return 'Insufficient charge';
      }
    }
    return null;
  }

  /** Applies a command already validated as legal; records its paired transfers. */
  applyLegalCommand(cmd: Command): void {
    if (cmd.type === 'deploy') {
      const seed = deviceById(cmd.device as string) as DeviceSeed;
      const install: Install = {
        id: this.nextEntityId++,
        device: seed.id,
        lane: cmd.lane,
        cell: cmd.cell,
        tier: 'base',
        installedCharge: seed.cost,
        nextFireTick: cmd.tick,
      };
      this.installs.push(install);
      this.addMovement('reserve', -seed.cost, `installed:${install.id}`, seed.cost, 'deploy', install.id, cmd.tick);
      this.reserve -= seed.cost;
    } else if (cmd.type === 'upgrade') {
      const install = this.installAt(cmd.lane, cmd.cell) as Install;
      const seed = deviceById(install.device) as DeviceSeed;
      install.tier = 'upgraded';
      install.installedCharge += seed.upgradeCost;
      this.addMovement('reserve', -seed.upgradeCost, `installed:${install.id}`, seed.upgradeCost, 'upgrade', install.id, cmd.tick);
      this.reserve -= seed.upgradeCost;
    } else if (cmd.type === 'salvage') {
      const install = this.installAt(cmd.lane, cmd.cell) as Install;
      const refund = divDown(install.installedCharge, 2);
      const loss = install.installedCharge - refund;
      this.addMovement(`installed:${install.id}`, -refund, 'reserve', refund, 'salvage-refund', install.id, cmd.tick);
      if (loss > 0) {
        this.addMovement(`installed:${install.id}`, -loss, 'sink', loss, 'salvage-loss', install.id, cmd.tick);
      }
      this.installs = this.installs.filter((i) => i !== install);
      this.reserve += refund;
    }
  }

  // ---------- Tick resolution in published numbered order ----------

  /**
   * Resolves the current tick t, producing frame t+1. Commands stamped t must
   * already be applied by the caller through applyLegalCommand; `transfersBefore`
   * is the transfer-array length before those commands were applied, so the
   * frame holds that transition's transfers (commands at t, generation at t+1).
   */
  resolveTick(transfersBefore: number): void {
    const t = this.tick;

    this.spawnDue(t);
    this.moveCreatures();
    const prepared = this.prepareAttacks(t);
    this.applyDamage(prepared, t);
    this.removeDead();
    this.generate(t);
    this.processBreaches(t);
    this.decideTerminal(t);

    const tickEvents = this.events.slice();
    this.events = [];
    this.lastTransfers = this.transfers.slice(transfersBefore);
    this.tick = t + 1;
    this.frameCache = {
      tick: this.tick,
      events: tickEvents,
      transfers: this.lastTransfers,
      outcome: this.outcomeValue,
    };
  }

  private frameCache: { tick: number; events: SimEvent[]; transfers: Transfer[]; outcome: Outcome } | null = null;

  /** The initial frame (tick 0, before any command) — events and transfers hold starting allocation. */
  buildInitialFrame(): Frame {
    return {
      tick: 0,
      rngState: this.rngState,
      nextEntityId: this.nextEntityId,
      nextMovementId: this.nextMovementId,
      health: this.health,
      breaches: this.breaches,
      reserve: this.reserve,
      source: this.source,
      sink: this.sink,
      devices: [],
      creatures: [],
      spawned: this.spawned.slice(),
      events: [],
      transfers: this.transfers.slice(),
      outcome: null,
    };
  }

  /** State immediately after resolving the previous tick (frame t+1 contents). */
  get currentFrame(): Frame | null {
    if (!this.frameCache) return null;
    return this.buildFrame(this.frameCache.tick, this.frameCache.events, this.frameCache.transfers, this.frameCache.outcome);
  }

  /** Frame before resolving tick `tick` (commands stamped tick not yet applied). */
  frameBefore(tick: number): Frame {
    return this.buildFrame(tick, [], [], this.outcomeValue && this.tick > tick ? this.outcomeValue : null);
  }

  /**
   * CommandState snapshot: current state including commands applied at the
   * current tick, with events empty and transfers limited to those commands.
   * `since` is the transfer-array length before those commands were applied.
   */
  commandStateSnapshot(since: number): Omit<CommandState, 'phase'> {
    return this.buildFrame(this.tick, [], this.transfers.slice(since), null);
  }

  private buildFrame(tick: number, events: SimEvent[], transfers: Transfer[], outcome: Outcome): Frame {
    return {
      tick,
      rngState: this.rngState,
      nextEntityId: this.nextEntityId,
      nextMovementId: this.nextMovementId,
      health: this.health,
      breaches: this.breaches,
      reserve: this.reserve,
      source: this.source,
      sink: this.sink,
      devices: this.installs
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((i) => ({
          id: i.id,
          device: i.device,
          lane: i.lane,
          cell: i.cell,
          tier: i.tier,
          installedCharge: i.installedCharge,
          nextFireTick: i.nextFireTick,
        })),
      creatures: this.beasts
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((b) => ({
          id: b.id,
          creature: b.creature,
          lane: b.lane,
          position: b.position,
          health: b.health,
          movements: b.movements,
        })),
      spawned: this.spawned.slice(),
      events,
      transfers,
      outcome,
    };
  }

  private spawnDue(t: number): void {
    this.definition.waves.forEach((wave, waveIndex) => {
      while (this.spawned[waveIndex] < wave.count) {
        const i = this.spawned[waveIndex];
        const spawnTick = wave.tick + i * wave.interval;
        if (spawnTick !== t) break;
        const draw = this.nextDraw();
        const lane = wave.lane === 0 ? rngLaneChoice(draw, LIMITS.lanes) : wave.lane;
        this.beasts.push({
          id: this.nextEntityId++,
          creature: wave.creature,
          lane,
          position: 8999,
          health: (creatureById(wave.creature) as CreatureSeed).health,
          movements: 0,
        });
        this.spawned[waveIndex]++;
      }
    });
  }

  private moveCreatures(): void {
    // Walls use pre-movement positions; the strongest applicable divisor applies once.
    const factors = new Map<number, number>();
    for (const beast of this.beasts) {
      let divisor = 1;
      for (const install of this.installs) {
        if (install.device !== 'wall' || install.lane !== beast.lane) continue;
        if (Math.abs(beast.position - deviceCentre(install.cell)) <= 1000) {
          const d = install.tier === 'upgraded' ? 4 : 2;
          if (d > divisor) divisor = d;
        }
      }
      factors.set(beast.id, divisor);
    }
    for (const beast of this.beasts) {
      const divisor = factors.get(beast.id) ?? 1;
      const seed = creatureById(beast.creature) as CreatureSeed;
      beast.position -= divDown(seed.speed, divisor);
      beast.movements++;
      const lc = seed.laneChange;
      if (lc && beast.movements % lc.everyMovements === 0) {
        beast.lane = beast.lane + lc.laneDelta;
        if (beast.lane > LIMITS.lanes) beast.lane = 1;
      }
    }
  }

  private prepareAttacks(t: number): PreparedHit[] {
    const hits: PreparedHit[] = [];
    const attackers = this.installs
      .filter((i) => (deviceById(i.device) as DeviceSeed).damage > 0)
      .sort((a, b) => a.id - b.id);
    for (const attacker of attackers) {
      const seed = deviceById(attacker.device) as DeviceSeed;
      if (attacker.nextFireTick !== null && t < attacker.nextFireTick) continue;
      const targets = this.beasts
        .filter(
          (b) =>
            seed.laneOffsets.includes(b.lane - attacker.lane) &&
            Math.abs(b.position - deviceCentre(attacker.cell)) <= (seed.range ?? 0),
        )
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .slice(0, seed.maxTargets);
      if (targets.length === 0) continue;
      attacker.nextFireTick = t + (seed.cooldown ?? 0);
      for (const target of targets) hits.push({ attacker, target });
    }
    return hits;
  }

  private applyDamage(hits: PreparedHit[], t: number): void {
    if (hits.length === 0) return;
    const preHealth = new Map<number, number>();
    for (const beast of this.beasts) preHealth.set(beast.id, beast.health);
    const totalPerTarget = new Map<number, number>();
    for (const hit of hits) {
      const dmg = creatureDamage(deviceById(hit.attacker.device) as DeviceSeed, creatureById(hit.target.creature) as CreatureSeed);
      totalPerTarget.set(hit.target.id, (totalPerTarget.get(hit.target.id) ?? 0) + dmg);
    }
    const attackersInOrder: Install[] = [];
    for (const hit of hits) {
      if (!attackersInOrder.includes(hit.attacker)) attackersInOrder.push(hit.attacker);
    }
    attackersInOrder.sort((a, b) => a.id - b.id);
    for (const attacker of attackersInOrder) {
      for (const hit of hits) {
        if (hit.attacker !== attacker) continue;
        this.events.push({
          kind: 'damage',
          tick: t + 1,
          deviceId: attacker.id,
          targetId: hit.target.id,
          lane: hit.target.lane,
          cell: contactCell(hit.target.position),
          damage: creatureDamage(deviceById(attacker.device) as DeviceSeed, creatureById(hit.target.creature) as CreatureSeed),
          resultingHealth: (preHealth.get(hit.target.id) ?? 0) - (totalPerTarget.get(hit.target.id) ?? 0),
        });
      }
    }
    for (const [targetId, total] of totalPerTarget) {
      const beast = this.beasts.find((b) => b.id === targetId);
      if (beast) beast.health -= total;
    }
  }

  private removeDead(): void {
    const dead = this.beasts.filter((b) => b.health <= 0).sort((a, b) => a.id - b.id);
    for (const beast of dead) {
      this.events.push({
        kind: 'death',
        tick: this.tick + 1,
        creatureId: beast.id,
        lane: beast.lane,
        cell: contactCell(beast.position),
      });
    }
    this.beasts = this.beasts.filter((b) => b.health > 0);
  }

  private generate(t: number): void {
    if (t % GENERATION_PERIOD !== 0) return;
    this.addMovement('source', -HARBOUR_GENERATION, 'reserve', HARBOUR_GENERATION, 'harbour-generation', null, t + 1);
    this.reserve += HARBOUR_GENERATION;
    this.source -= HARBOUR_GENERATION;
    const collectors = this.installs
      .filter((i) => (deviceById(i.device) as DeviceSeed).generation > 0)
      .sort((a, b) => a.id - b.id);
    for (const collector of collectors) {
      const seed = deviceById(collector.device) as DeviceSeed;
      const amount = collector.tier === 'upgraded' ? seed.generation * 2 : seed.generation;
      this.addMovement('source', -amount, 'reserve', amount, 'collector-generation', collector.id, t + 1);
      this.reserve += amount;
      this.source -= amount;
    }
  }

  private processBreaches(t: number): void {
    const survivors = this.beasts.filter((b) => b.position <= 0).sort((a, b) => a.id - b.id);
    for (const beast of survivors) {
      this.events.push({ kind: 'breach', tick: t + 1, creatureId: beast.id, lane: beast.lane, cell: 1 });
      this.breaches++;
    }
    this.beasts = this.beasts.filter((b) => b.position > 0);
    this.health = Math.max(0, this.health - survivors.length);
  }

  private decideTerminal(t: number): void {
    if (this.health === 0) {
      this.outcomeValue = 'defeat';
      return;
    }
    const allSpawned = this.spawned.every((count, index) => count === this.definition.waves[index].count);
    if (allSpawned && this.beasts.length === 0) {
      this.outcomeValue = 'victory';
      return;
    }
    if (t + 1 >= LIMITS.maxCompletedTicks) {
      this.outcomeValue = 'defeat';
      return;
    }
  }
  metrics(): Metrics {
    return {
      outcome: this.outcomeValue ?? 'defeat',
      breaches: this.breaches,
      completionTick: this.tick,
      remainingCharge: this.reserve,
      health: this.health,
    };
  }

  /** Deep clone for forecasting; the source is never advanced by cloning. */
  clone(): Simulation {
    const copy = new Simulation(this.definition, this.loadout, this.initialReserve, this.initialHealth, 1);
    copy.tick = this.tick;
    copy.rngState = this.rngState;
    copy.nextEntityId = this.nextEntityId;
    copy.nextMovementId = this.nextMovementId;
    copy.health = this.health;
    copy.breaches = this.breaches;
    copy.reserve = this.reserve;
    copy.source = this.source;
    copy.sink = this.sink;
    copy.spawned = this.spawned.slice();
    copy.outcomeValue = this.outcomeValue;
    this.installs.forEach((i) => copy.installEntity({ ...i }));
    this.beasts.forEach((b) => copy.spawnEntity({ ...b }));
    copy.transfers = this.transfers.map((tr) => ({ ...tr }));
    copy.tick = this.tick;
    return copy;
  }

  private installEntity(install: Install): void {
    this.installs.push(install);
  }

  private spawnEntity(beast: Beast): void {
    this.beasts.push(beast);
  }
}
