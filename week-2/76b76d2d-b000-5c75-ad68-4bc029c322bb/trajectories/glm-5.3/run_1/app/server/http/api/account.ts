import { Router } from 'express';
import { query, withTransaction } from '../../services/database';
import type { AppServices } from './handlers';
import { handler, json, param, bodyOf } from './handlers';
import { ApiError, notFoundError, validationError } from '../errors';
import type { CookiedRequest } from '../scope';
import type { Locale, Tier, Cadence, StepupPurpose } from '../../domain/model';
import { isSafePath, localePath } from '../../domain/safepath';
import { createSession, createPatronAccount, findAccountByEmail } from '../../services/store';
import { verifyPassword } from '../../domain/ids';
import { membershipRow, membershipView, joinMembership, changeMembership, type PatronAccount } from '../../services/membership';
import { purchaseGift, giftByToken, redeemGift, giftTokenView } from '../../services/gifts';
import { stepupVerified, startStepup, resendStepup, verifyStepup, stepupNeeded } from '../../services/stepup';
import { creditBalance, createEnquiry } from '../../services/finance';
import { idempotencyReplay, storeIdempotent } from '../../services/checkout';
import { tierPrices, isTier, isCadence } from '../../domain/model';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function patronFromScope(req: CookiedRequest): Promise<PatronAccount | null> {
  const account = req.scope?.account ?? null;
  if (!account || account.role !== 'patron') return null;
  return {
    id: account.id,
    number: account.number as string,
    name: account.name,
    email: account.email,
    locale: (account.locale === 'fr' ? 'fr' : 'en') as Locale,
  };
}

function localeError(locale: Locale, field: string): string {
  return locale === 'en' ? 'Choose one of the listed options.' : "Choisissez l'une des options proposées.";
}

