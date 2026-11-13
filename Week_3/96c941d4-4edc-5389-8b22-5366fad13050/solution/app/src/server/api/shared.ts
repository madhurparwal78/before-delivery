import {
  CREATURE_IDS,
  DEVICE_IDS,
  DIFFICULTIES,
  LIMITS,
  isCreatureId,
} from '../../shared/constants.js';
import type { Definition, Metrics, Ticket, Wave } from '../../shared/types.js';
import { ApiError } from '../errors.js';
import type { ChallengeRecord, LevelRecord, ProofRecord, RunRecord, Store, StoredTicket } from '../store.js';
import {
  Problems,
  checkEnum,
  checkNoControlCharacters,
  checkRange,
  checkTextLength,
  elementObject,
  readArray,
  readInteger,
  readString,
  rejectUnknown,
} from '../validation.js';

export function publicTicket(ticket: StoredTicket): Ticket {
  return {
    id: ticket.id,
    accountId: ticket.accountId,
    mode: ticket.mode,
    sourceId: ticket.sourceId,
    revision: ticket.revision,
    seed: ticket.seed,
    levelDigest: ticket.levelDigest,
    loadout: ticket.loadout,
    ruleset: ticket.ruleset,
    initialReserve: ticket.initialReserve,
    initialHealth: ticket.initialHealth,
    seasonDay: ticket.seasonDay,
    daily: ticket.daily,
  };
}

export function publicResult(run: RunRecord): Record<string, unknown> | null {
  if (run.state === 'issued' || run.state === 'playing') return null;
  return {
    runId: run.id,
    state: run.state,
    evidenceDigest: run.evidenceDigest,
    metrics: run.state === 'accepted' ? run.metrics : null,
    failure: run.state === 'rejected' ? run.failure : null,
  };
}

function publicProof(proof: ProofRecord): Record<string, unknown> {
  return { runId: proof.runId, revision: proof.revision, state: proof.state };
}

export function publicLevel(
  level: LevelRecord,
  proofs: ProofRecord[],
  indexing: 'pending' | 'current',
): Record<string, unknown> {
  return {
    id: level.id,
    revision: level.revision,
    state: level.state,
    definition: level.definition,
    digest: level.digest,
    proofRunId: level.proofRunId,
    challengeDigest: level.challengeDigest,
    proofs: proofs.map(publicProof),
    indexing,
  };
}

export function publicChallenge(
  challenge: ChallengeRecord,
  completions: number,
): Record<string, unknown> {
  return {
    digest: challenge.digest,
    ruleset: challenge.ruleset,
    title: challenge.title,
    description: challenge.description,
    difficulty: challenge.difficulty,
    creatorName: challenge.creatorName,
    definition: challenge.definition,
    proofRunId: challenge.proofRunId,
    completions,
  };
}

export function metricsOf(run: RunRecord): Metrics {
  return run.metrics as Metrics;
}

/** Reads a client-supplied definition under the types validation stage. */
export function readDefinition(
  raw: Record<string, unknown>,
  base: string,
  problems: Problems,
): Definition {
  rejectUnknown(
    raw,
    ['title', 'description', 'difficulty', 'seed', 'buildable', 'waves'],
    base,
    problems,
  );
  const title = readString(raw, 'title', base, problems);
  const description = readString(raw, 'description', base, problems);
  const difficulty = readString(raw, 'difficulty', base, problems);
  const seed = readInteger(raw, 'seed', base, problems);
  const buildableRaw = readArray(raw, 'buildable', base, problems);
  const wavesRaw = readArray(raw, 'waves', base, problems);

  const buildable = buildableRaw.map((entry, index) => {
    const path = `${base}.buildable[${index}]`;
    const cell = elementObject(entry, path, problems);
    rejectUnknown(cell, ['lane', 'cell'], path, problems);
    return {
      lane: readInteger(cell, 'lane', path, problems),
      cell: readInteger(cell, 'cell', path, problems),
    };
  });

  const waves: Wave[] = wavesRaw.map((entry, index) => {
    const path = `${base}.waves[${index}]`;
    const wave = elementObject(entry, path, problems);
    rejectUnknown(wave, ['tick', 'creature', 'count', 'interval', 'lane'], path, problems);
    return {
      tick: readInteger(wave, 'tick', path, problems),
      creature: readString(wave, 'creature', path, problems),
      count: readInteger(wave, 'count', path, problems),
      interval: readInteger(wave, 'interval', path, problems),
      lane: readInteger(wave, 'lane', path, problems),
    };
  });

  return {
    title,
    description,
    difficulty: difficulty as Definition['difficulty'],
    seed,
    buildable,
    waves,
  };
}

