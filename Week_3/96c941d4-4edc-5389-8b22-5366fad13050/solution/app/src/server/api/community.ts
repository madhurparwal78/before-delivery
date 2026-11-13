import { DIFFICULTIES, LIMITS, RULESET } from '../../shared/constants.js';
import { requireSearch, requireStore } from '../app.js';
import { ApiError } from '../errors.js';
import { computeBoard } from '../rankings.js';
import { SearchUnavailableError } from '../search.js';
import type { ChallengeRecord, Store } from '../store.js';
import { Problems, checkEnum, codePoints } from '../validation.js';
import type { ApiResponse, RequestContext } from '../http.js';
import { indexingState, reconcileDiscovery } from './discovery.js';
import { publicChallenge } from './shared.js';

async function challengePayload(store: Store, challenge: ChallengeRecord): Promise<unknown> {
  return publicChallenge(challenge, await store.challengeCompletions(challenge.digest));
}

export async function searchChallenges(request: RequestContext): Promise<ApiResponse> {
  const problems = new Problems();
  const text = request.query.get('q') ?? '';
  const difficulty = request.query.get('difficulty');
  const ruleset = request.query.get('ruleset');
  if (codePoints(text) > LIMITS.maxSearchCodePoints) problems.add('range', 'q');
  if (difficulty !== null) checkEnum(difficulty, DIFFICULTIES, 'difficulty', problems);
  if (ruleset !== null) checkEnum(ruleset, [RULESET], 'ruleset', problems);
  problems.flush();

  const store = await requireStore(request.app);
  const search = requireSearch(request.app);
  await reconcileDiscovery(request.app);

  let digests: string[];
  try {
    digests = await search.search({ text, difficulty, ruleset });
  } catch (error) {
    if (error instanceof SearchUnavailableError) throw new ApiError('DISCOVERY_UNAVAILABLE');
    throw error;
  }

  const hydrated = await store.challengesByDigests(digests);
  hydrated.sort((a, b) => (a.title === b.title ? (a.digest < b.digest ? -1 : 1) : a.title < b.title ? -1 : 1));
  const challenges = [];
  for (const challenge of hydrated) challenges.push(await challengePayload(store, challenge));
  return { status: 200, body: { challenges, indexing: await indexingState(store) } };
}

export async function readChallenge(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const challenge = await store.challenge(request.params.digest);
  if (challenge === null || !challenge.listed) throw new ApiError('NOT_FOUND');
  return { status: 200, body: await challengePayload(store, challenge) };
}

export async function readLeaderboard(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const challenge = await store.challenge(request.params.digest);
  if (challenge === null) throw new ApiError('NOT_FOUND');
  const results = await store.qualifyingResults(challenge.digest, null);
  return {
    status: 200,
    body: computeBoard(challenge.digest, challenge.ruleset, results, request.account?.id ?? null),
  };
}
