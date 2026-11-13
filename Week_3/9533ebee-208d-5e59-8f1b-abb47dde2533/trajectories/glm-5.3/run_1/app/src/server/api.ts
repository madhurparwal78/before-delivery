import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import type { Pool, Tx } from './db.js';
import type { Ctx, Actor, Body } from './http.js';
import { sendJson, requireRole, requireActor, notFound, validateBody } from './http.js';
import { problem, ProblemError, insufficientLiquidity, STALE_BANNER, STALE_SWAP } from './problems.js';
import { getConfig } from './config.js';
import { ASSETS, isAssetCode } from '../shared/assets.js';
import type { AssetCode, Leg, PositionState, Role } from '../shared/types.js';
import { deskAmount, deskPercent, deskPrice } from '../shared/deskFormat.js';
import {
  accrueAsset, appendPosting, walletAccount, collateralAccount, loanAccount,
  lockPoolRow, poolBalances, poolRates, accountBalance,
} from './ledger.js';
import {
  currentPrices, isStale, poolView, priceApi, canonical, loadPositionRow, positionView,
  refreshAndEvaluate, positionFigures, sharePriceApi,
} from './market.js';
import { evaluatePosition, applyEvaluation, hfApi, type PositionRow } from './evaluation.js';
import { poolFigures, sharePrice, shareValue, mintShares, burnShares, splitFee, quoteMath, liquidationLimits, seizedForRepay, withinLtv, healthFactorScaled, INDEX_SCALE } from './domain.js';
import { enqueueEvent } from './outbox.js';
import { noticesFor, listNotices } from './positions.js';
import { statementText, statementHtml, type StatementInput, statementLines } from './statements.js';
import { storeResponse } from './idempotency.js';
import type { App } from './app.js';

const STALE_DRAW = STALE_BANNER;
const CLOSED_STATE: PositionState = 'closed';

export interface RouteResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  raw?: boolean;
}

type Handler = (ctx: Ctx, app: App) => Promise<RouteResult>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  needsAuth: boolean;
  keyed: boolean;
}

const routes: Route[] = [];

function route(method: string, path: string, opts: { auth?: boolean; keyed?: boolean }, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:[^/]+/g, (match): string => {
    keys.push(match.slice(1));
    return '([^/]+)';
  }).replace(/\/api/, '/api') + '$');
  routes.push({
    method,
    pattern,
    keys,
    handler,
    needsAuth: opts.auth ?? true,
    keyed: opts.keyed ?? false,
  });
}

// ---------- helpers ----------

function amountValue(raw: unknown, field: string): bigint {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
      [field]: 'Enter a whole number of minor units above zero.',
    });
  }
  return BigInt(raw);
}

function assetValue(raw: unknown, field: string): AssetCode {
  if (typeof raw !== 'string' || !isAssetCode(raw)) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { [field]: 'Choose a listed asset.' });
  }
  return raw;
}

function priceValue(raw: unknown): { scaled: bigint; text: string } {
  if (typeof raw !== 'string' || !/^\d+(\.\d{1,8})?$/.test(raw) || /^[0.]+$/.test(raw) || (raw.match(/\./g) ?? []).length > 1) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
      price: 'Enter a price above zero with at most 8 decimal places.',
    });
  }
  const [intPart, fracPart = ''] = raw.split('.');
  if (fracPart.length > 8) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
      price: 'Enter a price above zero with at most 8 decimal places.',
    });
  }
  const scaled = BigInt(intPart + fracPart.padEnd(8, '0'));
  if (scaled <= 0n) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
      price: 'Enter a price above zero with at most 8 decimal places.',
    });
  }
  return { scaled, text: raw };
}

function parseInstant(raw: string, field: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if (match === null) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { [field]: 'Send an RFC 3339 time with an offset.' });
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { [field]: 'Send an RFC 3339 time with an offset.' });
  }
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

export async function handleApi(ctx: Ctx, app: App): Promise<RouteResult> {
  for (const r of routes) {
    if (r.method !== ctx.method) continue;
    const match = r.pattern.exec(ctx.path);
    if (match === null) continue;
    for (let i = 0; i < r.keys.length; i += 1) {
      ctx.params[r.keys[i]] = decodeURIComponent(match[i + 1] ?? '');
    }
    if (r.needsAuth && ctx.actor === undefined) {
      throw problem(401, 'unauthenticated', 'Choose who you are acting as.', undefined, { 'WWW-Authenticate': 'Bearer' });
    }
    const result = await r.handler(ctx, app);
    if (r.keyed && ctx.actor !== undefined && ctx.idempotencyKey !== undefined && result.status < 500) {
      await storeResponse(app.db, ctx.actor.actor_id, endpointKey(ctx.path), ctx.idempotencyKey, result.status, result.body)
        .catch((): void => undefined);
    }
    return result;
  }
  throw notFound();
}

function endpointKey(pathname: string): string {
  const match = /^\/api\/positions\/([^/]+)\/(draws|repayments|collateral|collateral-withdrawals|liquidations)$/.exec(pathname);
  if (match !== null) return `/api/positions/:id/${match[2]}`;
  const poolMatch = /^\/api\/pools\/([^/]+)\/(supplies|withdrawals)$/.exec(pathname);
  if (poolMatch !== null) return `/api/pools/:asset/${poolMatch[2]}`;
  return pathname;
}

// ---------- sessions and actors ----------

route('GET', '/api/health', { auth: false }, async (): Promise<RouteResult> => {
  return { status: 200, body: { status: 'ok' } };
});

route('GET', '/api/actors', { auth: false }, async (_ctx, app): Promise<RouteResult> => {
  const rows = await app.db.withClient(async (client): Promise<Array<{ actor_id: string; name: string; email: string; role: Role }>> => {
    const result = await client.query<{ actor_id: string; name: string; email: string; role: Role }>(
      'SELECT actor_id, name, email, role FROM members ORDER BY name',
    );
    return result.rows;
  });
  return { status: 200, body: { actors: rows } };
});

route('POST', '/api/sessions', { auth: false }, async (ctx, app): Promise<RouteResult> => {
  const body = strictBody(ctx, { required: ['actor_id'], optional: [], types: { actor_id: 'string' } });
  const actorId = typeof body.actor_id === 'string' ? body.actor_id : '';
  const result = await app.db.withClient(async (client): Promise<{ actor_id: string; role: Role } | null> => {
    const found = await client.query<{ actor_id: string; role: Role }>('SELECT actor_id, role FROM members WHERE actor_id = $1', [actorId]);
    return found.rows[0] ?? null;
  });
  if (result === null) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { actor_id: 'Choose an existing member.' });
  }
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  await app.db.withClient(async (client): Promise<void> => {
    await client.query('INSERT INTO sessions (token, actor_id) VALUES ($1, $2)', [token, actorId]);
  });
  return { status: 201, body: { token, actor_id: actorId, role: result.role } };
});

route('GET', '/api/me', { auth: true }, async (ctx): Promise<RouteResult> => {
  const actor = requireActor(ctx);
  return { status: 200, body: { actor_id: actor.actor_id, name: actor.name, email: actor.email, role: actor.role } };
});

route('POST', '/api/actors', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  requireRole(ctx, ['risk_steward']);
  const body = strictBody(ctx, { required: ['name', 'email', 'role'], optional: [], types: { name: 'string', email: 'string', role: 'string' } });
  const rawName = body.name;
  if (typeof rawName !== 'string') throw unreachable();
  const name = rawName.normalize('NFC');
  if (name.length < 1 || [...name].length > 80) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { name: 'Enter a name of 1 to 80 characters.' });
  }
  const rawEmail = body.email;
  if (typeof rawEmail !== 'string') throw unreachable();
  const email = rawEmail.normalize('NFC');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { email: 'Enter a valid email address.' });
  }
  const roles: Role[] = ['risk_steward', 'liquidity_provider', 'borrower', 'trader', 'liquidator'];
  const roleValue = body.role;
  if (typeof roleValue !== 'string' || !roles.includes(roleValue as Role)) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { role: 'Choose a role.' });
  }
  const role = roleValue as Role;
  const taken = await app.db.withClient(async (client): Promise<boolean> => {
    const result = await client.query<{ actor_id: string }>('SELECT actor_id FROM members WHERE email_lower = $1', [email.toLowerCase()]);
    return result.rows.length > 0;
  });
  if (taken) {
    throw problem(409, 'email_taken', 'A member with this email already exists.');
  }
  const actorId = await nextActorId(app, role);
  await app.db.withClient(async (client): Promise<void> => {
    await client.query(
      'INSERT INTO members (actor_id, name, email, email_lower, role) VALUES ($1, $2, $3, $4, $5)',
      [actorId, name, email, email.toLowerCase(), role],
    );
  });
  return { status: 201, body: { actor_id: actorId, name, email, role } };
});

function unreachable(): ProblemError {
  return problem(422, 'validation_failed', 'Check the highlighted fields.');
}

async function nextActorId(app: App, role: Role): Promise<string> {
  const prefix = ROLE_PREFIX[role];
  return app.db.withClient(async (client): Promise<string> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
      const exists = await client.query<{ actor_id: string }>('SELECT actor_id FROM members WHERE actor_id = $1', [candidate]);
      if (exists.rows.length === 0) return candidate;
    }
    return `${prefix}-${randomUUID().slice(0, 8)}`;
  });
}

const ROLE_PREFIX: Record<Role, string> = {
  risk_steward: 'stw',
  liquidity_provider: 'lp',
  borrower: 'br',
  trader: 'tr',
  liquidator: 'lq',
};

route('POST', '/api/transfers', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  requireRole(ctx, ['risk_steward']);
  const body = strictBody(ctx, { required: ['actor_id', 'asset', 'amount'], optional: [], types: { actor_id: 'string', asset: 'string', amount: 'string' } });
  const actorId = typeof body.actor_id === 'string' ? body.actor_id : '';
  const asset = assetValue(body.asset, 'asset');
  const amount = amountValue(body.amount, 'amount');
  const member = await app.db.withClient(async (client): Promise<{ actor_id: string; name: string } | null> => {
    const result = await client.query<{ actor_id: string; name: string }>('SELECT actor_id, name FROM members WHERE actor_id = $1', [actorId]);
    return result.rows[0] ?? null;
  });
  if (member === null) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { actor_id: 'Choose an existing member.' });
  }
  const now = new Date();
  const result = await app.db.transaction(async (tx): Promise<{ transfer_id: string; posting_id: number }> => {
    const postingId = await appendPosting(tx, 'transfer_in', [
      { account: 'custody', asset, amount: -amount },
      { account: walletAccount(actorId), asset, amount },
    ], actorId, now);
    return { transfer_id: randomUUID(), posting_id: postingId };
  });
  return { status: 201, body: { transfer_id: result.transfer_id, posting_id: result.posting_id, actor_id: actorId, asset, amount: amount.toString() } };
});

