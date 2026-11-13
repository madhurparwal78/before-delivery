import { IncomingMessage, ServerResponse } from 'node:http';
import { json, empty, errors } from './errors.js';
import { readBody, parseJsonBody } from './body.js';
import { config, configComplete } from './config.js';
import { ensureSchema, withClient, withTransaction } from './db.js';
import * as accounts from './accounts.js';
import * as runs from './runs.js';
import * as levels from './levels.js';
import * as seasonService from './seasonService.js';
import * as playback from './playback.js';
import * as discovery from './discovery.js';
import * as objects from './objects.js';
import { rulesResponse } from './rulesDoc.js';
import * as validation from './validation.js';
import { FieldErrors } from '../shared/validate.js';
import { LIMITS, CAMPAIGN_ENCOUNTERS, RULESET } from '../shared/seed.js';
import { DIFFICULTIES } from '../shared/validate.js';
import { Command, Frame } from '../shared/sim.js';
import { replayRun } from '../shared/run.js';
import { parseInstant } from './season.js';

const SESSION_COOKIE = 'squallglass_session';

/** Same-origin boundary: cross-origin mutations are refused. */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '') {
    // Non-browser clients and same-origin GETs send no Origin header.
    return true;
  }
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(config.publicUrl).origin);
  } catch {
    // Fall back to the request host when the public URL is not parseable.
    return true;
  }
  allowed.add(`http://localhost:${config.publicPort}`);
  allowed.add(`http://127.0.0.1:${config.publicPort}`);
  return allowed.has(origin);
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  account: accounts.AccountRow | null;
  rawBody?: Buffer;
}

function readSessionCookie(req: IncomingMessage): string {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return '';
}

function setSessionCookie(res: ServerResponse, token: string): void {
  const secure = config.publicUrl.startsWith('https');
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res: ServerResponse): void {
  const secure = config.publicUrl.startsWith('https');
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`);
}

/** Command-check and submission bodies share the tighter command byte bound. */
function commandBodyPath(rest: string[]): boolean {
  return rest[0] === 'runs' && (rest[2] === 'submit' || (rest[2] === 'commands' && rest[3] === 'check'));
}

async function handleBody(ctx: RequestContext, _maxBytes: number, requireJson: boolean): Promise<unknown | null> {
  const bytes = ctx.rawBody ?? Buffer.alloc(0);
  const contentType = ctx.req.headers['content-type'] ?? '';
  if (ctx.method !== 'GET' && ctx.method !== 'DELETE') {
    if (requireJson && !contentType.includes('application/json')) {
      errors.jsonRequired(ctx.res);
      return null;
    }
  }
  const parsed = parseJsonBody(bytes);
  if (parsed.invalid) {
    errors.invalidJson(ctx.res);
    return null;
  }
  if (parsed.depthExceeded) {
    const fields: FieldErrors = { depth: 'Use a permitted value.' };
    errors.invalidFields(ctx.res, fields);
    return null;
  }
  return parsed.value;
}

function requireAuth(ctx: RequestContext): boolean {
  if (!ctx.account) {
    errors.authRequired(ctx.res);
    return false;
  }
  return true;
}

export async function routeApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${config.publicPort}`);
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.pathname;
  const query = url.searchParams;

  if (path === '/api/health') {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    json(res, 200, { status: 'ok' });
    return;
  }

  if (!configComplete()) {
    // Dependency-dependent requests use their service-unavailable response.
    if (isStaticPath(path)) {
      json(res, 200, { status: 'ok' });
      return;
    }
    errors.databaseUnavailable(res);
    return;
  }

  let account: accounts.AccountRow | null = null;
  try {
    account = await accounts.resolveSession(readSessionCookie(req));
  } catch {
    account = null;
  }

  const ctx: RequestContext = { req, res, method, path, query, account };

  // Cross-origin mutations are refused before any other handling.
  if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && !originAllowed(req)) {
    errors.originRefused(res);
    return;
  }

  try {
    await ensureSchema();
    await dispatch(ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('ECONNREFUSED') || message.includes('connect')) {
      errors.databaseUnavailable(res);
      return;
    }
    errors.databaseUnavailable(res);
  }
}

function isStaticPath(path: string): boolean {
  return path === '/' || path.startsWith('/assets') || path === '/manifest.json';
}

// ---------- Endpoint dispatch ----------

