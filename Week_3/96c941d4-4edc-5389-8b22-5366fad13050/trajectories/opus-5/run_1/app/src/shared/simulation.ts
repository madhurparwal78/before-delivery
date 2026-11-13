import {
  CELL_WIDTH,
  CELLS_PER_LANE,
  FORECAST_TRANSITIONS,
  GENERATION_PERIOD,
  HARBOUR_GENERATION,
  INITIAL_ENTITY_ID,
  INITIAL_MOVEMENT_ID,
  LANES,
  LIMITS,
  SALVAGE_REFUND_DIVISOR,
  SPAWN_POSITION,
  UPGRADE_DAMAGE_MULTIPLIER,
  UPGRADE_GENERATION_MULTIPLIER,
  creatureSpec,
  deviceSpec,
  isDeviceId,
} from './constants.js';
import type {
  Command,
  CommandState,
  Frame,
  FrameCreature,
  FrameDevice,
  FrameEvent,
  Outcome,
  SimulationConfig,
  Transfer,
} from './types.js';

/** Division rounding half away from zero, the published gameplay default. */
export function divideHalfAwayFromZero(numerator: number, denominator: number): number {
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const a = Math.abs(numerator);
  const b = Math.abs(denominator);
  return sign * Math.floor((2 * a + b) / (2 * b));
}

export function nextRandom(state: number): number {
  let x = state;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x;
}

export function contactCell(position: number): number {
  return 1 + Math.floor(Math.min(Math.max(position, 0), SPAWN_POSITION) / CELL_WIDTH);
}

export function deviceCentre(cell: number): number {
  return CELL_WIDTH * cell - CELL_WIDTH / 2;
}

export function scheduledCreatureTotal(config: SimulationConfig): number {
  return config.definition.waves.reduce((total, wave) => total + wave.count, 0);
}

export function installationAt(frame: Frame, lane: number, cell: number): FrameDevice | undefined {
  return frame.devices.find((d) => d.lane === lane && d.cell === cell);
}

function cloneFrame(frame: Frame): Frame {
  return {
    tick: frame.tick,
    rngState: frame.rngState,
    nextEntityId: frame.nextEntityId,
    nextMovementId: frame.nextMovementId,
    health: frame.health,
    breaches: frame.breaches,
    reserve: frame.reserve,
    source: frame.source,
    sink: frame.sink,
    devices: frame.devices.map((d) => ({ ...d })),
    creatures: frame.creatures.map((c) => ({ ...c })),
    spawned: [...frame.spawned],
    events: [],
    transfers: [],
    outcome: frame.outcome,
  };
}

export function initialFrame(config: SimulationConfig): Frame {
  const movementId = INITIAL_MOVEMENT_ID;
  const amount = config.initialReserve;
  return {
    tick: 0,
    rngState: config.definition.seed,
    nextEntityId: INITIAL_ENTITY_ID,
    nextMovementId: movementId + 1,
    health: config.initialHealth,
    breaches: 0,
    reserve: amount,
    source: -amount,
    sink: 0,
    devices: [],
    creatures: [],
    spawned: config.definition.waves.map(() => 0),
    events: [],
    transfers: [
      { movementId, tick: 0, account: 'source', delta: -amount, reason: 'initial', deviceId: null },
      { movementId, tick: 0, account: 'reserve', delta: amount, reason: 'initial', deviceId: null },
    ],
    outcome: null,
  };
}

function onBoard(lane: number, cell: number): boolean {
  return lane >= 1 && lane <= LANES && cell >= 1 && cell <= CELLS_PER_LANE;
}

function isBuildable(config: SimulationConfig, lane: number, cell: number): boolean {
  return config.definition.buildable.some((b) => b.lane === lane && b.cell === cell);
}

export interface CommandContext {
  previousSeq: number | null;
  previousTick: number | null;
}