export function checkDefinitionForbidden(
  definition: Definition,
  base: string,
  problems: Problems,
): void {
  checkNoControlCharacters(definition.title, `${base}.title`, problems);
  checkNoControlCharacters(definition.description, `${base}.description`, problems);
}

export function checkDefinitionRanges(
  definition: Definition,
  base: string,
  problems: Problems,
): void {
  checkTextLength(
    definition.title.trim(),
    LIMITS.minTitleCodePoints,
    LIMITS.maxTitleCodePoints,
    `${base}.title`,
    problems,
  );
  checkTextLength(
    definition.description,
    LIMITS.minDescriptionCodePoints,
    LIMITS.maxDescriptionCodePoints,
    `${base}.description`,
    problems,
  );
  checkEnum(definition.difficulty, DIFFICULTIES, `${base}.difficulty`, problems);
  checkRange(definition.seed, LIMITS.minSeed, LIMITS.maxSeed, `${base}.seed`, problems);
  definition.buildable.forEach((cell, index) => {
    checkRange(cell.lane, 1, LIMITS.lanes, `${base}.buildable[${index}].lane`, problems);
    checkRange(cell.cell, 1, LIMITS.cellsPerLane, `${base}.buildable[${index}].cell`, problems);
  });
  definition.waves.forEach((wave, index) => {
    const path = `${base}.waves[${index}]`;
    checkRange(wave.tick, LIMITS.minWaveTick, LIMITS.maxCommandTick, `${path}.tick`, problems);
    if (!isCreatureId(wave.creature)) {
      checkEnum(wave.creature, CREATURE_IDS, `${path}.creature`, problems);
    }
    checkRange(wave.count, LIMITS.minWaveCount, Number.MAX_SAFE_INTEGER, `${path}.count`, problems);
    checkRange(
      wave.interval,
      LIMITS.minWaveInterval,
      Number.MAX_SAFE_INTEGER,
      `${path}.interval`,
      problems,
    );
    checkRange(wave.lane, 0, LIMITS.maxWaveLane, `${path}.lane`, problems);
  });
}

export function checkDefinitionCross(
  definition: Definition,
  base: string,
  problems: Problems,
): void {
  definition.waves.forEach((wave, index) => {
    if (wave.tick + (wave.count - 1) * wave.interval > LIMITS.maxCommandTick) {
      problems.add('cross', `${base}.waves[${index}].interval`);
    }
  });
}

export function checkDefinitionAggregates(
  definition: Definition,
  base: string,
  problems: Problems,
): void {
  if (definition.waves.length < LIMITS.minWaves || definition.waves.length > LIMITS.maxWaves) {
    problems.add('aggregate', `${base}.waves`);
  }
  if (definition.waves.reduce((total, wave) => total + wave.count, 0) > LIMITS.maxCreatures) {
    problems.add('aggregate', `${base}.waves`);
  }
  const keys = definition.buildable.map((cell) => `${cell.lane}:${cell.cell}`);
  if (new Set(keys).size !== keys.length) problems.add('aggregate', `${base}.buildable`);
  const sorted = [...definition.buildable].sort((a, b) => a.lane - b.lane || a.cell - b.cell);
  if (sorted.some((cell, index) => cell !== definition.buildable[index])) {
    problems.add('aggregate', `${base}.buildable`);
  }
}

export function checkLoadout(loadout: string[], problems: Problems): void {
  loadout.forEach((device, index) => {
    if (!DEVICE_IDS.includes(device)) problems.add('range', `loadout[${index}]`);
  });
  if (loadout.length < LIMITS.minLoadout || loadout.length > LIMITS.maxLoadout) {
    problems.add('aggregate', 'loadout');
  }
  if (new Set(loadout).size !== loadout.length) problems.add('aggregate', 'loadout');
}

/** Replay eligibility for accepted runs under the documented access rules. */
export async function replayEligible(
  store: Store,
  ticket: StoredTicket,
  run: RunRecord,
): Promise<boolean> {
  if (run.state !== 'accepted') return false;
  if (ticket.mode === 'campaign') return true;
  if (ticket.mode === 'challenge') {
    if (ticket.challengeDigest === null) return false;
    return (await store.challenge(ticket.challengeDigest)) !== null;
  }
  const challenge = await store.challengeForLevel(ticket.sourceId);
  return challenge !== null && challenge.proofRunId === run.id;
}

export function requireOwner(ownerId: string, accountId: string | null): void {
  if (ownerId !== accountId) throw new ApiError('NOT_FOUND');
}
