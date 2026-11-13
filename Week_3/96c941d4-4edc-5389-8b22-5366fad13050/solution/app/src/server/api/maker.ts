import { challengeSources, challengeDestination, proofSources } from '../transitions.js';
import type { LevelState } from '../transitions.js';
import { RULESET } from '../../shared/constants.js';
import type { Definition } from '../../shared/types.js';
import { requireObjects, requireStore } from '../app.js';
import { canonicalDefinitionText, challengeDigestOf, definitionDigest } from '../digests.js';
import { ApiError } from '../errors.js';
import { ObjectStoreError, levelObjectKey } from '../objects.js';
import { recordIndexWork } from '../store.js';
import type { ChallengeRecord, LevelRecord, Store } from '../store.js';
import { UNIQUE_VIOLATION, pgCode } from '../db.js';
import { confirmEvidenceObjects } from '../verification.js';
import { reconcileDiscovery } from './discovery.js';
import {
  Problems,
  checkDepth,
  checkSurrogates,
  readObject,
  readInteger,
  rejectUnknown,
  requireJsonObject,
} from '../validation.js';
import type { ApiResponse, RequestContext } from '../http.js';
import {
  checkDefinitionAggregates,
  checkDefinitionCross,
  checkDefinitionForbidden,
  checkDefinitionRanges,
  publicChallenge,
  publicLevel,
  readDefinition,
} from './shared.js';

function validatedDefinition(request: RequestContext, body: Record<string, unknown>, problems = new Problems()): Definition {
  const raw = readObject(body, 'definition', '', problems);
  const definition = readDefinition(raw, 'definition', problems);
  problems.flush();
  checkDepth(request.body, problems);
  problems.flush();
  checkSurrogates(request.body, problems, '');
  checkDefinitionForbidden(definition, 'definition', problems);
  problems.flush();
  checkDefinitionRanges(definition, 'definition', problems);
  problems.flush();
  checkDefinitionCross(definition, 'definition', problems);
  problems.flush();
  checkDefinitionAggregates(definition, 'definition', problems);
  problems.flush();
  return {
    ...definition,
    title: definition.title.trim(),
    description: definition.description,
  };
}

async function storeDefinitionObject(request: RequestContext, definition: Definition): Promise<void> {
  try {
    const objects = requireObjects(request.app);
    await objects.putImmutable(
      levelObjectKey(definitionDigest(definition)),
      Buffer.from(canonicalDefinitionText(definition), 'utf8'),
    );
  } catch (error) {
    if (!(error instanceof ObjectStoreError) && !(error instanceof ApiError)) throw error;
  }
}

async function levelResponse(store: Store, level: LevelRecord): Promise<Record<string, unknown>> {
  return publicLevel(
    level,
    await store.proofsOf(level.id),
    (await store.indexingPending()) ? 'pending' : 'current',
  );
}

async function ownedLevel(
  store: Store,
  id: string,
  accountId: string | null,
): Promise<LevelRecord> {
  const level = await store.level(id);
  if (level === null || level.accountId !== accountId || level.state === 'withdrawn') {
    throw new ApiError('NOT_FOUND');
  }
  return level;
}

export async function createLevel(request: RequestContext): Promise<ApiResponse> {
  const body = requireJsonObject(request.body);
  const problems = new Problems();
  rejectUnknown(body, ['definition'], '', problems);
  const definition = validatedDefinition(request, body, problems);
  const store = await requireStore(request.app);
  const level = await store.insertLevel(
    (request.account as { id: string }).id,
    definition,
    definitionDigest(definition),
  );
  await storeDefinitionObject(request, definition);
  return { status: 201, body: await levelResponse(store, level) };
}

export async function listLevels(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  await reconcileDiscovery(request.app);
  const levels = await store.levelsOf((request.account as { id: string }).id);
  const indexing = (await store.indexingPending()) ? 'pending' : 'current';
  const payload = [];
  for (const level of levels) {
    payload.push(publicLevel(level, await store.proofsOf(level.id), indexing));
  }
  return { status: 200, body: { levels: payload } };
}

export async function readLevel(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  await reconcileDiscovery(request.app);
  const level = await ownedLevel(store, request.params.id, request.account?.id ?? null);
  return { status: 200, body: await levelResponse(store, level) };
}