/** First applicable command refusal reason, or null when legal against this pre-command state. */
export function commandRefusal(
  frame: Frame,
  command: Command,
  config: SimulationConfig,
  context: CommandContext,
): string | null {
  if (command.type !== 'deploy' && command.type !== 'upgrade' && command.type !== 'salvage') {
    return 'Unknown command';
  }
  if (context.previousSeq !== null && command.seq <= context.previousSeq) {
    return 'Command sequence is not increasing';
  }
  if (context.previousTick !== null && command.tick < context.previousTick) {
    return 'Command tick moved backwards';
  }
  if (frame.outcome !== null) return 'Command follows terminal state';

  if (command.type === 'deploy') {
    if (!onBoard(command.lane, command.cell) || !isBuildable(config, command.lane, command.cell)) {
      return 'Invalid cell';
    }
    if (
      command.device === null ||
      !isDeviceId(command.device) ||
      !config.loadout.includes(command.device)
    ) {
      return 'Device is outside the loadout';
    }
    if (installationAt(frame, command.lane, command.cell) !== undefined) return 'Cell is occupied';
    if (frame.reserve - deviceSpec(command.device).cost < 0) return 'Insufficient charge';
    return null;
  }

  if (!onBoard(command.lane, command.cell)) return 'Invalid cell';
  const installed = installationAt(frame, command.lane, command.cell);
  if (installed === undefined) return 'No installed device';
  if (command.type === 'salvage') return null;
  if (installed.tier === 'upgraded') return 'Device is already upgraded';
  if (frame.reserve - deviceSpec(installed.device).upgradeCost < 0) return 'Insufficient charge';
  return null;
}

function pushPair(
  frame: Frame,
  tick: number,
  debitAccount: string,
  creditAccount: string,
  amount: number,
  reason: Transfer['reason'],
  entityId: number | null,
): void {
  const movementId = frame.nextMovementId;
  frame.nextMovementId += 1;
  frame.transfers.push({
    movementId,
    tick,
    account: debitAccount,
    delta: -amount,
    reason,
    deviceId: debitAccount.startsWith('installed:') ? entityId : null,
  });
  frame.transfers.push({
    movementId,
    tick,
    account: creditAccount,
    delta: amount,
    reason,
    deviceId: creditAccount.startsWith('installed:') ? entityId : null,
  });
}

/** Applies one legal command to a frame in its after-commands phase. */
export function applyCommand(frame: Frame, command: Command): void {
  const tick = frame.tick;
  if (command.type === 'deploy') {
    const spec = deviceSpec(command.device as string);
    const id = frame.nextEntityId;
    frame.nextEntityId += 1;
    frame.devices.push({
      id,
      device: spec.id,
      lane: command.lane,
      cell: command.cell,
      tier: 'base',
      installedCharge: spec.cost,
      nextFireTick: spec.cooldown === null ? null : tick,
    });
    frame.devices.sort((a, b) => a.id - b.id);
    frame.reserve -= spec.cost;
    pushPair(frame, tick, 'reserve', `installed:${id}`, spec.cost, 'deploy', id);
    return;
  }
  const installed = installationAt(frame, command.lane, command.cell) as FrameDevice;
  if (command.type === 'upgrade') {
    const spec = deviceSpec(installed.device);
    installed.tier = 'upgraded';
    installed.installedCharge += spec.upgradeCost;
    frame.reserve -= spec.upgradeCost;
    pushPair(
      frame,
      tick,
      'reserve',
      `installed:${installed.id}`,
      spec.upgradeCost,
      'upgrade',
      installed.id,
    );
    return;
  }
  const total = installed.installedCharge;
  const refund = Math.floor(total / SALVAGE_REFUND_DIVISOR);
  const loss = total - refund;
  const account = `installed:${installed.id}`;
  installed.installedCharge = 0;
  frame.devices = frame.devices.filter((d) => d.id !== installed.id);
  frame.reserve += refund;
  frame.sink += loss;
  pushPair(frame, tick, account, 'reserve', refund, 'salvage-refund', installed.id);
  pushPair(frame, tick, account, 'sink', loss, 'salvage-loss', installed.id);
}

/** Produces the after-commands phase state for the commands stamped at this frame's tick. */
export function applyCommandsPhase(frame: Frame, commands: Command[]): Frame {
  const next = cloneFrame(frame);
  for (const command of commands) applyCommand(next, command);
  return next;
}

function spawnDue(frame: Frame, config: SimulationConfig): void {
  const waves = config.definition.waves;
  let spawned = false;
  for (let w = 0; w < waves.length; w += 1) {
    const wave = waves[w];
    for (let index = 0; index < wave.count; index += 1) {
      if (wave.tick + index * wave.interval !== frame.tick) continue;
      const draw = nextRandom(frame.rngState);
      frame.rngState = draw;
      const spec = creatureSpec(wave.creature);
      const id = frame.nextEntityId;
      frame.nextEntityId += 1;
      frame.creatures.push({
        id,
        creature: spec.id,
        lane: wave.lane === 0 ? 1 + (draw % LANES) : wave.lane,
        position: SPAWN_POSITION,
        health: spec.health,
        movements: 0,
      });
      frame.spawned[w] += 1;
      spawned = true;
    }
  }
  if (spawned) frame.creatures.sort((a, b) => a.id - b.id);
}

