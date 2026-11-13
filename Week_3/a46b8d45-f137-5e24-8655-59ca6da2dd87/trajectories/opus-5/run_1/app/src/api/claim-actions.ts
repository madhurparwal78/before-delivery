/**
 * The claim moves. Each one asks the state machine first, then talks to the services it
 * needs, and writes its records, its bin change and its notice together: either all of them
 * are kept or none is.
 */

import * as billing from '../services/billing';
import * as catalogue from '../db/catalogue';
import * as claims from '../db/claims';
import * as storage from '../services/storage';
import { apiError, partNotFound, partWithdrawn, unknownReference, wrongState, type Audience } from '../http/errors';
import { askCarrier, postcodeArea } from '../services/carrier';
import { bankHolidaysIn, listEditionsIn } from '../db/catalogue';
import { deleteMessagesTo, requireMail } from '../services/mailpit';
import { decidingEdition } from '../domain/editions';
import { dispatchPromise, type QuoteSource } from '../domain/dispatch-promise';
import { newToken } from '../domain/references';
import { now } from '../domain/time';
import { queueNotice } from '../services/notices';
import { quoteFigures } from '../domain/quote-figures';
import { refuseAction, stateAfter, type ClaimAction, type ClaimStanding } from '../domain/state';
import { renderDispatchNote } from '../services/dispatch-note';
import { ruleClaim } from '../domain/ruling';
import { withTransaction, type Transaction } from '../db/pool';
import type { ClaimRow, DeclineReason } from '../db/claims';
import type { ClaimState } from '../shared/claim-state';
import type { Language } from '../shared/format';

const OPERATOR: Audience = 'operator';

/** Every operator claim action begins the same way: lock the claim, then ask the state machine. */
async function standingOf(tx: Transaction, claim: ClaimRow): Promise<ClaimStanding> {
  const payment = await claims.paymentFor(tx, claim.reference);
  return { state: claim.state, paid: payment !== null };
}

async function requireAction(tx: Transaction, claim: ClaimRow, action: ClaimAction): Promise<void> {
  const refusal = refuseAction(action, await standingOf(tx, claim));
  if (refusal === null) return;
  if (refusal === 'wrong_state') throw wrongState(OPERATOR, claim.state);
  throw apiError(OPERATOR, 409, refusal);
}

async function activeShareToken(tx: Transaction, reference: string): Promise<string | null> {
  const row = await tx.queryOne<{ token: string }>(
    `SELECT token FROM share_links WHERE reference = $1 AND state = 'active' ORDER BY created_at DESC LIMIT 1`,
    [reference],
  );
  return row?.token ?? null;
}

function languageOf(claim: ClaimRow): Language {
  return claim.language ?? 'en-GB';
}

/* ------------------------------------------------------------------------------ identify */

export interface IdentifyInput {
  modelSlug: string;
  bookletNumber: number;
  quantity: number;
}

/** Identify never calls Kill Bill, so it works while Kill Bill is down. */
export async function identifyPart(reference: string, input: IdentifyInput): Promise<void> {
  await withTransaction(async (tx) => {
    const claim = await claims.lockClaimRow(tx, reference);
    if (claim === null) throw unknownReference(OPERATOR);
    await requireAction(tx, claim, 'identify');

    const part = await catalogue.findPartIn(tx, input.modelSlug, input.bookletNumber);
    if (part === null) throw partNotFound();
    if (part.status === 'withdrawn') throw partWithdrawn(OPERATOR, input.bookletNumber);

    const identified = stateAfter('identify', { state: claim.state, paid: false }) as ClaimState;
    const confirmedAt = claim.confirmed_at;
    const startedAt = claim.started_at;
    const purchaseDate = claim.purchase_date;
    if (confirmedAt === null || startedAt === null || purchaseDate === null) {
      throw wrongState(OPERATOR, claim.state);
    }

    // The one edition in force at the confirmation instant rules the claim.
    const edition = decidingEdition(await listEditionsIn(tx), confirmedAt);
    if (edition === null) throw wrongState(OPERATOR, claim.state);

    const ruling = ruleClaim({
      purchaseDate,
      clubMember: claim.club_member ?? false,
      edition,
      startedAt,
      confirmedAt,
    });

    const decidedAt = now();
    await claims.setIdentifiedPart(tx, reference, input.modelSlug, input.bookletNumber, input.quantity);
    await claims.setClaimState(tx, reference, identified);
    await claims.insertRuling(tx, reference, ruling, decidedAt);
    await claims.recordHistory(tx, reference, 'identified', decidedAt);
    await catalogue.countDecision(tx, ruling.inside);
  });
}