route('GET', '/api/wallet', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireActor(ctx);
  const balances: Array<{ asset: string; amount: string }> = [];
  const holdings: Array<{ asset: string; shares: string; value: string }> = [];
  const positionIds: string[] = [];
  await app.db.withClient(async (client): Promise<void> => {
    for (const code of Object.keys(ASSETS) as AssetCode[]) {
      const balance = await accountBalance(client, walletAccount(actor.actor_id), code);
      balances.push({ asset: code, amount: balance.toString() });
      const shareRow = await client.query<{ shares: string }>('SELECT shares FROM shares WHERE actor_id = $1 AND asset = $2', [actor.actor_id, code]);
      const shares = shareRow.rows.length > 0 ? BigInt(shareRow.rows[0].shares) : 0n;
      const poolRow = await client.query<{ total_shares: string }>('SELECT total_shares FROM pools WHERE asset = $1', [code]);
      const supply = (await poolBalances(client, code)).supply;
      const totalShares = BigInt(poolRow.rows[0].total_shares);
      holdings.push({ asset: code, shares: shares.toString(), value: shareValue(shares, supply, totalShares).toString() });
    }
    const positions = await client.query<{ position_id: string }>(
      'SELECT position_id FROM positions WHERE borrower_id = $1 ORDER BY position_id', [actor.actor_id],
    );
    for (const row of positions.rows) positionIds.push(row.position_id);
  });
  return { status: 200, body: { actor_id: actor.actor_id, balances, lp_holdings: holdings, position_ids: positionIds } };
});

function strictBody(ctx: Ctx, rules: { required: string[]; optional: string[]; types: Record<string, 'string' | 'number' | 'boolean'> }): Body {
  const body = ctx.body;
  if (body === undefined) throw problem(400, 'invalid_json', 'The request body is not valid JSON.');
  return validateBody(body, rules);
}

// ---------- pools, prices, risk ----------

route('GET', '/api/pools', { auth: true }, async (_ctx, app): Promise<RouteResult> => {
  const cfg = getConfig();
  const now = new Date();
  const pools = await app.db.withClient(async (client): Promise<unknown[]> => {
    const views: unknown[] = [];
    for (const code of Object.keys(ASSETS) as AssetCode[]) {
      await accrueAssetRead(app, code, now);
      views.push(await poolView(client, code, now));
    }
    return views;
  });
  return {
    status: 200,
    body: {
      pools,
      staleness_limit: durationApi(cfg.stalenessSeconds),
      grace_period: durationApi(cfg.graceSeconds),
      quote_lifetime: durationApi(cfg.quoteTtlSeconds),
      desk_time_zone: cfg.deskTimeZone,
      server_time: canonical(now),
    },
  };
});

async function accrueAssetRead(app: App, asset: AssetCode, now: Date): Promise<void> {
  const nowSec = Math.floor(now.getTime() / 1000);
  await app.db.transaction(async (tx): Promise<void> => {
    await accrueAsset(tx, asset, nowSec);
  });
}

function durationApi(seconds: number): string {
  if (seconds === 0) return 'PT0S';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  let out = 'PT';
  if (hours > 0) out += `${hours}H`;
  if (minutes > 0) out += `${minutes}M`;
  if (rest > 0) out += `${rest}S`;
  return out;
}

route('GET', '/api/pools/:asset', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const asset = assetValue(ctx.params.asset ?? '', 'asset');
  const now = new Date();
  await accrueAssetRead(app, asset, now);
  const view = await app.db.withClient(async (client): Promise<unknown> => poolView(client, asset, now));
  return { status: 200, body: { ...(view as Record<string, unknown>), server_time: canonical(now) } };
});

route('GET', '/api/assets/:asset/risk', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const asset = assetValue(ctx.params.asset ?? '', 'asset');
  const row = await app.db.withClient(async (client): Promise<{ params_version: string; ltv_bps: number; liquidation_threshold_bps: number; liquidation_bonus_bps: number; reserve_factor_bps: number }> => {
    const result = await client.query('SELECT params_version::text, ltv_bps, liquidation_threshold_bps, liquidation_bonus_bps, reserve_factor_bps FROM pools WHERE asset = $1', [asset]);
    return result.rows[0];
  });
  return {
    status: 200,
    body: {
      asset,
      ltv_bps: row.ltv_bps,
      liquidation_threshold_bps: row.liquidation_threshold_bps,
      liquidation_bonus_bps: row.liquidation_bonus_bps,
      reserve_factor_bps: row.reserve_factor_bps,
    },
    headers: { ETag: `"${row.params_version}"` },
  };
});

route('PATCH', '/api/assets/:asset/risk', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  requireRole(ctx, ['risk_steward']);
  const asset = assetValue(ctx.params.asset ?? '', 'asset');
  if (ctx.ifMatch === undefined) {
    throw problem(428, 'precondition_required', 'Send the If-Match header from your latest read.');
  }
  const body = strictBody(ctx, {
    required: [],
    optional: ['ltv_bps', 'liquidation_threshold_bps', 'liquidation_bonus_bps', 'reserve_factor_bps'],
    types: { ltv_bps: 'number', liquidation_threshold_bps: 'number', liquidation_bonus_bps: 'number', reserve_factor_bps: 'number' },
  });
  const now = new Date();
  return app.db.transaction(async (tx): Promise<RouteResult> => {
    const pool = await lockPoolRow(tx, asset);
    if (ctx.ifMatch !== `"${pool.params_version}"`) {
      throw problem(412, 'precondition_failed', 'These risk parameters changed since you opened them. Check the current values and save again.');
    }
    const submitted = {
      ltv_bps: typeof body.ltv_bps === 'number' ? body.ltv_bps : pool.ltv_bps,
      liquidation_threshold_bps: typeof body.liquidation_threshold_bps === 'number' ? body.liquidation_threshold_bps : pool.liquidation_threshold_bps,
      liquidation_bonus_bps: typeof body.liquidation_bonus_bps === 'number' ? body.liquidation_bonus_bps : pool.liquidation_bonus_bps,
      reserve_factor_bps: typeof body.reserve_factor_bps === 'number' ? body.reserve_factor_bps : pool.reserve_factor_bps,
    };
    const errors: Record<string, string> = {};
    if (!Number.isInteger(submitted.ltv_bps) || submitted.ltv_bps <= 0 || submitted.ltv_bps >= submitted.liquidation_threshold_bps) {
      errors.ltv_bps = 'Loan-to-value must be above 0% and below the liquidation threshold.';
    }
    if (!Number.isInteger(submitted.liquidation_threshold_bps) || submitted.liquidation_threshold_bps <= 0 || submitted.liquidation_threshold_bps > 9500) {
      errors.liquidation_threshold_bps = 'Liquidation threshold must be above 0% and at most 95,00%.';
    }
    if (!Number.isInteger(submitted.liquidation_bonus_bps) || submitted.liquidation_bonus_bps < 0
      || submitted.liquidation_bonus_bps > 2000
      || submitted.liquidation_threshold_bps * (10_000 + submitted.liquidation_bonus_bps) >= 100_000_000) {
      errors.liquidation_bonus_bps = 'Bonus must be from 0% to 20,00%, and the threshold times one plus the bonus must stay below 100%.';
    }
    if (!Number.isInteger(submitted.reserve_factor_bps) || submitted.reserve_factor_bps < 0 || submitted.reserve_factor_bps > 5000) {
      errors.reserve_factor_bps = 'Reserve factor must be from 0% to 50,00%.';
    }
    if (Object.keys(errors).length > 0) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', errors);
    }
    const newVersion = BigInt(pool.params_version) + 1n;
    await tx.query(
      `UPDATE pools SET ltv_bps = $1, liquidation_threshold_bps = $2, liquidation_bonus_bps = $3,
       reserve_factor_bps = $4, params_version = $5 WHERE asset = $6`,
      [submitted.ltv_bps, submitted.liquidation_threshold_bps, submitted.liquidation_bonus_bps, submitted.reserve_factor_bps, newVersion.toString(), asset],
    );
    const result = await reevaluateAll(tx, now);
    return {
      status: 200,
      body: {
        asset,
        ltv_bps: submitted.ltv_bps,
        liquidation_threshold_bps: submitted.liquidation_threshold_bps,
        liquidation_bonus_bps: submitted.liquidation_bonus_bps,
        reserve_factor_bps: submitted.reserve_factor_bps,
        positions_below_one: result,
      },
      headers: { ETag: `"${newVersion}"` },
    };
  });
});

/** Re-evaluate every open position; returns the count below health factor 1. */
async function reevaluateAll(tx: Tx, now: Date): Promise<number> {
  const cfg = getConfig();
  const nowSec = Math.floor(now.getTime() / 1000);
  const prices = await currentPrices(tx.client);
  const rows = await tx.query<PositionRow & { threshold: number; ltv: number }>(
    `SELECT p.*, po.liquidation_threshold_bps AS threshold FROM positions p
     JOIN pools po ON po.asset = p.collateral_asset
     WHERE p.state <> 'closed' ORDER BY p.position_id FOR UPDATE OF p`,
  );
  let below = 0;
  for (const row of rows.rows) {
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) continue;
    const result = evaluatePosition(row, {
      collateralPrice: collateralPrice.price,
      debtPrice: debtPrice.price,
      thresholdBps: row.threshold,
      graceSeconds: cfg.graceSeconds,
      nowSec,
    });
    await applyEvaluation(tx, row, result, now, false);
    if (result.hfScaled !== null && result.hfScaled < 10_000n) below += 1;
  }
  return below;
}

