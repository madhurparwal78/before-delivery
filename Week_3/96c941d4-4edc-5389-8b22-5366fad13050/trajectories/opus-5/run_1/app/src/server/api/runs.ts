import {
  CAMPAIGN,
  INITIAL_HEALTH,
  INITIAL_RESERVE,
  LIMITS,
  RULESET,
  campaignEncounter,
} from '../../shared/constants.js';
import { checkProposal, frameWindow } from '../../shared/simulation.js';
import type { Command } from '../../shared/types.js';
import { requireStore } from '../app.js';
import { definitionDigest, evidenceDigest } from '../digests.js';
import { ApiError, commandRefused } from '../errors.js';
import { newId } from '../store.js';
import type { RunRecord, Store, StoredTicket } from '../store.js';
import { seasonDayOf, selectDailyDigest } from '../season.js';
import {
  commitTerminalResult,
  confirmEvidenceObjects,
  reproduce,
  simulationConfigOf,
} from '../verification.js';
import {
  Problems,
  checkDepth,
  checkRange,
  checkSurrogates,
  elementObject,
  queryInteger,
  readArray,
  readInteger,
  readNullableInteger,
  readNullableString,
  readObject,
  readString,
  rejectUnknown,
  requireJsonObject,
} from '../validation.js';
import type { ApiResponse, RequestContext } from '../http.js';
import { checkLoadout, publicResult, publicTicket, replayEligible, requireOwner } from './shared.js';
import { campaignUnlocks } from '../verification.js';

const MODES = ['campaign', 'playtest', 'challenge'] as const;

export async function issueTicket(request: RequestContext): Promise<ApiResponse> {
  const body = requireJsonObject(request.body);
  const account = request.account as { id: string };
  const problems = new Problems();
  rejectUnknown(body, ['mode', 'sourceId', 'revision', 'loadout'], '', problems);
  const mode = readString(body, 'mode', '', problems);
  const sourceId = readString(body, 'sourceId', '', problems);
  const revision = readNullableInteger(body, 'revision', '', problems);
  const loadoutRaw = readArray(body, 'loadout', '', problems);
  const loadout = loadoutRaw.map((entry, index) => {
    if (typeof entry !== 'string') {
      problems.add('types', `loadout[${index}]`);
      return '';
    }
    return entry;
  });
  problems.flush();
  checkDepth(request.body, problems);
  problems.flush();
  checkSurrogates(request.body, problems, '');
  problems.flush();
  if (!MODES.includes(mode as (typeof MODES)[number])) {
    problems.add('range', 'mode');
    problems.flush();
  }

  const store = await requireStore(request.app);
  const ticket: StoredTicket = {
    id: newId('run'),
    accountId: account.id,
    mode: mode as StoredTicket['mode'],
    sourceId,
    revision: null,
    seed: 0,
    levelDigest: '',
    loadout,
    ruleset: RULESET,
    initialReserve: INITIAL_RESERVE,
    initialHealth: INITIAL_HEALTH,
    seasonDay: null,
    daily: false,
    definition: CAMPAIGN[0].definition,
    challengeDigest: null,
  };
  let proof: { levelId: string; revision: number } | null = null;

  if (mode === 'campaign') {
    const encounter = campaignEncounter(sourceId);
    if (encounter === undefined) throw new ApiError('NOT_FOUND');
    const progress = campaignUnlocks(await store.completedEncounters(account.id));
    if (!progress.unlocked.includes(encounter.id)) throw new ApiError('ENCOUNTER_LOCKED');
    if (revision !== null) problems.add('range', 'revision');
    ticket.definition = encounter.definition;
    ticket.levelDigest = definitionDigest(encounter.definition);
    ticket.seed = encounter.definition.seed;
  } else if (mode === 'playtest') {
    const level = await store.level(sourceId);
    if (level === null || level.accountId !== account.id || level.state === 'withdrawn') {
      throw new ApiError('NOT_FOUND');
    }
    if (level.state !== 'private') throw new ApiError('INVALID_TRANSITION');
    if (revision !== level.revision) throw new ApiError('REVISION_CHANGED');
    ticket.revision = level.revision;
    ticket.definition = level.definition;
    ticket.levelDigest = level.digest;
    ticket.seed = level.definition.seed;
    proof = { levelId: level.id, revision: level.revision };
  } else {
    const challenge = await store.challenge(sourceId);
    if (challenge === null || !challenge.listed) throw new ApiError('NOT_FOUND');
    if (revision !== null) problems.add('range', 'revision');
    const seasonDay = seasonDayOf(Date.now());
    const selection = await store.freezeDailySelection(seasonDay, (digests) =>
      selectDailyDigest(seasonDay, digests),
    );
    ticket.definition = challenge.definition;
    ticket.levelDigest = challenge.levelDigest;
    ticket.seed = challenge.definition.seed;
    ticket.challengeDigest = challenge.digest;
    ticket.seasonDay = seasonDay;
    ticket.daily = selection === challenge.digest;
  }

  checkLoadout(loadout, problems);
  problems.flush();

  await store.insertTicketAndRun(ticket, proof);
  return { status: 201, body: { ticket: publicTicket(ticket) } };
}