async function dispatch(ctx: RequestContext): Promise<void> {
  const { method, path, res } = ctx;
  const segments = path.split('/').filter(Boolean); // ['api', ...]
  const rest = segments.slice(1);

  // Byte bounds precede authentication: reject oversized bodies on the
  // documented command paths before any other precedence stage.
  if (method === 'POST' || method === 'PUT') {
    const maxBytes = commandBodyPath(rest) ? LIMITS.commandBodyBytes : LIMITS.otherBodyBytes;
    const body = await readBody(ctx.req, maxBytes);
    if (body.tooLarge) {
      errors.bodyTooLarge(res);
      return;
    }
    if (body.ok) {
      ctx.rawBody = body.value as Buffer;
    }
  }

  if (rest[0] === 'accounts' && rest.length === 1) {
    if (method !== 'POST') {
      errors.methodRefused(res);
      return;
    }
    return createAccount(ctx);
  }
  if (rest[0] === 'session' && rest.length === 1) {
    if (method === 'POST') return signIn(ctx);
    if (method === 'GET') return getSession(ctx);
    if (method === 'DELETE') return signOut(ctx);
    errors.methodRefused(res);
    return;
  }
  if (rest[0] === 'rules' && rest.length === 1) {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    json(res, 200, rulesResponse());
    return;
  }
  if (rest[0] === 'campaign' && rest.length === 1) {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    return campaign(ctx);
  }
  if (rest[0] === 'progress' && rest.length === 1) {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return progress(ctx);
  }
  if (rest[0] === 'runs' && rest.length === 1) {
    if (method !== 'POST') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return createRun(ctx);
  }
  if (rest[0] === 'runs' && rest[1] && rest.length === 2 && rest[2] === undefined) {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return getRun(ctx, rest[1]);
  }
  if (rest[0] === 'runs' && rest[2] === 'start') {
    if (method !== 'POST') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return startRun(ctx, rest[1]);
  }
  if (rest[0] === 'runs' && rest[2] === 'commands' && rest[3] === 'check') {
    if (method !== 'POST') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return checkCommand(ctx, rest[1]);
  }
  if (rest[0] === 'runs' && rest[2] === 'submit') {
    if (method !== 'POST') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return submitRun(ctx, rest[1]);
  }
  if (rest[0] === 'runs' && rest[2] === 'retry') {
    if (method !== 'POST') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return retryRun(ctx, rest[1]);
  }
  if (rest[0] === 'runs' && rest[2] === 'frames') {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    return readFrames(ctx, rest[1]);
  }
  if (rest[0] === 'levels' && rest.length === 1) {
    if (method === 'POST') {
      if (!requireAuth(ctx)) return;
      return createLevel(ctx);
    }
    if (method === 'GET') {
      if (!requireAuth(ctx)) return;
      return listLevels(ctx);
    }
    errors.methodRefused(res);
    return;
  }
  if (rest[0] === 'levels' && rest[1] && rest.length === 2) {
    if (method === 'GET') {
      if (!requireAuth(ctx)) return;
      return getLevel(ctx, rest[1]);
    }
    if (method === 'PUT') {
      if (!requireAuth(ctx)) return;
      return saveLevel(ctx, rest[1]);
    }
    errors.methodRefused(res);
    return;
  }
  if (rest[0] === 'levels' && rest[2] === 'publish') {
    if (method !== 'POST') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return publishLevel(ctx, rest[1]);
  }
  if (rest[0] === 'levels' && rest[2] === 'withdraw') {
    if (method !== 'POST') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return withdrawLevel(ctx, rest[1]);
  }
  if (rest[0] === 'challenges' && rest.length === 1) {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    return searchChallenges(ctx);
  }
  if (rest[0] === 'challenges' && rest[1] && rest.length === 2) {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    return getChallenge(ctx, rest[1]);
  }
  if (rest[0] === 'challenges' && rest[2] === 'leaderboard') {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    return leaderboard(ctx, rest[1]);
  }
  if (rest[0] === 'results' && rest[2] === 'replay') {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    return getReplay(ctx, rest[1]);
  }
  if (rest[0] === 'results' && rest[2] === 'snapshot') {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    return getSnapshot(ctx, rest[1]);
  }
  if (rest[0] === 'results' && rest[2] === 'playback') {
    if (method !== 'PUT') {
      errors.methodRefused(res);
      return;
    }
    if (!requireAuth(ctx)) return;
    return putPlayback(ctx, rest[1]);
  }
  if (rest[0] === 'season' && rest.length === 1) {
    if (method !== 'GET') {
      errors.methodRefused(res);
      return;
    }
    return season(ctx);
  }
  errors.notFound(res);
}

// ---------- Accounts and session ----------