route('POST', '/api/prices', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['risk_steward']);
  const rawBody = ctx.body;
  if (rawBody === undefined) throw problem(400, 'invalid_json', 'The request body is not valid JSON.');
  const body = strictBody(ctx, {
    required: ['asset', 'price'],
    optional: ['confirm_large_move'],
    types: { asset: 'string', price: 'string', confirm_large_move: 'boolean' },
  });
  const asset = assetValue(body.asset, 'asset');
  const { scaled } = priceValue(body.price);
  const confirm = body.confirm_large_move === true;
  const submitted = rawSubmission(rawBody);
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const evidenceKey = `evidence/prices/${randomUUID()}.json`;
  const stored = await app.db.transaction(async (tx): Promise<{
    pricePostId: string; scaled: bigint; previous: bigint; wasStale: boolean; below: number;
    evidence: Record<string, unknown>;
  }> => {
    const prices = await currentPrices(tx.client);
    const prev = prices.get(asset);
    if (prev === undefined) throw notFound();
    const pricePostId = randomUUID();
    if (scaled !== prev.price) {
      const lower = scaled < prev.price ? scaled : prev.price;
      const higher = scaled > prev.price ? scaled : prev.price;
      if (higher * 10n > lower * 16n && !confirm) {
        throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
          price: 'This moves the price by more than 60%. Confirm the large move to post it.',
        });
      }
    }
    const wasStale = isStale(prev, now);
    await tx.query(
      `INSERT INTO price_posts (price_post_id, asset, price, previous_price, posted_at, posted_by, source, oracle_round, evidence_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', NULL, $7)`,
      [pricePostId, asset, scaled.toString(), prev.price.toString(), now, actor.actor_id, evidenceKey],
    );
    await tx.query('UPDATE current_prices SET price_post_id = $1 WHERE asset = $2', [pricePostId, asset]);
    const positionsAfter = await positionsInvolving(tx, asset);
    const below = await reevaluateAll(tx, now);
    if (wasStale) await grantRecoveryGrace(tx, asset, now);
    const evidence: Record<string, unknown> = {
      price_post_id: pricePostId,
      asset,
      price: priceApi(scaled),
      previous_price: priceApi(prev.price),
      posted_at: canonical(now),
      posted_by: actor.actor_id,
      source: 'manual',
      positions_below_one: below,
      positions: positionsAfter,
      submitted,
    };
    try {
      await app.store.ensureBucket();
      await app.store.putOnce(evidenceKey, JSON.stringify(evidence, null, 2), 'application/json');
    } catch {
      await app.store.remove(evidenceKey).catch((): void => undefined);
      throw problem(503, 'statement_store_unavailable', 'The statement store is unreachable. Nothing was changed. Try again shortly.');
    }
    return { pricePostId, scaled, previous: prev.price, wasStale, below, evidence };
  });
  return {
    status: 201,
    body: {
      price_post_id: stored.pricePostId,
      asset,
      price: priceApi(stored.scaled),
      previous_price: priceApi(stored.previous),
      posted_at: canonical(now),
      source: 'manual',
      positions_below_one: stored.below,
      evidence_key: evidenceKey,
    },
  };
});

/** Recovery grace: positions on a reopened market below health factor 1 re-enter grace. */
async function grantRecoveryGrace(tx: Tx, asset: AssetCode, now: Date): Promise<void> {
  const cfg = getConfig();
  const nowSec = Math.floor(now.getTime() / 1000);
  const prices = await currentPrices(tx.client);
  const rows = await tx.query<PositionRow & { threshold: number }>(
    `SELECT p.*, po.liquidation_threshold_bps AS threshold FROM positions p
     JOIN pools po ON po.asset = p.collateral_asset
     WHERE (p.collateral_asset = $1 OR p.debt_asset = $1) AND p.state <> 'closed'
     ORDER BY p.position_id FOR UPDATE OF p`,
    [asset],
  );
  for (const row of rows.rows) {
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) continue;
    const figures = positionFigures(row, collateralPrice.price, debtPrice.price, row.threshold);
    if (figures.hfScaled === null || figures.hfScaled >= 10_000n) continue;
    const existing = row.grace_ends_at === null ? 0n : BigInt(row.grace_ends_at);
    const offered = BigInt(nowSec + cfg.graceSeconds);
    const graceEnd = existing > offered ? existing : offered;
    const newState = row.state === 'liquidatable_grace' ? 'liquidatable_grace'
      : (nowSec < Number(graceEnd) ? 'liquidatable_grace' : row.state);
    const effectiveState = nowSec < Number(graceEnd) ? 'liquidatable_grace' : newState;
    await tx.query(
      'UPDATE positions SET state = $1, grace_ends_at = $2, updated_at = now() WHERE position_id = $3',
      [effectiveState, graceEnd.toString(), row.position_id],
    );
    if (effectiveState !== row.state) {
      await emitStateChange(tx, row.position_id, row.state, effectiveState, figures.hfScaled, graceEnd.toString(), now);
    }
  }
}

async function emitStateChange(
  tx: Tx, positionId: string, from: PositionState, to: PositionState,
  hfScaled: bigint | null, graceEnd: string | null, now: Date,
): Promise<void> {
  const sequenceRow = await tx.query<{ last_sequence: string }>(
    'SELECT last_sequence FROM position_sequences WHERE position_id = $1 FOR UPDATE', [positionId],
  );
  let last = 0n;
  if (sequenceRow.rows.length === 0) {
    await tx.query('INSERT INTO position_sequences (position_id, last_sequence) VALUES ($1, 0)', [positionId]);
  } else {
    last = BigInt(sequenceRow.rows[0].last_sequence);
  }
  const sequence = last + 1n;
  await tx.query('UPDATE position_sequences SET last_sequence = $1 WHERE position_id = $2', [sequence.toString(), positionId]);
  await enqueueEvent(tx, {
    event_id: randomUUID(),
    type: 'position.state_changed',
    position_id: positionId,
    sequence: Number(sequence),
    occurred_at: canonical(now),
    data: {
      from,
      to,
      health_factor: hfScaled === null ? null : hfApi(hfScaled),
      grace_ends_at: graceEnd === null ? null : canonical(new Date(Number(graceEnd) * 1000)),
    },
  });
}

function rawSubmission(rawBody: Body): Record<string, unknown> {
  const source = rawBody as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    copy[key] = source[key];
  }
  return copy;
}

async function positionsInvolving(tx: Tx, asset: AssetCode): Promise<Array<{ position_id: string; health_factor: string | null; liquidation_price: string | null }>> {
  const rows = await tx.query<PositionRow & { threshold: number }>(
    `SELECT p.*, po.liquidation_threshold_bps AS threshold FROM positions p
     JOIN pools po ON po.asset = p.collateral_asset
     WHERE (p.collateral_asset = $1 OR p.debt_asset = $1) AND p.state <> 'closed' ORDER BY p.position_id`,
    [asset],
  );
  const prices = await currentPrices(tx.client);
  const out: Array<{ position_id: string; health_factor: string | null; liquidation_price: string | null }> = [];
  for (const row of rows.rows) {
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) continue;
    const figures = positionFigures(row, collateralPrice.price, debtPrice.price, row.threshold);
    out.push({
      position_id: row.position_id,
      health_factor: figures.hfScaled === null ? null : hfApi(figures.hfScaled),
      liquidation_price: figures.liqPrice === null ? null : priceApi(figures.liqPrice),
    });
  }
  return out;
}


async function countBelowOne(tx: Tx, now: Date): Promise<number> {
  const prices = await currentPrices(tx.client);
  const rows = await tx.query<PositionRow & { threshold: number }>(
    `SELECT p.*, po.liquidation_threshold_bps AS threshold FROM positions p
     JOIN pools po ON po.asset = p.collateral_asset
     WHERE p.state <> 'closed'`,
  );
  let below = 0;
  for (const row of rows.rows) {
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) continue;
    const figures = positionFigures(row, collateralPrice.price, debtPrice.price, row.threshold);
    if (figures.hfScaled !== null && figures.hfScaled < 10_000n) below += 1;
  }
  void now;
  return below;
}

// ---------- supply, withdrawal, swap ----------

route('POST', '/api/pools/:asset/supplies', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['liquidity_provider']);
  const asset = assetValue(ctx.params.asset ?? '', 'asset');
  const body = strictBody(ctx, { required: ['amount'], optional: [], types: { amount: 'string' } });
  const amount = amountValue(body.amount, 'amount');
  const now = new Date();
  const result = await app.db.transaction(async (tx): Promise<{ supply_id: string; posting_id: number; shares: bigint; share_price: string }> => {
    const wallet = await accountBalance(tx.client, walletAccount(actor.actor_id), asset);
    if (wallet < amount) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount: `Your wallet holds ${deskAmount(wallet, ASSETS[asset].decimals, false)} ${asset}.`,
      });
    }
    const pool = await lockPoolRow(tx, asset);
    const balances = await poolBalances(tx.client, asset);
    const totalShares = BigInt(pool.total_shares);
    const shares = mintShares(amount, totalShares, balances.supply);
    if (shares <= 0n) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', { amount: 'This amount is too small to receive any shares.' });
    }
    const postingId = await appendPosting(tx, 'supply', [
      { account: walletAccount(actor.actor_id), asset, amount: -amount },
      { account: 'supply', asset, amount },
    ], actor.actor_id, now);
    await tx.query(
      `INSERT INTO shares (actor_id, asset, shares) VALUES ($1, $2, $3)
       ON CONFLICT (actor_id, asset) DO UPDATE SET shares = shares.shares + EXCLUDED.shares`,
      [actor.actor_id, asset, shares.toString()],
    );
    await tx.query('UPDATE pools SET total_shares = $1 WHERE asset = $2', [(totalShares + shares).toString(), asset]);
    const newBalances = await poolBalances(tx.client, asset);
    return {
      supply_id: randomUUID(),
      posting_id: postingId,
      shares,
      share_price: sharePriceApi(sharePrice(newBalances.supply, totalShares + shares)),
    };
  });
  return {
    status: 201,
    body: {
      supply_id: result.supply_id,
      posting_id: result.posting_id,
      asset,
      amount: amount.toString(),
      shares_minted: result.shares.toString(),
      share_price: result.share_price,
    },
  };
});

