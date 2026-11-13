import { Definition, DeviceId, LIMITS, INITIAL_RESERVE, INITIAL_HEALTH, MISSING_TERMINAL_REASON } from './seed.js';
import { Simulation, Command, Frame, Metrics, Failure, Transfer } from './sim.js';

export interface RunReplayOutcome {
  frames: Frame[];             // frames[0] is the initial frame (tick 0)
  terminalFrame: Frame | null;  // the frame at which the run ended (outcome != null)
  metrics: Metrics | null;
  failure: Failure | null;
  ledger: Transfer[];
  legalPrefix: Command[];       // commands applied before the first illegal one
}

export interface ReplayOptions {
  stopAtTick?: number;         // resolve at most through this tick
  collectFrames?: boolean;
}

/**
 * Replays commands against a fresh simulation. The single reproduction path for
 * browser play, forecasts, replay and server verification.
 */
export function replayRun(
  definition: Definition,
  loadout: DeviceId[],
  seed: number,
  commands: Command[],
  endTick: number,
  options: ReplayOptions = {},
): RunReplayOutcome {
  const sim = new Simulation(definition, loadout, INITIAL_RESERVE, INITIAL_HEALTH, seed);
  const frames: Frame[] = [];
  if (options.collectFrames !== false) {
    frames.push(sim.buildInitialFrame());
  }
  let failure: Failure | null = null;
  let lastSeq: number | null = null;
  let lastTick: number | null = null;
  const legalLog: Command[] = [];

  // Sequence and tick ordering are log-wide: check them across the full log first,
  // stopping the legal prefix at the first ordering violation.
  const commandsByTick = new Map<number, Command[]>();
  let orderingFailure: Failure | null = null;
  for (const cmd of commands) {
    if (orderingFailure === null) {
      if (lastSeq !== null && cmd.seq <= lastSeq) {
        orderingFailure = { tick: cmd.tick, seq: cmd.seq, reason: 'Command sequence is not increasing' };
      } else if (lastTick !== null && cmd.tick < lastTick) {
        orderingFailure = { tick: cmd.tick, seq: cmd.seq, reason: 'Command tick moved backwards' };
      } else {
        lastSeq = cmd.seq;
        lastTick = cmd.tick;
        legalLog.push(cmd);
        const list = commandsByTick.get(cmd.tick) ?? [];
        list.push(cmd);
        commandsByTick.set(cmd.tick, list);
      }
    }
  }
  failure = orderingFailure;

  // Advance tick-by-tick, validating state-dependent legality in tick context.
  const stopTick = Math.min(endTick, LIMITS.maxCompletedTicks);
  let applied: Command[] = [];
  if (failure === null) {
    let stopped = false;
    while (!sim.terminal && sim.tick < stopTick) {
      const tickCommands = commandsByTick.get(sim.tick) ?? [];
      const mark = sim.transferCount;
      for (const cmd of tickCommands) {
        const reason = sim.commandReason(cmd, null, null);
        if (reason !== null) {
          failure = { tick: cmd.tick, seq: cmd.seq, reason: reason as string };
          stopped = true;
          break;
        }
        sim.applyLegalCommand(cmd);
        applied.push(cmd);
      }
      if (stopped) break;
      sim.resolveTick(mark);
      if (options.collectFrames !== false) {
        frames.push(sim.currentFrame as Frame);
      }
    }
  }

  // After stopping, remaining commands are inspected for terminal violations.
  if (failure === null) {
    for (let j = applied.length; j < commands.length; j++) {
      const cmd = commands[j];
      const reason = sim.commandReason(cmd, null, null);
      if (reason !== null) {
        failure = { tick: cmd.tick, seq: cmd.seq, reason: reason as string };
        break;
      }
    }
  }

  const terminalFrame = sim.terminal ? (sim.currentFrame as Frame) : null;
  const metrics: Metrics | null = sim.terminal ? sim.metrics() : null;

  if (failure === null && !sim.terminal) {
    failure = { tick: endTick, seq: null, reason: MISSING_TERMINAL_REASON };
  }

  return {
    frames,
    terminalFrame,
    metrics,
    failure,
    ledger: sim.allTransfers,
    legalPrefix: applied,
  };
}

/** Forecast comparison of one proposed command against no command over up to 100 transitions. */
export function forecast(
  source: Simulation,
  proposal: Command | null,
  horizon = 100,
): { proposalBranch: Frame[]; baselineBranch: Frame[] } {
  const proposalBranchSim = source.clone();
  if (proposal) {
    const reason = proposalBranchSim.commandReason(proposal, null, null);
    if (reason === null) proposalBranchSim.applyLegalCommand(proposal);
  }
  const baselineSim = source.clone();
  const proposalFrames: Frame[] = [];
  const baselineFrames: Frame[] = [];
  for (let step = 0; step < horizon; step++) {
    if (proposalBranchSim.terminal) break;
    proposalBranchSim.resolveTick(proposalBranchSim.transferCount);
    proposalFrames.push(proposalBranchSim.currentFrame as Frame);
    if (baselineSim.terminal) break;
    baselineSim.resolveTick(baselineSim.transferCount);
    baselineFrames.push(baselineSim.currentFrame as Frame);
  }
  return {
    proposalBranch: proposalFrames,
    baselineBranch: baselineFrames,
  };
}
