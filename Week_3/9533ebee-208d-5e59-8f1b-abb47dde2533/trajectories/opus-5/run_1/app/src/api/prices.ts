/**
 * Manual price posts and the price history.
 */

import { query, transaction } from '../db/pool.ts';
import { apiPrice } from '../domain/apiformat.ts';
import { isAsset } from '../domain/assets.ts';
import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import { isLargeMove } from '../domain/oracle.ts';
import { applyPricePost, listPricePosts } from '../market/prices.ts';
import { loadAsset } from '../market/state.ts';
import { wholeSecond } from '../market/accrual.ts';
import { validationFailed } from '../http/problem.ts';
import type { Member } from '../http/sessions.ts';
import type { Reply, Request, Route } from '../http/router.ts';
import { finishWith, Validator } from '../http/validate.ts';

async function postPrice(request: Request, member: Member): Promise<Reply> {
  const validator = new Validator(request.body, ['asset', 'price', 'confirm_large_move']);
  const asset = validator.asset('asset');
  const price = validator.price('price');
  const confirm = validator.optionalBoolean(
    'confirm_large_move',
    API_FIELD_MESSAGE.confirmLargeMove,
  );
  const fields = finishWith(validator, { asset, price });

  const current = await loadAsset({ query }, fields.asset);
  // A move of more than 60% needs explicit confirmation. Exactly 60% is allowed.
  if (isLargeMove(current.price.price, fields.price) && confirm !== true) {
    throw validationFailed({ price: API_FIELD_MESSAGE.priceLargeMove });
  }

  // A manual post's posted_at is the server's now.
  const postedAtMs = wholeSecond(request.nowMs);
  const submitted: Record<string, unknown> = {};
  for (const key of ['asset', 'price', 'confirm_large_move']) {
    if (Object.prototype.hasOwnProperty.call(request.body, key)) {
      submitted[key] = request.body[key];
    }
  }

  const result = await transaction((client) =>
    applyPricePost(
      client,
      {
        asset: fields.asset,
        price: fields.price,
        postedBy: member.actorId,
        source: 'manual',
        oracleRound: null,
        postedAtMs,
        submitted,
        oracleResponse: null,
      },
      request.nowMs,
    ),
  );

  return {
    status: 201,
    body: {
      price_post_id: result.pricePostId,
      asset: fields.asset,
      price: apiPrice(fields.price),
      previous_price: apiPrice(result.previousPrice),
      posted_at: formatCanonicalUtc(postedAtMs),
      source: 'manual',
      positions_below_one: result.positionsBelowOne,
      evidence_key: result.evidenceKey,
    },
  };
}

async function readPrices(request: Request): Promise<Reply> {
  const named = request.search.get('asset');
  const asset = named === null ? null : isAsset(named) ? named : null;
  const posts = await listPricePosts({ query }, asset);
  return {
    status: 200,
    body: {
      prices: posts.map((post) => ({
        price_post_id: post.pricePostId,
        asset: post.asset,
        price: apiPrice(post.price),
        posted_at: formatCanonicalUtc(post.postedAtMs),
        posted_by: post.postedBy,
        source: post.source,
        oracle_round: post.oracleRound,
        evidence_key: post.evidenceKey,
      })),
    },
  };
}

export const priceRoutes: readonly Route[] = [
  {
    kind: 'member',
    method: 'POST',
    pattern: '/api/prices',
    roles: ['risk_steward'],
    handler: postPrice,
  },
  { kind: 'member', method: 'GET', pattern: '/api/prices', handler: readPrices },
];