route('POST', '/api/pools/:asset/withdrawals', { keyed: true, auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['liquidity_provider']);
  const asset = assetValue(ctx.params.asset ?? '', 'asset');
  const body = strictBody(ctx, { required: ['amount'], optional: [], types: { amount: 'string' } });
  const amount = amountValue(body.amount, 'amount');
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const settlement = await app.db.transaction(async (tx): Promise<unknown> => {
    await accrueAsset(tx, asset, nowSec);
    const pool = await lockPoolRow(tx, asset);
    const balances = await poolBalances(tx.client, asset);
    const totalShares = BigInt(pool.total_shares);
    const shareRow = await tx.query<{ shares: string }>('SELECT shares FROM shares WHERE actor_id = $1 AND asset = $2', [actor.actor_id, asset]);
    const holderShares = shareRow.rows.length > 0 ? BigInt(shareRow.rows[0].shares) : 0n;
    const value = shareValue(holderShares, balances.supply, totalShares);
    if (amount > value) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount: `Your shares are worth ${deskAmount(value, ASSETS[asset].decimals, false)} ${asset}.`,
      });
    }
    const figures = poolFigures(balances);
    if (amount > figures.available_liquidity) {
      throw insufficientLiquidity(figures.available_liquidity, asset, ASSETS[asset].decimals);
    }
    const sharesBurned = burnShares(amount, totalShares, balances.supply);
    const legs = [
      { account: 'supply', asset, amount: -amount },
      { account: walletAccount(actor.actor_id), asset, amount },
    ];
    return await commitSettlement(tx, app, {
      kind: 'withdrawal',
      actor,
      positionId: null,
      asset,
      amount,
      legs,
      now,
      extra: {
        shares_burned: sharesBurned.toString(),
        share_price_after: sharePriceApi(sharePrice(balances.supply - amount, totalShares - sharesBurned)),
      },
    });
  });
  return { status: 201, body: settlement };
});