export function accountApi(services: AppServices): Router {
  const router = Router();

  // Sign up.
  router.post('/api/auth/signup', handler(async (req, res) => {
    const body = bodyOf<{ name?: unknown; email?: unknown; password?: unknown; locale?: unknown }>(req);
    const locale = req.scope?.locale ?? 'fr';
    const fields: Record<string, string> = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const preferred = body.locale === 'en' || body.locale === 'fr' ? body.locale : null;
    if (name.length < 1 || name.length > 80) fields.name = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';
    if (!emailRe.test(email) || email.length > 254) fields.email = locale === 'en' ? 'Enter a valid email address.' : 'Entrez une adresse courriel valide.';
    if (password.length < 10 || password.length > 128) fields.password = locale === 'en' ? 'Use 10 to 128 characters.' : 'Utilisez de 10 à 128 caractères.';
    if (!preferred) fields.locale = localeError(locale, 'locale');
    if (Object.keys(fields).length > 0) throw validationError(fields);

    const existing = await findAccountByEmail(email);
    if (existing) throw new ApiError('email_taken');
    const account = await createPatronAccount({ email, name, password, locale: preferred as Locale });
    const token = await createSession(account.id);
    res.setHeader('Set-Cookie', `halide_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
    json(res, 201, {
      account: {
        number: account.number,
        name: account.name,
        email: account.email,
        locale: account.locale,
        role: account.role,
      },
    });
  }));

  // Sign in.
  router.post('/api/auth/signin', handler(async (req, res) => {
    const body = bodyOf<{ email?: unknown; password?: unknown; next?: unknown }>(req);
    const locale = req.scope?.locale ?? 'fr';
    const fields: Record<string, string> = {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const next = typeof body.next === 'string' ? body.next : '';
    if (!emailRe.test(email)) fields.email = locale === 'en' ? 'Enter a valid email address.' : 'Entrez une adresse courriel valide.';
    if (password.length < 1) fields.password = locale === 'en' ? 'Required.' : 'Obligatoire.';
    if (Object.keys(fields).length > 0) throw validationError(fields);

    const account = await findAccountByEmail(email);
    if (!account || !verifyPassword(password, account.password_hash)) {
      throw new ApiError('invalid_credentials');
    }
    const signedIn = account;
    const token = await createSession(account.id);
    res.setHeader('Set-Cookie', `halide_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
    const accountLocale = (signedIn.locale === 'fr' ? 'fr' : 'en') as Locale;
    const redirect = isSafePath(next)
      ? localePath(accountLocale, next)
      : (signedIn.role === 'patron'
        ? `/${accountLocale}/account`
        : `/${accountLocale}/staff`);
    json(res, 200, {
      account: {
        number: account.number,
        name: account.name,
        email: account.email,
        locale: account.locale,
        role: account.role,
      },
      redirect,
    });
  }));

  router.post('/api/auth/signout', handler(async (req, res) => {
    if (!req.scope?.account) throw new ApiError('unauthenticated');
    await query('DELETE FROM sessions WHERE token = $1', [req.scope.sessionId]);
    res.setHeader('Set-Cookie', 'halide_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.status(204).end();
  }));

  router.get('/api/me', handler(async (req, res) => {
    const scope = req.scope;
    if (!scope) throw notFoundError();
    const account = scope.requireAccount();
    const membership = account.role === 'patron' && account.number
      ? await membershipRow(account.id)
      : null;
    const credit = account.role === 'patron' && account.number
      ? await creditBalance(account.number)
      : null;
    json(res, 200, {
      account: {
        number: account.number,
        name: account.name,
        email: account.email,
        locale: account.locale,
        role: account.role,
        membership: membership ? membershipView(membership) : null,
        credit_balance_cents: credit?.balance_cents ?? 0,
      },
    });
  }));

  router.get('/api/me/credit', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('forbidden');
    const credit = await creditBalance(patron.number);
    json(res, 200, credit);
  }));

  // Membership.
  router.get('/api/membership', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const membership = await membershipRow(patron.id);
    json(res, 200, { membership: membership ? membershipView(membership) : null });
  }));

  router.post('/api/membership', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const body = bodyOf<{ tier?: unknown; cadence?: unknown }>(req);
    const locale = req.scope?.locale ?? 'fr';
    const fields: Record<string, string> = {};
    if (!isTier(body.tier)) fields.tier = localeError(locale, 'tier');
    if (!isCadence(body.cadence)) fields.cadence = localeError(locale, 'cadence');
    if (Object.keys(fields).length > 0) throw validationError(fields);
    const tier = body.tier as Tier;
    const cadence = body.cadence as Cadence;

    // Step-up: a join while the credit balance is above zero.
    const credit = await creditBalance(patron.number);
    const verified = await stepupVerified(patron.id);
    if (stepupNeeded({ creditAppliedCents: credit.balance_cents, tierChange: false, verified })) {
      throw new ApiError('stepup_required');
    }
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');

    const outcome = await joinMembership(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      patron, tier, cadence,
    );
    json(res, 201, outcome);
  }));

  router.post('/api/membership/change', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const body = bodyOf<{ tier?: unknown; cadence?: unknown }>(req);
    const locale = req.scope?.locale ?? 'fr';
    const fields: Record<string, string> = {};
    if (!isTier(body.tier)) fields.tier = localeError(locale, 'tier');
    if (!isCadence(body.cadence)) fields.cadence = localeError(locale, 'cadence');
    if (Object.keys(fields).length > 0) throw validationError(fields);
    const tier = body.tier as Tier;
    const cadence = body.cadence as Cadence;

    // Step-up: every tier change.
    const verified = await stepupVerified(patron.id);
    if (stepupNeeded({ creditAppliedCents: 0, tierChange: true, verified })) {
      throw new ApiError('stepup_required');
    }
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');

    const outcome = await changeMembership(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      patron, tier, cadence,
    );
    json(res, 200, outcome);
  }));

  // Step-up.
  router.post('/api/stepup/start', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const body = bodyOf<{ purpose?: unknown }>(req);
    const locale = req.scope?.locale ?? 'fr';
    if (body.purpose !== 'checkout' && body.purpose !== 'gift' && body.purpose !== 'membership') {
      throw validationError({ purpose: localeError(locale, 'purpose') });
    }
    const outcome = await startStepup(
      { cfg: services.cfg, outbox: services.outbox },
      patron.id, patron.number, patron.email, patron.locale, body.purpose as StepupPurpose,
    );
    json(res, 201, outcome);
  }));

  router.post('/api/stepup/resend', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const body = bodyOf<{ challenge_id?: unknown }>(req);
    const challengeId = typeof body.challenge_id === 'string' ? body.challenge_id : '';
    if (!challengeId) throw notFoundError();
    const outcome = await resendStepup(
      { cfg: services.cfg, outbox: services.outbox },
      patron.id, challengeId, patron.number, patron.email, patron.locale,
    );
    json(res, 200, outcome);
  }));

  router.post('/api/stepup/verify', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const body = bodyOf<{ challenge_id?: unknown; code?: unknown }>(req);
    const challengeId = typeof body.challenge_id === 'string' ? body.challenge_id : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!challengeId) throw notFoundError();
    if (!/^\d{6}$/.test(code)) {
      throw validationError({ code: req.scope?.locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.' });
    }
    const outcome = await verifyStepup(services.cfg, patron.id, challengeId, code);
    json(res, 200, outcome);
  }));

  // Gifts.
  router.post('/api/gifts', handler(async (req, res) => {
    const raw = (req as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
    const locale = req.scope?.locale ?? 'fr';
    const body = bodyOf<{
      tier?: unknown; purchaser?: unknown; recipient?: unknown;
      message?: unknown; cardholder_name?: unknown;
    }>(req);
    const patron = await patronFromScope(req);
    const fields: Record<string, string> = {};
    if (!isTier(body.tier)) fields.tier = localeError(locale, 'tier');
    const recipient = (typeof body.recipient === 'object' && body.recipient !== null
      ? body.recipient as Record<string, unknown> : {});
    const purchaser = (typeof body.purchaser === 'object' && body.purchaser !== null
      ? body.purchaser as Record<string, unknown> : {});
    const recipientName = typeof recipient.name === 'string' ? recipient.name.trim() : '';
    const recipientEmail = typeof recipient.email === 'string' ? recipient.email.trim() : '';
    const recipientLocale = recipient.locale === 'en' || recipient.locale === 'fr'
      ? recipient.locale as Locale : null;
    const message = typeof body.message === 'string' ? body.message.slice(0, 300) : '';
    const cardholder = typeof body.cardholder_name === 'string' ? body.cardholder_name.trim() : '';
    if (recipientName.length < 1 || recipientName.length > 80) fields['recipient.name'] = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';
    if (!emailRe.test(recipientEmail)) fields['recipient.email'] = locale === 'en' ? 'Enter a valid email address.' : 'Entrez une adresse courriel valide.';
    if (!recipientLocale) fields['recipient.locale'] = localeError(locale, 'recipient.locale');
    if (cardholder.length < 1 || cardholder.length > 80) fields.cardholder_name = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';

    let purchaserName: string;
    let purchaserEmail: string;
    if (patron) {
      purchaserName = patron.name;
      purchaserEmail = patron.email;
    } else {
      purchaserName = typeof purchaser.name === 'string' ? purchaser.name.trim() : '';
      purchaserEmail = typeof purchaser.email === 'string' ? purchaser.email.trim() : '';
      if (purchaserName.length < 1 || purchaserName.length > 80) fields['purchaser.name'] = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';
      if (!emailRe.test(purchaserEmail)) fields['purchaser.email'] = locale === 'en' ? 'Enter a valid email address.' : 'Entrez une adresse courriel valide.';
    }
    if (Object.keys(fields).length > 0) throw validationError(fields);

    // Idempotency, before any charge.
    const idemKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null;
    const replay = await idempotencyReplay({
      sessionToken: req.scope?.sessionId ?? '',
      accountId: patron?.id ?? null,
      accountNumber: patron?.number ?? null,
      accountName: patron?.name ?? null,
      accountEmail: patron?.email ?? null,
      idempotencyKey: idemKey,
      cardholderName: cardholder,
      note: '',
      guest: null,
      split: null,
      locale,
    }, raw);
    if (replay) {
      res.setHeader('Idempotent-Replayed', 'true');
      const replayStatus = (replay.status as number) ?? 201;
      json(res, replayStatus, replay.body ?? replay);
      return;
    }

    // Step-up: a signed-in purchase while credit balance is above zero.
    if (patron) {
      const credit = await creditBalance(patron.number);
      const verified = await stepupVerified(patron.id);
      if (stepupNeeded({ creditAppliedCents: credit.balance_cents, tierChange: false, verified })) {
        throw new ApiError('stepup_required');
      }
    }
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');

    let giftView: Record<string, unknown>;
    try {
      giftView = await purchaseGift(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      {
        tier: body.tier as Tier,
        purchaserAccount: patron,
        purchaserName,
        purchaserEmail,
        purchaserLocale: locale,
        recipientName,
        recipientEmail,
        recipientLocale: recipientLocale as Locale,
        message,
        cardholderName: cardholder,
      },
    ) as unknown as Record<string, unknown>;
    } catch (err) {
      await query(`DELETE FROM idempotency WHERE key = $1 AND state = 'in_progress'`, [idemKey]);
      throw err;
    }
    const responseBody = { gift: giftView };
    await storeIdempotent(idemKey as string, 201, responseBody);
    json(res, 201, responseBody);
  }));

  router.get('/api/gifts/:ref', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const ref = param(req, 'ref');
    const gift = await query<{
      ref: string; tier: Tier; price_cents: number; recipient_name: string;
      recipient_email: string; state: string; redeemed_at: Date | null;
    }>(
      `SELECT ref, tier, price_cents, recipient_name, recipient_email, state, redeemed_at
       FROM gifts WHERE upper(ref) = upper($1) AND purchaser_account_id = $2`,
      [ref, patron.id],
    );
    if (gift.rows.length === 0) throw notFoundError();
    const g = gift.rows[0];
    json(res, 200, {
      gift: {
        ref: g.ref,
        tier: g.tier,
        price_cents: g.price_cents,
        currency: 'CAD',
        recipient_name: g.recipient_name,
        recipient_email: g.recipient_email,
        state: g.state,
        redeemed_at: g.redeemed_at ? g.redeemed_at.toISOString() : null,
      },
    });
  }));

  router.get('/api/gift-redemptions/:token', handler(async (req, res) => {
    const gift = await giftByToken(param(req, 'token'));
    if (!gift || gift.state !== 'unredeemed') throw notFoundError();
    json(res, 200, { gift: giftTokenView(gift) });
  }));

  router.post('/api/gift-redemptions/:token/redeem', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');
    const outcome = await redeemGift(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      param(req, 'token'),
      patron,
    );
    json(res, 201, outcome);
  }));

  // Enquiries.
  router.post('/api/enquiries', handler(async (req, res) => {
    const body = bodyOf<{ name?: unknown; email?: unknown; subject?: unknown; message?: unknown }>(req);
    const locale = req.scope?.locale ?? 'fr';
    const fields: Record<string, string> = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (name.length < 1 || name.length > 80) fields.name = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';
    if (!emailRe.test(email)) fields.email = locale === 'en' ? 'Enter a valid email address.' : 'Entrez une adresse courriel valide.';
    if (subject.length < 1 || subject.length > 120) fields.subject = locale === 'en' ? 'Use 1 to 120 characters.' : 'Utilisez de 1 à 120 caractères.';
    if (message.length < 1 || message.length > 4000) fields.message = locale === 'en' ? 'Use 1 to 4000 characters.' : 'Utilisez de 1 à 4000 caractères.';
    if (Object.keys(fields).length > 0) throw validationError(fields);
    const outcome = await createEnquiry({ name, email, subject, message, locale });
    json(res, 201, { enquiry: { ref: outcome.ref, state: 'open' } });
  }));

  return router;
}
