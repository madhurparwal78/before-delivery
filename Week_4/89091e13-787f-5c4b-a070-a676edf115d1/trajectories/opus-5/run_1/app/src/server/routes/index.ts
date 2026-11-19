import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, notFound, readBody, readCookie, sendEmpty, sendJson } from '../http.js';
import { probeStorage } from '../storage.js';
import {
  getBlock,
  getFraudProof,
  getProofs,
  getShares,
  getSnapshot,
  listBlocks,
  verifyProof,
} from './blocks.js';
import { RequestContext, StoredResponse } from './context.js';
import { handleGrading } from './grading.js';
import { createSample, listLightNodes, listSamples, patchLightNode } from './nodes.js';
import { acceptInvite, me, personForToken, readInvite, signIn, signOut } from './session.js';
import {
  getStakingFee,
  getStakingMe,
  listValidators,
  postClaim,
  postDelegation,
} from './stake.js';
import { createDeposit, createProposal, createVote, getProposal, listProposals } from './vote.js';
import {
  createInvite,
  feeEstimate,
  getBlob,
  getLedger,
  getMembers,
  getMempool,
  getStats,
  getTransaction,
  getWorkspace,
  listBlobs,
  listNamespaces,
  listTransactions,
  registerNamespace,
  setProducer,
  submitBlob,
} from './workspace.js';

const JSON_WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

async function route(ctx: RequestContext): Promise<StoredResponse> {
  const [first, ...rest] = ctx.segments;
  const { method } = ctx;

  if (first === 'health' && method === 'GET') {
    const reachable = await probeStorage();
    return { status: 200, body: { status: reachable ? 'ok' : 'unavailable' } };
  }
  if (first === 'session') {
    if (method === 'POST') return signIn(ctx);
    if (method === 'DELETE') return signOut(ctx);
    throw notFound();
  }
  if (first === 'me' && method === 'GET') return me(ctx);
  if (first === 'invites') {
    const [token, action] = rest;
    if (token && !action && method === 'GET') return readInvite(token);
    if (token && action === 'accept' && method === 'POST') return acceptInvite(ctx, token);
    throw notFound();
  }
  if (first === 'w') {
    const [id, section, third, fourth] = rest;
    if (!id) throw notFound();
    if (!section && method === 'GET') return getWorkspace(ctx, id);
    if (section === 'stats' && method === 'GET') return getStats(ctx, id);
    if (section === 'producer' && method === 'PUT') return setProducer(ctx, id);
    if (section === 'members' && method === 'GET') return getMembers(ctx, id);
    if (section === 'invites' && method === 'POST') return createInvite(ctx, id);
    if (section === 'namespaces' && !third) {
      if (method === 'GET') return listNamespaces(ctx, id);
      if (method === 'POST') return registerNamespace(ctx, id);
    }
    if (section === 'fee-estimate' && method === 'GET') return feeEstimate(ctx, id);
    if (section === 'blobs') {
      if (!third && method === 'GET') return listBlobs(ctx, id);
      if (!third && method === 'POST') return submitBlob(ctx, id);
      if (third && method === 'GET') return getBlob(ctx, id, third);
    }
    if (section === 'transactions') {
      if (!third && method === 'GET') return listTransactions(ctx, id);
      if (third && method === 'GET') return getTransaction(ctx, id, third);
    }
    if (section === 'mempool' && method === 'GET') return getMempool(ctx, id);
    if (section === 'ledger' && method === 'GET') return getLedger(ctx, id);
    if (section === 'blocks') {
      if (!third && method === 'GET') return listBlocks(ctx, id);
      if (third && !fourth && method === 'GET') return getBlock(ctx, id, third);
      if (third && fourth === 'shares' && method === 'GET') return getShares(ctx, id, third);
      if (third && fourth === 'proofs') {
        const [, , , , fifth] = rest;
        if (!fifth && method === 'GET') return getProofs(ctx, id, third);
        if (fifth === 'verify' && method === 'POST') return verifyProof(ctx, id, third);
      }
      if (third && fourth === 'fraud-proof' && method === 'GET') {
        return getFraudProof(ctx, id, third);
      }
    }
    if (section === 'light-nodes') {
      if (!third && method === 'GET') return listLightNodes(ctx, id);
      if (third && !fourth && method === 'PATCH') return patchLightNode(ctx, id, third);
      if (third && fourth === 'samples' && method === 'GET') return listSamples(ctx, id, third);
      if (third && fourth === 'samples' && method === 'POST') return createSample(ctx, id, third);
    }
    if (section === 'validators' && method === 'GET') return listValidators(ctx, id);
    if (section === 'staking') {
      if (third === 'fee' && method === 'GET') return getStakingFee(ctx, id);
      if (third === 'me' && method === 'GET') return getStakingMe(ctx, id);
      if (third === 'delegate' && method === 'POST') return postDelegation(ctx, id, 'delegate');
      if (third === 'undelegate' && method === 'POST') return postDelegation(ctx, id, 'undelegate');
      if (third === 'redelegate' && method === 'POST') return postDelegation(ctx, id, 'redelegate');
      if (third === 'claim' && method === 'POST') return postClaim(ctx, id);
    }
    if (section === 'proposals') {
      if (!third && method === 'GET') return listProposals(ctx, id);
      if (!third && method === 'POST') return createProposal(ctx, id);
      if (third && !fourth && method === 'GET') return getProposal(ctx, id, third);
      if (third && fourth === 'deposits' && method === 'POST') return createDeposit(ctx, id, third);
      if (third && fourth === 'votes' && method === 'POST') return createVote(ctx, id, third);
    }
  }
  throw notFound();
}