/* --------------------------------------------------------------------------------- quote */

/** Decided at quote time: the bin covers the quantity, or the parts are supplier-ordered. */
async function takeStock(
  tx: Transaction,
  modelSlug: string,
  bookletNumber: number,
  quantity: number,
): Promise<QuoteSource> {
  const taken = await catalogue.takeFromBin(tx, modelSlug, bookletNumber, quantity);
  return taken ? 'bin' : 'supplier';
}

/** Voiding a bin revision puts that revision's quantity back, at most once. */
async function returnStockFor(
  tx: Transaction,
  reference: string,
  revision: claims.QuoteRow,
  modelSlug: string,
  bookletNumber: number,
): Promise<void> {
  if (revision.source !== 'bin') return;
  if (!(await claims.claimStockReturn(tx, reference, revision.revision))) return;
  await catalogue.returnToBin(tx, modelSlug, bookletNumber, revision.stock_quantity);
}

export async function quoteClaim(reference: string): Promise<void> {
  await withTransaction(async (tx) => {
    const claim = await claims.lockClaimRow(tx, reference);
    if (claim === null) throw unknownReference(OPERATOR);
    await requireAction(tx, claim, 'quote');

    const modelSlug = claim.model_slug;
    const bookletNumber = claim.booklet_number;
    const quantity = claim.quantity;
    if (modelSlug === null || bookletNumber === null || quantity === null) throw wrongState(OPERATOR, claim.state);

    const part = await catalogue.findPartIn(tx, modelSlug, bookletNumber);
    if (part === null) throw partNotFound();
    // A withdrawn part is refused before any carrier or billing call.
    if (part.status === 'withdrawn') throw partWithdrawn(OPERATOR, bookletNumber);

    const ruling = await tx.queryOne<claims.RulingRow>(
      `SELECT inside, edition_code, cover_ends_at, cover_ends_on, term_months, decided_at
         FROM claim_rulings WHERE reference = $1`,
      [reference],
    );
    if (ruling === null) throw wrongState(OPERATOR, claim.state);

    const editions = await listEditionsIn(tx);
    const edition = editions.find((candidate) => candidate.code === ruling.edition_code);
    if (edition === undefined) throw wrongState(OPERATOR, claim.state);

    const quotedAt = now();
    const carriage = await askCarrier(
      {
        weightG: part.weightG * quantity,
        longestSideMm: part.longestSideMm,
        postcodeArea: postcodeArea(claim.owner_postcode ?? ''),
      },
      quotedAt,
    );

    const figures = quoteFigures({
      unitPriceMinor: part.priceMinor,
      quantity,
      ownerContributionPercent: edition.ownerContributionPercent,
      inside: ruling.inside,
      carriageMinor: carriage.chargeMinor,
    });

    const existing = await claims.lockQuotes(tx, reference);
    const current = existing.find((quote) => quote.status === 'current') ?? null;
    const accountId = await billing.accountForClaim(reference);

    // A re-quote voids the previous revision's invoice first and gives its units back.
    if (current !== null) {
      await billing.voidInvoice(current.invoice_id);
      await claims.markQuoteVoid(tx, reference, current.revision);
      await returnStockFor(tx, reference, current, modelSlug, bookletNumber);
    }

    const source = await takeStock(tx, modelSlug, bookletNumber, quantity);
    const invoiceId = await billing.chargeInvoice(accountId, [
      { description: `Part ${part.partNumber} × ${quantity}`, amountMinor: figures.partLineMinor },
      { description: `Carriage band ${carriage.band}`, amountMinor: figures.carriageMinor },
    ]);

    // Only what Kill Bill returns for that invoice is recorded, shown and emailed.
    const invoice = await billing.readInvoice(invoiceId);
    const partLineMinor = invoice.lines[0]?.amountMinor ?? figures.partLineMinor;
    const carriageMinor = invoice.lines[1]?.amountMinor ?? figures.carriageMinor;

    const revision = (existing[0]?.revision ?? 0) + 1;
    const promise = dispatchPromise(quotedAt, source, await bankHolidaysIn(tx));

    await claims.insertQuote(tx, {
      reference,
      revision,
      source,
      partLineMinor,
      carriageMinor,
      totalMinor: invoice.amountMinor,
      band: carriage.band,
      carriageValidUntil: carriage.validUntil,
      promiseKind: promise.kind,
      promiseDate: promise.date,
      quotedAt,
      invoiceId,
      stockQuantity: source === 'bin' ? quantity : 0,
    });

    const quotedState = stateAfter('quote', { state: claim.state, paid: false }) as ClaimState;
    if (claim.state !== quotedState) {
      await claims.setClaimState(tx, reference, quotedState);
      await claims.recordHistory(tx, reference, quotedState, quotedAt);
    }

    await queueNotice(tx, {
      reference,
      kind: 'quoted',
      language: languageOf(claim),
      recipient: claim.owner_email ?? '',
      figures: {
        partLineMinor,
        carriageMinor,
        totalMinor: invoice.amountMinor,
        band: carriage.band,
        promiseKind: promise.kind,
        promiseDate: promise.date,
        shareToken: (await activeShareToken(tx, reference)) ?? undefined,
      },
    });
  });
}