function slowdownDivisorFor(frame: Frame, creature: FrameCreature): number {
  let divisor = 1;
  for (const device of frame.devices) {
    const spec = deviceSpec(device.device);
    if (spec.slowdownDivisor === null || spec.range === null || device.lane !== creature.lane) continue;
    if (Math.abs(creature.position - deviceCentre(device.cell)) > spec.range) continue;
    const applicable =
      device.tier === 'upgraded' ? (spec.upgradedSlowdownDivisor as number) : spec.slowdownDivisor;
    if (applicable > divisor) divisor = applicable;
  }
  return divisor;
}

function moveCreatures(frame: Frame): void {
  for (const creature of frame.creatures) {
    const divisor = slowdownDivisorFor(frame, creature);
    const base = creatureSpec(creature.creature).speed;
    creature.position -= divisor === 1 ? base : divideHalfAwayFromZero(base, divisor);
    creature.movements += 1;
  }
  for (const creature of frame.creatures) {
    const change = creatureSpec(creature.creature).laneChange;
    if (change === null || creature.movements % change.everyMovements !== 0) continue;
    const moved = creature.lane + change.laneDelta;
    creature.lane = moved > LANES ? moved - LANES : moved;
  }
}

interface PreparedHit {
  deviceId: number;
  targetId: number;
  damage: number;
  ignoresArmour: boolean;
}

function prepareAttacks(frame: Frame): PreparedHit[] {
  const hits: PreparedHit[] = [];
  for (const device of frame.devices) {
    const spec = deviceSpec(device.device);
    if (spec.cooldown === null || device.nextFireTick === null || frame.tick < device.nextFireTick) {
      continue;
    }
    const lanes = new Set(spec.laneOffsets.map((offset) => device.lane + offset));
    const centre = deviceCentre(device.cell);
    const range = spec.range as number;
    const targets = frame.creatures
      .filter((c) => lanes.has(c.lane) && Math.abs(c.position - centre) <= range)
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .slice(0, spec.maxTargets);
    if (targets.length === 0) continue;
    const damage = device.tier === 'upgraded' ? spec.damage * UPGRADE_DAMAGE_MULTIPLIER : spec.damage;
    for (const target of targets) {
      hits.push({ deviceId: device.id, targetId: target.id, damage, ignoresArmour: spec.ignoresArmour });
    }
    device.nextFireTick = frame.tick + spec.cooldown;
  }
  return hits;
}

function applyDamage(frame: Frame, hits: PreparedHit[]): void {
  if (hits.length === 0) return;
  const eventTick = frame.tick + 1;
  const byId = new Map(frame.creatures.map((c) => [c.id, c]));
  const effective = hits.map((hit) => {
    const armour = creatureSpec((byId.get(hit.targetId) as FrameCreature).creature).armour;
    return hit.ignoresArmour ? hit.damage : Math.max(1, hit.damage - armour);
  });
  const totals = new Map<number, number>();
  hits.forEach((hit, index) => {
    totals.set(hit.targetId, (totals.get(hit.targetId) ?? 0) + effective[index]);
  });
  const resulting = new Map<number, number>();
  for (const [id, total] of totals) {
    const target = byId.get(id) as FrameCreature;
    resulting.set(id, target.health - total);
    target.health -= total;
  }
  hits.forEach((hit, index) => {
    const target = byId.get(hit.targetId) as FrameCreature;
    frame.events.push({
      kind: 'damage',
      tick: eventTick,
      deviceId: hit.deviceId,
      targetId: hit.targetId,
      lane: target.lane,
      cell: contactCell(target.position),
      damage: effective[index],
      resultingHealth: resulting.get(hit.targetId) as number,
    });
  });
}

function removeDead(frame: Frame): void {
  const dead = frame.creatures.filter((c) => c.health <= 0);
  if (dead.length === 0) return;
  for (const creature of dead) {
    frame.events.push({
      kind: 'death',
      tick: frame.tick + 1,
      creatureId: creature.id,
      lane: creature.lane,
      cell: contactCell(creature.position),
    });
  }
  frame.creatures = frame.creatures.filter((c) => c.health > 0);
}

