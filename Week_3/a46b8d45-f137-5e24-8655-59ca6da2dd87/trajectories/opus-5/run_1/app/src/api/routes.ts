/**
 * Every published endpoint. Nothing here is served that the brief does not name.
 */

import * as actions from './claim-actions';
import * as catalogue from '../db/catalogue';
import * as claims from '../db/claims';
import * as owner from './owner-actions';
import * as storage from '../services/storage';
import { apiError, partNotFound, partWithdrawn, validationFailed, type Audience } from '../http/errors';
import { askCarrier, postcodeArea } from '../services/carrier';
import {
  bodyFingerprint,
  closeSession,
  findOperator,
  isIdempotencyKey,
  openSession,
  rateVerdict,
  referenceLockVerdict,
  replayVerdict,
  storeResponse,
} from '../db/shared-state';
import { claimView, shareView, type ClaimViewContext } from './views';
import { config } from '../config';
import { detectPhotoType } from '../domain/photos';
import { importSupplierFile, saveEdition } from './upkeep';
import { isReference, matchesExactly, normaliseReference } from '../domain/references';
import { now } from '../domain/time';
import { passwordMatches } from '../services/passwords';
import { SESSION_COOKIE, type Reply, type RequestContext, type Route } from '../http/router';
import { withTransaction } from '../db/pool';
import type { ClaimRecord } from '../db/claims';
import type { DeclineReason } from '../db/claims';

const OPERATOR: Audience = 'operator';
const OWNER: Audience = 'owner';

const PARTS_PAGE_DEFAULT = 20;
const PARTS_PAGE_MAX = 50;

/* ------------------------------------------------------------------------- helpers */

function queryText(context: RequestContext, name: string): string {
  return context.url.searchParams.get(name) ?? '';
}