async function loadOwnedRun(
  store: Store,
  id: string,
  accountId: string | null,
): Promise<{ ticket: StoredTicket; run: RunRecord }> {
  const ticket = await store.ticket(id);
  const run = await store.run(id);
  if (ticket === null || run === null) throw new ApiError('NOT_FOUND');
  requireOwner(ticket.accountId, accountId);
  return { ticket, run };
}

async function runBody(store: Store, ticket: StoredTicket, run: RunRecord): Promise<unknown> {
  return {
    ticket: publicTicket(ticket),
    state: run.state,
    result: publicResult(run),
    ledger: await store.ledger(run.id),
    proof: await proofBody(store, run.id),
  };
}

async function proofBody(store: Store, runId: string): Promise<unknown> {
  const proof = await store.proof(runId);
  return proof === null ? null : { runId: proof.runId, revision: proof.revision, state: proof.state };
}

export async function startRun(request: RequestContext): Promise<ApiResponse> {
  requireJsonObject(request.body);
  const problems = new Problems();
  rejectUnknown(request.body as Record<string, unknown>, [], '', problems);
  problems.flush();
  const store = await requireStore(request.app);
  const { ticket, run } = await loadOwnedRun(store, request.params.id, request.account?.id ?? null);
  if (run.state === 'issued') await store.startRun(run.id);
  else if (run.state !== 'playing') throw new ApiError('INVALID_TRANSITION');
  const started = (await store.run(run.id)) as RunRecord;
  return { status: 200, body: await runBody(store, ticket, started) };
}

export async function readRun(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const { ticket, run } = await loadOwnedRun(store, request.params.id, request.account?.id ?? null);
  return { status: 200, body: await runBody(store, ticket, run) };
}

function readCommand(entry: unknown, path: string, problems: Problems): Command {
  const raw = elementObject(entry, path, problems);
  rejectUnknown(raw, ['seq', 'tick', 'type', 'lane', 'cell', 'device'], path, problems);
  return {
    seq: readInteger(raw, 'seq', path, problems),
    tick: readInteger(raw, 'tick', path, problems),
    type: readString(raw, 'type', path, problems) as Command['type'],
    lane: readInteger(raw, 'lane', path, problems),
    cell: readInteger(raw, 'cell', path, problems),
    device: readNullableString(raw, 'device', path, problems),
  };
}

function checkCommandRanges(commands: Command[], base: string, problems: Problems): void {
  commands.forEach((command, index) => {
    checkRange(command.seq, 1, Number.MAX_SAFE_INTEGER, `${base}[${index}].seq`, problems);
    checkRange(
      command.tick,
      LIMITS.minCommandTick,
      LIMITS.maxCommandTick,
      `${base}[${index}].tick`,
      problems,
    );
  });
}

export async function checkCommand(request: RequestContext): Promise<ApiResponse> {
  const body = requireJsonObject(request.body);
  const problems = new Problems();
  rejectUnknown(body, ['commands', 'atTick', 'proposal'], '', problems);
  const commandsRaw = readArray(body, 'commands', '', problems);
  const atTick = readInteger(body, 'atTick', '', problems);
  const proposalRaw = readObject(body, 'proposal', '', problems);
  const commands = commandsRaw.map((entry, index) => readCommand(entry, `commands[${index}]`, problems));
  const proposal = readCommand(proposalRaw, 'proposal', problems);
  problems.flush();
  checkDepth(request.body, problems);
  problems.flush();
  checkSurrogates(request.body, problems, '');
  problems.flush();

  const store = await requireStore(request.app);
  const { ticket, run } = await loadOwnedRun(store, request.params.id, request.account?.id ?? null);
  if (run.state !== 'playing') throw new ApiError('INVALID_TRANSITION');

  checkRange(atTick, LIMITS.minCommandTick, LIMITS.maxCommandTick, 'atTick', problems);
  checkCommandRanges(commands, 'commands', problems);
  checkCommandRanges([proposal], 'proposal', problems);
  problems.flush();

  if (proposal.tick !== atTick) problems.add('cross', 'proposal.tick');
  commands.forEach((command, index) => {
    if (command.tick > atTick) problems.add('cross', `commands[${index}].tick`);
  });
  problems.flush();

  if (commands.length + 1 > LIMITS.maxCommands) problems.add('aggregate', 'commands');
  problems.flush();

  const outcome = checkProposal(
    simulationConfigOf(ticket, ticket.definition),
    commands,
    atTick,
    proposal,
  );
  if ('refusal' in outcome) throw commandRefused(outcome.refusal);
  return { status: 200, body: { command: proposal, state: outcome.state } };
}

