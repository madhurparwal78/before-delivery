/**
 * Members, sessions, onboarding, inbound transfers and wallets.
 */

import { randomUUID } from 'node:crypto';
import { query, transaction, writeInstant } from '../db/pool.ts';
import { apiAmount } from '../domain/apiformat.ts';
import { ASSET_CODES } from '../domain/assets.ts';
import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { shareValue } from '../domain/pool.ts';
import { CUSTODY, walletAccount } from '../ledger/accounts.ts';
import { insertPosting, poolBalances, walletBalances } from '../ledger/postings.ts';
import { refreshMarket } from '../market/refresh.ts';
import { loadAssets } from '../market/state.ts';
import { emailTaken, validationFailed } from '../http/problem.ts';
import { createSession, isRole, type Member } from '../http/sessions.ts';
import { finishWith, Validator } from '../http/validate.ts';
import type { Reply, Request, Route } from '../http/router.ts';

/** One address with a domain, which is as much as the desk needs to post to. */
const EMAIL =
  /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

async function listActors(): Promise<Reply> {
  const result = await query<{ actor_id: string; name: string; email: string; role: string }>(
    'SELECT actor_id, name, email, role FROM actors ORDER BY name, actor_id',
  );
  return {
    status: 200,
    body: {
      actors: result.rows.map((row) => ({
        actor_id: row.actor_id,
        name: row.name,
        email: row.email,
        role: row.role,
      })),
    },
  };
}

async function openSession(request: Request): Promise<Reply> {
  const validator = new Validator(request.body, ['actor_id']);
  const fields = finishWith(validator, {
    actorId: validator.text('actor_id', API_FIELD_MESSAGE.actorId),
  });

  const found = await query<{ role: string }>('SELECT role FROM actors WHERE actor_id = $1', [
    fields.actorId,
  ]);
  const role = found.rows[0]?.role;
  if (role === undefined) throw validationFailed({ actor_id: API_FIELD_MESSAGE.actorId });

  const token = await createSession(fields.actorId);
  return { status: 201, body: { token, actor_id: fields.actorId, role } };
}

function describeMember(member: Member): Reply {
  return {
    status: 200,
    body: {
      actor_id: member.actorId,
      name: member.name,
      email: member.email,
      role: member.role,
    },
  };
}

async function addMember(request: Request): Promise<Reply> {
  const validator = new Validator(request.body, ['name', 'email', 'role']);
  const name = validator.text('name', API_FIELD_MESSAGE.name);
  const email = validator.text('email', API_FIELD_MESSAGE.email);
  const role = validator.text('role', API_FIELD_MESSAGE.role);

  if (name !== null && ([...name].length < 1 || [...name].length > 80 || name.trim() === '')) {
    validator.fail('name', API_FIELD_MESSAGE.name);
  }
  if (email !== null && !EMAIL.test(email)) validator.fail('email', API_FIELD_MESSAGE.email);
  if (role !== null && !isRole(role)) validator.fail('role', API_FIELD_MESSAGE.role);

  const fields = finishWith(validator, { name, email, role });
  if (!isRole(fields.role)) throw validationFailed({ role: API_FIELD_MESSAGE.role });

  const actorId = `mem-${randomUUID().slice(0, 12)}`;
  try {
    await query(
      `INSERT INTO actors (actor_id, name, email, email_lower, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actorId,
        fields.name,
        fields.email,
        fields.email.toLowerCase(),
        fields.role,
        writeInstant(Date.now()),
      ],
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === '23505'
    ) {
      throw emailTaken();
    }
    throw error;
  }

  return {
    status: 201,
    body: { actor_id: actorId, name: fields.name, email: fields.email, role: fields.role },
  };
}

async function recordTransfer(request: Request): Promise<Reply> {
  const validator = new Validator(request.body, ['actor_id', 'asset', 'amount']);
  const actorId = validator.text('actor_id', API_FIELD_MESSAGE.actorId);
  const asset = validator.asset('asset');
  const amount = validator.amount('amount');

  if (actorId !== null) {
    const found = await query<{ actor_id: string }>(
      'SELECT actor_id FROM actors WHERE actor_id = $1',
      [actorId],
    );
    if (found.rows[0] === undefined) validator.fail('actor_id', API_FIELD_MESSAGE.actorId);
  }
  const fields = finishWith(validator, { actorId, asset, amount });

  const postingId = await transaction((client) =>
    insertPosting(client, {
      kind: 'transfer_in',
      ref: fields.actorId,
      createdAtMs: request.nowMs,
      legs: [
        { account: CUSTODY, asset: fields.asset, amount: -fields.amount },
        { account: walletAccount(fields.actorId), asset: fields.asset, amount: fields.amount },
      ],
    }),
  );

  return {
    status: 201,
    body: {
      transfer_id: randomUUID(),
      posting_id: postingId,
      actor_id: fields.actorId,
      asset: fields.asset,
      amount: apiAmount(fields.amount),
    },
  };
}

async function readWallet(request: Request, member: Member): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const balances = await walletBalances({ query }, member.actorId);
  const assets = await loadAssets({ query });

  const shareRows = await query<{ asset: string; shares: string }>(
    'SELECT asset, shares FROM lp_shares WHERE actor_id = $1',
    [member.actorId],
  );
  const sharesByAsset = new Map(shareRows.rows.map((row) => [row.asset, BigInt(row.shares)]));

  const holdings: Array<{ asset: string; shares: string; value: string }> = [];
  for (const asset of ASSET_CODES) {
    const shares = sharesByAsset.get(asset) ?? 0n;
    if (shares === 0n) continue;
    const pool = await poolBalances({ query }, asset);
    holdings.push({
      asset,
      shares: apiAmount(shares),
      value: apiAmount(shareValue(shares, pool.supply, assets[asset].settings.totalShares)),
    });
  }

  const positions = await query<{ position_id: string }>(
    "SELECT position_id FROM positions WHERE borrower_id = $1 AND state <> 'closed' ORDER BY position_id",
    [member.actorId],
  );

  return {
    status: 200,
    body: {
      actor_id: member.actorId,
      balances: ASSET_CODES.map((asset) => ({ asset, amount: apiAmount(balances[asset]) })),
      lp_holdings: holdings,
      position_ids: positions.rows.map((row) => row.position_id),
    },
  };
}

export const memberRoutes: readonly Route[] = [
  { kind: 'anonymous', method: 'GET', pattern: '/api/actors', handler: () => listActors() },
  { kind: 'anonymous', method: 'POST', pattern: '/api/sessions', handler: openSession },
  {
    kind: 'member',
    method: 'GET',
    pattern: '/api/me',
    handler: (_request, member) => Promise.resolve(describeMember(member)),
  },
  {
    kind: 'member',
    method: 'POST',
    pattern: '/api/actors',
    roles: ['risk_steward'],
    handler: (request) => addMember(request),
  },
  {
    kind: 'member',
    method: 'POST',
    pattern: '/api/transfers',
    roles: ['risk_steward'],
    handler: (request) => recordTransfer(request),
  },
  { kind: 'member', method: 'GET', pattern: '/api/wallet', handler: readWallet },
];
