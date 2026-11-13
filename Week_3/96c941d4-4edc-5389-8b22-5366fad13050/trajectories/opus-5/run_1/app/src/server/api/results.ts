import { frameWindow } from '../../shared/simulation.js';
import type { Command } from '../../shared/types.js';
import { requireStore } from '../app.js';
import { ApiError } from '../errors.js';
import { computeBoard } from '../rankings.js';
import type { RunRecord, Store, StoredTicket } from '../store.js';
import { confirmEvidenceObjects, simulationConfigOf } from '../verification.js';
import {
  Problems,
  readBoolean,
  readInteger,
  rejectUnknown,
  requireJsonObject,
} from '../validation.js';
import type { ApiResponse, RequestContext } from '../http.js';
import { metricsOf, publicTicket, replayEligible } from './shared.js';

async function eligibleRun(
  store: Store,
  id: string,
): Promise<{ ticket: StoredTicket; run: RunRecord }> {
  const ticket = await store.ticket(id);
  const run = await store.run(id);
  if (ticket === null || run === null) throw new ApiError('NOT_FOUND');
  if (!(await replayEligible(store, ticket, run))) throw new ApiError('NOT_FOUND');
  return { ticket, run };
}

async function confirmed(request: RequestContext, ticket: StoredTicket, run: RunRecord) {
  const evidence = await confirmEvidenceObjects(
    request.app,
    ticket,
    run.commands as Command[],
    run.endTick as number,
    run.evidenceDigest as string,
  );
  if (evidence === null) throw new ApiError('EVIDENCE_UNAVAILABLE');
  return evidence;
}

export async function readReplay(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const { ticket, run } = await eligibleRun(store, request.params.id);
  const evidence = await confirmed(request, ticket, run);
  return {
    status: 200,
    body: {
      ticket: publicTicket(ticket),
      definition: evidence.definition,
      commands: evidence.commands,
      endTick: evidence.endTick,
      metrics: metricsOf(run),
    },
  };
}

export async function readSnapshot(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const { ticket, run } = await eligibleRun(store, request.params.id);
  await store.ensurePresentation(run.id);
  const digest = ticket.mode === 'challenge' ? ticket.challengeDigest : null;
  const sources = await store.snapshotSources(run.id, digest);
  const evidence = await confirmed(request, ticket, run);
  const frames = frameWindow(
    simulationConfigOf(ticket, evidence.definition),
    evidence.commands,
    evidence.endTick,
    sources.presentation.tick,
    sources.presentation.tick + 1,
  );
  return {
    status: 200,
    body: {
      runId: run.id,
      playback: {
        version: sources.presentation.version,
        tick: sources.presentation.tick,
        playing: sources.presentation.playing,
      },
      frame: frames[0],
      leaderboard:
        digest === null
          ? null
          : computeBoard(digest, ticket.ruleset, sources.results, request.account?.id ?? null),
    },
  };
}

export async function updatePlayback(request: RequestContext): Promise<ApiResponse> {
  const body = requireJsonObject(request.body);
  const problems = new Problems();
  rejectUnknown(body, ['expectedVersion', 'tick', 'playing'], '', problems);
  const expectedVersion = readInteger(body, 'expectedVersion', '', problems);
  const tick = readInteger(body, 'tick', '', problems);
  const playing = readBoolean(body, 'playing', '', problems);
  problems.flush();

  const store = await requireStore(request.app);
  const { ticket, run } = await eligibleRun(store, request.params.id);
  if (ticket.accountId !== (request.account?.id ?? null)) throw new ApiError('FORBIDDEN');
  await store.ensurePresentation(run.id);
  const current = (await store.presentation(run.id)) as { version: number; tick: number };

  const terminalTick = metricsOf(run).completionTick;
  if (tick < 0 || tick > terminalTick) problems.add('range', 'tick');
  if (playing && tick === terminalTick) problems.add('range', 'playing');
  problems.flush();
  if (tick !== 0 && tick < current.tick) problems.add('cross', 'tick');
  problems.flush();

  const updated = await store.updatePresentation(run.id, expectedVersion, tick, playing);
  if (updated === null) throw new ApiError('PLAYBACK_CHANGED');
  return {
    status: 200,
    body: { version: updated.version, tick: updated.tick, playing: updated.playing },
  };
}