function generate(frame: Frame): void {
  const eventTick = frame.tick + 1;
  if (eventTick % GENERATION_PERIOD !== 0) return;
  pushPair(frame, eventTick, 'source', 'reserve', HARBOUR_GENERATION, 'harbour-generation', null);
  frame.reserve += HARBOUR_GENERATION;
  frame.source -= HARBOUR_GENERATION;
  for (const device of frame.devices) {
    const spec = deviceSpec(device.device);
    if (spec.generation === 0) continue;
    const amount =
      device.tier === 'upgraded' ? spec.generation * UPGRADE_GENERATION_MULTIPLIER : spec.generation;
    pushPair(frame, eventTick, 'source', 'reserve', amount, 'collector-generation', null);
    frame.reserve += amount;
    frame.source -= amount;
  }
}

function resolveBreaches(frame: Frame): void {
  const breached = frame.creatures.filter((c) => c.position <= 0);
  if (breached.length === 0) return;
  for (const creature of breached) {
    frame.events.push({
      kind: 'breach',
      tick: frame.tick + 1,
      creatureId: creature.id,
      lane: creature.lane,
      cell: 1,
    });
    frame.breaches += 1;
    frame.health = Math.max(0, frame.health - 1);
  }
  frame.creatures = frame.creatures.filter((c) => c.position > 0);
}

function decideOutcome(frame: Frame, config: SimulationConfig): Outcome | null {
  if (frame.health === 0) return 'defeat';
  const spawned = frame.spawned.reduce((sum, count) => sum + count, 0);
  if (spawned === scheduledCreatureTotal(config) && frame.creatures.length === 0) return 'victory';
  if (frame.tick >= LIMITS.maxCompletedTicks) return 'defeat';
  return null;
}

/** Resolves the remaining tick order from an after-commands state into the next frame. */
export function resolveAfterCommands(afterCommands: Frame, config: SimulationConfig): Frame {
  const frame = afterCommands;
  spawnDue(frame, config);
  moveCreatures(frame);
  applyDamage(frame, prepareAttacks(frame));
  removeDead(frame);
  generate(frame);
  resolveBreaches(frame);
  frame.tick += 1;
  frame.outcome = decideOutcome(frame, config);
  return frame;
}

/** Resolves frame t with the commands stamped t into frame t+1. */
export function resolveTick(frame: Frame, commands: Command[], config: SimulationConfig): Frame {
  return resolveAfterCommands(applyCommandsPhase(frame, commands), config);
}

export interface LogRunOutcome {
  lastAvailableTick: number;
  ledger: Transfer[];
  terminal: Frame | null;
  failure: { tick: number; seq: number | null; reason: string } | null;
}

const ORDERING_REASONS = new Set([
  'Unknown command',
  'Command sequence is not increasing',
  'Command tick moved backwards',
]);

/**
 * Independently reproduces a command log from tick zero, stopping at the first illegal command
 * while retaining the legal prefix's ledger.
 */
export function runCommandLog(
  config: SimulationConfig,
  commands: Command[],
  endTick: number,
): LogRunOutcome {
  let frame = initialFrame(config);
  const ledger: Transfer[] = [...frame.transfers];
  let previousSeq: number | null = null;
  let previousTick: number | null = null;
  let staged = applyCommandsPhase(frame, []);

  const advanceTo = (target: number): void => {
    while (frame.outcome === null && frame.tick < target && frame.tick < endTick) {
      frame = resolveAfterCommands(staged, config);
      ledger.push(...frame.transfers);
      staged = applyCommandsPhase(frame, []);
    }
  };

  for (const command of commands) {
    const ordering = commandRefusal(frame, command, config, { previousSeq, previousTick });
    if (ordering !== null && ORDERING_REASONS.has(ordering)) {
      return {
        lastAvailableTick: frame.tick,
        ledger,
        terminal: null,
        failure: { tick: command.tick, seq: command.seq, reason: ordering },
      };
    }
    previousSeq = command.seq;
    previousTick = command.tick;
    advanceTo(command.tick);
    const refusal = commandRefusal(staged, command, config, { previousSeq: null, previousTick: null });
    if (refusal !== null) {
      ledger.push(...staged.transfers);
      return {
        lastAvailableTick: frame.tick,
        ledger,
        terminal: null,
        failure: { tick: command.tick, seq: command.seq, reason: refusal },
      };
    }
    applyCommand(staged, command);
  }

  advanceTo(endTick);
  if (frame.outcome !== null) {
    return { lastAvailableTick: frame.tick, ledger, terminal: frame, failure: null };
  }
  ledger.push(...staged.transfers);
  return {
    lastAvailableTick: frame.tick,
    ledger,
    terminal: null,
    failure: { tick: endTick, seq: null, reason: 'Run has no terminal outcome' },
  };
}