export async function saveLevel(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const level = await ownedLevel(store, request.params.id, request.account?.id ?? null);
  challengeDestination(level.state, 'edit');
  const body = requireJsonObject(request.body);
  const problems = new Problems();
  if (typeof body.expectedRevision === 'number' && Number.isSafeInteger(body.expectedRevision) && body.expectedRevision !== level.revision) throw new ApiError('REVISION_CHANGED');
  rejectUnknown(body, ['expectedRevision', 'definition'], '', problems);
  readInteger(body, 'expectedRevision', '', problems);
  const definition = validatedDefinition(request, body, problems);
  const digest = definitionDigest(definition);
  const updated = await store.transaction(async (client) => {
    const result = await client.query(
      `UPDATE levels SET revision = revision + 1, definition = $3, digest = $4, title = $5,
         proof_run_id = NULL
       WHERE id = $1 AND revision = $2 AND state = ANY($6::text[])`,
      [level.id, level.revision, JSON.stringify(definition), digest, definition.title, challengeSources.edit],
    );
    if ((result.rowCount ?? 0) !== 1) return false;
    await client.query('INSERT INTO level_revisions (level_id, revision, definition, digest) VALUES ($1,$2,$3,$4)', [level.id, level.revision + 1, JSON.stringify(definition), digest]);
    await client.query(
      `UPDATE proofs SET state = 'obsolete'
       WHERE level_id = $1 AND state = ANY($2::text[])`,
      [level.id, proofSources.revise],
    );
    return true;
  });
  if (!updated) throw new ApiError('REVISION_CHANGED');
  await storeDefinitionObject(request, definition);
  const saved = (await store.level(level.id)) as LevelRecord;
  return { status: 200, body: await levelResponse(store, saved) };
}

async function challengeBody(store: Store, challenge: ChallengeRecord): Promise<unknown> {
  return publicChallenge(challenge, await store.challengeCompletions(challenge.digest));
}