/** Write a settlement: statement objects, posting, outbox event and notice in one transaction. */
async function commitSettlement(
  tx: Tx, app: App, input: {
    kind: 'draw' | 'withdrawal' | 'liquidation';
    actor: Actor;
    positionId: string | null;
    asset: AssetCode;
    amount: bigint;
    legs: Array<{ account: string; asset: AssetCode; amount: bigint }>;
    now: Date;
    extra: Record<string, unknown>;
    notices?: Array<{ positionId: string; kind: 'margin' | 'liquidation' }>;
    before?: Record<string, unknown>;
  },
): Promise<unknown> {
  const cfg = getConfig();
  const settlementId = randomUUID();
  const eventId = randomUUID();
  const statementKey = `statements/${input.kind}/${settlementId}.json`;
  const pdfKey = `statements/${input.kind}/${settlementId}.pdf`;
  const legsOut: Leg[] = input.legs.filter((leg): boolean => leg.amount !== 0n).map((leg): Leg => ({
    account: leg.account,
    asset: leg.asset,
    amount: leg.amount.toString(),
  }));
  const postingId = await appendPosting(tx, input.kind === 'withdrawal' ? 'withdrawal' : input.kind, input.legs, settlementId, input.now);
  let noticeId: string | null = null;
  for (const notice of input.notices ?? []) {
    noticeId = await noticesFor(tx, notice.positionId, notice.kind, input.now);
  }
  const body: Record<string, unknown> = {
    settlement_id: settlementId,
    kind: input.kind,
    actor_id: input.actor.actor_id,
    position_id: input.positionId,
    asset: input.asset,
    amount: input.amount.toString(),
    legs: legsOut,
    statement_key: statementKey,
    pdf_key: pdfKey,
    event_id: eventId,
    created_at: canonical(input.now),
    ...input.extra,
  };
  await tx.query(
    `INSERT INTO settlements (settlement_id, kind, actor_id, position_id, asset, amount, statement_key, pdf_key, event_id, extra, notice_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [settlementId, input.kind, input.actor.actor_id, input.positionId, input.asset, input.amount.toString(),
      statementKey, pdfKey, eventId, JSON.stringify(input.extra), noticeId, input.now],
  );
  await tx.query(
    'INSERT INTO render_queue (settlement_id, status, next_attempt_at) VALUES ($1, $2, now())',
    [settlementId, 'pending'],
  ).catch((): void => undefined);
  await enqueueEvent(tx, {
    event_id: eventId,
    type: 'settlement.committed',
    position_id: input.positionId,
    sequence: input.positionId === null ? null : await nextSequence(tx, input.positionId),
    occurred_at: canonical(input.now),
    data: {
      settlement_id: settlementId,
      kind: input.kind,
      asset: input.asset,
      amount: input.amount.toString(),
      statement_key: statementKey,
    },
  });
  const statementInput: StatementInput = {
    settlement_id: settlementId,
    kind: input.kind,
    actor_id: input.actor.actor_id,
    actor_name: input.actor.name,
    position_id: input.positionId,
    asset: input.asset,
    amount: input.amount,
    legs: legsOut,
    created_at: input.now,
    withdrawal: input.kind === 'withdrawal'
      ? {
        shares_burned: BigInt(String(input.extra.shares_burned ?? '0')),
        share_price_after: String(input.extra.share_price_after ?? '1.000000000000'),
      }
      : undefined,
  };
  const jsonBody = JSON.stringify(body, null, 2);
  const textBody = statementText(statementInput, cfg.deskTimeZone);
  const txtKey = `statements/${input.kind}/${settlementId}.txt`;
  try {
    await app.store.ensureBucket();
    await app.store.putOnce(statementKey, jsonBody, 'application/json');
    await app.store.putOnce(txtKey, textBody, 'text/plain; charset=utf-8');
  } catch {
    await app.store.remove(statementKey).catch((): void => undefined);
    await app.store.remove(txtKey).catch((): void => undefined);
    throw problem(503, 'statement_store_unavailable', 'The statement store is unreachable. Nothing was changed. Try again shortly.');
  }
  return {
    ...body,
    pdf_rendered_at: null,
    statement_status: 'pending_statement',
    notice_status: noticeId === null ? undefined : 'queued',
    webhook_status: 'queued',
    posting_id: postingId,
  };
}

async function nextSequence(tx: Tx, positionId: string): Promise<number> {
  const sequenceRow = await tx.query<{ last_sequence: string }>(
    'SELECT last_sequence FROM position_sequences WHERE position_id = $1 FOR UPDATE', [positionId],
  );
  let last = 0n;
  if (sequenceRow.rows.length === 0) {
    await tx.query('INSERT INTO position_sequences (position_id, last_sequence) VALUES ($1, 0)', [positionId]);
  } else {
    last = BigInt(sequenceRow.rows[0].last_sequence);
  }
  const sequence = last + 1n;
  await tx.query('UPDATE position_sequences SET last_sequence = $1 WHERE position_id = $2', [sequence.toString(), positionId]);
  return Number(sequence);
}

function staleSwapProblem(): ProblemError {
  return problem(423, 'market_stale', STALE_SWAP);
}

function staleMarketProblem(): ProblemError {
  return problem(423, 'market_stale', STALE_BANNER);
}

interface SwapInputs {
  fromAsset: AssetCode;
  toAsset: AssetCode;
  amountIn: bigint;
}

function parseSwapQuery(query: URLSearchParams): SwapInputs {
  const fromAsset = assetValue(query.get('from_asset') ?? '', 'from_asset');
  const toAsset = assetValue(query.get('to_asset') ?? '', 'to_asset');
  if (fromAsset === toAsset) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { to_asset: 'Choose two different assets.' });
  }
  const amountIn = amountValue(query.get('amount_in') ?? '', 'amount_in');
  return { fromAsset, toAsset, amountIn };
}

async function swapMathFor(app: App, inputs: SwapInputs): Promise<{
  fee: bigint; fee_to_supply: bigint; fee_to_reserve: bigint; amount_out: bigint;
  price_from: string; price_to: string; stale: boolean; availableOut: bigint;
}> {
  const now = new Date();
  return app.db.withClient(async (client): Promise<{
    fee: bigint; fee_to_supply: bigint; fee_to_reserve: bigint; amount_out: bigint;
    price_from: string; price_to: string; stale: boolean; availableOut: bigint;
  }> => {
    const prices = await currentPrices(client);
    const fromPrice = prices.get(inputs.fromAsset);
    const toPrice = prices.get(inputs.toAsset);
    if (fromPrice === undefined || toPrice === undefined) throw notFound();
    const fromPool = await lockPoolRead(client, inputs.fromAsset);
    const toPool = await lockPoolRead(client, inputs.toAsset);
    const math = quoteMath({
      amount_in: inputs.amountIn,
      swap_fee_bps: fromPool.swap_fee_bps,
      price_from: fromPrice.price,
      price_to: toPrice.price,
      from_decimals: ASSETS[inputs.fromAsset].decimals,
      to_decimals: ASSETS[inputs.toAsset].decimals,
    });
    const split = splitFee(math.fee, fromPool.reserve_factor_bps);
    const toBalances = await poolBalances(client, inputs.toAsset);
    const toFigures = poolFigures(toBalances);
    return {
      fee: math.fee,
      fee_to_supply: split.to_supply,
      fee_to_reserve: split.to_reserve,
      amount_out: math.amount_out,
      price_from: priceApi(fromPrice.price),
      price_to: priceApi(toPrice.price),
      stale: isStale(fromPrice, now) || isStale(toPrice, now),
      availableOut: toFigures.available_liquidity,
    };
  });
}

async function lockPoolRead(client: Tx['client'], asset: AssetCode): Promise<{ swap_fee_bps: number; reserve_factor_bps: number }> {
  const result = await client.query<{ swap_fee_bps: number; reserve_factor_bps: number }>(
    'SELECT swap_fee_bps, reserve_factor_bps FROM pools WHERE asset = $1', [asset],
  );
  return result.rows[0];
}

route('GET', '/api/swap/preview', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  requireRole(ctx, ['trader', 'risk_steward']);
  const inputs = parseSwapQuery(ctx.query);
  const math = await swapMathFor(app, inputs);
  if (math.stale) throw staleSwapProblem();
  if (math.amount_out === 0n) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { amount_in: 'This amount is too small to receive anything.' });
  }
  if (math.amount_out > math.availableOut) {
    throw insufficientLiquidity(math.availableOut, inputs.toAsset, ASSETS[inputs.toAsset].decimals);
  }
  return {
    status: 200,
    body: {
      from_asset: inputs.fromAsset,
      to_asset: inputs.toAsset,
      amount_in: inputs.amountIn.toString(),
      fee: math.fee.toString(),
      amount_out: math.amount_out.toString(),
      price_from: math.price_from,
      price_to: math.price_to,
    },
  };
});

route('POST', '/api/swap/quotes', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  requireRole(ctx, ['trader', 'risk_steward']);
  const body = strictBody(ctx, {
    required: ['from_asset', 'to_asset', 'amount_in'],
    optional: [],
    types: { from_asset: 'string', to_asset: 'string', amount_in: 'string' },
  });
  const fromAsset = assetValue(body.from_asset, 'from_asset');
  const toAsset = assetValue(body.to_asset, 'to_asset');
  if (fromAsset === toAsset) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { to_asset: 'Choose two different assets.' });
  }
  const amountIn = amountValue(body.amount_in, 'amount_in');
  const actor = requireActor(ctx);
  const wallet = await app.db.withClient(async (client): Promise<bigint> => accountBalance(client, walletAccount(actor.actor_id), fromAsset));
  if (wallet < amountIn) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
      amount_in: `Your wallet holds ${deskAmount(wallet, ASSETS[fromAsset].decimals, false)} ${fromAsset}.`,
    });
  }
  const math = await swapMathFor(app, { fromAsset, toAsset, amountIn });
  if (math.stale) throw staleSwapProblem();
  if (math.amount_out === 0n) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { amount_in: 'This amount is too small to receive anything.' });
  }
  if (math.amount_out > math.availableOut) {
    throw insufficientLiquidity(math.availableOut, toAsset, ASSETS[toAsset].decimals);
  }
  const cfg = getConfig();
  const nowSec = Math.floor(Date.now() / 1000);
  const quoteId = randomUUID();
  await app.db.withClient(async (client): Promise<void> => {
    await client.query(
      `INSERT INTO quotes (quote_id, trader_id, from_asset, to_asset, amount_in, fee, fee_to_supply, fee_to_reserve,
        amount_out, price_from, price_to, expires_at, used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false)`,
      [quoteId, actor.actor_id, fromAsset, toAsset, amountIn.toString(), math.fee.toString(),
        math.fee_to_supply.toString(), math.fee_to_reserve.toString(), math.amount_out.toString(),
        math.price_from, math.price_to, new Date((nowSec + cfg.quoteTtlSeconds) * 1000)],
    );
  });
  return {
    status: 201,
    body: {
      quote_id: quoteId,
      from_asset: fromAsset,
      to_asset: toAsset,
      amount_in: amountIn.toString(),
      fee: math.fee.toString(),
      fee_to_supply: math.fee_to_supply.toString(),
      fee_to_reserve: math.fee_to_reserve.toString(),
      amount_out: math.amount_out.toString(),
      price_from: math.price_from,
      price_to: math.price_to,
      expires_at: canonical(new Date((nowSec + cfg.quoteTtlSeconds) * 1000)),
      server_time: canonical(new Date(nowSec * 1000)),
    },
  };
});

route('POST', '/api/swaps', { keyed: true, auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['trader', 'risk_steward']);
  const body = strictBody(ctx, { required: ['quote_id'], optional: [], types: { quote_id: 'string' } });
  const quoteId = typeof body.quote_id === 'string' ? body.quote_id : '';
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const result = await app.db.transaction(async (tx): Promise<unknown> => {
    const quote = await tx.query<{
      quote_id: string; trader_id: string; from_asset: AssetCode; to_asset: AssetCode; amount_in: string;
      fee: string; fee_to_supply: string; fee_to_reserve: string; amount_out: string;
      price_from: string; price_to: string; expires_at: Date; used: boolean; swap_id: string | null;
    }>('SELECT * FROM quotes WHERE quote_id = $1 FOR UPDATE', [quoteId]);
    if (quote.rows.length === 0) throw notFound();
    const q = quote.rows[0];
    if (q.used) {
      throw problem(409, 'quote_used', 'This quote has already been used.');
    }
    if (q.trader_id !== actor.actor_id) {
      throw problem(403, 'forbidden', 'Your role can\u2019t do this.');
    }
    const prices = await currentPrices(tx.client);
    const fromPrice = prices.get(q.from_asset);
    const toPrice = prices.get(q.to_asset);
    if (fromPrice === undefined || toPrice === undefined) throw notFound();
    if (isStale(fromPrice, now) || isStale(toPrice, now)) throw staleSwapProblem();
    if (now.getTime() >= q.expires_at.getTime()) {
      throw problem(410, 'quote_expired', 'This quote has expired. Get a new quote.');
    }
    const amountIn = BigInt(q.amount_in);
    const wallet = await accountBalance(tx.client, walletAccount(actor.actor_id), q.from_asset);
    if (wallet < amountIn) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount_in: `Your wallet holds ${deskAmount(wallet, ASSETS[q.from_asset].decimals, false)} ${q.from_asset}.`,
      });
    }
    const fee = BigInt(q.fee);
    const feeToSupply = BigInt(q.fee_to_supply);
    const feeToReserve = BigInt(q.fee_to_reserve);
    const amountOut = BigInt(q.amount_out);
    const toBalances = await poolBalances(tx.client, q.to_asset);
    const toFigures = poolFigures(toBalances);
    if (amountOut > toFigures.available_liquidity) {
      throw insufficientLiquidity(toFigures.available_liquidity, q.to_asset, ASSETS[q.to_asset].decimals);
    }
    const swapId = randomUUID();
    const legs = [
      { account: walletAccount(actor.actor_id), asset: q.from_asset, amount: -amountIn },
      { account: 'supply', asset: q.from_asset, amount: feeToSupply },
      { account: 'reserve', asset: q.from_asset, amount: feeToReserve },
      { account: 'swap', asset: q.from_asset, amount: amountIn - fee },
      { account: 'swap', asset: q.to_asset, amount: -amountOut },
      { account: walletAccount(actor.actor_id), asset: q.to_asset, amount: amountOut },
    ];
    const postingId = await appendPosting(tx, 'swap', legs, swapId, now);
    await tx.query('UPDATE quotes SET used = true, swap_id = $1 WHERE quote_id = $2', [swapId, quoteId]);
    return {
      swap_id: swapId,
      quote_id: quoteId,
      posting_id: postingId,
      from_asset: q.from_asset,
      to_asset: q.to_asset,
      amount_in: amountIn.toString(),
      fee: fee.toString(),
      fee_to_supply: feeToSupply.toString(),
      fee_to_reserve: feeToReserve.toString(),
      amount_out: amountOut.toString(),
      price_from: q.price_from,
      price_to: q.price_to,
      legs: legs.filter((leg): boolean => leg.amount !== 0n).map((leg): Leg => ({
        account: leg.account, asset: leg.asset, amount: leg.amount.toString(),
      })),
      created_at: canonical(now),
    };
  });
  return { status: 201, body: result };
});

// ---------- positions ----------

route('POST', '/api/positions', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['borrower']);
  const body = strictBody(ctx, {
    required: ['collateral_asset', 'debt_asset', 'collateral_amount'],
    optional: [],
    types: { collateral_asset: 'string', debt_asset: 'string', collateral_amount: 'string' },
  });
  const collateralAsset = assetValue(body.collateral_asset, 'collateral_asset');
  const debtAsset = assetValue(body.debt_asset, 'debt_asset');
  if (collateralAsset === debtAsset) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { debt_asset: 'Choose two different assets.' });
  }
  const collateralAmount = amountValue(body.collateral_amount, 'collateral_amount');
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  return app.db.transaction(async (tx): Promise<RouteResult> => {
    await refreshAndEvaluate(tx, now);
    const wallet = await accountBalance(tx.client, walletAccount(actor.actor_id), collateralAsset);
    if (wallet < collateralAmount) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        collateral_amount: `Your wallet holds ${deskAmount(wallet, ASSETS[collateralAsset].decimals, false)} ${collateralAsset}.`,
      });
    }
    const positionId = await nextPositionId(tx);
    await tx.query(
      `INSERT INTO positions (position_id, borrower_id, collateral_asset, debt_asset, collateral_amount, debt, posted_debt,
        principal, reference_index, state, grace_ends_at, after_fill_mark, margin_armed, round)
       VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6, 'healthy', NULL, false, true, 0)`,
      [positionId, actor.actor_id, collateralAsset, debtAsset, collateralAmount.toString(), INDEX_SCALE.toString()],
    );
    await appendPosting(tx, 'lock', [
      { account: walletAccount(actor.actor_id), asset: collateralAsset, amount: -collateralAmount },
      { account: collateralAccount(positionId), asset: collateralAsset, amount: collateralAmount },
    ], positionId, now);
    await emitStateChange(tx, positionId, 'healthy', 'healthy', null, null, now).catch((): void => undefined);
    const seq = await nextSequence(tx, positionId);
    await tx.query(
      `INSERT INTO events (event_id, position_id, type, sequence, occurred_at, payload, status)
       VALUES ($1, $2, 'position.state_changed', $3, $4, $5, 'queued')`,
      [randomUUID(), positionId, seq, canonical(now), JSON.stringify({
        event_id: randomUUID(), type: 'position.state_changed', position_id: positionId, sequence: seq,
        occurred_at: canonical(now), data: { from: null, to: 'healthy', health_factor: null, grace_ends_at: null },
      })],
    );
    const row = await loadPositionRow(tx, positionId);
    if (row === null) throw notFound();
    return { status: 201, body: await positionView(tx.client, row, now, getConfig().graceSeconds) };
  });
});

async function nextPositionId(tx: Tx): Promise<string> {
  const result = await tx.query<{ next: string }>(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(position_id, '\\D', '', 'g'), ''))::bigint, 0)::text AS next FROM positions`,
  );
  const next = BigInt(result.rows[0].next) + 1n;
  return `pos-${next.toString().padStart(4, '0')}`;
}

route('GET', '/api/positions', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const collateralAsset = ctx.query.get('collateral_asset');
  const includeClosed = ctx.query.get('include_closed') === 'true';
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const views = await app.db.transaction(async (tx): Promise<unknown[]> => {
    await refreshAndEvaluate(tx, now);
    const filters: string[] = [];
    const params: unknown[] = [];
    if (collateralAsset !== null && collateralAsset !== '' && isAssetCode(collateralAsset)) {
      params.push(collateralAsset);
      filters.push(`collateral_asset = $${params.length}`);
    }
    if (!includeClosed) {
      filters.push(`state <> 'closed'`);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await tx.query<PositionRow>(`SELECT * FROM positions ${where} ORDER BY position_id`, params);
    const out: unknown[] = [];
    for (const row of rows.rows) {
      out.push(await positionView(tx.client, row, now, getConfig().graceSeconds));
    }
    return out;
  });
  return { status: 200, body: { positions: views, server_time: canonical(now) } };
});