export type ProposalCheck = { refusal: string } | { state: CommandState };

/**
 * Independently reconstructs the command prefix to atTick, applies that tick's prefix commands in
 * supplied order, then validates and applies the proposal before spawning.
 */
export function checkProposal(
  config: SimulationConfig,
  commands: Command[],
  atTick: number,
  proposal: Command,
): ProposalCheck {
  let frame = initialFrame(config);
  let staged = applyCommandsPhase(frame, []);
  let previousSeq: number | null = null;
  let previousTick: number | null = null;

  const advanceTo = (target: number): void => {
    while (frame.outcome === null && frame.tick < target) {
      frame = resolveAfterCommands(staged, config);
      staged = applyCommandsPhase(frame, []);
    }
  };

  for (const command of commands) {
    const ordering = commandRefusal(frame, command, config, { previousSeq, previousTick });
    if (ordering !== null && ORDERING_REASONS.has(ordering)) return { refusal: ordering };
    previousSeq = command.seq;
    previousTick = command.tick;
    advanceTo(command.tick);
    const refusal = commandRefusal(staged, command, config, { previousSeq: null, previousTick: null });
    if (refusal !== null) return { refusal };
    applyCommand(staged, command);
  }

  advanceTo(atTick);
  const refusal = commandRefusal(staged, proposal, config, { previousSeq, previousTick });
  if (refusal !== null) return { refusal };
  applyCommand(staged, proposal);
  return { state: { ...staged, phase: 'after-commands' } };
}

/** Reproduces the inclusive-exclusive frame window [from,to) of a legal command log. */
export function frameWindow(
  config: SimulationConfig,
  commands: Command[],
  endTick: number,
  from: number,
  to: number,
): Frame[] {
  const byTick = new Map<number, Command[]>();
  for (const command of commands) {
    const bucket = byTick.get(command.tick);
    if (bucket === undefined) byTick.set(command.tick, [command]);
    else bucket.push(command);
  }
  const out: Frame[] = [];
  let frame = initialFrame(config);
  while (frame.tick < to) {
    if (frame.tick >= from) out.push(frame);
    if (frame.outcome !== null || frame.tick >= endTick) break;
    frame = resolveTick(frame, byTick.get(frame.tick) ?? [], config);
  }
  return out;
}

export interface NumberedForecastEvent {
  number: number;
  event: FrameEvent;
}

export interface ForecastBranch {
  label: 'proposed' | 'none';
  frames: Frame[];
  events: NumberedForecastEvent[];
  endpointTick: number;
  endpointReserve: number;
}

export interface ForecastResult {
  immediateCost: number;
  proposed: ForecastBranch;
  none: ForecastBranch;
}

function runBranch(
  frozen: Frame,
  config: SimulationConfig,
  command: Command | null,
  label: 'proposed' | 'none',
): ForecastBranch {
  let frame = applyCommandsPhase(frozen, command === null ? [] : [command]);
  const frames: Frame[] = [];
  const events: NumberedForecastEvent[] = [];
  let numbered = 0;
  for (let step = 0; step < FORECAST_TRANSITIONS; step += 1) {
    frame = resolveAfterCommands(frame, config);
    frames.push(frame);
    for (const event of frame.events) {
      numbered += 1;
      events.push({ number: numbered, event });
    }
    if (frame.outcome !== null) break;
    frame = applyCommandsPhase(frame, []);
  }
  return { label, frames, events, endpointTick: frame.tick, endpointReserve: frame.reserve };
}

function proposalCost(frozen: Frame, proposal: Command): number {
  if (proposal.type === 'deploy') return deviceSpec(proposal.device as string).cost;
  const installed = installationAt(frozen, proposal.lane, proposal.cell) as FrameDevice;
  if (proposal.type === 'upgrade') return deviceSpec(installed.device).upgradeCost;
  return -Math.floor(installed.installedCharge / SALVAGE_REFUND_DIVISOR);
}

/**
 * Lantern Cast: compares one proposed command against no new command from one frozen state,
 * never mutating or advancing the source.
 */
export function forecast(
  frozen: Frame,
  config: SimulationConfig,
  proposal: Command,
): ForecastResult {
  return {
    immediateCost: proposalCost(frozen, proposal),
    proposed: runBranch(frozen, config, proposal, 'proposed'),
    none: runBranch(frozen, config, null, 'none'),
  };
}
