import { createHash } from "node:crypto";
import {
  accountBalance, accountPayments, createInvoice, ensureAccount, readInvoiceById, recordExternalPayment,
  refundWholePayment, successfulTransaction, voidInvoice, type InvoiceReadBack,
} from "./billing";
import { carriageQuote } from "./carrier";
import {
  activeShareToken, billingAccountOf, currentQuote, findClaim, holidaySet, isClubMember, issueShareToken, liveOf, opsView, partOf,
  quotesOf, recordState, requireSameReference, withdrawShareTokens, type ClaimRow, type PartRow,
} from "./claims";
import { importSupplierFile, listEditions, readEdition } from "./catalogue";
import { iso, now } from "./clock";
import { config } from "./config";
import { headerText, json, type Context, type Reply, type Route } from "./context";
import { database, one, rows, transaction, type Db } from "./db";
import { renderDispatchNote } from "./dispatch-note";
import { fail, failFields, unknownClaim, unknownPartOrModel } from "./errors";
import { deleteMessages, messagesTo } from "./mailer";
import { closedNotice, declinedNotice, deliverClaimNotices, dispatchedNotice, enqueueNotice, newLinkNotice, quotedNotice } from "./notices";
import { asText, integerIn, isObject } from "./parse";
import {
  BOOKLET_RANGE, QUANTITY_RANGE, applyAction, decidingEdition, dispatchPromise, idempotencyKeyProblem, makeRuling, partLineMinor, postcodeArea,
} from "./rules";
import { clearedSessionCookie, closeSession, openSession, sessionCookie, sessionToken } from "./session";
import { deleteObject, dispatchNoteKey, getObject, listObjects, photoKey, putObject } from "./storage";
import type { DeclineReason } from "../shared/types";

// ---- sign-in ---------------------------------------------------------------------------------

async function signIn(ctx: Context): Promise<Reply> {
  const body = isObject(ctx.json) ? ctx.json : {};
  const email = asText(body["email"]) ?? "";
  const password = asText(body["password"]) ?? "";
  const fields: Record<string, string> = {};
  if (email === "") fields["email"] = "required";
  if (password === "") fields["password"] = "required";
  if (Object.keys(fields).length > 0) return failFields(fields);
  const token = await openSession(await database(), email, password);
  return { status: 204, headers: { "set-cookie": sessionCookie(token) } };
}

async function signOut(ctx: Context): Promise<Reply> {
  const token = sessionToken(ctx);
  if (token) await closeSession(await database(), token);
  return { status: 204, headers: { "set-cookie": clearedSessionCookie() } };
}

// ---- reading ---------------------------------------------------------------------------------

async function listClaims(ctx: Context): Promise<Reply> {
  const found = await rows<{ reference: string; state: string; model: string | null; confirmed_at: Date | null }>(
    await database(),
    `SELECT reference, state, model_slug AS model, confirmed_at FROM claims WHERE ($1::text IS NULL OR state = $1)
     ORDER BY confirmed_at DESC NULLS LAST, started_at DESC NULLS LAST, reference`,
    [ctx.query.get("state")],
  );
  return json(200, { claims: found.map((row) => ({ ...row, confirmed_at: row.confirmed_at ? iso(row.confirmed_at) : null })) });
}

async function viewClaim(ctx: Context): Promise<Reply> {
  const db = await database();
  return json(200, await opsView(db, await findClaim(db, ctx.params["reference"], "operator")));
}

async function claimPhoto(ctx: Context): Promise<Reply> {
  const db = await database();
  const claim = await findClaim(db, ctx.params["reference"], "operator");
  const index = /^\d+$/.test(ctx.params["index"] ?? "") ? Number(ctx.params["index"]) : 0;
  const photo = await one<{ content_type: string }>(db, "SELECT content_type FROM claim_photos WHERE claim_reference = $1 AND idx = $2", [claim.reference, index]);
  if (!photo) return unknownClaim();
  const stored = await getObject(photoKey(claim.reference, index));
  if (!stored) return unknownClaim();
  return { status: 200, raw: stored.body, contentType: photo.content_type, headers: { "x-content-type-options": "nosniff" } };
}

async function dispatchNote(ctx: Context): Promise<Reply> {
  const claim = await findClaim(await database(), ctx.params["reference"], "operator");
  const stored = await getObject(dispatchNoteKey(claim.reference));
  if (!stored) return unknownClaim();
  return { status: 200, raw: stored.body, contentType: "text/html; charset=utf-8" };
}

