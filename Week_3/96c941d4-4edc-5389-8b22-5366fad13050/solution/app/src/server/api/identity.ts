import { CAMPAIGN, LIMITS } from '../../shared/constants.js';
import { requireStore } from '../app.js';
import { definitionDigest } from '../digests.js';
import { ApiError } from '../errors.js';
import { rulesResponse } from '../rulesResponse.js';
import { verifyPassword } from '../store.js';
import { campaignUnlocks } from '../verification.js';
import {
  Problems,
  checkDepth,
  checkEmail,
  checkNoControlCharacters,
  checkPassword,
  checkSurrogates,
  checkTextLength,
  normalizeEmail,
  readString,
  rejectUnknown,
  requireJsonObject,
} from '../validation.js';
import type { ApiResponse, RequestContext } from '../http.js';

export async function createAccount(request: RequestContext): Promise<ApiResponse> {
  const body = requireJsonObject(request.body);
  const problems = new Problems();
  rejectUnknown(body, ['email', 'password', 'playerName'], '', problems);
  const email = readString(body, 'email', '', problems);
  const password = readString(body, 'password', '', problems);
  const playerName = readString(body, 'playerName', '', problems);
  problems.flush();

  checkDepth(request.body, problems);
  problems.flush();

  checkSurrogates(request.body, problems, '');
  checkNoControlCharacters(playerName, 'playerName', problems);
  problems.flush();

  const store = await requireStore(request.app);
  const normalized = normalizeEmail(email);
  if ((await store.accountByEmail(normalized)) !== null) throw new ApiError('EMAIL_EXISTS');

  checkEmail(email, 'email', problems);
  checkPassword(password, 'password', problems);
  checkTextLength(
    playerName.trim(),
    LIMITS.minPlayerNameCodePoints,
    LIMITS.maxPlayerNameCodePoints,
    'playerName',
    problems,
  );
  problems.flush();

  const account = await store.createAccount(normalized, normalized, playerName.trim(), password);
  const token = await store.createSession(account.id);
  return { status: 201, body: { account }, setSession: token };
}

export async function signIn(request: RequestContext): Promise<ApiResponse> {
  const body = requireJsonObject(request.body);
  const problems = new Problems();
  rejectUnknown(body, ['email', 'password'], '', problems);
  const email = readString(body, 'email', '', problems);
  const password = readString(body, 'password', '', problems);
  problems.flush();
  checkDepth(request.body, problems);
  problems.flush();
  checkSurrogates(request.body, problems, '');
  problems.flush();

  const store = await requireStore(request.app);
  const account = await store.accountByEmail(normalizeEmail(email));
  if (account === null || !verifyPassword(password, account.passwordHash)) {
    throw new ApiError('INVALID_CREDENTIALS');
  }
  const token = await store.createSession(account.id);
  return {
    status: 200,
    body: { account: { id: account.id, email: account.email, playerName: account.playerName } },
    setSession: token,
  };
}

export async function readSession(request: RequestContext): Promise<ApiResponse> {
  return { status: 200, body: { account: request.account } };
}

export async function signOut(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  await store.revokeSession(request.sessionToken as string);
  return { status: 204, clearSession: true };
}

export async function readRules(): Promise<ApiResponse> {
  return { status: 200, body: rulesResponse() };
}

export async function readCampaign(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  const progress = campaignUnlocks(await store.completedEncounters((request.account as { id: string }).id));
  return {
    status: 200,
    body: {
      encounters: CAMPAIGN.map((encounter) => ({
        id: encounter.id,
        title: encounter.title,
        definition: encounter.definition,
        digest: definitionDigest(encounter.definition),
        unlocked: progress.unlocked.includes(encounter.id),
        completed: progress.completed.includes(encounter.id),
      })),
      progress,
    },
  };
}

export async function readProgress(request: RequestContext): Promise<ApiResponse> {
  const store = await requireStore(request.app);
  return {
    status: 200,
    body: campaignUnlocks(await store.completedEncounters((request.account as { id: string }).id)),
  };
}
