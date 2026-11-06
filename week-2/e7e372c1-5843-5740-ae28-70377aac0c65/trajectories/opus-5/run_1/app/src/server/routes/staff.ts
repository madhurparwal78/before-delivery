/** Staff endpoints: the session, restatements and the exhibit upload. */
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { transact } from '../db';
import {
  ApiResponse,
  RequestContext,
  headerOf,
  parseCookies,
  readJsonBody,
  readPdfBody,
} from '../http';
import { fail, validationFailure } from '../errors';
import {
  SESSION_COOKIE,
  StaffUser,
  authenticate,
  clearedSessionCookieHeader,
  sessionCookieHeader,
  signIn,
  signOut,
} from '../auth';
import { ActorContext, authoriseAction, isTransitionAllowed } from '../../domain/stateMachine';
import { FILING_SAFE_MESSAGES, checkFilingSafe } from '../../domain/filingSafe';
import { loadAuditTrail, loadAllRestatements, loadRestatement } from '../restatementStore';
import { restatementPayload } from '../serialise';
import {
  clearRestatement,
  createRestatement,
  releaseRestatement,
  returnRestatement,
  saveRestatement,
  storeExhibitSteps,
  submitRestatement,
  withdrawRestatement,
} from '../restatementActions';
import { copyToPublishedKey, publishedKey, readVaultBytes, stageExhibitBytes, stagingKey } from '../vault';

export async function currentUser(context: RequestContext): Promise<StaffUser | null> {
  const cookies = parseCookies(headerOf(context, 'cookie'));
  return authenticate(cookies[SESSION_COOKIE]);
}

export async function requireUser(context: RequestContext): Promise<StaffUser> {
  const user = await currentUser(context);
  if (user === null) throw fail('unauthenticated');
  return user;
}

function actorOf(user: StaffUser): ActorContext {
  return { userId: user.id, roles: user.roles };
}

function userBody(user: StaffUser): ApiResponse['json'] {
  return { user: { id: user.id, name: user.name, email: user.email, roles: user.roles } };
}

export async function postSession(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  const email = body.email;
  const password = body.password;
  const failures: Record<string, string> = {};
  if (typeof email !== 'string' || email.length === 0) failures.email = 'Enter your email address.';
  if (typeof password !== 'string' || password.length === 0) failures.password = 'Enter your password.';
  if (Object.keys(failures).length > 0) throw validationFailure(failures);
  const signedIn = await signIn(email as string, password as string);
  if (signedIn === null) throw fail('invalid_credentials');
  return {
    status: 200,
    json: userBody(signedIn.user),
    headers: { 'Set-Cookie': sessionCookieHeader(signedIn.cookieValue) },
  };
}

export async function getSession(context: RequestContext): Promise<ApiResponse> {
  const user = await requireUser(context);
  return { status: 200, json: userBody(user) };
}

export async function deleteSession(context: RequestContext): Promise<ApiResponse> {
  const cookies = parseCookies(headerOf(context, 'cookie'));
  await signOut(cookies[SESSION_COOKIE]);
  return { status: 204, headers: { 'Set-Cookie': clearedSessionCookieHeader() } };
}

export async function listRestatements(context: RequestContext): Promise<ApiResponse> {
  await requireUser(context);
  const records = await transact((tx) => loadAllRestatements(tx));
  return { status: 200, json: { restatements: records.map(restatementPayload) } };
}

export async function getRestatement(context: RequestContext): Promise<ApiResponse> {
  await requireUser(context);
  const record = await transact((tx) => loadRestatement(tx, context.params.id ?? ''));
  if (record === null) throw fail('not_found');
  return { status: 200, json: { restatement: restatementPayload(record) } };
}

export async function getAuditTrail(context: RequestContext): Promise<ApiResponse> {
  await requireUser(context);
  const id = context.params.id ?? '';
  const record = await transact((tx) => loadRestatement(tx, id));
  if (record === null) throw fail('not_found');
  const entries = await transact((tx) => loadAuditTrail(tx, id));
  return { status: 200, json: { entries } };
}

