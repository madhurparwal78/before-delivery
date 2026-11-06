import { one } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { route } from '../http/router.ts';
import { sendJson } from '../http/respond.ts';
import { requireIdempotencyKey } from '../http/validate.ts';
import { bodyHash, claimKey, finishKey, releaseKey } from '../http/idempotency.ts';
import { assertBillingUp } from '../service/guard.ts';
import { activeMembership, changeMembership, joinMembership, membershipPayload } from '../service/membership.ts';
import { giftByRef, giftPayload, giftByToken, purchaseGift, redeemGift } from '../service/gifts.ts';
import { startStepup, resendStepup, verifyStepup } from '../service/stepup.ts';

async function serverNow(): Promise<Date> {
  const row = await one<{ now: Date }>('select now() as now');
  return row!.now;
}

route('GET', '/api/membership', 'patron', async (ctx) => {
  const membership = await activeMembership(ctx.account!.id);
  sendJson(ctx.res, 200, { membership: membershipPayload(membership) });
});

route('POST', '/api/membership', 'patron', async (ctx) => {
  const result = await joinMembership({
    account: ctx.account!,
    sessionToken: ctx.sessionToken,
    body: ctx.body,
    now: await serverNow(),
  });
  sendJson(ctx.res, 201, result);
});

route('POST', '/api/membership/change', 'patron', async (ctx) => {
  const result = await changeMembership({
    account: ctx.account!,
    sessionToken: ctx.sessionToken,
    body: ctx.body,
    now: await serverNow(),
  });
  sendJson(ctx.res, 200, result);
});

route('POST', '/api/gifts', 'anyone', async (ctx) => {
  const key = requireIdempotencyKey(ctx.req.headers['idempotency-key'] as string | undefined);
  const caller = ctx.account === null ? `guest:${ctx.guestKey ?? ''}` : `account:${ctx.account.id}`;
  const replay = await claimKey({ key, caller, endpoint: 'gifts', hash: bodyHash(ctx.rawBody) });
  if (replay !== null) {
    ctx.res.setHeader('Idempotent-Replayed', 'true');
    sendJson(ctx.res, replay.status, replay.body);
    return;
  }
  try {
    const gift = await purchaseGift({
      account: ctx.account,
      sessionToken: ctx.sessionToken,
      locale: ctx.locale,
      body: ctx.body,
      now: await serverNow(),
    });
    await finishKey(key, 201, { gift });
    sendJson(ctx.res, 201, { gift });
  } catch (error) {
    await releaseKey(key);
    throw error;
  }
});

route('GET', '/api/gifts/:ref', 'patron', async (ctx) => {
  const gift = await giftByRef(ctx.params.ref);
  if (gift === null || gift.purchaser_account_id !== ctx.account!.id) throw new ApiError('not_found');
  sendJson(ctx.res, 200, { gift: giftPayload(gift) });
});

route('GET', '/api/gift-redemptions/:token', 'anyone', async (ctx) => {
  const gift = await giftByToken(ctx.params.token);
  if (gift === null) throw new ApiError('not_found');
  sendJson(ctx.res, 200, {
    gift: {
      ref: gift.ref,
      tier: gift.tier,
      from_name: gift.purchaser_name,
      message: gift.message,
      term_months: 12,
    },
  });
});

route('POST', '/api/gift-redemptions/:token/redeem', 'patron', async (ctx) => {
  assertBillingUp();
  const result = await redeemGift({
    token: ctx.params.token,
    account: ctx.account!,
    now: await serverNow(),
  });
  sendJson(ctx.res, 201, result);
});

route('POST', '/api/stepup/start', 'patron', async (ctx) => {
  const challenge = await startStepup({ account: ctx.account!, body: ctx.body, now: await serverNow() });
  sendJson(ctx.res, 201, { challenge });
});

route('POST', '/api/stepup/resend', 'patron', async (ctx) => {
  const challenge = await resendStepup({ account: ctx.account!, body: ctx.body, now: await serverNow() });
  sendJson(ctx.res, 200, { challenge });
});

route('POST', '/api/stepup/verify', 'patron', async (ctx) => {
  const stepup = await verifyStepup({
    account: ctx.account!,
    sessionToken: ctx.sessionToken,
    body: ctx.body,
    now: await serverNow(),
  });
  sendJson(ctx.res, 200, { stepup });
});