async function stats(): Promise<Reply> {
  const counts = await one<{ decided: number; inside: number; outside: number }>(await database(), "SELECT decided, inside, outside FROM decided_counts WHERE id = 1");
  return json(200, { decided_claims: counts?.decided ?? 0, decided_inside: counts?.inside ?? 0, decided_outside: counts?.outside ?? 0 });
}

// ---- acting on a claim -------------------------------------------------------------------------

const bodyOf = (ctx: Context): Record<string, unknown> => (isObject(ctx.json) ? ctx.json : {});

/** Runs one claim action under the claim's row lock, so two moves that arrive together are serialised. */
async function onClaim(ctx: Context, work: (db: Db, claim: ClaimRow, at: Date) => Promise<Reply>): Promise<Reply> {
  return transaction(async (db) => {
    const claim = await findClaim(db, ctx.params["reference"], "operator", { lock: true });
    requireSameReference(ctx.json, claim);
    return work(db, claim, now());
  });
}

/** Ends an action: sends the claim's queued notices, reads the claim back and answers 200 with its view. */
async function answer(db: Db, reference: string): Promise<Reply> {
  await deliverClaimNotices(db, reference);
  return json(200, await opsView(db, await findClaim(db, reference, "operator")));
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.keys(value).filter((key) => key !== "reference").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

interface Keyed {
  key: string | undefined;
  fingerprint: string;
  replay: Reply | null;
}

/** One key means one action with one body on one claim: a repeat answers with the stored response. */
async function startKeyed(db: Db, ctx: Context, claim: ClaimRow, action: string): Promise<Keyed> {
  const key = headerText(ctx.headers["idempotency-key"]);
  const fingerprint = createHash("sha256").update(`${action}\n${canonical(ctx.json)}`).digest("hex");
  if (idempotencyKeyProblem(key) === null) {
    const stored = await one<{ action: string; fingerprint: string; response: unknown }>(
      db, "SELECT action, fingerprint, response FROM idempotency_records WHERE claim_reference = $1 AND key = $2", [claim.reference, key],
    );
    if (stored) {
      if (stored.action !== action || stored.fingerprint !== fingerprint) return fail("idempotency_conflict");
      return { key, fingerprint, replay: json(200, stored.response) };
    }
  }
  return { key, fingerprint, replay: null };
}

/** The idempotency key's field error, if any: reported with the action's other field errors at once. */
const keyFields = (keyed: Keyed): Record<string, string> => {
  const problem = idempotencyKeyProblem(keyed.key);
  return problem ? { idempotency_key: problem } : {};
};

async function finishKeyed(db: Db, claim: ClaimRow, keyed: Keyed, action: string, reply: Reply, at: Date): Promise<Reply> {
  await rows(db, "INSERT INTO idempotency_records (claim_reference, key, action, fingerprint, response, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
    claim.reference, keyed.key, action, keyed.fingerprint, JSON.stringify(reply.json), at,
  ]);
  return reply;
}

// ---- identify --------------------------------------------------------------------------------

async function identify(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, claim, at) => {
    const body = bodyOf(ctx);
    const modelSlug = asText(body["model"]) ?? "";
    const booklet = integerIn(body["booklet_number"], ...BOOKLET_RANGE);
    const quantity = integerIn(body["quantity"], ...QUANTITY_RANGE);
    const part = modelSlug !== "" && typeof booklet === "number" ? ((await partOf(db, modelSlug, booklet)) ?? unknownPartOrModel()) : null;
    const next = applyAction("identify", claim.state);
    if (part?.status === "withdrawn") return fail("part_withdrawn", { number: part.booklet_number });
    const fields: Record<string, string> = {};
    if (modelSlug === "") fields["model"] = "required";
    if (typeof booklet === "string") fields["booklet_number"] = booklet;
    if (typeof quantity === "string") fields["quantity"] = quantity;
    if (Object.keys(fields).length > 0 || !part || typeof quantity !== "number") return failFields(fields);

    const owner = liveOf(claim);
    const confirmedAt = claim.confirmed_at as Date;
    const ruling = makeRuling({
      purchaseDate: owner.purchase_date,
      startedAt: owner.started_at,
      confirmedAt,
      clubMember: await isClubMember(db, owner.email, owner.purchase_date),
      edition: decidingEdition(await listEditions(db), confirmedAt),
      termSecondsOverride: config.desk.termSecondsOverride,
    });
    await rows(
      db,
      `UPDATE claims SET model_slug = $2, booklet_number = $3, quantity = $4, ruling_inside = $5, ruling_edition = $6,
         ruling_cover_ends_at = $7, ruling_cover_ends_on = $8, ruling_term_months = $9, ruling_decided_at = $10 WHERE reference = $1`,
      [claim.reference, modelSlug, part.booklet_number, quantity, ruling.inside, ruling.edition, ruling.coverEndsAt, ruling.coverEndsOn, ruling.termMonths, at],
    );
    await recordState(db, claim, next, at);
    await rows(db, "UPDATE decided_counts SET decided = decided + 1, inside = inside + $1, outside = outside + $2 WHERE id = 1", [ruling.inside ? 1 : 0, ruling.inside ? 0 : 1]);
    return answer(db, claim.reference);
  });
}