export async function postRestatement(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  const user = await requireUser(context);
  const record = await createRestatement(actorOf(user), body);
  return { status: 201, json: { restatement: restatementPayload(record) } };
}

export async function patchRestatement(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  const user = await requireUser(context);
  const record = await saveRestatement(actorOf(user), context.params.id ?? '', body);
  return { status: 200, json: { restatement: restatementPayload(record) } };
}

export async function postSubmit(context: RequestContext): Promise<ApiResponse> {
  await readJsonBody(context);
  const user = await requireUser(context);
  const record = await submitRestatement(actorOf(user), context.params.id ?? '');
  return { status: 200, json: { restatement: restatementPayload(record) } };
}

export async function postReturn(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  const user = await requireUser(context);
  const record = await returnRestatement(actorOf(user), context.params.id ?? '', body.note);
  return { status: 200, json: { restatement: restatementPayload(record) } };
}

export async function postClear(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  const user = await requireUser(context);
  const record = await clearRestatement(actorOf(user), context.params.id ?? '', body);
  return { status: 200, json: { restatement: restatementPayload(record) } };
}

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,100}$/;

export async function postRelease(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  const user = await requireUser(context);
  const rawKey = headerOf(context, 'idempotency-key');
  const key = typeof rawKey === 'string' && IDEMPOTENCY_KEY_PATTERN.test(rawKey) ? rawKey : null;
  const result = await releaseRestatement(actorOf(user), context.params.id ?? '', body, key);
  return {
    status: result.status,
    json: { outcome: result.outcome, restatement: restatementPayload(result.restatement) },
  };
}

export async function postWithdraw(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  const user = await requireUser(context);
  const record = await withdrawRestatement(actorOf(user), context.params.id ?? '', body);
  return { status: 200, json: { restatement: restatementPayload(record) } };
}

const SHA256_HEADER_PATTERN = /^[0-9a-f]{64}$/;

export async function putExhibit(context: RequestContext): Promise<ApiResponse> {
  const body = await readPdfBody(context);
  const user = await requireUser(context);
  const id = context.params.id ?? '';

  const record = await transact((tx) => loadRestatement(tx, id));
  if (record === null) throw fail('not_found');
  const authorisation = authoriseAction('upload_exhibit', actorOf(user), {
    preparedBy: record.preparedBy.id,
    clearedBy: record.clearedBy === null ? null : record.clearedBy.id,
  });
  if (authorisation !== null) throw fail(authorisation);
  if (!isTransitionAllowed('upload_exhibit', record.state)) throw fail('invalid_transition');

  const failures: Record<string, string> = {};
  const filingSafeFailure = checkFilingSafe(body);
  if (filingSafeFailure !== null) failures.file = FILING_SAFE_MESSAGES[filingSafeFailure];
  if (record.accession === null) {
    failures.accession = 'Save the accession number before attaching an exhibit.';
  }
  const claimed = headerOf(context, 'x-exhibit-sha256');
  if (typeof claimed !== 'string' || !SHA256_HEADER_PATTERN.test(claimed.trim())) {
    failures.sha256 = 'Send the file SHA-256 as 64 lowercase hex characters.';
  }
  if (Object.keys(failures).length > 0) throw validationFailure(failures);

  const claimedSha = (claimed as string).trim();
  const accession = record.accession as string;

  const staged = stagingKey(id, randomUUID());
  await stageExhibitBytes(staged, body);
  const readBack = await readVaultBytes(staged);
  const actualSha = createHash('sha256').update(readBack).digest('hex');

  if (actualSha !== claimedSha) {
    await storeExhibitSteps(actorOf(user), id, 'rejected', {
      sha256: claimedSha,
      bytes: body.length,
      key: null,
    });
    throw validationFailure({
      sha256: "The vault copy's SHA-256 does not match the file you chose.",
    });
  }

  const key = publishedKey(accession, actualSha);
  await copyToPublishedKey(key, readBack);
  const result = await storeExhibitSteps(actorOf(user), id, 'verified', {
    sha256: actualSha,
    bytes: readBack.length,
    key,
  });
  return { status: 201, json: { restatement: restatementPayload(result.restatement) } };
}