function bodyText(context: RequestContext, name: string): string {
  const value = context.json[name];
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

async function viewContext(claim: claims.ClaimRow): Promise<ClaimViewContext> {
  if (claim.model_slug === null) return { modelName: null, part: null };
  const model = await catalogue.findModel(claim.model_slug);
  const part = claim.booklet_number === null ? null : await catalogue.findPart(claim.model_slug, claim.booklet_number);
  return { modelName: model?.name ?? null, part };
}

/**
 * The one place operator claim endpoints resolve a reference. An unknown or malformed
 * reference, and a body reference naming a different claim, all answer the same bytes.
 */
async function resolveOperatorClaim(context: RequestContext): Promise<claims.ClaimRow> {
  const notFound = apiError(OPERATOR, 404, 'not_found');
  const reference = normaliseReference(context.params['reference'] ?? '');
  if (!isReference(reference)) throw notFound;

  const bodyReference = bodyText(context, 'reference');
  if (bodyReference !== '' && normaliseReference(bodyReference) !== reference) throw notFound;

  const claim = await claims.findClaimRow(reference);
  if (claim === null) throw notFound;
  return claim;
}

async function claimReply(reference: string): Promise<Reply> {
  const record = await claims.loadClaim(reference);
  if (record === null) throw apiError(OPERATOR, 404, 'not_found');
  return { status: 200, json: claimView(record, await viewContext(record.claim)) };
}

/**
 * Quote, payment, decline and dispatch all carry an idempotency key. A replay on the same
 * claim returns the stored response with no second Kill Bill effect, and a reused key with
 * a different body or action is refused.
 */
async function idempotent(
  context: RequestContext,
  reference: string,
  action: string,
  work: () => Promise<void>,
): Promise<Reply> {
  const key = context.raw.headers['idempotency-key'];
  const given = typeof key === 'string' ? key : '';
  if (given === '') throw validationFailed({ idempotency_key: 'required' });
  if (!isIdempotencyKey(given)) throw validationFailed({ idempotency_key: 'invalid' });

  const fingerprint = bodyFingerprint(context.json);
  const verdict = await withTransaction((tx) => replayVerdict(tx, reference, given, action, fingerprint));
  if (verdict.kind === 'conflict') throw apiError(OPERATOR, 409, 'idempotency_conflict');
  if (verdict.kind === 'replay') {
    return { status: verdict.stored.status, body: verdict.stored.body, contentType: 'application/json; charset=utf-8' };
  }

  await work();
  const reply = await claimReply(reference);
  // Only a 200 is stored, so a failed attempt leaves its key unused.
  await withTransaction((tx) =>
    storeResponse(tx, reference, given, action, fingerprint, { status: 200, body: JSON.stringify(reply.json) }, now()),
  );
  return reply;
}

/* -------------------------------------------------------------------- public routes */

const publicRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    audience: OWNER,
    // Answers whatever the state of the services.
    handler: async () => ({ status: 200, json: { status: 'ok' } }),
  },

  {
    method: 'GET',
    pattern: '/api/models',
    audience: OWNER,
    handler: async () => {
      const models = await catalogue.listModels();
      return {
        status: 200,
        json: {
          models: models.map((model) => ({
            slug: model.slug,
            name: model.name,
            axis: model.axis,
            // A model's diagram can be drawn exactly when it has an axis.
            diagram: model.axis !== null,
            part_count: model.partCount,
          })),
        },
      };
    },
  },

  {
    method: 'GET',
    pattern: '/api/models/:slug',
    audience: OWNER,
    handler: async (context) => {
      const model = await catalogue.findModel(context.params['slug'] ?? '');
      if (model === null) throw partNotFound();
      const parts = await catalogue.listParts(model.slug);
      return {
        status: 200,
        json: {
          slug: model.slug,
          name: model.name,
          axis: model.axis,
          diagram: model.axis !== null,
          parts: parts.map((part) => ({
            booklet_number: part.bookletNumber,
            part_number: part.partNumber,
            name: part.name,
            longest_side_mm: part.longestSideMm,
            status: part.status,
          })),
        },
      };
    },
  },

  {
    method: 'GET',
    pattern: '/api/parts',
    audience: OWNER,
    handler: async (context) => {
      // The rate limit is judged before anything else.
      const verdict = await rateVerdict(context.caller, now());
      if (verdict.limited) {
        throw apiError(OWNER, 429, 'rate_limited', { retryAfter: verdict.retryAfter });
      }

      const rawLimit = queryText(context, 'limit');
      let limit = PARTS_PAGE_DEFAULT;
      if (rawLimit !== '') {
        if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) throw validationFailed({ limit: 'invalid' });
        limit = Math.min(Number(rawLimit), PARTS_PAGE_MAX);
      }

      const rawCursor = queryText(context, 'cursor');
      const cursor = rawCursor === '' ? null : decodeCursor(rawCursor);
      const model = queryText(context, 'model');

      const parts = await catalogue.pageParts(model === '' ? null : model, limit + 1, cursor);
      const page = parts.slice(0, limit);
      const nextCursor = parts.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null;

      return {
        status: 200,
        json: {
          parts: page.map((part) => ({
            model: part.modelSlug,
            booklet_number: part.bookletNumber,
            part_number: part.partNumber,
            name: part.name,
            price_minor: part.priceMinor,
            status: part.status,
          })),
          next_cursor: nextCursor,
        },
      };
    },
  },

  {
    method: 'GET',
    pattern: '/api/carriage-estimate',
    audience: OWNER,
    handler: async (context) => {
      const model = queryText(context, 'model');
      const rawPart = queryText(context, 'part');
      const rawQuantity = queryText(context, 'quantity');
      const postcode = queryText(context, 'postcode');

      const errors: Record<string, string> = {};
      if (model === '') errors['model'] = 'required';
      let bookletNumber: number | null = null;
      if (rawPart === '') errors['part'] = 'required';
      else if (!/^\d+$/.test(rawPart) || Number(rawPart) < 1 || Number(rawPart) > 99) errors['part'] = 'invalid';
      else bookletNumber = Number(rawPart);

      // The model slug and booklet number are looked up before any other field.
      let part: catalogue.CataloguePart | null = null;
      if (Object.keys(errors).length === 0 && bookletNumber !== null) {
        part = await catalogue.findPart(model, bookletNumber);
        if (part === null) throw partNotFound();
        if (part.status === 'withdrawn') throw partWithdrawn(OWNER, bookletNumber);
      }

      let quantity: number | null = null;
      if (rawQuantity === '') errors['quantity'] = 'required';
      else if (!/^\d+$/.test(rawQuantity) || Number(rawQuantity) < 1 || Number(rawQuantity) > 20) {
        errors['quantity'] = 'invalid';
      } else quantity = Number(rawQuantity);

      if (postcode === '') errors['postcode'] = 'required';
      else if (!/^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/.test(postcode.trim().toUpperCase())) {
        errors['postcode'] = 'invalid';
      }

      if (Object.keys(errors).length > 0) throw validationFailed(errors);
      if (part === null || quantity === null) throw partNotFound();

      const quote = await askCarrier(
        {
          weightG: part.weightG * quantity,
          longestSideMm: part.longestSideMm,
          postcodeArea: postcodeArea(postcode),
        },
        now(),
      );
      return {
        status: 200,
        json: {
          band: quote.band,
          charge_minor: quote.chargeMinor,
          currency: quote.currency,
          valid_until: quote.validUntil.toISOString(),
        },
      };
    },
  },

  {
    method: 'POST',
    pattern: '/api/claims',
    audience: OWNER,
    body: 'multipart',
    handler: async (context) => {
      const parts = context.multipart;
      if (parts === null) throw apiError(OWNER, 415, 'unsupported_media_type');
      const field = (name: string): string => parts.fields[name] ?? '';

      const result = await owner.startClaim(
        {
          name: field('name'),
          email: field('email'),
          postcode: field('postcode'),
          model: field('model'),
          bookletNumber: field('booklet_number'),
          quantity: field('quantity'),
          purchaseDate: field('purchase_date'),
          description: field('description'),
          language: field('language'),
        },
        parts.files.filter((file) => file.field === 'photos'),
      );

      return {
        status: 201,
        json: {
          reference: result.reference,
          state: 'started',
          confirm_by: result.confirmBy.toISOString(),
        },
      };
    },
  },

  {
    method: 'GET',
    pattern: '/api/claims/:reference/confirmation',
    audience: OWNER,
    handler: async (context) => {
      const status = await owner.confirmationStatus(context.params['reference'] ?? '');
      return {
        status: 200,
        json: {
          reference: status.reference,
          link_state: status.linkState,
          confirm_by: status.confirmBy.toISOString(),
        },
      };
    },
  },

  {
    method: 'POST',
    pattern: '/api/claims/confirm',
    audience: OWNER,
    body: 'json',
    handler: async (context) => {
      const token = bodyText(context, 'token');
      if (token === '') throw validationFailed({ token: 'required' });
      const bodyReference = bodyText(context, 'reference');
      const result = await owner.confirmClaim(token, bodyReference === '' ? null : bodyReference);
      return {
        status: 200,
        json: { reference: result.reference, state: 'confirmed', share_url: `/s/${result.shareToken}` },
      };
    },
  },

  {
    method: 'POST',
    pattern: '/api/claims/lookup',
    audience: OWNER,
    body: 'json',
    handler: async (context) => {
      const reference = bodyText(context, 'reference');
      const email = bodyText(context, 'email');
      const errors: Record<string, string> = {};
      if (reference.trim() === '') errors['reference'] = 'required';
      if (email.trim() === '') errors['email'] = 'required';
      if (Object.keys(errors).length > 0) throw validationFailed(errors);

      // A locked reference is refused before the email is compared.
      const named = normaliseReference(reference.trim());
      if (isReference(named)) {
        const lock = await referenceLockVerdict(named, now());
        if (lock.locked) throw apiError(OWNER, 423, 'reference_locked', { retryAfter: lock.retryAfter });
      }

      const result = await owner.lookupClaim(reference, email);
      return { status: 200, json: { share_url: `/s/${result.shareToken}` } };
    },
  },

  {
    method: 'GET',
    pattern: '/api/share/:token',
    audience: OWNER,
    readOnlyPath: true,
    handler: async (context) => {
      const record = await shareRecord(context.params['token'] ?? '');
      return { status: 200, json: shareView(record, await viewContext(record.claim)) };
    },
  },
];