route('GET', '/api/positions/:id', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const positionId = ctx.params.id ?? '';
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  return app.db.transaction(async (tx): Promise<RouteResult> => {
    await refreshAndEvaluate(tx, now);
    const row = await loadPositionRow(tx, positionId);
    if (row === null) throw notFound();
    return { status: 200, body: await positionView(tx.client, row, now, getConfig().graceSeconds) };
  });
});

route('POST', '/api/positions/:id/draws', { keyed: true, auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['borrower']);
  const positionId = ctx.params.id ?? '';
  const body = strictBody(ctx, { required: ['amount'], optional: [], types: { amount: 'string' } });
  const amount = amountValue(body.amount, 'amount');
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const settlement = await app.db.transaction(async (tx): Promise<unknown> => {
    await refreshAndEvaluate(tx, now);
    const row = await loadPositionRow(tx, positionId);
    if (row === null) throw notFound();
    if (row.borrower_id !== actor.actor_id) {
      throw problem(403, 'forbidden', 'Your role can\u2019t do this.');
    }
    if (row.state === 'closed') {
      throw problem(409, 'position_closed', 'This position is closed.');
    }
    const prices = await currentPrices(tx.client);
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) throw notFound();
    if (isStale(collateralPrice, now) || isStale(debtPrice, now)) throw staleMarketProblem();
    const collateralPool = await lockPoolRow(tx, row.collateral_asset);
    const newDebt = BigInt(row.posted_debt) + amount;
    if (!withinLtv({
      collateralAsset: row.collateral_asset,
      debtAsset: row.debt_asset,
      collateral_amount: BigInt(row.collateral_amount),
      debt: newDebt,
      collateral_price: collateralPrice.price,
      debt_price: debtPrice.price,
      ltv_bps: collateralPool.ltv_bps,
    })) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount: `This draw would take the position past its ${deskPercentFieldBps(collateralPool.ltv_bps)}% loan-to-value limit.`,
      });
    }
    const debtBalances = await poolBalances(tx.client, row.debt_asset);
    const debtFigures = poolFigures(debtBalances);
    if (amount > debtFigures.available_liquidity) {
      throw insufficientLiquidity(debtFigures.available_liquidity, row.debt_asset, ASSETS[row.debt_asset].decimals);
    }
    const debtPool = await lockPoolRow(tx, row.debt_asset);
    const newIndex = BigInt(debtPool.borrow_index);
    await tx.query(
      `UPDATE positions SET debt = $1, posted_debt = $1, principal = $1, reference_index = $2, updated_at = now() WHERE position_id = $3`,
      [newDebt.toString(), newIndex.toString(), positionId],
    );
    const legs = [
      { account: loanAccount(positionId), asset: row.debt_asset, amount: -amount },
      { account: walletAccount(actor.actor_id), asset: row.debt_asset, amount },
    ];
    return await commitSettlement(tx, app, {
      kind: 'draw',
      actor,
      positionId,
      asset: row.debt_asset,
      amount,
      legs,
      now,
      extra: {},
    });
  });
  const extras = await app.db.withClient(async (client): Promise<Record<string, unknown>> => {
    const row = await client.query<PositionRow>('SELECT * FROM positions WHERE position_id = $1', [positionId]);
    if (row.rows.length === 0) return {};
    const prices = await currentPrices(client);
    const collateralPrice = prices.get(row.rows[0].collateral_asset);
    const debtPrice = prices.get(row.rows[0].debt_asset);
    const collateralPool = await client.query<{ liquidation_threshold_bps: number }>(
      'SELECT liquidation_threshold_bps FROM pools WHERE asset = $1', [row.rows[0].collateral_asset],
    );
    if (collateralPrice === undefined || debtPrice === undefined) return {};
    const figures = positionFigures(row.rows[0], collateralPrice.price, debtPrice.price, collateralPool.rows[0].liquidation_threshold_bps);
    return {
      debt_after: row.rows[0].posted_debt,
      health_factor_after: figures.hfScaled === null ? null : hfApi(figures.hfScaled),
      state_after: row.rows[0].state,
    };
  });
  return { status: 201, body: { ...(settlement as Record<string, unknown>), ...extras } };
});

function deskPercentFieldBps(bps: number): string {
  const whole = Math.floor(bps / 100).toString();
  const frac = (bps % 100).toString().padStart(2, '0');
  return `${whole},${frac}`;
}

route('POST', '/api/positions/:id/repayments', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['borrower']);
  const positionId = ctx.params.id ?? '';
  const body = strictBody(ctx, { required: ['amount'], optional: [], types: { amount: 'string' } });
  const rawAmount = body.amount;
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const result = await app.db.transaction(async (tx): Promise<unknown> => {
    await accrueAsset(tx, 'QUSD', nowSec);
    await accrueAsset(tx, 'MBTC', nowSec);
    await accrueAsset(tx, 'METH', nowSec);
    const row = await loadPositionRow(tx, positionId);
    if (row === null) throw notFound();
    if (row.borrower_id !== actor.actor_id) {
      throw problem(403, 'forbidden', 'Your role can\u2019t do this.');
    }
    if (row.state === 'closed') {
      throw problem(409, 'position_closed', 'This position is closed.');
    }
    const debt = BigInt(row.posted_debt);
    const repayAll = rawAmount === 'all';
    let amount: bigint;
    if (repayAll) {
      amount = debt;
    } else {
      if (typeof rawAmount !== 'string' || !/^[1-9][0-9]*$/.test(rawAmount)) {
        throw problem(422, 'validation_failed', 'Check the highlighted fields.', { amount: 'Enter a whole number of minor units above zero.' });
      }
      amount = BigInt(rawAmount);
    }
    if (amount === 0n && debt === 0n) {
      return { zeroDebt: true };
    }
    if (amount > debt) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount: `The current debt is ${deskAmount(debt, ASSETS[row.debt_asset].decimals, false)} ${row.debt_asset}.`,
      });
    }
    const wallet = await accountBalance(tx.client, walletAccount(actor.actor_id), row.debt_asset);
    if (wallet < amount) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount: `Your wallet holds ${deskAmount(wallet, ASSETS[row.debt_asset].decimals, false)} ${row.debt_asset}.`,
      });
    }
    const newDebt = debt - amount;
    const debtPool = await lockPoolRow(tx, row.debt_asset);
    const newIndex = BigInt(debtPool.borrow_index);
    const legs = [
      { account: walletAccount(actor.actor_id), asset: row.debt_asset, amount: -amount },
      { account: loanAccount(positionId), asset: row.debt_asset, amount },
    ];
    const postingId = await appendPosting(tx, 'repay', legs, positionId, now);
    let stateAfter: PositionState = row.state;
    await tx.query(
      `UPDATE positions SET debt = $1, posted_debt = $1, principal = $1, reference_index = $2, updated_at = now() WHERE position_id = $3`,
      [newDebt.toString(), newIndex.toString(), positionId],
    );
    const prices = await currentPrices(tx.client);
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) throw notFound();
    const collateralPool = await clientPoolThreshold(tx, row.collateral_asset);
    const figures = positionFigures({ ...row, posted_debt: newDebt.toString() }, collateralPrice.price, debtPrice.price, collateralPool);
    const evalResult = evaluatePosition({ ...row, posted_debt: newDebt.toString(), debt: newDebt.toString() }, {
      collateralPrice: collateralPrice.price,
      debtPrice: debtPrice.price,
      thresholdBps: collateralPool,
      graceSeconds: getConfig().graceSeconds,
      nowSec,
    });
    if (newDebt === 0n && BigInt(row.collateral_amount) > 0n) {
      await appendPosting(tx, 'release', [
        { account: collateralAccount(positionId), asset: row.collateral_asset, amount: -BigInt(row.collateral_amount) },
        { account: walletAccount(actor.actor_id), asset: row.collateral_asset, amount: BigInt(row.collateral_amount) },
      ], positionId, now);
      await tx.query('UPDATE positions SET collateral_amount = 0, state = $1, grace_ends_at = NULL, updated_at = now() WHERE position_id = $2', ['closed', positionId]);
      await emitStateChange(tx, positionId, row.state, 'closed', null, null, now);
      stateAfter = 'closed';
    } else if (newDebt === 0n && BigInt(row.collateral_amount) === 0n) {
      await tx.query('UPDATE positions SET state = $1, grace_ends_at = NULL, updated_at = now() WHERE position_id = $2', ['closed', positionId]);
      await emitStateChange(tx, positionId, row.state, 'closed', null, null, now);
      stateAfter = 'closed';
    } else {
      await applyEvaluation(tx, { ...row, posted_debt: newDebt.toString() }, evalResult, now, false);
      stateAfter = evalResult.state;
    }
    return {
      repayment_id: randomUUID(),
      posting_id: postingId,
      amount: amount.toString(),
      debt_after: newDebt.toString(),
      health_factor_after: figures.hfScaled === null ? null : hfApi(figures.hfScaled),
      state_after: stateAfter,
    };
  });
  return { status: 201, body: result };
});

async function clientPoolThreshold(tx: Tx, asset: AssetCode): Promise<number> {
  const result = await tx.query<{ liquidation_threshold_bps: number }>('SELECT liquidation_threshold_bps FROM pools WHERE asset = $1', [asset]);
  return result.rows[0].liquidation_threshold_bps;
}

route('POST', '/api/positions/:id/collateral', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['borrower']);
  const positionId = ctx.params.id ?? '';
  const body = strictBody(ctx, { required: ['amount'], optional: [], types: { amount: 'string' } });
  const amount = amountValue(body.amount, 'amount');
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  return app.db.transaction(async (tx): Promise<RouteResult> => {
    const row = await loadPositionRow(tx, positionId);
    if (row === null) throw notFound();
    if (row.borrower_id !== actor.actor_id) {
      throw problem(403, 'forbidden', 'Your role can\u2019t do this.');
    }
    if (row.state === 'closed') {
      throw problem(409, 'position_closed', 'This position is closed.');
    }
    const wallet = await accountBalance(tx.client, walletAccount(actor.actor_id), row.collateral_asset);
    if (wallet < amount) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount: `Your wallet holds ${deskAmount(wallet, ASSETS[row.collateral_asset].decimals, false)} ${row.collateral_asset}.`,
      });
    }
    await appendPosting(tx, 'lock', [
      { account: walletAccount(actor.actor_id), asset: row.collateral_asset, amount: -amount },
      { account: collateralAccount(positionId), asset: row.collateral_asset, amount },
    ], positionId, now);
    await tx.query(
      'UPDATE positions SET collateral_amount = $1, updated_at = now() WHERE position_id = $2',
      [(BigInt(row.collateral_amount) + amount).toString(), positionId],
    );
    const updated = await loadPositionRow(tx, positionId);
    if (updated === null) throw notFound();
    return { status: 201, body: await positionView(tx.client, updated, now, getConfig().graceSeconds) };
  });
});