/* ------------------------------------------------------------------------------- payment */

export async function recordPayment(reference: string): Promise<void> {
  await withTransaction(async (tx) => {
    const claim = await claims.lockClaimRow(tx, reference);
    if (claim === null) throw unknownReference(OPERATOR);
    await requireAction(tx, claim, 'payment');

    const quotes = await claims.lockQuotes(tx, reference);
    const current = quotes.find((quote) => quote.status === 'current');
    if (current === undefined) throw wrongState(OPERATOR, claim.state);

    const accountId = await billing.accountForClaim(reference);
    const invoice = await billing.readInvoice(current.invoice_id);
    const paymentId = await billing.payInvoice(accountId, current.invoice_id, invoice.balanceMinor);
    // The paid figure is the amount of the successful PURCHASE transaction Kill Bill returns.
    const paidMinor = billing.successfulAmountMinor(await billing.readPayment(paymentId), 'PURCHASE');

    await claims.insertPayment(tx, reference, paidMinor, now(), paymentId);
  });
}

/* ------------------------------------------------------------------------------- decline */

export async function declineClaim(reference: string, reason: DeclineReason): Promise<void> {
  await withTransaction(async (tx) => {
    const claim = await claims.lockClaimRow(tx, reference);
    if (claim === null) throw unknownReference(OPERATOR);
    await requireAction(tx, claim, 'decline');

    const quotes = await claims.lockQuotes(tx, reference);
    const current = quotes.find((quote) => quote.status === 'current');
    if (current === undefined) throw wrongState(OPERATOR, claim.state);

    const payment = await claims.paymentFor(tx, reference);
    const accountId = await billing.accountForClaim(reference);

    let refundedMinor = 0;
    if (payment === null) {
      // Nothing charged: the current invoice is voided and the balance returns to 0.
      await billing.voidInvoice(current.invoice_id);
    } else {
      const purchaseMinor = billing.successfulAmountMinor(await billing.readPayment(payment.payment_id), 'PURCHASE');
      await billing.refundPayment(payment.payment_id, purchaseMinor);
      refundedMinor = billing.successfulAmountMinor(await billing.readPayment(payment.payment_id), 'REFUND');
    }
    const chargedMinor = await billing.accountBalanceMinor(accountId);

    const declinedAt = now();
    if (claim.model_slug !== null && claim.booklet_number !== null) {
      await returnStockFor(tx, reference, current, claim.model_slug, claim.booklet_number);
    }
    const declinedState = stateAfter('decline', { state: claim.state, paid: payment !== null }) as ClaimState;
    await claims.insertDecline(tx, reference, reason, chargedMinor, refundedMinor, declinedAt);
    await claims.setClaimState(tx, reference, declinedState);
    await claims.recordHistory(tx, reference, declinedState, declinedAt);

    await queueNotice(tx, {
      reference,
      kind: 'declined',
      language: languageOf(claim),
      recipient: claim.owner_email ?? '',
      figures: {
        refundedMinor,
        shareToken: (await activeShareToken(tx, reference)) ?? undefined,
      },
    });
  });
}

/* ------------------------------------------------------------------------------ dispatch */