// ---- quote -----------------------------------------------------------------------------------

const lockPart = (db: Db, claim: LiveClaim): Promise<PartRow | null> =>
  one<PartRow>(db, "SELECT * FROM parts WHERE model_slug = $1 AND booklet_number = $2 FOR UPDATE", [claim.model_slug, claim.booklet_number]);

type LiveClaim = ReturnType<typeof liveOf>;

/** Billing's own figures for an invoice: the two charge items and the invoice amount. */
function figuresFromInvoice(invoice: InvoiceReadBack): { partLineMinor: number; carriageMinor: number; totalMinor: number } {
  const part = invoice.items.find((item) => item.description.startsWith("Part "));
  const carriage = invoice.items.find((item) => item.description.startsWith("Carriage band "));
  if (!part || !carriage) return fail("billing_unavailable");
  return { partLineMinor: part.amountMinor, carriageMinor: carriage.amountMinor, totalMinor: invoice.amountMinor };
}

/** Returns a bin revision's units to the bin, once. */
async function returnToBin(db: Db, claim: LiveClaim, revision: { revision: number; quantity: number; source: string; bin_returned: boolean }): Promise<void> {
  if (revision.source !== "bin" || revision.bin_returned) return;
  await rows(db, "UPDATE parts SET bin_count = bin_count + $3 WHERE model_slug = $1 AND booklet_number = $2", [claim.model_slug, claim.booklet_number, revision.quantity]);
  await rows(db, "UPDATE quote_revisions SET bin_returned = true WHERE claim_reference = $1 AND revision = $2", [claim.reference, revision.revision]);
}