async function verifyStagedRun(
  request: RequestContext,
  store: Store,
  ticket: StoredTicket,
): Promise<ApiResponse> {
  await store.beginVerification(ticket.id);
  const staged = (await store.run(ticket.id)) as RunRecord;
  const evidence = await confirmEvidenceObjects(
    request.app,
    ticket,
    staged.commands as Command[],
    staged.endTick as number,
    staged.evidenceDigest as string,
  );
  if (evidence === null) {
    await store.returnToSubmitted(ticket.id);
    const pending = (await store.run(ticket.id)) as RunRecord;
    return { status: 202, body: publicResult(pending) };
  }
  const committed = await commitTerminalResult(request.app, ticket, reproduce(ticket, evidence));
  return { status: 200, body: publicResult(committed) };
}

export async function submitEvidence(request: RequestContext): Promise<ApiResponse> {
  const body = requireJsonObject(request.body);
  const problems = new Problems();
  rejectUnknown(body, ['commands', 'endTick', 'claims'], '', problems);
  const commandsRaw = readArray(body, 'commands', '', problems);
  const endTick = readInteger(body, 'endTick', '', problems);
  if (body.claims !== undefined) readObject(body, 'claims', '', problems);
  const commands = commandsRaw.map((entry, index) => readCommand(entry, `commands[${index}]`, problems));
  problems.flush();
  checkDepth(request.body, problems);
  problems.flush();
  checkSurrogates(request.body, problems, '');
  problems.flush();

  const store = await requireStore(request.app);
  const { ticket, run } = await loadOwnedRun(store, request.params.id, request.account?.id ?? null);
  if (run.state === 'issued') throw new ApiError('INVALID_TRANSITION');

  checkRange(endTick, LIMITS.minEndTick, LIMITS.maxEndTick, 'endTick', problems);
  checkCommandRanges(commands, 'commands', problems);
  problems.flush();

  for (const command of commands) {
    if (command.tick > endTick) problems.add('cross', 'endTick');
  }
  problems.flush();

  if (commands.length > LIMITS.maxCommands) problems.add('aggregate', 'commands');
  problems.flush();

  const digest = evidenceDigest(commands, endTick);
  if (run.state === 'accepted' || run.state === 'rejected') {
    if (run.evidenceDigest !== digest) throw new ApiError('EVIDENCE_CONFLICT');
    return { status: 200, body: publicResult(run) };
  }
  if (run.state === 'playing') {
    const staged = await store.stageEvidence(run.id, digest, commands, endTick);
    if (!staged) {
      const current = (await store.run(run.id)) as RunRecord;
      if (current.evidenceDigest !== digest) throw new ApiError('EVIDENCE_CONFLICT');
    }
  } else if (run.evidenceDigest !== digest) {
    throw new ApiError('EVIDENCE_CONFLICT');
  }
  return verifyStagedRun(request, store, ticket);
}

export async function retryVerification(request: RequestContext): Promise<ApiResponse> {
  requireJsonObject(request.body);
  const problems = new Problems();
  rejectUnknown(request.body as Record<string, unknown>, [], '', problems);
  problems.flush();
  const store = await requireStore(request.app);
  const { ticket, run } = await loadOwnedRun(store, request.params.id, request.account?.id ?? null);
  if (run.state === 'issued' || run.state === 'playing') throw new ApiError('INVALID_TRANSITION');
  if (run.state === 'accepted' || run.state === 'rejected') {
    return { status: 200, body: publicResult(run) };
  }
  return verifyStagedRun(request, store, ticket);
}

export async function readFrames(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const id = request.params.id;
  const ticket = await store.ticket(id);
  const run = await store.run(id);
  if (ticket === null || run === null) throw new ApiError('NOT_FOUND');
  const viewer = request.account?.id ?? null;
  const owner = ticket.accountId === viewer;

  if (run.state === 'accepted') {
    if (!owner && !(await replayEligible(store, ticket, run))) throw new ApiError('NOT_FOUND');
  } else if (run.state === 'rejected') {
    if (!owner) throw new ApiError('NOT_FOUND');
  } else {
    if (!owner) throw new ApiError('NOT_FOUND');
    throw new ApiError('INVALID_TRANSITION');
  }

  const problems = new Problems();
  const from = queryInteger(request.query.get('from'), 'from', problems);
  const to = queryInteger(request.query.get('to'), 'to', problems);
  problems.flush();

  const lastAvailable = run.lastAvailableTick as number;
  if (to > lastAvailable + 1) problems.add('range', 'to');
  if (from > to) problems.add('cross', 'to');
  if (to - from > LIMITS.maxFramePage) problems.add('aggregate', 'to');
  problems.flush();

  const evidence = await confirmEvidenceObjects(
    request.app,
    ticket,
    run.commands as Command[],
    run.endTick as number,
    run.evidenceDigest as string,
  );
  if (evidence === null) throw new ApiError('EVIDENCE_UNAVAILABLE');
  const frames = frameWindow(
    simulationConfigOf(ticket, evidence.definition),
    evidence.commands,
    evidence.endTick,
    from,
    to,
  );
  return { status: 200, body: { runId: id, from, to, frames } };
}