route('POST', '/api/positions/:id/collateral-withdrawals', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['borrower']);
  const positionId = ctx.params.id ?? '';
  const body = strictBody(ctx, { required: ['amount'], optional: [], types: { amount: 'string' } });
  const amount = amountValue(body.amount, 'amount');
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  return app.db.transaction(async (tx): Promise<RouteResult> => {
    const row = await loadPositionRow(tx, positionId);
    if (row === null) throw notFound();
    if (row.borrower_id !== actor.actor_id) {
      throw problem(403, 'forbidden', 'Your role can\u2019t do this.');
    }
    if (row.state === 'closed') {
      throw problem(409, 'position_closed', 'This position is closed.');
    }
    const collateral = BigInt(row.collateral_amount);
    if (amount > collateral) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount: `The position holds ${deskAmount(collateral, ASSETS[row.collateral_asset].decimals, false)} ${row.collateral_asset}.`,
      });
    }
    const prices = await currentPrices(tx.client);
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) throw notFound();
    if (isStale(collateralPrice, now) || isStale(debtPrice, now)) throw staleMarketProblem();
    const collateralPool = await lockPoolRow(tx, row.collateral_asset);
    const newCollateral = collateral - amount;
    const debt = BigInt(row.posted_debt);
    if (debt > 0n && !withinLtv({
      collateralAsset: row.collateral_asset,
      debtAsset: row.debt_asset,
      collateral_amount: newCollateral,
      debt,
      collateral_price: collateralPrice.price,
      debt_price: debtPrice.price,
      ltv_bps: collateralPool.ltv_bps,
    })) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        amount: `This withdrawal would take the position past its ${deskPercentFieldBps(collateralPool.ltv_bps)}% loan-to-value limit.`,
      });
    }
    await appendPosting(tx, 'release', [
      { account: collateralAccount(positionId), asset: row.collateral_asset, amount: -amount },
      { account: walletAccount(actor.actor_id), asset: row.collateral_asset, amount },
    ], positionId, now);
    if (newCollateral === 0n && debt === 0n) {
      await tx.query(
        'UPDATE positions SET collateral_amount = 0, state = $1, grace_ends_at = NULL, updated_at = now() WHERE position_id = $2',
        ['closed', positionId],
      );
      await emitStateChange(tx, positionId, row.state, 'closed', null, null, now);
    } else {
      await tx.query(
        'UPDATE positions SET collateral_amount = $1, updated_at = now() WHERE position_id = $2',
        [newCollateral.toString(), positionId],
      );
    }
    const updated = await loadPositionRow(tx, positionId);
    if (updated === null) throw notFound();
    return { status: 201, body: await positionView(tx.client, updated, now, getConfig().graceSeconds) };
  });
});

route('GET', '/api/liquidations/queue', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  requireRole(ctx, ['liquidator', 'risk_steward']);
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const views = await app.db.transaction(async (tx): Promise<unknown[]> => {
    await refreshAndEvaluate(tx, now);
    const rows = await tx.query<PositionRow & { threshold: number }>(
      `SELECT p.*, po.liquidation_threshold_bps AS threshold FROM positions p
       JOIN pools po ON po.asset = p.collateral_asset
       WHERE p.state IN ('liquidatable', 'partially_liquidated', 'liquidatable_grace')`,
    );
    const out: Array<{ view: unknown; hf: bigint }> = [];
    for (const row of rows.rows) {
      const collateralPrice = (await currentPrices(tx.client)).get(row.collateral_asset);
      const debtPrice = (await currentPrices(tx.client)).get(row.debt_asset);
      if (collateralPrice === undefined || debtPrice === undefined) continue;
      const figures = positionFigures(row, collateralPrice.price, debtPrice.price, row.threshold);
      if (figures.hfScaled === null || figures.hfScaled >= 10_000n) continue;
      out.push({ view: await positionView(tx.client, row, now, getConfig().graceSeconds), hf: figures.hfScaled });
    }
    out.sort((a, b): number => (a.hf < b.hf ? -1 : a.hf > b.hf ? 1 : 0));
    return out.map((item): unknown => item.view);
  });
  return { status: 200, body: { positions: views, server_time: canonical(now) } };
});

route('POST', '/api/positions/:id/liquidations', { keyed: true, auth: true }, async (ctx, app): Promise<RouteResult> => {
  const actor = requireRole(ctx, ['liquidator', 'risk_steward']);
  const positionId = ctx.params.id ?? '';
  const body = strictBody(ctx, { required: ['repay_amount', 'round'], optional: [], types: { repay_amount: 'string', round: 'number' } });
  const repayAmount = amountValue(body.repay_amount, 'repay_amount');
  const roundRaw = body.round;
  if (typeof roundRaw !== 'number' || !Number.isInteger(roundRaw) || roundRaw < 0) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { round: 'Send the round shown for this position.' });
  }
  const round = BigInt(roundRaw);
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const settlement = await app.db.transaction(async (tx): Promise<unknown> => {
    await refreshAndEvaluate(tx, now);
    const row = await loadPositionRow(tx, positionId);
    if (row === null) throw notFound();
    if (BigInt(row.round) !== round) {
      throw problem(409, 'already_liquidated', 'Already liquidated at this health factor');
    }
    if (row.state === 'closed') {
      throw problem(409, 'position_closed', 'This position is closed.');
    }
    if (row.state === 'liquidatable_grace') {
      throw problem(409, 'in_grace', 'This position is in its grace period.');
    }
    if (row.state !== 'liquidatable' && row.state !== 'partially_liquidated') {
      throw problem(409, 'not_liquidatable', 'This position is not below health factor 1.');
    }
    const prices = await currentPrices(tx.client);
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) throw notFound();
    if (isStale(collateralPrice, now) || isStale(debtPrice, now)) throw staleMarketProblem();
    const collateralPool = await lockPoolRow(tx, row.collateral_asset);
    const debt = BigInt(row.posted_debt);
    const collateral = BigInt(row.collateral_amount);
    const hfBefore = healthFactorScaled({
      collateralAsset: row.collateral_asset,
      debtAsset: row.debt_asset,
      collateral_amount: collateral,
      collateral_price: collateralPrice.price,
      debt,
      debt_price: debtPrice.price,
      liquidation_threshold_bps: collateralPool.liquidation_threshold_bps,
    });
    const limits = liquidationLimits({
      collateralAsset: row.collateral_asset,
      debtAsset: row.debt_asset,
      debt,
      collateral_amount: collateral,
      collateral_price: collateralPrice.price,
      debt_price: debtPrice.price,
      close_factor_bps: collateralPool.close_factor_bps,
      liquidation_bonus_bps: collateralPool.liquidation_bonus_bps,
    });
    if (repayAmount < 1n || repayAmount > limits.max_repay) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        repay_amount: `Repay at most ${deskAmount(limits.max_repay, ASSETS[row.debt_asset].decimals, false)} ${row.debt_asset} on this fill.`,
      });
    }
    const wallet = await accountBalance(tx.client, walletAccount(actor.actor_id), row.debt_asset);
    if (wallet < repayAmount) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', {
        repay_amount: `Your wallet holds ${deskAmount(wallet, ASSETS[row.debt_asset].decimals, false)} ${row.debt_asset}.`,
      });
    }
    const seizedMath = seizedForRepay(repayAmount, row.collateral_asset, row.debt_asset, collateralPrice.price, debtPrice.price, collateralPool.liquidation_bonus_bps);
    let seized = seizedMath.seized;
    if (seized > collateral) seized = collateral;
    const bonusAmount = seizedMath.bonus_amount;
    const newDebt = debt - repayAmount;
    const takeAll = limits.cover < debt * BigInt(collateralPool.close_factor_bps) / 10_000n && repayAmount === limits.max_repay;
    const debtAssetPool = await lockPoolRow(tx, row.debt_asset);
    const newIndex = BigInt(debtAssetPool.borrow_index);
    const legs: Array<{ account: string; asset: AssetCode; amount: bigint }> = [
      { account: walletAccount(actor.actor_id), asset: row.debt_asset, amount: -repayAmount },
      { account: loanAccount(positionId), asset: row.debt_asset, amount: repayAmount },
      { account: collateralAccount(positionId), asset: row.collateral_asset, amount: -seized },
      { account: walletAccount(actor.actor_id), asset: row.collateral_asset, amount: seized },
    ];
    let writtenOff = 0n;
    let stateAfter: PositionState = 'partially_liquidated';
    let newCollateral = collateral - seized;
    if (takeAll || newDebt === 0n) {
      writtenOff = takeAll ? newDebt : 0n;
      if (writtenOff > 0n) {
        legs.push({ account: loanAccount(positionId), asset: row.debt_asset, amount: writtenOff });
        legs.push({ account: 'supply', asset: row.debt_asset, amount: -writtenOff });
      }
      if (newCollateral > 0n && newDebt === 0n) {
        legs.push({ account: collateralAccount(positionId), asset: row.collateral_asset, amount: -newCollateral });
        legs.push({ account: walletAccount(row.borrower_id), asset: row.collateral_asset, amount: newCollateral });
      }
      newCollateral = 0n;
      stateAfter = 'closed';
    }
    const settlementBody = await commitSettlement(tx, app, {
      kind: 'liquidation',
      actor,
      positionId,
      asset: row.debt_asset,
      amount: repayAmount,
      legs,
      now,
      extra: {
        round: (BigInt(row.round) + 1n).toString(),
        borrower_id: row.borrower_id,
        repaid: repayAmount.toString(),
        seized: seized.toString(),
        bonus_amount: bonusAmount.toString(),
        written_off: writtenOff.toString(),
        health_factor_before: hfBefore === null ? null : hfApi(hfBefore),
        health_factor_after: newDebt === 0n ? null : hfApi(healthFactorScaled({
          collateralAsset: row.collateral_asset,
          debtAsset: row.debt_asset,
          collateral_amount: newCollateral,
          collateral_price: collateralPrice.price,
          debt: newDebt,
          debt_price: debtPrice.price,
          liquidation_threshold_bps: collateralPool.liquidation_threshold_bps,
        }) ?? 0n),
        state_after: stateAfter,
        price_collateral: priceApi(collateralPrice.price),
        price_debt: priceApi(debtPrice.price),
      },
      notices: [{ positionId, kind: 'liquidation' }],
    });
    const newRound = BigInt(row.round) + 1n;
    await tx.query(
      `UPDATE positions SET round = $1, debt = $2, posted_debt = $2, principal = $2, reference_index = $3,
       collateral_amount = $4, state = $5, grace_ends_at = $6, after_fill_mark = $7, updated_at = now()
       WHERE position_id = $8`,
      [newRound.toString(), newDebt.toString(), newIndex.toString(), newCollateral.toString(),
        stateAfter, null, newDebt > 0n && stateAfter !== 'closed', positionId],
    );
    return settlementBody;
  });
  return { status: 201, body: settlement };
});