export async function dispatchClaim(reference: string): Promise<void> {
  await withTransaction(async (tx) => {
    const claim = await claims.lockClaimRow(tx, reference);
    if (claim === null) throw unknownReference(OPERATOR);
    await requireAction(tx, claim, 'dispatch');

    const quotes = await claims.lockQuotes(tx, reference);
    const current = quotes.find((quote) => quote.status === 'current');
    const payment = await claims.paymentFor(tx, reference);
    if (current === undefined || payment === null) throw wrongState(OPERATOR, claim.state);

    const modelSlug = claim.model_slug;
    const bookletNumber = claim.booklet_number;
    if (modelSlug === null || bookletNumber === null) throw wrongState(OPERATOR, claim.state);
    const part = await catalogue.findPartIn(tx, modelSlug, bookletNumber);
    if (part === null) throw partNotFound();

    // The note's figures are read back from Kill Bill, so they match it to the penny.
    const invoice = await billing.readInvoice(current.invoice_id);
    const paidMinor = billing.successfulAmountMinor(await billing.readPayment(payment.payment_id), 'PURCHASE');

    const note = renderDispatchNote({
      reference,
      bookletNumber,
      partName: part.name,
      partNumber: part.partNumber,
      quantity: claim.quantity ?? 0,
      band: current.band,
      partLineMinor: invoice.lines[0]?.amountMinor ?? current.part_line_minor,
      carriageMinor: invoice.lines[1]?.amountMinor ?? current.carriage_minor,
      totalMinor: invoice.amountMinor,
      paidMinor,
    });
    await storage.putObject(storage.dispatchNoteKey(reference), note, 'text/html; charset=utf-8');

    const dispatchedAt = now();
    const dispatchedState = stateAfter('dispatch', { state: claim.state, paid: true }) as ClaimState;
    await claims.setClaimState(tx, reference, dispatchedState);
    await claims.markDispatchedAt(tx, reference, dispatchedAt);
    await claims.recordHistory(tx, reference, dispatchedState, dispatchedAt);

    await queueNotice(tx, {
      reference,
      kind: 'dispatched',
      language: languageOf(claim),
      recipient: claim.owner_email ?? '',
      figures: { paidMinor, shareToken: (await activeShareToken(tx, reference)) ?? undefined },
    });
  });
}

/* --------------------------------------------------------------------------------- close */

export async function closeClaim(reference: string): Promise<void> {
  await withTransaction(async (tx) => {
    const claim = await claims.lockClaimRow(tx, reference);
    if (claim === null) throw unknownReference(OPERATOR);
    await requireAction(tx, claim, 'close');

    const closedAt = now();
    const closedState = stateAfter('close', { state: claim.state, paid: true }) as ClaimState;
    await claims.setClaimState(tx, reference, closedState);
    await claims.markClosedAt(tx, reference, closedAt);
    // The share link ends at the instant the claim closes.
    await claims.endShareLinks(tx, reference);
    await claims.recordHistory(tx, reference, closedState, closedAt);

    await queueNotice(tx, {
      reference,
      kind: 'closed',
      language: languageOf(claim),
      recipient: claim.owner_email ?? '',
      figures: {},
    });
  });
}

/* --------------------------------------------------------------------------- share links */

export async function withdrawShareLink(reference: string): Promise<void> {
  await withTransaction(async (tx) => {
    const claim = await claims.lockClaimRow(tx, reference);
    if (claim === null) throw unknownReference(OPERATOR);
    await requireAction(tx, claim, 'share_link');
    await claims.withdrawShareLinks(tx, reference);
  });
}

export async function newShareLink(reference: string): Promise<void> {
  await withTransaction(async (tx) => {
    const claim = await claims.lockClaimRow(tx, reference);
    if (claim === null) throw unknownReference(OPERATOR);
    await requireAction(tx, claim, 'share_link');

    // A new link replaces the old one, which stops working at once.
    await claims.withdrawShareLinks(tx, reference);
    const token = newToken();
    await claims.insertShareLink(tx, token, reference, now());

    await queueNotice(tx, {
      reference,
      kind: 'new_link',
      language: languageOf(claim),
      recipient: claim.owner_email ?? '',
      figures: { shareToken: token },
    });
  });
}

/* --------------------------------------------------------------------------------- erase */

export interface ErasureResult {
  erased: string[];
  email: string;
}

/**
 * Erases the owner from every claim they have, in any state. If MinIO or Mailpit cannot be
 * reached, nothing is erased, so both are asked before anything changes.
 */
export async function eraseOwner(reference: string): Promise<ErasureResult> {
  const claim = await claims.findClaimRow(reference);
  if (claim === null || claim.state === 'erased') {
    throw claim === null ? apiError(OPERATOR, 404, 'not_found') : wrongState(OPERATOR, 'erased');
  }
  const email = claim.owner_email;
  if (email === null) throw wrongState(OPERATOR, claim.state);

  await storage.ensureBucket();
  await requireMail();

  const erased = await withTransaction(async (tx) => {
    const references = await claims.referencesForOwner(tx, email);
    const at = now();
    for (const owned of references) {
      // Every photo and dispatch-note object goes, so the claim's prefix lists nothing.
      for (const key of await storage.listKeys(storage.claimPrefix(owned))) {
        await storage.deleteObject(key);
      }
      await claims.eraseClaimRows(tx, owned, at);
    }
    // A claim started later with that email is not a club member.
    await catalogue.deleteClubMember(tx, email);
    return references;
  });

  await deleteMessagesTo(email);
  return { erased, email };
}
