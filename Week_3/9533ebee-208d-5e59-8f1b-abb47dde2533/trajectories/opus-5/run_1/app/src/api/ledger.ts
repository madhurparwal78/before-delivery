/**
 * The ledger views: the trial balance, account balances and the filtered
 * postings.
 */

import { query } from '../db/pool.ts';
import { apiAmount } from '../domain/apiformat.ts';
import { isAsset } from '../domain/assets.ts';
import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { formatCanonicalUtc, parseRfc3339 } from '../domain/desktime.ts';
import { accountBalances, listPostings, trialBalance } from '../ledger/postings.ts';
import { refreshMarket } from '../market/refresh.ts';
import { validationFailed } from '../http/problem.ts';
import type { Reply, Request, Route } from '../http/router.ts';

async function readTotals(request: Request): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const totals = await trialBalance({ query });
  return {
    status: 200,
    body: {
      assets: totals.map((total) => ({
        asset: total.asset,
        debits: apiAmount(total.debits),
        credits: apiAmount(total.credits),
        net: apiAmount(total.net),
      })),
    },
  };
}

async function readAccounts(request: Request): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const named = request.search.get('asset');
  if (named === null || !isAsset(named)) {
    throw validationFailed({ asset: API_FIELD_MESSAGE.unlistedAsset });
  }
  const rows = await accountBalances({ query }, named);
  return {
    status: 200,
    body: {
      accounts: rows.map((row) => ({
        account: row.account,
        asset: row.asset,
        balance: apiAmount(row.balance),
      })),
    },
  };
}

/** `limit` runs from 1 to 200 and defaults to 50. */
function readLimit(raw: string | null): number {
  if (raw === null) return 50;
  if (!/^[0-9]+$/.test(raw)) throw validationFailed({ limit: 'Send a limit from 1 to 200.' });
  const value = Number(raw);
  if (value < 1 || value > 200)
    throw validationFailed({ limit: 'Send a limit from 1 to 200.' });
  return value;
}

async function readPostings(request: Request): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const named = request.search.get('asset');
  const asset = named === null ? null : isAsset(named) ? named : null;
  if (named !== null && asset === null) {
    throw validationFailed({ asset: API_FIELD_MESSAGE.unlistedAsset });
  }
  const limit = readLimit(request.search.get('limit'));

  const fromRaw = request.search.get('from');
  const toRaw = request.search.get('to');
  const fromMs = fromRaw === null ? null : parseRfc3339(fromRaw);
  if (fromRaw !== null && fromMs === null) {
    throw validationFailed({ from: API_FIELD_MESSAGE.instant });
  }
  const toMs = toRaw === null ? null : parseRfc3339(toRaw);
  if (toRaw !== null && toMs === null) {
    throw validationFailed({ to: API_FIELD_MESSAGE.instant });
  }
  if (fromMs !== null && toMs !== null && toMs <= fromMs) {
    throw validationFailed({ to: API_FIELD_MESSAGE.endBeforeStart });
  }

  const postings = await listPostings({ query }, { asset, limit, fromMs, toMs });
  return {
    status: 200,
    body: {
      postings: postings.map((posting) => ({
        posting_id: posting.postingId,
        kind: posting.kind,
        ref: posting.ref,
        created_at: formatCanonicalUtc(posting.createdAtMs),
        legs: posting.legs.map((leg) => ({
          account: leg.account,
          asset: leg.asset,
          amount: apiAmount(leg.amount),
        })),
      })),
      server_time: formatCanonicalUtc(request.nowMs),
    },
  };
}

export const ledgerRoutes: readonly Route[] = [
  {
    kind: 'member',
    method: 'GET',
    pattern: '/api/ledger/totals',
    roles: ['risk_steward'],
    handler: (request) => readTotals(request),
  },
  {
    kind: 'member',
    method: 'GET',
    pattern: '/api/ledger/accounts',
    roles: ['risk_steward'],
    handler: (request) => readAccounts(request),
  },
  {
    kind: 'member',
    method: 'GET',
    pattern: '/api/ledger/postings',
    roles: ['risk_steward'],
    handler: (request) => readPostings(request),
  },
];