/** Confirms the proof's exact immutable objects, then commits the publication record. */
async function commitPublication(
  request: RequestContext,
  store: Store,
  level: LevelRecord,
  proofRunId: string,
): Promise<ApiResponse> {
  const digest = challengeDigestOf(level.digest, RULESET);
  const existing = await store.challenge(digest);
  if (existing !== null && existing.levelId !== level.id) {
    await revertToPrivate(store, level.id);
    throw new ApiError('CHALLENGE_EXISTS');
  }

  const proofRun = await store.run(proofRunId);
  const proofTicket = await store.ticket(proofRunId);
  if (proofRun === null || proofTicket === null) throw new ApiError('PROOF_REQUIRED');

  const evidence = await confirmEvidenceObjects(
    request.app, proofTicket, proofRun.commands as import('../../shared/types.js').Command[],
    proofRun.endTick as number, proofRun.evidenceDigest as string,
  );
  if (evidence === null) return { status: 202, body: await levelResponse(store, level) };

  const account = request.account as { id: string; playerName: string };
  let firstCommit = true;
  try {
    await store.transaction(async (client) => {
      const locked = await client.query<{state: string; pending_proof_run_id: string | null}>(
        'SELECT state, pending_proof_run_id FROM levels WHERE id = $1 FOR UPDATE', [level.id],
      );
      const current = locked.rows[0];
      if (current.state === 'withdrawn') throw new ApiError('NOT_FOUND');
      if (current.state === 'published') { firstCommit = false; return; }
      challengeDestination(current.state as LevelState, 'commit');
      if (current.pending_proof_run_id !== proofRunId) throw new ApiError('INVALID_TRANSITION');
      await client.query(
        `INSERT INTO challenges (digest, level_id, account_id, ruleset, level_digest, title, description,
           difficulty, creator_name, definition, proof_run_id, listed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         ON CONFLICT (digest) DO NOTHING`,
        [
          digest,
          level.id,
          account.id,
          RULESET,
          level.digest,
          level.definition.title,
          level.definition.description,
          level.definition.difficulty,
          account.playerName,
          JSON.stringify(level.definition),
          proofRunId,
        ],
      );
      const owner = await client.query<{ level_id: string }>(
        'SELECT level_id FROM challenges WHERE digest = $1',
        [digest],
      );
      if (owner.rows[0].level_id !== level.id) throw new ApiError('CHALLENGE_EXISTS');
      await client.query(
        `UPDATE levels SET state = 'published', challenge_digest = $2 WHERE id = $1 AND state = 'proof-pending'`,
        [level.id, digest],
      );
      await client.query(
        'INSERT INTO presentations (run_id, version, tick, playing) VALUES ($1,0,0,false) ON CONFLICT (run_id) DO NOTHING',
        [proofRunId],
      );
      await recordIndexWork(client, digest, 'upsert');
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CHALLENGE_EXISTS') {
      await revertToPrivate(store, level.id);
      throw error;
    }
    if (pgCode(error) === UNIQUE_VIOLATION) {
      await revertToPrivate(store, level.id);
      throw new ApiError('CHALLENGE_EXISTS');
    }
    throw error;
  }

  await reconcileDiscovery(request.app);
  const challenge = (await store.challenge(digest)) as ChallengeRecord;
  return { status: firstCommit ? 201 : 200, body: await challengeBody(store, challenge) };
}

async function revertToPrivate(store: Store, levelId: string): Promise<void> {
  await store.transaction(async (client) => {
    await client.query(
      `UPDATE levels SET state = 'private', pending_proof_run_id = NULL
       WHERE id = $1 AND state = 'proof-pending'`,
      [levelId],
    );
  });
}

export async function publishLevel(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const level = await ownedLevel(store, request.params.id, request.account?.id ?? null);
  const body = requireJsonObject(request.body);
  const problems = new Problems();

  const proofRunId = body.proofRunId;

  if (level.state === 'published') {
    const challenge = (await store.challengeForLevel(level.id)) as ChallengeRecord;
    if (body.expectedRevision === level.revision && proofRunId === challenge.proofRunId) {
      return { status: 200, body: await challengeBody(store, challenge) };
    }
    throw new ApiError('INVALID_TRANSITION');
  }
  if (level.state === 'unlisted') throw new ApiError('INVALID_TRANSITION');
  if (body.expectedRevision !== level.revision) throw new ApiError('REVISION_CHANGED');

  const proof = typeof proofRunId === 'string' ? await store.proof(proofRunId) : null;
  const qualified =
    proof !== null &&
    proof.levelId === level.id &&
    proof.accountId === level.accountId &&
    proof.revision === level.revision &&
    proof.state === 'qualified';
  if (!qualified) throw new ApiError('PROOF_REQUIRED');

  if (level.state === 'proof-pending') {
    if (level.pendingProofRunId !== proofRunId) throw new ApiError('INVALID_TRANSITION');
    return commitPublication(request, store, level, proofRunId as string);
  }

  rejectUnknown(body, ['expectedRevision', 'proofRunId'], '', problems);
  problems.flush();
  challengeDestination(level.state, 'publish');
  const pinned = await store.transaction(async (client) => {
    const result = await client.query(
      `UPDATE levels SET state = 'proof-pending', pending_proof_run_id = $2
       WHERE id = $1 AND revision = $3 AND state = ANY($4::text[])`,
      [level.id, proofRunId, level.revision, challengeSources.publish],
    );
    return (result.rowCount ?? 0) === 1;
  });
  if (!pinned) return publishLevel(request);
  const pending = (await store.level(level.id)) as LevelRecord;
  return commitPublication(request, store, pending, proofRunId as string);
}

export async function withdrawLevel(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const level = await ownedLevel(store, request.params.id, request.account?.id ?? null);
  const body = requireJsonObject(request.body);
  const problems = new Problems();

  if (body.expectedRevision !== level.revision) throw new ApiError('REVISION_CHANGED');

  if (level.state === 'unlisted') return { status: 200, body: { id: level.id, state: 'unlisted' } };

  rejectUnknown(body, ['expectedRevision'], '', problems);
  problems.flush();
  const next = await store.transaction(async (client) => {
    const locked = await client.query<{state: string; revision: number}>('SELECT state, revision FROM levels WHERE id = $1 FOR UPDATE', [level.id]);
    const current = locked.rows[0];
    if (current.state === 'withdrawn') throw new ApiError('NOT_FOUND');
    if (current.revision !== body.expectedRevision) throw new ApiError('REVISION_CHANGED');
    const next = challengeDestination(current.state as LevelState, 'withdraw');
    await client.query('UPDATE levels SET state = $2 WHERE id = $1', [level.id, next]);
    if (next === 'unlisted') {
      await client.query('UPDATE challenges SET listed = false WHERE level_id = $1', [level.id]);
      const challenge = await client.query<{digest: string}>('SELECT digest FROM challenges WHERE level_id = $1', [level.id]);
      await recordIndexWork(client, challenge.rows[0].digest, 'delete');
    }
    return next;
  });
  await reconcileDiscovery(request.app);
  return { status: 200, body: { id: level.id, state: next } };
}