async function quote(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, row, at) => {
    const keyed = await startKeyed(db, ctx, row, "quote");
    if (keyed.replay) return keyed.replay;
    const next = applyAction("quote", row.state, row.paid_minor !== null);
    const claim = liveOf(row);
    const part = (await lockPart(db, claim)) as PartRow;
    if (part.status === "withdrawn") return fail("part_withdrawn", { number: part.booklet_number });
    if (Object.keys(keyFields(keyed)).length > 0) return failFields(keyFields(keyed));

    const estimate = await carriageQuote({
      weightG: part.weight_g * claim.quantity,
      longestSideMm: part.longest_side_mm,
      postcodeArea: postcodeArea(claim.postcode) as string,
    });
    const accountId = claim.billing_account ?? (await ensureAccount(claim.reference));

    const previous = (await quotesOf(db, claim.reference)).find((revision) => revision.status === "current");
    const binAfterReturn = part.bin_count + (previous && previous.source === "bin" && !previous.bin_returned ? previous.quantity : 0);
    const source = binAfterReturn >= claim.quantity ? "bin" : "supplier";

    const edition = await one<{ owner_contribution_percent: number }>(db, "SELECT owner_contribution_percent FROM editions WHERE code = $1", [claim.ruling_edition]);
    const percent = claim.ruling_inside ? (edition as { owner_contribution_percent: number }).owner_contribution_percent : 100;
    const invoice = await createInvoice(accountId, {
      partDescription: `Part ${part.part_number} × ${claim.quantity}`,
      partMinor: partLineMinor(part.price_minor, claim.quantity, percent),
      carriageDescription: `Carriage band ${estimate.band}`,
      carriageMinor: estimate.charge_minor,
    });
    const billed = figuresFromInvoice(invoice);

    if (previous) {
      try {
        await voidInvoice(previous.billing_invoice);
      } catch (error) {
        await voidInvoice(invoice.invoiceId).catch(() => undefined);
        throw error;
      }
      await rows(db, "UPDATE quote_revisions SET status = 'void' WHERE claim_reference = $1 AND revision = $2", [claim.reference, previous.revision]);
      await returnToBin(db, claim, previous);
    }
    if (source === "bin") await rows(db, "UPDATE parts SET bin_count = bin_count - $3 WHERE model_slug = $1 AND booklet_number = $2", [claim.model_slug, claim.booklet_number, claim.quantity]);

    const promise = dispatchPromise({ quotedAt: at, source, cutoffLocal: config.desk.dispatchCutoffLocal, holidays: await holidaySet(db) });
    const revision = (previous?.revision ?? 0) + 1;
    await rows(
      db,
      `INSERT INTO quote_revisions (claim_reference, revision, status, source, quantity, part_line_minor, carriage_minor, total_minor, band,
         carriage_valid_until, promise_kind, promise_date, quoted_at, billing_invoice) VALUES ($1,$2,'current',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [claim.reference, revision, source, claim.quantity, billed.partLineMinor, billed.carriageMinor, billed.totalMinor, estimate.band, estimate.valid_until, promise.kind, promise.date, at, invoice.invoiceId],
    );
    await rows(db, "UPDATE claims SET billing_account = $2 WHERE reference = $1", [claim.reference, accountId]);
    if (next !== claim.state) await recordState(db, claim, next, at);
    const token = (await activeShareToken(db, claim.reference)) ?? "";
    await enqueueNotice(db, claim, quotedNotice(claim.reference, claim.language, await currentQuote(db, claim.reference), token));
    return finishKeyed(db, claim, keyed, "quote", await answer(db, claim.reference), at);
  });
}

// ---- payment ---------------------------------------------------------------------------------

async function payment(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, claim, at) => {
    const keyed = await startKeyed(db, ctx, claim, "payment");
    if (keyed.replay) return keyed.replay;
    applyAction("payment", claim.state, claim.paid_minor !== null);
    if (Object.keys(keyFields(keyed)).length > 0) return failFields(keyFields(keyed));
    const current = await currentQuote(db, claim.reference);
    const invoice = await readInvoiceById(current.billing_invoice);
    const paid = await recordExternalPayment(billingAccountOf(claim), current.billing_invoice, invoice.balanceMinor);
    await rows(db, "UPDATE claims SET paid_minor = $2, paid_at = $3 WHERE reference = $1", [claim.reference, paid, at]);
    return finishKeyed(db, claim, keyed, "payment", await answer(db, claim.reference), at);
  });
}

// ---- decline ---------------------------------------------------------------------------------

const REASONS: readonly DeclineReason[] = ["owner_declined", "cannot_send"];

async function decline(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, row, at) => {
    const keyed = await startKeyed(db, ctx, row, "decline");
    if (keyed.replay) return keyed.replay;
    const next = applyAction("decline", row.state);
    const fields = keyFields(keyed);
    const reason = bodyOf(ctx)["reason"];
    if (reason === undefined || reason === "") fields["reason"] = "required";
    else if (!REASONS.includes(reason as DeclineReason)) fields["reason"] = "invalid";
    if (Object.keys(fields).length > 0) return failFields(fields);

    const claim = liveOf(row);
    const current = await currentQuote(db, claim.reference);
    const accountId = billingAccountOf(claim);
    let refunded = 0;
    if (claim.paid_minor !== null) {
      const purchase = successfulTransaction(await accountPayments(accountId), "PURCHASE");
      refunded = await refundWholePayment(accountId, purchase.paymentId, purchase.transaction.amountMinor);
    } else {
      await voidInvoice(current.billing_invoice);
    }
    const charged = await accountBalance(accountId);
    await lockPart(db, claim);
    await returnToBin(db, claim, current);
    await rows(db, "UPDATE claims SET decline_reason = $2, decline_charged_minor = $3, decline_refunded_minor = $4 WHERE reference = $1", [claim.reference, reason, charged, refunded]);
    await recordState(db, claim, next, at);
    const token = (await activeShareToken(db, claim.reference)) ?? "";
    await enqueueNotice(db, claim, declinedNotice(claim.reference, claim.language, refunded, token));
    return finishKeyed(db, claim, keyed, "decline", await answer(db, claim.reference), at);
  });
}

// ---- dispatch --------------------------------------------------------------------------------

async function dispatch(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, row, at) => {
    const keyed = await startKeyed(db, ctx, row, "dispatch");
    if (keyed.replay) return keyed.replay;
    const next = applyAction("dispatch", row.state, row.paid_minor !== null);
    if (Object.keys(keyFields(keyed)).length > 0) return failFields(keyFields(keyed));

    const claim = liveOf(row);
    const current = await currentQuote(db, claim.reference);
    const billed = figuresFromInvoice(await readInvoiceById(current.billing_invoice));
    const paid = successfulTransaction(await accountPayments(billingAccountOf(claim)), "PURCHASE").transaction.amountMinor;
    const part = (await partOf(db, claim.model_slug, claim.booklet_number)) as PartRow;
    const note = renderDispatchNote({
      reference: claim.reference,
      bookletNumber: part.booklet_number,
      partName: part.name,
      partNumber: part.part_number,
      quantity: current.quantity,
      partLineMinor: billed.partLineMinor,
      carriageBand: current.band,
      carriageMinor: billed.carriageMinor,
      totalMinor: billed.totalMinor,
      paidMinor: paid,
    });
    await putObject(dispatchNoteKey(claim.reference), note, "text/html; charset=utf-8");
    try {
      await rows(db, "UPDATE claims SET dispatched_at = $2 WHERE reference = $1", [claim.reference, at]);
      await recordState(db, claim, next, at);
      const token = (await activeShareToken(db, claim.reference)) ?? "";
      await enqueueNotice(db, claim, dispatchedNotice(claim.reference, claim.language, paid, token));
      return await finishKeyed(db, claim, keyed, "dispatch", await answer(db, claim.reference), at);
    } catch (error) {
      await deleteObject(dispatchNoteKey(claim.reference)).catch(() => undefined);
      throw error;
    }
  });
}

// ---- close, share link -----------------------------------------------------------------------

async function closeClaim(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, row, at) => {
    const next = applyAction("close", row.state);
    const claim = liveOf(row);
    await rows(db, "UPDATE claims SET closed_at = $2 WHERE reference = $1", [claim.reference, at]);
    await recordState(db, claim, next, at);
    await enqueueNotice(db, claim, closedNotice(claim.reference, claim.language));
    return answer(db, claim.reference);
  });
}

async function withdrawLink(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, claim) => {
    applyAction("share_link", claim.state);
    await withdrawShareTokens(db, claim.reference);
    return { status: 204 };
  });
}

async function newLink(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, row, at) => {
    applyAction("share_link", row.state);
    const claim = liveOf(row);
    await withdrawShareTokens(db, claim.reference);
    const token = await issueShareToken(db, claim.reference, at);
    await enqueueNotice(db, claim, newLinkNotice(claim.reference, claim.language, token));
    return { ...(await answer(db, claim.reference)), status: 201 };
  });
}

// ---- erase -----------------------------------------------------------------------------------

const CLAIM_CHILD_TABLES = ["claim_history", "claim_photos", "quote_revisions", "share_tokens", "idempotency_records", "notice_queue"] as const;

async function erase(ctx: Context): Promise<Reply> {
  return onClaim(ctx, async (db, row, at) => {
    applyAction("erase", row.state);
    const typed = bodyOf(ctx)["confirm_reference"];
    if (typed === undefined || typed === "") return failFields({ confirm_reference: "required" });
    if (typed !== row.reference) return failFields({ confirm_reference: "mismatch" });

    const { email } = liveOf(row);
    const owned = await rows<{ reference: string }>(db, "SELECT reference FROM claims WHERE lower(email) = lower($1) AND state <> 'erased' ORDER BY reference FOR UPDATE", [email]);
    const references = owned.map((claim) => claim.reference);
    const objects = (await Promise.all(references.map((reference) => listObjects(`claims/${reference}/`)))).flat();
    const messages = await messagesTo(email);

    for (const table of CLAIM_CHILD_TABLES) await rows(db, `DELETE FROM ${table} WHERE claim_reference = ANY($1)`, [references]);
    await rows(db, "DELETE FROM reference_attempts WHERE reference = ANY($1)", [references]);
    await rows(
      db,
      `UPDATE claims SET state = 'erased', erased_at = $2, language = NULL, name = NULL, email = NULL, postcode = NULL, purchase_date = NULL,
         model_slug = NULL, booklet_number = NULL, quantity = NULL, description = NULL, started_at = NULL, confirm_by = NULL, confirm_token = NULL,
         confirmed_at = NULL, ruling_inside = NULL, ruling_edition = NULL, ruling_cover_ends_at = NULL, ruling_cover_ends_on = NULL,
         ruling_term_months = NULL, ruling_decided_at = NULL, paid_minor = NULL, paid_at = NULL, decline_reason = NULL,
         decline_charged_minor = NULL, decline_refunded_minor = NULL, dispatched_at = NULL, closed_at = NULL, billing_account = NULL
       WHERE reference = ANY($1)`,
      [references, at],
    );
    await rows(db, "DELETE FROM club_roster WHERE lower(email) = lower($1)", [email]);
    for (const key of objects) await deleteObject(key);
    await deleteMessages(messages);
    return json(200, { erased: references });
  });
}

// ---- weekly upkeep ---------------------------------------------------------------------------

async function editions(): Promise<Reply> {
  return json(200, { editions: await listEditions(await database()) });
}

async function saveEdition(ctx: Context): Promise<Reply> {
  const edition = readEdition(ctx.json);
  return transaction(async (db) => {
    const clash = await one<{ code: string }>(db, "SELECT code FROM editions WHERE code = $1 OR starts_on = $2", [edition.code, edition.starts_on]);
    if (clash?.code === edition.code) return fail("edition_code_taken");
    if (clash) return fail("edition_date_taken");
    await rows(db, "INSERT INTO editions (code, title, starts_on, standard_months, club_months, owner_contribution_percent) VALUES ($1,$2,$3,$4,$5,$6)", [
      edition.code, edition.title, edition.starts_on, edition.standard_months, edition.club_months, edition.owner_contribution_percent,
    ]);
    return json(201, edition);
  });
}

async function importFile(ctx: Context): Promise<Reply> {
  const report = await transaction((db) => importSupplierFile(db, ctx.body.toString("utf8")));
  return report ? json(200, report) : failFields({ file: "bad_header" });
}

export const opsRoutes: Route[] = [
  { method: "POST", template: "/api/ops/session", body: "json", auth: "sign-in", handler: signIn },
  { method: "DELETE", template: "/api/ops/session", body: "none", auth: "operator", handler: signOut },
  { method: "GET", template: "/api/ops/claims", body: "none", auth: "operator", handler: listClaims },
  { method: "GET", template: "/api/ops/stats", body: "none", auth: "operator", handler: stats },
  { method: "GET", template: "/api/ops/editions", body: "none", auth: "operator", handler: editions },
  { method: "POST", template: "/api/ops/editions", body: "json", auth: "operator", handler: saveEdition },
  { method: "POST", template: "/api/ops/imports", body: "csv", auth: "operator", handler: importFile },
  { method: "GET", template: "/api/ops/claims/:reference", body: "none", auth: "operator", handler: viewClaim },
  { method: "GET", template: "/api/ops/claims/:reference/photos/:index", body: "none", auth: "operator", handler: claimPhoto },
  { method: "GET", template: "/api/ops/claims/:reference/dispatch-note", body: "none", auth: "operator", handler: dispatchNote },
  { method: "POST", template: "/api/ops/claims/:reference/identify", body: "json", auth: "operator", handler: identify },
  { method: "POST", template: "/api/ops/claims/:reference/quote", body: "json", auth: "operator", handler: quote },
  { method: "POST", template: "/api/ops/claims/:reference/payment", body: "json", auth: "operator", handler: payment },
  { method: "POST", template: "/api/ops/claims/:reference/decline", body: "json", auth: "operator", handler: decline },
  { method: "POST", template: "/api/ops/claims/:reference/dispatch", body: "json", auth: "operator", handler: dispatch },
  { method: "POST", template: "/api/ops/claims/:reference/close", body: "json", auth: "operator", handler: closeClaim },
  { method: "DELETE", template: "/api/ops/claims/:reference/share-link", body: "none", auth: "operator", handler: withdrawLink },
  { method: "POST", template: "/api/ops/claims/:reference/share-link", body: "json", auth: "operator", handler: newLink },
  { method: "POST", template: "/api/ops/claims/:reference/erase", body: "json", auth: "operator", handler: erase },
];