route('GET', '/api/settlements/:id', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const settlementId = ctx.params.id ?? '';
  if (!/^[0-9a-f-]{36}$/.test(settlementId)) throw notFound();
  return app.db.withClient(async (client): Promise<RouteResult> => {
    const result = await client.query<{
      settlement_id: string; kind: string; actor_id: string; position_id: string | null; asset: AssetCode;
      amount: string; statement_key: string; pdf_key: string; pdf_rendered_at: Date | null; event_id: string;
      extra: Record<string, unknown>; notice_id: string | null; created_at: Date;
    }>(
      'SELECT * FROM settlements WHERE settlement_id = $1', [settlementId],
    );
    if (result.rows.length === 0) throw notFound();
    const s = result.rows[0];
    const extra = (s.extra ?? {}) as Record<string, unknown>;
    const statementStored = await app.store.exists(s.statement_key).catch((): boolean => false);
    const pdfStored = s.pdf_rendered_at !== null && await app.store.exists(s.pdf_key).catch((): boolean => false);
    const eventRow = await client.query<{ status: string }>('SELECT status FROM events WHERE event_id = $1', [s.event_id]);
    const webhookStatus = eventRow.rows[0]?.status === 'delivered' ? 'delivered' : 'queued';
    let noticeStatus: string | undefined;
    if (s.notice_id !== null) {
      const noticeRow = await client.query<{ status: string }>('SELECT status FROM notices WHERE notice_id = $1', [s.notice_id]);
      noticeStatus = noticeRow.rows[0]?.status ?? 'queued';
    }
    const legs = await client.query<{ account: string; asset: AssetCode; amount: string }>(
      `SELECT l.account, l.asset, l.amount::text AS amount FROM legs l
       JOIN postings p ON p.posting_id = l.posting_id
       WHERE p.ref = $1 ORDER BY l.posting_id, l.seq`,
      [settlementId],
    );
    return {
      status: 200,
      body: {
        settlement_id: s.settlement_id,
        kind: s.kind,
        actor_id: s.actor_id,
        position_id: s.position_id,
        asset: s.asset,
        amount: s.amount,
        legs: legs.rows,
        statement_key: s.statement_key,
        pdf_key: s.pdf_key,
        pdf_rendered_at: s.pdf_rendered_at === null ? null : canonical(s.pdf_rendered_at),
        statement_status: statementStored && pdfStored ? 'stored' : 'pending_statement',
        event_id: s.event_id,
        webhook_status: webhookStatus,
        ...(noticeStatus === undefined ? {} : { notice_status: noticeStatus }),
        created_at: canonical(s.created_at),
        ...extra,
      },
    };
  });
});

route('GET', '/api/settlements/:id/statement.pdf', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const settlementId = ctx.params.id ?? '';
  if (!/^[0-9a-f-]{36}$/.test(settlementId)) throw notFound();
  const found = await app.db.withClient(async (client): Promise<{ pdf_key: string; pdf_rendered_at: Date | null }> => {
    const result = await client.query<{ pdf_key: string; pdf_rendered_at: Date | null }>(
      'SELECT pdf_key, pdf_rendered_at FROM settlements WHERE settlement_id = $1', [settlementId],
    );
    return result.rows[0] ?? { pdf_key: '', pdf_rendered_at: null };
  });
  if (found.pdf_rendered_at === null) {
    throw problem(409, 'pdf_pending', 'The PDF statement isn\u2019t ready yet.');
  }
  const bytes = await app.store.get(found.pdf_key).catch((): Uint8Array | null => null);
  if (bytes === null) {
    throw problem(409, 'pdf_pending', 'The PDF statement isn\u2019t ready yet.');
  }
  return { status: 200, body: bytes, headers: { 'Content-Type': 'application/pdf' }, raw: true } as RouteResult & { raw: true };
});

route('GET', '/api/prices', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  const assetParam = ctx.query.get('asset');
  const rows = await app.db.withClient(async (client): Promise<unknown[]> => {
    if (assetParam !== null && isAssetCode(assetParam)) {
      const result = await client.query(
        `SELECT price_post_id, asset, price::text AS price, posted_at, posted_by, source, oracle_round::text AS oracle_round, evidence_key
         FROM price_posts WHERE asset = $1 ORDER BY posted_at DESC, price_post_id DESC LIMIT 50`,
        [assetParam],
      );
      return result.rows.map((row): Record<string, unknown> => ({ ...row, price: priceApi(BigInt(row.price)) }));
    }
    const result = await client.query(
      `SELECT price_post_id, asset, price::text AS price, posted_at, posted_by, source, oracle_round::text AS oracle_round, evidence_key
       FROM price_posts ORDER BY posted_at DESC, price_post_id DESC LIMIT 50`,
    );
    return result.rows.map((row): Record<string, unknown> => ({ ...row, price: priceApi(BigInt(row.price)) }));
  });
  return { status: 200, body: { prices: rows } };
});

route('GET', '/api/ledger/totals', { auth: true }, async (_ctx, app): Promise<RouteResult> => {
  requireRole(_ctx, ['risk_steward']);
  const now = new Date();
  await app.db.transaction(async (tx): Promise<void> => {
    await refreshAndEvaluate(tx, now);
  });
  const rows = await app.db.withClient(async (client): Promise<unknown[]> => {
    const result = await client.query<{ asset: AssetCode; debits: string; credits: string }>(
      `SELECT asset, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)::numeric(78,0)::text AS debits,
              SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END)::numeric(78,0)::text AS credits
       FROM legs GROUP BY asset`,
    );
    const byAsset = new Map<AssetCode, { debits: bigint; credits: bigint }>();
    for (const row of result.rows) {
      byAsset.set(row.asset, { debits: BigInt(row.debits), credits: BigInt(row.credits) });
    }
    const out: unknown[] = [];
    for (const code of Object.keys(ASSETS) as AssetCode[]) {
      const entry = byAsset.get(code) ?? { debits: 0n, credits: 0n };
      out.push({
        asset: code,
        debits: entry.debits.toString(),
        credits: entry.credits.toString(),
        net: (entry.debits - entry.credits).toString(),
      });
    }
    return out;
  });
  return { status: 200, body: { assets: rows } };
});

route('GET', '/api/ledger/accounts', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  requireRole(ctx, ['risk_steward']);
  const assetParam = ctx.query.get('asset');
  const rows = await app.db.withClient(async (client): Promise<unknown[]> => {
    if (assetParam !== null && isAssetCode(assetParam)) {
      const result = await client.query(
        'SELECT account, asset, balance::text AS balance FROM balances WHERE asset = $1 ORDER BY account',
        [assetParam],
      );
      return result.rows;
    }
    const result = await client.query('SELECT account, asset, balance::text AS balance FROM balances ORDER BY asset, account');
    return result.rows;
  });
  return { status: 200, body: { accounts: rows } };
});

route('GET', '/api/ledger/postings', { auth: true }, async (ctx, app): Promise<RouteResult> => {
  requireRole(ctx, ['risk_steward']);
  const now = new Date();
  const assetParam = ctx.query.get('asset');
  const limitParam = ctx.query.get('limit');
  const fromParam = ctx.query.get('from');
  const toParam = ctx.query.get('to');
  let limit = 50;
  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam)) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', { limit: 'Enter a whole number of minor units above zero.' });
    }
    const parsed = Number.parseInt(limitParam, 10);
    if (parsed < 1 || parsed > 200) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', { limit: 'Enter a whole number of minor units above zero.' });
    }
    limit = parsed;
  }
  const from = fromParam === null ? undefined : parseInstant(fromParam, 'from');
  const to = toParam === null ? undefined : parseInstant(toParam, 'to');
  if (from !== undefined && to !== undefined && to.getTime() <= from.getTime()) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { to: 'End must be after start.' });
  }
  const rows = await app.db.withClient(async (client): Promise<unknown[]> => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (assetParam !== null && isAssetCode(assetParam)) {
      params.push(assetParam);
      conditions.push(`posting_id IN (SELECT posting_id FROM legs WHERE asset = $${params.length})`);
    }
    if (from !== undefined) {
      params.push(from);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (to !== undefined) {
      params.push(to);
      conditions.push(`created_at < $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const postings = await client.query<{ posting_id: string; kind: string; ref: string | null; created_at: Date }>(
      `SELECT posting_id, kind, ref, created_at FROM postings ${where}
       ORDER BY created_at DESC, posting_id DESC LIMIT $${params.length + 1}`,
      [...params, limit],
    );
    const out: unknown[] = [];
    for (const posting of postings.rows) {
      const legs = await client.query<{ account: string; asset: AssetCode; amount: string }>(
        'SELECT account, asset, amount::text AS amount FROM legs WHERE posting_id = $1 ORDER BY seq',
        [posting.posting_id],
      );
      out.push({
        posting_id: posting.posting_id,
        kind: posting.kind,
        ref: posting.ref,
        created_at: canonical(posting.created_at),
        legs: legs.rows,
      });
    }
    return out;
  });
  return { status: 200, body: { postings: rows, server_time: canonical(now) } };
});