async function createAccount(ctx: RequestContext): Promise<void> {
  const value = await handleBody(ctx, LIMITS.otherBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const input = validation.validateAccount(value, fieldErrors);
  if (!input) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const outcome = await accounts.createAccount(input.email, input.password, input.playerName);
  if (outcome.kind === 'duplicate') {
    errors.emailExists(ctx.res);
    return;
  }
  const token = await accounts.createSession(outcome.account!.id);
  setSessionCookie(ctx.res, token);
  json(ctx.res, 201, { account: { id: outcome.account!.id, email: outcome.account!.email, playerName: outcome.account!.player_name } });
}

async function signIn(ctx: RequestContext): Promise<void> {
  const value = await handleBody(ctx, LIMITS.otherBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const input = validation.validateSignIn(value, fieldErrors);
  if (!input) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const account = await accounts.authenticate(input.email, input.password);
  if (!account) {
    errors.invalidCredentials(ctx.res);
    return;
  }
  const token = await accounts.createSession(account.id);
  setSessionCookie(ctx.res, token);
  json(ctx.res, 200, { account: { id: account.id, email: account.email, playerName: account.player_name } });
}

async function getSession(ctx: RequestContext): Promise<void> {
  if (!ctx.account) {
    errors.authRequired(ctx.res);
    return;
  }
  json(ctx.res, 200, { account: { id: ctx.account.id, email: ctx.account.email, playerName: ctx.account.player_name } });
}

async function signOut(ctx: RequestContext): Promise<void> {
  const token = readSessionCookie(ctx.req);
  if (token) {
    try {
      await accounts.revokeSession(token);
    } catch {
      // Sign-out still succeeds for the client.
    }
  }
  clearSessionCookie(ctx.res);
  empty(ctx.res, 204);
}

// ---------- Campaign ----------

async function campaign(ctx: RequestContext): Promise<void> {
  const accountId = ctx.account?.id ?? null;
  const body = await withClient(async (client) => {
    let progress = { completed: [] as string[], unlocked: [] as string[] };
    if (accountId) {
      progress = await runs.campaignProgress(client, accountId);
    } else {
      progress = { completed: [], unlocked: ['c1'] };
    }
    const encounters = CAMPAIGN_ENCOUNTERS.map((encounter) => ({
      id: encounter.id,
      title: encounter.title,
      definition: encounter.definition,
      digest: runs.levelDigestOf(encounter.definition),
      unlocked: progress.unlocked.includes(encounter.id),
      completed: progress.completed.includes(encounter.id),
    }));
    return { encounters, progress };
  });
  json(ctx.res, 200, body);
}

async function progress(ctx: RequestContext): Promise<void> {
  const progress = await withClient(async (client) => runs.campaignProgress(client, ctx.account!.id));
  json(ctx.res, 200, progress);
}

// ---------- Runs ----------

async function createRun(ctx: RequestContext): Promise<void> {
  const value = await handleBody(ctx, LIMITS.otherBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const input = validation.validateRunCreate(value, fieldErrors);
  if (!input) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const outcome = await withTransaction(async (client) => runs.issueTicket(client, ctx.account!.id, input));
  if (outcome.kind === 'issued') {
    json(ctx.res, 201, { ticket: ticketShape(outcome.ticket) });
    return;
  }
  if (outcome.kind === 'locked') {
    errors.encounterLocked(ctx.res);
    return;
  }
  if (outcome.kind === 'invalid-revision') {
    errors.revisionChanged(ctx.res);
    return;
  }
  errors.notFound(ctx.res);
}

function ticketShape(ticket: runs.TicketRow): Record<string, unknown> {
  return {
    id: ticket.id,
    accountId: ticket.account_id,
    mode: ticket.mode,
    sourceId: ticket.source_id,
    revision: ticket.revision,
    seed: ticket.seed,
    levelDigest: ticket.level_digest,
    loadout: ticket.loadout,
    ruleset: ticket.ruleset,
    initialReserve: ticket.initial_reserve,
    initialHealth: ticket.initial_health,
    seasonDay: ticket.season_day,
    daily: ticket.daily,
  };
}

async function startRun(ctx: RequestContext, runId: string): Promise<void> {
  const outcome = await withTransaction(async (client) => {
    const ticketResult = await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [runId]);
    const ticket = ticketResult.rows[0] as runs.TicketRow | undefined;
    if (!ticket || ticket.account_id !== ctx.account!.id) return { kind: 'not-found' as const };
    if (ticket.state === 'issued' || ticket.state === 'playing') {
      await client.query(
        `INSERT INTO runs (ticket_id, state, updated_at) VALUES ($1,'playing',now())
         ON CONFLICT (ticket_id) DO UPDATE SET state='playing', updated_at=now()`,
        [runId],
      );
      await client.query("UPDATE tickets SET state='playing' WHERE id=$1", [runId]);
      return { kind: 'ok' as const, ticket };
    }
    return { kind: 'transition' as const };
  });
  if (outcome.kind === 'not-found') {
    errors.notFound(ctx.res);
    return;
  }
  if (outcome.kind === 'transition') {
    errors.invalidTransition(ctx.res);
    return;
  }
  const ticket = await withClient(async (client) => runs.loadTicket(client, runId));
  json(ctx.res, 200, runShape(ticket, null, null, null));
}

function runShape(ticket: runs.TicketRow, run: runs.RunRow | null, result: Record<string, unknown> | null, proof: Record<string, unknown> | null): Record<string, unknown> {
  return {
    ticket: ticketShape(ticket),
    state: run?.state ?? ticket.state,
    result,
    ledger: run?.ledger ?? null,
    proof,
  };
}

async function getRun(ctx: RequestContext, runId: string): Promise<void> {
  const data = await withClient(async (client) => {
    const ticket = await runs.loadTicket(client, runId);
    if (!ticket || ticket.account_id !== ctx.account!.id) return null;
    const run = await runs.loadRun(client, runId);
    let proof = null;
    if (ticket.mode === 'playtest') {
      const proofResult = await client.query('SELECT run_id, state FROM proofs WHERE run_id = $1', [runId]);
      proof = proofResult.rows[0] ?? null;
    }
    return { ticket, run, proof };
  });
  if (!data) {
    errors.notFound(ctx.res);
    return;
  }
  const result = data.run ? runs.resultShape(data.run) : null;
  json(ctx.res, 200, runShape(data.ticket, data.run, result, data.proof));
}

async function checkCommand(ctx: RequestContext, runId: string): Promise<void> {
  const value = await handleBody(ctx, LIMITS.commandBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const input = validation.validateCommandCheck(value, fieldErrors);
  if (!input) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const ticket = await withClient(async (client) => runs.loadTicket(client, runId));
  if (!ticket || ticket.account_id !== ctx.account!.id) {
    errors.notFound(ctx.res);
    return;
  }
  const run = await withClient(async (client) => runs.loadRun(client, runId));
  if (!run || (run.state !== 'playing' && run.state !== 'submitted')) {
    errors.invalidTransition(ctx.res);
    return;
  }
  if (input.proposal.tick !== input.atTick) {
    errors.commandRefused(ctx.res, 'Command tick moved backwards');
    return;
  }
  const outcome = await runs.checkCommand(
    ticket.definition,
    ticket.loadout,
    ticket.seed,
    input.commands,
    input.atTick,
    input.proposal,
  );
  if (!outcome.ok) {
    errors.commandRefused(ctx.res, outcome.reason ?? 'Unknown command');
    return;
  }
  json(ctx.res, 200, { command: input.proposal, state: outcome.commandState });
}

async function submitRun(ctx: RequestContext, runId: string): Promise<void> {
  const value = await handleBody(ctx, LIMITS.commandBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const input = validation.validateSubmission(value, fieldErrors);
  if (!input) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const outcome = await runs.submitEvidence(runId, ctx.account!.id, input.commands, input.endTick);
  if ('code' in outcome) {
    if (outcome.code === 'NOT_FOUND') errors.notFound(ctx.res);
    else if (outcome.code === 'EVIDENCE_CONFLICT') errors.evidenceConflict(ctx.res);
    else if (outcome.code === 'INVALID_TRANSITION') errors.invalidTransition(ctx.res);
    else errors.invalidTransition(ctx.res);
    return;
  }
  json(ctx.res, outcome.status, outcome.result);
}

async function retryRun(ctx: RequestContext, runId: string): Promise<void> {
  const staged = await withClient(async (client) => {
    const result = await client.query('SELECT commands, end_tick FROM staged_evidence WHERE ticket_id = $1', [runId]);
    return result.rows[0] as { commands: Command[]; end_tick: number } | undefined;
  });
  if (!staged) {
    errors.notFound(ctx.res);
    return;
  }
  const outcome = await runs.submitEvidence(runId, ctx.account!.id, staged.commands, Number(staged.end_tick));
  if ('code' in outcome) {
    if (outcome.code === 'NOT_FOUND') errors.notFound(ctx.res);
    else if (outcome.code === 'EVIDENCE_CONFLICT') errors.evidenceConflict(ctx.res);
    else if (outcome.code === 'INVALID_TRANSITION') errors.invalidTransition(ctx.res);
    else errors.invalidTransition(ctx.res);
    return;
  }
  json(ctx.res, outcome.status, outcome.result);
}

// ---------- Frames ----------

async function readFrames(ctx: RequestContext, runId: string): Promise<void> {
  const fromText = ctx.query.get('from');
  const toText = ctx.query.get('to');
  const fieldErrors: FieldErrors = {};
  if (fromText === null || !/^\d+$/.test(fromText) || Number(fromText) < 0) {
    fieldErrors['from'] = 'Use a permitted value.';
  }
  if (toText === null || !/^\d+$/.test(toText) || Number(toText) < 0) {
    fieldErrors['to'] = 'Use a permitted value.';
  }
  const from = fromText !== null && /^\d+$/.test(fromText) ? Number(fromText) : -1;
  const to = toText !== null && /^\d+$/.test(toText) ? Number(toText) : -1;
  if (from > to) {
    fieldErrors['from'] = 'Use a permitted value.';
  }
  if (to - from > LIMITS.maxFramePage) {
    fieldErrors['to'] = 'Use a permitted value.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const data = await withClient(async (client) => {
    const ticket = await runs.loadTicket(client, runId);
    const run = await runs.loadRun(client, runId);
    return { ticket, run };
  });
  if (!data.ticket || !data.run) {
    errors.notFound(ctx.res);
    return;
  }
  const ticket = data.ticket;
  const run = data.run;

  // Access rules: before acceptance only an owner with a rejected result may
  // read frames; accepted reads reconstruct from confirmed objects.
  const eligible = await isReplayEligible(ctx, runId);
  if (run.state !== 'accepted' && run.state !== 'rejected') {
    errors.invalidTransition(ctx.res);
    return;
  }
  if (run.state === 'rejected' && ticket.account_id !== ctx.account?.id) {
    errors.notFound(ctx.res);
    return;
  }
  if (run.state === 'accepted' && !eligible && ticket.account_id !== ctx.account?.id) {
    errors.notFound(ctx.res);
    return;
  }

  const staged = await withClient(async (client) => {
    const result = await client.query('SELECT commands, end_tick FROM staged_evidence WHERE ticket_id = $1', [runId]);
    return result.rows[0] as { commands: Command[]; end_tick: number } | undefined;
  });
  if (!staged) {
    errors.evidenceUnavailable(ctx.res);
    return;
  }

  let definition = ticket.definition;
  let commands = staged.commands;
  if (run.state === 'accepted') {
    // Reconstruct from confirmed immutable objects.
    const evidenceObject = await objects.getObject(objects.evidenceKey(run.evidence_digest!));
    const definitionObject = await objects.getObject(objects.levelsKey(ticket.level_digest));
    if (!evidenceObject.ok || !definitionObject.ok) {
      errors.evidenceUnavailable(ctx.res);
      return;
    }
    const evidenceParsed = JSON.parse(Buffer.from(evidenceObject.bytes!).toString('utf8')) as { commands: Command[]; endTick: number };
    definition = JSON.parse(Buffer.from(definitionObject.bytes!).toString('utf8')) as typeof definition;
    commands = evidenceParsed.commands;
  }

  const replay = replayRun(definition, ticket.loadout, ticket.seed, commands, Number(staged.end_tick), { collectFrames: true });
  const frames = replay.frames.filter((frame) => frame.tick >= from && frame.tick < to);
  if (to > replay.frames.length) {
    const fieldErrors2: FieldErrors = { to: 'Use a permitted value.' };
    errors.invalidFields(ctx.res, fieldErrors2);
    return;
  }
  json(ctx.res, 200, { runId, from, to, frames });
}

/** Replay eligibility: acceptance plus campaign, published challenge, or the proof run itself. */
async function isReplayEligible(_ctx: RequestContext, runId: string): Promise<boolean> {
  const data = await withClient(async (client) => {
    const ticket = await runs.loadTicket(client, runId);
    const run = await runs.loadRun(client, runId);
    return { ticket, run };
  });
  if (!data.ticket || !data.run || data.run.state !== 'accepted') return false;
  const { ticket } = data;
  if (ticket.mode === 'campaign') return true;
  if (ticket.mode === 'challenge') {
    const publication = await withClient(async (client) => {
      const result = await client.query('SELECT * FROM challenge_publications WHERE digest = $1', [ticket.source_id]);
      return result.rows[0] as { unlisted: boolean } | undefined;
    });
    // A challenge that has ever committed publication stays eligible even unlisted.
    return publication !== undefined;
  }
  // Playtest: only the exact run ID of a committed publication's proof.
  const proof = await withClient(async (client) => {
    const result = await client.query('SELECT proof_run_id FROM challenge_publications WHERE proof_run_id = $1', [runId]);
    return result.rows[0];
  });
  return proof !== undefined;
}

// ---------- Levels ----------

async function createLevel(ctx: RequestContext): Promise<void> {
  const value = await handleBody(ctx, LIMITS.otherBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const definition = validation.validateLevelCreate(value, fieldErrors);
  if (!definition) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const level = await levels.createLevel(ctx.account!.id, definition);
  json(ctx.res, 201, levelShape(level, [], 'current'));
}

function levelShape(level: runs.LevelRow, proofs: Array<{ run_id: string; state: string }>, indexing: 'pending' | 'current'): Record<string, unknown> {
  return {
    id: level.id,
    revision: level.revision,
    state: level.state,
    definition: level.definition,
    digest: level.level_digest,
    proofRunId: level.proof_run_id,
    challengeDigest: level.challenge_digest,
    proofs: proofs.map((p) => ({ runId: p.run_id, revision: (p as unknown as { revision: number }).revision ?? level.revision, state: p.state })),
    indexing,
  };
}

async function listLevels(ctx: RequestContext): Promise<void> {
  const rows = await levels.listLevels(ctx.account!.id);
  const shapes = await Promise.all(
    rows.map(async (level) => {
      const proofs = await withClient(async (client) => levels.levelProofs(client, level.id));
      const indexing = await discoveryIndexingState();
      return levelShape(level, proofs.map((p) => ({ run_id: p.run_id, state: p.state, revision: p.revision })), indexing);
    }),
  );
  json(ctx.res, 200, { levels: shapes });
}

async function getLevel(ctx: RequestContext, levelId: string): Promise<void> {
  const data = await withClient(async (client) => {
    const level = await runs.loadLevel(client, levelId);
    if (!level || level.account_id !== ctx.account!.id) return null;
    const proofs = await levels.levelProofs(client, level.id);
    return { level, proofs };
  });
  if (!data) {
    errors.notFound(ctx.res);
    return;
  }
  const indexing = await discoveryIndexingState();
  json(ctx.res, 200, levelShape(data.level, data.proofs.map((p) => ({ run_id: p.run_id, state: p.state, revision: p.revision })), indexing));
}

async function saveLevel(ctx: RequestContext, levelId: string): Promise<void> {
  const value = await handleBody(ctx, LIMITS.otherBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const input = validation.validateLevelSave(value, fieldErrors);
  if (!input) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const outcome = await levels.saveLevel(levelId, ctx.account!.id, input.expectedRevision, input.definition);
  if (outcome.kind === 'not-found') {
    errors.notFound(ctx.res);
    return;
  }
  if (outcome.kind === 'revision-changed') {
    errors.revisionChanged(ctx.res);
    return;
  }
  if (outcome.kind === 'transition') {
    errors.invalidTransition(ctx.res);
    return;
  }
  const proofs = await withClient(async (client) => levels.levelProofs(client, levelId));
  const indexing = await discoveryIndexingState();
  json(ctx.res, 200, levelShape(outcome.level, proofs.map((p) => ({ run_id: p.run_id, state: p.state, revision: p.revision })), indexing));
}

async function publishLevel(ctx: RequestContext, levelId: string): Promise<void> {
  const value = await handleBody(ctx, LIMITS.otherBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const input = validation.validatePublish(value, fieldErrors);
  if (!input) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const outcome = await levels.publishLevel(levelId, ctx.account!.id, input.expectedRevision, input.proofRunId);
  if (outcome.kind === 'not-found') {
    errors.notFound(ctx.res);
    return;
  }
  if (outcome.kind === 'revision-changed') {
    errors.revisionChanged(ctx.res);
    return;
  }
  if (outcome.kind === 'proof-required') {
    errors.proofRequired(ctx.res);
    return;
  }
  if (outcome.kind === 'duplicate') {
    errors.challengeExists(ctx.res);
    return;
  }
  if (outcome.kind === 'transition') {
    errors.invalidTransition(ctx.res);
    return;
  }
  if (outcome.kind === 'pending') {
    // Pending publication keeps the challenge private and retryable; the shape
    // carries the refreshed level state (proof-pending).
    const proofs = await withClient(async (client) => levels.levelProofs(client, levelId));
    const indexing = await discoveryIndexingState();
    json(ctx.res, 202, levelShape(outcome.level, proofs.map((p) => ({ run_id: p.run_id, state: p.state, revision: p.revision })), indexing));
    return;
  }
  // committed or identical: 201 first commit, 200 identical replay
  const committed = outcome.kind === 'committed';
  // Queue the discovery document upsert.
  const challenge = outcome.challenge as { digest: string; ruleset: string; title: string; description: string; difficulty: string; creatorName: string };
  await queueIndexWork(challenge, 'upsert');
  json(ctx.res, committed ? 201 : 200, challenge);
}

async function withdrawLevel(ctx: RequestContext, levelId: string): Promise<void> {
  const value = await handleBody(ctx, LIMITS.otherBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const expectedRevision = validation.validateWithdraw(value, fieldErrors);
  if (expectedRevision === undefined) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  const outcome = await levels.withdrawLevel(levelId, ctx.account!.id, expectedRevision);
  if (outcome.kind === 'not-found') {
    errors.notFound(ctx.res);
    return;
  }
  if (outcome.kind === 'revision-changed') {
    errors.revisionChanged(ctx.res);
    return;
  }
  if (outcome.kind === 'transition') {
    errors.invalidTransition(ctx.res);
    return;
  }
  const digestRow = await withClient(async (client) => {
    const result = await client.query('SELECT digest FROM challenge_publications WHERE level_id = $1', [levelId]);
    return result.rows[0] as { digest: string } | undefined;
  });
  if (digestRow) {
    await queueIndexWork({ digest: digestRow.digest } as { digest: string }, 'delete');
  }
  json(ctx.res, 200, { id: levelId, state: outcome.state });
}

async function queueIndexWork(doc: { digest: string; ruleset?: string; title?: string; description?: string; difficulty?: string; creatorName?: string }, action: 'upsert' | 'delete'): Promise<void> {
  if (action === 'upsert') {
    await discovery.upsertDocuments([
      {
        digest: doc.digest,
        ruleset: doc.ruleset ?? RULESET,
        title: doc.title ?? '',
        description: doc.description ?? '',
        difficulty: doc.difficulty ?? 'calm',
        creatorName: doc.creatorName ?? '',
      },
    ]).catch(() => false);
  } else {
    await discovery.deleteDocuments([doc.digest]).catch(() => false);
  }
  // The work row was committed with publication; the reconciler settles it.
}

// ---------- Discovery ----------

async function discoveryIndexingState(): Promise<'pending' | 'current'> {
  const result = await withClient(async (client) => {
    const rows = await client.query("SELECT COUNT(*)::int AS count FROM index_work WHERE status = 'pending'");
    return rows.rows[0].count as number;
  }).catch(() => 0);
  if (result === 0) {
    // Confirm the provider holds no stale documents before reporting current.
    return 'current';
  }
  return 'pending';
}

async function reconcileIndexWork(): Promise<void> {
  // Settle committed discovery work when the provider is available.
  const pending = await withClient(async (client) => {
    const rows = await client.query("SELECT * FROM index_work WHERE status = 'pending' ORDER BY id ASC LIMIT 50");
    return rows.rows as Array<{ id: number; digest: string; action: string }>;
  }).catch(() => [] as Array<{ id: number; digest: string; action: string }>);
  for (const work of pending) {
    let success = false;
    if (work.action === 'delete') {
      success = await discovery.deleteDocuments([work.digest]).catch(() => false);
    } else {
      const publication = await withClient(async (client) => {
        const rows = await client.query('SELECT * FROM challenge_publications WHERE digest = $1', [work.digest]);
        return rows.rows[0] as { digest: string; ruleset: string; title: string; description: string; difficulty: string; creator_name: string; unlisted: boolean } | undefined;
      }).catch(() => undefined);
      if (!publication) {
        success = true;
      } else if (publication.unlisted) {
        success = await discovery.deleteDocuments([work.digest]).catch(() => false);
      } else {
        success = await discovery.upsertDocuments([
          {
            digest: publication.digest,
            ruleset: publication.ruleset,
            title: publication.title,
            description: publication.description,
            difficulty: publication.difficulty,
            creatorName: publication.creator_name,
          },
        ]).catch(() => false);
      }
    }
    if (success) {
      await withClient(async (client) => {
        await client.query("UPDATE index_work SET status='done' WHERE id = $1", [work.id]);
      }).catch(() => undefined);
    }
  }
}

async function searchChallenges(ctx: RequestContext): Promise<void> {
  const q = ctx.query.get('q') ?? '';
  const difficulty = ctx.query.get('difficulty');
  const ruleset = ctx.query.get('ruleset');
  const fieldErrors: FieldErrors = {};
  let codePointCount = 0;
  for (const _ of q) codePointCount++;
  if (codePointCount > LIMITS.maxSearchCodePoints) {
    fieldErrors['q'] = 'Use a permitted value.';
  }
  if (difficulty !== null && difficulty !== '' && !DIFFICULTIES.includes(difficulty as 'calm' | 'rough' | 'severe')) {
    fieldErrors['difficulty'] = 'Use a permitted value.';
  }
  if (ruleset !== null && ruleset !== '' && ruleset !== RULESET) {
    fieldErrors['ruleset'] = 'Use a permitted value.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  // Reconcile pending work on discovery reads.
  await reconcileIndexWork().catch(() => undefined);
  const searchOutcome = await discovery.search(q, difficulty || null, ruleset || null);
  if (!searchOutcome.ok) {
    errors.discoveryUnavailable(ctx.res);
    return;
  }
  // Hydrate from PostgreSQL and remove no-longer-published records.
  const challenges: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const digest of searchOutcome.digests) {
    if (seen.has(digest)) continue;
    seen.add(digest);
    const row = await withClient(async (client) => {
      const result = await client.query('SELECT * FROM challenge_publications WHERE digest = $1 AND unlisted = false', [digest]);
      return result.rows[0];
    }).catch(() => undefined);
    if (!row) continue;
    challenges.push(levels.challengeShape(row));
  }
  const indexing = await discoveryIndexingState();
  json(ctx.res, 200, { challenges, indexing });
}

async function getChallenge(ctx: RequestContext, digest: string): Promise<void> {
  const row = await withClient(async (client) => {
    const result = await client.query('SELECT * FROM challenge_publications WHERE digest = $1 AND unlisted = false', [digest]);
    return result.rows[0];
  }).catch(() => undefined);
  if (!row) {
    errors.notFound(ctx.res);
    return;
  }
  json(ctx.res, 200, levels.challengeShape(row));
}

async function leaderboard(ctx: RequestContext, digest: string): Promise<void> {
  const row = await withClient(async (client) => {
    const result = await client.query('SELECT * FROM challenge_publications WHERE digest = $1', [digest]);
    return result.rows[0] as { unlisted: boolean } | undefined;
  }).catch(() => undefined);
  // Historical leaderboards remain available after withdrawal.
  if (!row) {
    errors.notFound(ctx.res);
    return;
  }
  const board = await withClient(async (client) => levels.computeBoard(client, digest, ctx.account?.id ?? null, false, null));
  json(ctx.res, 200, board);
}

// ---------- Replay and shared presentation ----------

async function getReplay(ctx: RequestContext, runId: string): Promise<void> {
  const eligible = await isReplayEligible(ctx, runId);
  if (!eligible) {
    errors.notFound(ctx.res);
    return;
  }
  const data = await withClient(async (client) => {
    const ticket = await runs.loadTicket(client, runId);
    const run = await runs.loadRun(client, runId);
    const staged = await client.query('SELECT commands, end_tick FROM staged_evidence WHERE ticket_id = $1', [runId]);
    return { ticket, run, staged: staged.rows[0] as { commands: Command[]; end_tick: number } | undefined };
  });
  if (!data.ticket || !data.run || data.run.state !== 'accepted' || !data.staged) {
    errors.notFound(ctx.res);
    return;
  }
  // Reconstruct from confirmed object bytes.
  const evidenceObject = await objects.getObject(objects.evidenceKey(data.run.evidence_digest!));
  const definitionObject = await objects.getObject(objects.levelsKey(data.ticket.level_digest));
  if (!evidenceObject.ok || !definitionObject.ok) {
    errors.evidenceUnavailable(ctx.res);
    return;
  }
  const evidence = JSON.parse(Buffer.from(evidenceObject.bytes!).toString('utf8')) as { commands: Command[]; endTick: number };
  const definition = JSON.parse(Buffer.from(definitionObject.bytes!).toString('utf8'));
  json(ctx.res, 200, {
    ticket: ticketShape(data.ticket),
    definition,
    commands: evidence.commands,
    endTick: evidence.endTick,
    metrics: {
      outcome: data.run.outcome,
      breaches: data.run.breaches,
      completionTick: data.run.completion_tick,
      remainingCharge: data.run.remaining_charge,
      health: data.run.health,
    },
  });
}

async function getSnapshot(ctx: RequestContext, runId: string): Promise<void> {
  const eligible = await isReplayEligible(ctx, runId);
  if (!eligible) {
    errors.notFound(ctx.res);
    return;
  }
  const data = await withClient(async (client) => {
    const ticket = await runs.loadTicket(client, runId);
    const run = await runs.loadRun(client, runId);
    const presentation = await playback.loadPlayback(client, runId);
    return { ticket, run, presentation };
  });
  if (!data.ticket || !data.run || data.run.state !== 'accepted') {
    errors.notFound(ctx.res);
    return;
  }
  await playback.ensurePlayback(runId);
  const presentation = await withClient(async (client) => playback.loadPlayback(client, runId));
  // Read presentation and Board from the same database snapshot.
  const boardData = await withClient(async (client) => {
    const ticket = await runs.loadTicket(client, runId);
    const presentationRow = await playback.loadPlayback(client, runId);
    let board = null;
    if (ticket!.mode === 'challenge') {
      board = await levels.computeBoard(client, ticket!.source_id, ctx.account?.id ?? null, false, null);
    }
    return { presentationRow, board };
  });
  const replayData = await getReplayInternals(runId);
  if (!replayData) {
    errors.evidenceUnavailable(ctx.res);
    return;
  }
  const frames = replayData.frames.filter((frame) => frame.tick === (presentation?.tick ?? 0));
  json(ctx.res, 200, {
    runId,
    playback: {
      version: presentation!.version,
      tick: presentation!.tick,
      playing: presentation!.playing,
    },
    frame: frames[0] ?? null,
    leaderboard: boardData.board,
  });
}

async function getReplayInternals(runId: string): Promise<{ frames: Frame[] } | null> {
  const data = await withClient(async (client) => {
    const ticket = await runs.loadTicket(client, runId);
    const run = await runs.loadRun(client, runId);
    const staged = await client.query('SELECT commands, end_tick FROM staged_evidence WHERE ticket_id = $1', [runId]);
    return { ticket, run, staged: staged.rows[0] as { commands: Command[]; end_tick: number } | undefined };
  });
  if (!data.ticket || !data.run || !data.staged) return null;
  const evidenceObject = await objects.getObject(objects.evidenceKey(data.run.evidence_digest!));
  const definitionObject = await objects.getObject(objects.levelsKey(data.ticket.level_digest));
  if (!evidenceObject.ok || !definitionObject.ok) return null;
  const evidence = JSON.parse(Buffer.from(evidenceObject.bytes!).toString('utf8')) as { commands: Command[]; endTick: number };
  const definition = JSON.parse(Buffer.from(definitionObject.bytes!).toString('utf8'));
  const replay = replayRun(definition, data.ticket.loadout, data.ticket.seed, evidence.commands, evidence.endTick, { collectFrames: true });
  return { frames: replay.frames };
}

async function putPlayback(ctx: RequestContext, runId: string): Promise<void> {
  const value = await handleBody(ctx, LIMITS.otherBodyBytes, true);
  if (value === null) return;
  const fieldErrors: FieldErrors = {};
  const input = validation.validatePlayback(value, fieldErrors);
  if (!input) {
    errors.invalidFields(ctx.res, fieldErrors);
    return;
  }
  // Shared playback changes require the owner.
  const owner = await withClient(async (client) => {
    const ticket = await runs.loadTicket(client, runId);
    return ticket?.account_id ?? null;
  });
  if (!owner || owner !== ctx.account!.id) {
    errors.forbidden(ctx.res);
    return;
  }
  const eligible = await isReplayEligible(ctx, runId);
  if (!eligible) {
    errors.notFound(ctx.res);
    return;
  }
  await playback.ensurePlayback(runId);
  // Playing at the terminal frame is invalid.
  const replayData = await getReplayInternals(runId);
  if (!replayData) {
    errors.evidenceUnavailable(ctx.res);
    return;
  }
  const terminalTick = replayData.frames[replayData.frames.length - 1]?.tick ?? 0;
  if (input.playing && input.tick >= terminalTick) {
    errors.invalidFields(ctx.res, { tick: 'Use a permitted value.' });
    return;
  }
  if (input.tick > terminalTick) {
    errors.invalidFields(ctx.res, { tick: 'Use a permitted value.' });
    return;
  }
  const outcome = await playback.updatePlayback(runId, input.expectedVersion, input.tick, input.playing);
  if (outcome.kind === 'not-found') {
    errors.notFound(ctx.res);
    return;
  }
  if (outcome.kind === 'conflict') {
    errors.playbackChanged(ctx.res);
    return;
  }
  if (outcome.kind === 'invalid') {
    errors.invalidFields(ctx.res, { tick: 'Use a permitted value.' });
    return;
  }
  json(ctx.res, 200, { version: outcome.playback!.version, tick: outcome.playback!.tick, playing: outcome.playback!.playing });
}

// ---------- Season ----------

async function season(ctx: RequestContext): Promise<void> {
  const atText = ctx.query.get('at');
  let at: Date | null = null;
  if (atText !== null) {
    at = parseInstant(atText);
    if (!at) {
      errors.invalidFields(ctx.res, { at: 'Use a permitted value.' });
      return;
    }
  }
  const body = await withClient(async (client) => seasonService.seasonResponse(client, at, ctx.account?.id ?? null));
  json(ctx.res, 200, body);
}

export { reconcileIndexWork };