/** A share token reads only its own claim, and query parameters are ignored. */
export async function shareRecord(token: string): Promise<ClaimRecord> {
  const unknown = apiError(OWNER, 404, 'share_unknown');
  const link = await claims.findShareLink(token);
  if (link === null) throw unknown;
  if (link.state === 'withdrawn') throw apiError(OWNER, 410, 'link_withdrawn');
  if (link.state === 'ended') throw apiError(OWNER, 410, 'claim_closed');

  const record = await claims.loadClaim(link.reference);
  if (record === null || record.claim.state === 'erased') throw unknown;
  return record;
}

interface PartsCursor {
  slug: string;
  booklet: number;
  partNumber: string;
}

function encodeCursor(part: catalogue.CataloguePart): string {
  const payload: PartsCursor = { slug: part.modelSlug, booklet: part.bookletNumber, partNumber: part.partNumber };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): PartsCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<PartsCursor>;
    if (typeof parsed.slug !== 'string' || typeof parsed.booklet !== 'number' || typeof parsed.partNumber !== 'string') {
      throw new Error('bad cursor');
    }
    return { slug: parsed.slug, booklet: parsed.booklet, partNumber: parsed.partNumber };
  } catch {
    throw validationFailed({ cursor: 'invalid' });
  }
}

/* ------------------------------------------------------------------ operator routes */

const operatorRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/ops/session',
    audience: OPERATOR,
    body: 'json',
    handler: async (context) => {
      const email = bodyText(context, 'email');
      const password = bodyText(context, 'password');
      const errors: Record<string, string> = {};
      if (email.trim() === '') errors['email'] = 'required';
      if (password === '') errors['password'] = 'required';
      if (Object.keys(errors).length > 0) throw validationFailed(errors);

      const operator = await findOperator(email.trim());
      if (operator === null || !passwordMatches(password, operator.passwordHash)) {
        throw apiError(OPERATOR, 401, 'bad_credentials');
      }
      const token = await openSession(operator.id, now());
      return {
        status: 204,
        headers: {
          'set-cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.operatorSessionSeconds}`,
        },
      };
    },
  },

  {
    method: 'DELETE',
    pattern: '/api/ops/session',
    audience: OPERATOR,
    handler: async (context) => {
      const token = context.cookies[SESSION_COOKIE];
      if (token !== undefined) await closeSession(token);
      return {
        status: 204,
        headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` },
      };
    },
  },

  {
    method: 'GET',
    pattern: '/api/ops/claims',
    audience: OPERATOR,
    session: true,
    handler: async (context) => {
      const wanted = queryText(context, 'state');
      const entries = await claims.listQueue(wanted === '' ? null : (wanted as claims.ClaimRow['state']));
      return {
        status: 200,
        json: {
          claims: entries.map((entry) => ({
            reference: entry.reference,
            state: entry.state,
            model: entry.modelName,
            confirmed_at: entry.confirmedAt === null ? null : entry.confirmedAt.toISOString(),
          })),
        },
      };
    },
  },

  {
    method: 'GET',
    pattern: '/api/ops/claims/:reference',
    audience: OPERATOR,
    session: true,
    handler: async (context) => claimReply((await resolveOperatorClaim(context)).reference),
  },

  {
    method: 'GET',
    pattern: '/api/ops/claims/:reference/photos/:index',
    audience: OPERATOR,
    session: true,
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      const index = Number(context.params['index'] ?? '');
      if (!Number.isInteger(index) || index < 1) throw apiError(OPERATOR, 404, 'not_found');

      const object = await storage.getObject(storage.photoKey(claim.reference, index));
      if (object === null) throw apiError(OPERATOR, 404, 'not_found');
      // Served with the type detected from its own bytes.
      const detected = detectPhotoType(object.bytes) ?? 'application/octet-stream';
      return { status: 200, body: object.bytes, contentType: detected };
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/claims/:reference/identify',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      const model = bodyText(context, 'model');
      const rawBooklet = bodyText(context, 'booklet_number');
      const rawQuantity = bodyText(context, 'quantity');

      const errors: Record<string, string> = {};
      if (model.trim() === '') errors['model'] = 'required';
      let bookletNumber: number | null = null;
      if (rawBooklet === '') errors['booklet_number'] = 'required';
      else if (!/^\d+$/.test(rawBooklet) || Number(rawBooklet) < 1 || Number(rawBooklet) > 99) {
        errors['booklet_number'] = 'invalid';
      } else bookletNumber = Number(rawBooklet);

      let quantity: number | null = null;
      if (rawQuantity === '') errors['quantity'] = 'required';
      else if (!/^\d+$/.test(rawQuantity) || Number(rawQuantity) < 1 || Number(rawQuantity) > 20) {
        errors['quantity'] = 'invalid';
      } else quantity = Number(rawQuantity);

      if (Object.keys(errors).length > 0) throw validationFailed(errors);

      await actions.identifyPart(claim.reference, {
        modelSlug: model.trim(),
        bookletNumber: bookletNumber as number,
        quantity: quantity as number,
      });
      return claimReply(claim.reference);
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/claims/:reference/quote',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      return idempotent(context, claim.reference, 'quote', () => actions.quoteClaim(claim.reference));
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/claims/:reference/payment',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      return idempotent(context, claim.reference, 'payment', () => actions.recordPayment(claim.reference));
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/claims/:reference/decline',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      return idempotent(context, claim.reference, 'decline', async () => {
        const reason = bodyText(context, 'reason');
        if (reason === '') throw validationFailed({ reason: 'required' });
        if (reason !== 'owner_declined' && reason !== 'cannot_send') throw validationFailed({ reason: 'invalid' });
        await actions.declineClaim(claim.reference, reason as DeclineReason);
      });
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/claims/:reference/dispatch',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      return idempotent(context, claim.reference, 'dispatch', () => actions.dispatchClaim(claim.reference));
    },
  },

  {
    method: 'GET',
    pattern: '/api/ops/claims/:reference/dispatch-note',
    audience: OPERATOR,
    session: true,
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      const object = await storage.getObject(storage.dispatchNoteKey(claim.reference));
      if (object === null) throw apiError(OPERATOR, 404, 'not_found');
      return { status: 200, body: object.bytes, contentType: 'text/html; charset=utf-8' };
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/claims/:reference/close',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      await actions.closeClaim(claim.reference);
      return claimReply(claim.reference);
    },
  },

  {
    method: 'DELETE',
    pattern: '/api/ops/claims/:reference/share-link',
    audience: OPERATOR,
    session: true,
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      await actions.withdrawShareLink(claim.reference);
      return { status: 204 };
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/claims/:reference/share-link',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      await actions.newShareLink(claim.reference);
      const reply = await claimReply(claim.reference);
      return { status: 201, json: reply.json };
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/claims/:reference/erase',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const claim = await resolveOperatorClaim(context);
      const typed = context.json['confirm_reference'];
      if (typeof typed !== 'string' || typed === '') throw validationFailed({ confirm_reference: 'required' });

      // A compared reference is validation, not identification.
      if (!matchesExactly(typed, claim.reference)) throw validationFailed({ confirm_reference: 'mismatch' });

      const result = await actions.eraseOwner(claim.reference);
      return { status: 200, json: { erased: result.erased } };
    },
  },

  {
    method: 'GET',
    pattern: '/api/ops/stats',
    audience: OPERATOR,
    session: true,
    handler: async () => {
      const counts = await catalogue.decidedCounts();
      return {
        status: 200,
        json: {
          decided_claims: counts.decidedClaims,
          decided_inside: counts.decidedInside,
          decided_outside: counts.decidedOutside,
        },
      };
    },
  },

  {
    method: 'GET',
    pattern: '/api/ops/editions',
    audience: OPERATOR,
    session: true,
    handler: async () => {
      const editions = await catalogue.listEditions();
      return {
        status: 200,
        json: {
          editions: editions.map((edition) => ({
            code: edition.code,
            title: edition.title,
            starts_on: edition.startsOn,
            standard_months: edition.standardMonths,
            club_months: edition.clubMonths,
            owner_contribution_percent: edition.ownerContributionPercent,
          })),
        },
      };
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/editions',
    audience: OPERATOR,
    session: true,
    body: 'json',
    handler: async (context) => {
      const edition = await saveEdition({
        code: bodyText(context, 'code'),
        title: bodyText(context, 'title'),
        startsOn: bodyText(context, 'starts_on'),
        standardMonths: bodyText(context, 'standard_months'),
        clubMonths: bodyText(context, 'club_months'),
        ownerContributionPercent: bodyText(context, 'owner_contribution_percent'),
      });
      return {
        status: 201,
        json: {
          code: edition.code,
          title: edition.title,
          starts_on: edition.startsOn,
          standard_months: edition.standardMonths,
          club_months: edition.clubMonths,
          owner_contribution_percent: edition.ownerContributionPercent,
        },
      };
    },
  },

  {
    method: 'POST',
    pattern: '/api/ops/imports',
    audience: OPERATOR,
    session: true,
    body: 'csv',
    handler: async (context) => {
      const report = await importSupplierFile(context.text);
      return {
        status: 200,
        json: {
          created: report.created,
          updated: report.updated,
          unchanged: report.unchanged,
          unmatched: report.unmatched,
        },
      };
    },
  },
];

export const apiRoutes: readonly Route[] = [...publicRoutes, ...operatorRoutes];