export async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<void> {
  const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const method = request.method ?? 'GET';
  const isGrading = segments[0] === 'grading';

  if (JSON_WRITE_METHODS.has(method) && !isGrading) {
    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) {
      sendJson(response, 415, { error: 'Send JSON.' });
      request.resume();
      return;
    }
  }

  const { tooLarge, bytes } = await readBody(request);
  if (tooLarge) {
    sendJson(response, 413, { error: 'Request body is too large.' });
    return;
  }

  let body: Record<string, unknown> = {};
  if (bytes.length > 0) {
    try {
      const parsed: unknown = JSON.parse(bytes.toString('utf8'));
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const sessionToken = readCookie(request.headers.cookie, 'fs_session');
  const idempotencyKey = request.headers['idempotency-key'];
  const ctx: RequestContext = {
    method,
    segments,
    query,
    body,
    rawBody: bytes,
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
    sessionToken,
    person: await personForToken(sessionToken),
    response,
    cookies: [],
  };

  try {
    if (isGrading) {
      const key = request.headers['x-grading-key'];
      const result = await handleGrading(ctx, typeof key === 'string' ? key : undefined);
      sendJson(response, result.status, result.body);
      return;
    }
    if (
      segments[0] === 'w' &&
      segments[2] === 'blocks' &&
      segments[4] === 'snapshot' &&
      method === 'GET'
    ) {
      const download = await getSnapshot(ctx, segments[1], segments[3]);
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': download.bytes.length,
        'content-disposition': `attachment; filename="${download.filename}"`,
        'cache-control': 'no-store',
      });
      response.end(Buffer.from(download.bytes));
      return;
    }
    const result = await route(ctx);
    if (ctx.cookies.length > 0) response.setHeader('set-cookie', ctx.cookies);
    if (result.status === 204 || result.body === null) {
      sendEmpty(response, result.status);
      return;
    }
    sendJson(response, result.status, result.body);
  } catch (error) {
    if (ctx.cookies.length > 0) response.setHeader('set-cookie', ctx.cookies);
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendJson(response, 500, { error: 'Not found' });
  }
}
