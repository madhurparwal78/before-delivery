// Operator endpoints. Every one needs a live session.
import { createHash } from 'node:crypto';
import type { Router, Desk } from '../server.js';
import { throwApi, newToken, verifyPassword, ApiErrorSignal } from '../server.js';
import { json, type Ctx } from '../http.js';
import { apiError, type ApiError } from '../errors.js';
import { operatorMessage } from '../errors.js';
import {
  REFERENCE_RE, EDITION_CODE_RE, ID_KEY_RE, isRealDate,
  matchModelName, buildModelIndex, makeRuling, decidingEdition, quoteFigures,
  dispatchPromise,
} from '../domain.js';
import { londonDateOf } from '../clock.js';
import { claimView } from './views.js';
import { queueNotice } from './notices.js';
import { formatMoneyEn } from '../format.js';

const CLAIM_NOT_FOUND = apiError({ status: 404, code: 'not_found', message: 'No claim with that reference.' });

function opsWrongState(state: string): ApiError {
  return apiError({
    status: 409, code: 'wrong_state',
    message: operatorMessage('wrong_state', { state: state.charAt(0).toUpperCase() + state.slice(1) }),
    state,
  });
}

function requireClaim(desk: Desk, reference: string): Promise<import('../store.js').ClaimRow> {
  if (!REFERENCE_RE.test(reference)) {
    return Promise.reject(new ApiErrorSignal(CLAIM_NOT_FOUND));
  }
  return desk.store.getClaim(reference).then((claim) => {
    if (claim === null) throw new ApiErrorSignal(CLAIM_NOT_FOUND);
    return claim;
  });
}

/** The store's snake_case edition records, as the domain's edition rows. */
function toEditionRow(record: import('../store.js').EditionRecord): import('../domain.js').EditionRow {
  return {
    code: record.code,
    title: record.title,
    startsOn: record.starts_on,
    standardMonths: record.standard_months,
    clubMonths: record.club_months,
    ownerContributionPercent: record.owner_contribution_percent,
  };
}

function idempotencyKeyError(ctx: Ctx): { key: string | null; error: ApiError | null } {
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key === '') {
    return { key: null, error: apiError({ status: 422, code: 'validation_failed', message: 'Some fields need attention.', fields: { idempotency_key: 'required' } }) };
  }
  if (!ID_KEY_RE.test(key)) {
    return { key: null, error: apiError({ status: 422, code: 'validation_failed', message: 'Some fields need attention.', fields: { idempotency_key: 'invalid' } }) };
  }
  return { key, error: null };
}

function bodyHash(ctx: Ctx): string {
  return createHash('sha256').update(ctx.rawBody).digest('hex');
}

async function storeResponse(desk: Desk, reference: string, key: string, action: string, requestHash: string, body: unknown, status = 200): Promise<void> {
  await desk.store.query(
    `INSERT INTO idempotency_records (key, reference, action, body_hash, status, response_body)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (reference, key) DO NOTHING`,
    [key, reference, action, requestHash, status, JSON.stringify(body)],
  );
}

export function registerOperatorRoutes(router: Router, desk: Desk): void {
  router.add('POST', '/api/ops/session', async (ctx) => {
    const body = ctx.body as { email?: unknown; password?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const fields: Record<string, string> = {};
    if (email === '') fields['email'] = 'required';
    if (password === '') fields['password'] = 'required';
    if (Object.keys(fields).length > 0) {
      throwApi(apiError({ status: 422, code: 'validation_failed', message: 'Some fields need attention.', fields }));
    }
    const account = await desk.store.getOperator(email);
    if (account === null || !verifyPassword(password, account.password_hash)) {
      throwApi(apiError({ status: 401, code: 'bad_credentials', message: operatorMessage('bad_credentials', {}) }));
    }
    const token = newToken();
    const expires = new Date(desk.now() + desk.config.operatorSessionSeconds * 1000);
    await desk.store.query('INSERT INTO sessions (token, created_at, expires_at) VALUES ($1, $2, $3)', [token, new Date(desk.now()), expires]);
    ctx.setCookies.push({
      name: 'ops_session', value: token, httpOnly: true, maxAge: null, path: '/', sameSite: 'Strict',
    });
    writeCookies(ctx);
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  router.add('DELETE', '/api/ops/session', async (ctx) => {
    const token = ctx.cookies['ops_session'];
    if (token) await desk.store.query('DELETE FROM sessions WHERE token = $1', [token]);
    ctx.res.writeHead(204);
    ctx.res.end();
  }, { session: true, raw: true });

  router.add('GET', '/api/ops/claims', async (ctx) => {
    const stateFilter = ctx.query.get('state');
    const res = await desk.store.query<{ reference: string; state: string; model_slug: string | null; confirmed_at: Date | null; created_at: Date }>(
      'SELECT reference, state, model_slug, confirmed_at, created_at FROM claims ORDER BY confirmed_at DESC NULLS LAST, created_at DESC', [],
    );
    const rows = res.rows.filter((r) => r.state !== 'erased' && (stateFilter === null || r.state === stateFilter));
    json(ctx.res, 200, {
      claims: rows.map((r) => ({
        reference: r.reference,
        state: r.state,
        model: r.model_slug,
        confirmed_at: r.confirmed_at ? r.confirmed_at.toISOString() : null,
      })),
    });
  }, { session: true });

  router.add('GET', '/api/ops/claims/{reference}', async (ctx) => {
    const claim = await requireClaim(desk, ctx.params['reference'] ?? '');
    json(ctx.res, 200, await claimView(desk, claim));
  }, { session: true });

  router.add('GET', '/api/ops/claims/{reference}/photos/{index}', async (ctx) => {
    const claim = await requireClaim(desk, ctx.params['reference'] ?? '');
    const index = Number(ctx.params['index'] ?? '');
    if (!Number.isInteger(index) || index < 1) throwApi(CLAIM_NOT_FOUND);
    const photos = await desk.store.listPhotos(claim.reference);
    const row = photos.find((p) => p.index === index);
    if (row === undefined) throwApi(apiError({ status: 404, code: 'not_found', message: 'No such photo.' }));
    const object = await desk.storage.getPhoto(claim.reference, index);
    if (object === null) throwApi(apiError({ status: 404, code: 'not_found', message: 'No such photo.' }));
    ctx.res.writeHead(200, {
      'Content-Type': object.contentType,
      'Content-Length': String(object.body.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    ctx.res.end(object.body);
  }, { session: true });

  router.add('POST', '/api/ops/claims/{reference}/identify', async (ctx) => {
    const reference = ctx.params['reference'] ?? '';
    const body = ctx.body as { model?: unknown; booklet_number?: unknown; quantity?: unknown; reference?: unknown } | undefined;
    const model = typeof body?.model === 'string' ? body.model : '';
    const bookletRaw = body?.booklet_number;
    const quantityRaw = body?.quantity;
    const fields: Record<string, string> = {};
    if (model === '') fields['model'] = 'required';
    let booklet: number | null = null;
    if (typeof bookletRaw === 'number' && Number.isInteger(bookletRaw)) booklet = bookletRaw;
    else if (typeof bookletRaw === 'string' && /^\d+$/.test(bookletRaw)) booklet = Number(bookletRaw);
    if (booklet === null) fields['booklet_number'] = typeof bookletRaw === 'undefined' ? 'required' : 'invalid';
    else if (booklet < 1 || booklet > 99) { fields['booklet_number'] = 'invalid'; booklet = null; }
    let quantity: number | null = null;
    if (typeof quantityRaw === 'number' && Number.isInteger(quantityRaw)) quantity = quantityRaw;
    else if (typeof quantityRaw === 'string' && /^\d+$/.test(quantityRaw)) quantity = Number(quantityRaw);
    if (quantity === null) fields['quantity'] = typeof quantityRaw === 'undefined' ? 'required' : 'invalid';
    else if (quantity < 1 || quantity > 20) { fields['quantity'] = 'invalid'; quantity = null; }

    // The claim is judged first: unknown reference answers the claim not-found body.
    const claim = await requireClaim(desk, reference);
    if (typeof body?.reference === 'string' && body.reference.toUpperCase() !== claim.reference) throwApi(CLAIM_NOT_FOUND);
    if (claim.state === 'erased') throwApi(opsWrongState('erased'));
    if (Object.keys(fields).length > 0) {
      throwApi(apiError({ status: 422, code: 'validation_failed', message: 'Some fields need attention.', fields }));
    }

    const modelRow = await desk.store.getModel(model);
    const part = model !== '' && booklet !== null ? await desk.store.getPart(model, booklet) : null;
    if (modelRow === null || part === null) {
      throwApi(apiError({ status: 404, code: 'not_found', message: 'Choose the broken or missing part.' }));
    }
    if (part.status === 'withdrawn') {
      throwApi(apiError({ status: 409, code: 'part_withdrawn', message: operatorMessage('part_withdrawn', { number: String(part.bookletNumber) }) }));
    }
    if (claim.state !== 'confirmed') throwApi(opsWrongState(claim.state));

    // The ruling is made once, at identification, from the confirmation instant.
    const editionRecords = await desk.store.listEditions();
    const editions = editionRecords.map(toEditionRow);
    const ruling = makeRuling({
      confirmedAt: claim.confirmedAt ? claim.confirmedAt.getTime() : desk.now(),
      purchaseDate: claim.purchaseDate ?? '',
      clubMember: claim.clubMember,
      editions,
      config: desk.config,
      claimStartedAt: claim.createdAt.getTime(),
    });

    await desk.store.withRecords(async (client) => {
      const updated = await client.query(
        `UPDATE claims SET state = 'identified', model_slug = $2, booklet_number = $3, quantity = $4
         WHERE reference = $1 AND state = 'confirmed' RETURNING reference`,
        [claim.reference, model, booklet, quantity],
      );
      if (updated.rowCount === 0) throwApi(opsWrongState('confirmed'));
      await client.query(
        'INSERT INTO claim_history (reference, state, at) VALUES ($1, $2, $3)',
        [claim.reference, 'identified', new Date(desk.now())],
      );
      await client.query(
        `INSERT INTO rulings (reference, inside, edition_code, cover_ends_at, cover_ends_on, term_months, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [claim.reference, ruling.inside, ruling.edition, new Date(ruling.coverEndsAt), ruling.coverEndsOn, ruling.termMonths, new Date(desk.now())],
      );
      await client.query(
        `INSERT INTO decided_counts (id, decided_claims, decided_inside, decided_outside)
         VALUES (1, 1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET
           decided_claims = decided_counts.decided_claims + 1,
           decided_inside = decided_counts.decided_inside + $1,
           decided_outside = decided_counts.decided_outside + $2`,
        [ruling.inside ? 1 : 0, ruling.inside ? 0 : 1],
      );
    });

    const updated = await desk.store.getClaim(claim.reference);
    json(ctx.res, 200, await claimView(desk, updated as import('../store.js').ClaimRow));
  }, { session: true });

  router.add('POST', '/api/ops/claims/{reference}/quote', async (ctx) => {
    await withBillingAction(desk, ctx, 'quote', async (claim, key) => {
      if (claim.state === 'erased') throwApi(opsWrongState('erased'));
      if (claim.state !== 'identified' && claim.state !== 'quoted') throwApi(opsWrongState(claim.state));
      if (claim.state === 'identified' && claim.modelSlug === null) throwApi(opsWrongState(claim.state));

      const payment = await desk.store.getPayment(claim.reference);
      if (payment !== null) throwApi(apiError({ status: 409, code: 'already_paid', message: operatorMessage('already_paid', {}) }));

      const part = claim.modelSlug && claim.bookletNumber !== null
        ? await desk.store.getPart(claim.modelSlug, claim.bookletNumber)
        : null;
      if (part === null) throwApi(apiError({ status: 404, code: 'not_found', message: 'Choose the broken or missing part.' }));
      if (part.status === 'withdrawn') {
        throwApi(apiError({ status: 409, code: 'part_withdrawn', message: operatorMessage('part_withdrawn', { number: String(part.bookletNumber) }) }));
      }
      if (claim.state === 'quoted') {
        // Re-quote: only while unpaid. The current revision must exist.
        const current = await desk.store.getCurrentQuote(claim.reference);
        if (current === null) throwApi(opsWrongState(claim.state));
      }
      const quantity = claim.quantity ?? 1;

      // Carrier first: no answer, no quote.
      const postcodeArea = claim.postcodeArea ?? '';
      const carrier = await desk.carrier.quote({
        weightG: part.weightG * quantity,
        longestSideMm: part.longestSideMm,
        postcodeArea,
      });
      if (carrier.kind === 'timeout') throwApi(apiError({ status: 504, code: 'carrier_timeout', message: operatorMessage('carrier_timeout', {}) }));
      if (carrier.kind === 'unavailable') throwApi(apiError({ status: 503, code: 'carrier_unavailable', message: operatorMessage('carrier_unavailable', {}) }));
      if (carrier.kind === 'malformed') throwApi(apiError({ status: 502, code: 'carrier_malformed', message: operatorMessage('carrier_malformed', {}) }));

      const ruling = await desk.store.getRuling(claim.reference);
      const editionRecords = await desk.store.listEditions();
      const editions = editionRecords.map(toEditionRow);
      const edition = ruling !== null
        ? editions.find((e) => e.code === ruling.editionCode) ?? null
        : decidingEdition(claim.confirmedAt?.getTime() ?? desk.now(), editions);

      const figures = quoteFigures(
        part.priceMinor, quantity,
        edition?.ownerContributionPercent ?? 100,
        ruling?.inside ?? false,
        carrier.chargeMinor,
      );

      // Bin stock: a quote takes from the bin when there is enough, else supplier.
      const source = part.binCount >= quantity ? 'bin' : 'supplier';

      // Re-quote: void the previous revision's invoice first.
      let nextRevision = 1;
      if (claim.state === 'quoted') {
        const current = await desk.store.getCurrentQuote(claim.reference);
        if (current !== null) {
          if (current.killbillInvoiceId !== null) {
            await desk.killbill.voidInvoice(current.killbillInvoiceId);
          }
          if (current.source === 'bin' && !current.binReturned && current.status === 'current') {
            // Voiding a bin revision returns its quantity once.
            await desk.store.query(
              'UPDATE parts SET bin_count = bin_count + $1 WHERE model_slug = $2 AND booklet_number = $3',
              [claim.quantity ?? 0, claim.modelSlug, claim.bookletNumber ?? 0],
            );
            await desk.store.query(
              'UPDATE quote_revisions SET bin_returned = true WHERE reference = $1 AND revision = $2',
              [claim.reference, current.revision],
            );
          }
          await desk.store.query(
            'UPDATE quote_revisions SET status = $3 WHERE reference = $1 AND revision = $2',
            [claim.reference, current.revision, 'void'],
          );
          nextRevision = current.revision + 1;
        }
      }

      // Record the invoice in billing first, then the revision.
      const accountId = await desk.killbill.ensureAccount(claim.reference);
      const invoice = await desk.killbill.createInvoice(
        claim.reference, accountId,
        figures.partLineMinor, `Part ${part.partNumber} × ${quantity}`,
        figures.carriageMinor, `Carriage band ${carrier.band}`,
      );

      // Re-read the invoice from Kill Bill: only its figures are shown.
      const invoiceView = await desk.killbill.readInvoice(invoice.invoiceId);
      const businessDay = londonDateOf(desk.now());
      const bankHolidays = await desk.store.listBankHolidays();
      const promise = dispatchPromise({
        source,
        quoteInstant: desk.now(),
        businessDay,
        config: desk.config,
        bankHolidays,
      });

      if (source === 'bin') {
        const updated = await desk.store.withRecords(async (client) => {
          const res = await client.query<{ bin_count: number }>(
            `UPDATE parts SET bin_count = bin_count - $1 WHERE model_slug = $2 AND booklet_number = $3 AND bin_count >= $1 RETURNING bin_count`,
            [quantity, part.modelSlug, part.bookletNumber],
          );
          return res.rows[0] !== undefined;
        });
        if (!updated) {
          // Another quote took the last units: quote as supplier-ordered.
          promise.kind = 'later';
          promise.date = dispatchPromise({
            source: 'supplier', quoteInstant: desk.now(), businessDay, config: desk.config, bankHolidays,
          }).date;
        }
      }

      await desk.store.withRecords(async (client) => {
        await client.query(
          `INSERT INTO quote_revisions (reference, revision, status, source, part_line_minor, carriage_minor, total_minor,
            band, carriage_valid_until, promise_kind, promise_date, killbill_invoice_id, killbill_invoice_number, quoted_at)
           VALUES ($1,$2,'current',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [claim.reference, nextRevision, source, invoiceView.items[0]?.amountMinor ?? figures.partLineMinor,
           invoiceView.items[1]?.amountMinor ?? figures.carriageMinor,
           (invoiceView.items[0]?.amountMinor ?? figures.partLineMinor) + (invoiceView.items[1]?.amountMinor ?? figures.carriageMinor),
           carrier.band, new Date(carrier.validUntil), promise.kind, promise.date,
           invoice.invoiceId, invoice.invoiceNumber, new Date(desk.now())],
        );
        if (claim.state === 'identified') {
          const upd = await client.query(
            `UPDATE claims SET state = 'quoted' WHERE reference = $1 AND state = 'identified' RETURNING reference`,
            [claim.reference],
          );
          if (upd.rowCount === 0) throwApi(opsWrongState(claim.state));
          await client.query(
            'INSERT INTO claim_history (reference, state, at) VALUES ($1, $2, $3)',
            [claim.reference, 'quoted', new Date(desk.now())],
          );
        }
      });

      const share = await desk.store.getActiveShareToken(claim.reference);
      await queueNotice(desk, 'quoted', {
        reference: claim.reference,
        email: claim.ownerEmail ?? '',
        language: (claim.language as 'en-GB' | 'pl-PL') ?? 'en-GB',
        totalMinor: invoiceView.amountMinor,
        partLineMinor: invoiceView.items[0]?.amountMinor,
        carriageMinor: invoiceView.items[1]?.amountMinor,
        band: carrier.band,
        promiseKind: promise.kind,
        promiseDate: promise.date,
        shareToken: share?.token ?? '',
      });

      const updated = await desk.store.getClaim(claim.reference);
      const view = await claimView(desk, updated as import('../store.js').ClaimRow);
      await storeResponse(desk, claim.reference, key, 'quote', bodyHash(ctx), view);
      json(ctx.res, 200, view);
    });
  }, { session: true });

  router.add('POST', '/api/ops/claims/{reference}/payment', async (ctx) => {
    await withBillingAction(desk, ctx, 'payment', async (claim, key) => {
      if (claim.state === 'erased') throwApi(opsWrongState('erased'));
      if (claim.state !== 'quoted') throwApi(opsWrongState(claim.state));
      const existing = await desk.store.getPayment(claim.reference);
      if (existing !== null) throwApi(apiError({ status: 409, code: 'already_paid', message: operatorMessage('already_paid', {}) }));
      const quote = await desk.store.getCurrentQuote(claim.reference);
      if (quote === null) throwApi(opsWrongState(claim.state));

      const accountId = await desk.killbill.ensureAccount(claim.reference);
      const payment = await desk.killbill.recordPayment(accountId, quote.killbillInvoiceId ?? '', quote.totalMinor);
      // Read back the amount Kill Bill confirms.
      const confirmed = await desk.killbill.readPayment(payment.paymentId);

      await desk.store.withRecords(async (client) => {
        const upd = await client.query(
          'INSERT INTO payments (reference, paid_minor, killbill_payment_id, paid_at) VALUES ($1, $2, $3, $4) RETURNING reference',
          [claim.reference, confirmed.purchasedMinor, confirmed.paymentId, new Date(desk.now())],
        );
        if (upd.rowCount === 0) throwApi(opsWrongState(claim.state));
      });
      void key;
      const updated = await desk.store.getClaim(claim.reference);
      const view = await claimView(desk, updated as import('../store.js').ClaimRow);
      await storeResponse(desk, claim.reference, key, 'payment', bodyHash(ctx), view);
      json(ctx.res, 200, view);
    });
  }, { session: true });

  router.add('POST', '/api/ops/claims/{reference}/decline', async (ctx) => {
    await withBillingAction(desk, ctx, 'decline', async (claim, key) => {
      if (claim.state === 'erased') throwApi(opsWrongState('erased'));
      if (claim.state !== 'quoted') throwApi(opsWrongState(claim.state));
      const body = ctx.body as { reason?: unknown } | undefined;
      const reason = typeof body?.reason === 'string' ? body.reason : '';
      if (reason !== 'owner_declined' && reason !== 'cannot_send') {
        throwApi(apiError({
          status: 422, code: 'validation_failed', message: 'Some fields need attention.',
          fields: { reason: reason === '' ? 'required' : 'invalid' },
        }));
      }
      const quote = await desk.store.getCurrentQuote(claim.reference);
      if (quote === null) throwApi(opsWrongState(claim.state));
      const payment = await desk.store.getPayment(claim.reference);

      let chargedMinor = 0;
      let refundedMinor = 0;
      if (payment === null) {
        if (quote.killbillInvoiceId !== null) {
          await desk.killbill.voidInvoice(quote.killbillInvoiceId);
        }
        const accountId = await desk.killbill.ensureAccount(claim.reference);
        chargedMinor = await desk.killbill.accountBalanceMinor(accountId);
        refundedMinor = 0;
      } else {
        const refunded = await desk.killbill.refundPayment(payment.killbillPaymentId ?? '', payment.paidMinor);
        // The figure billing reports after the refund: nothing remains charged.
        refundedMinor = refunded.refundMinor;
        chargedMinor = 0;
      }

      // The decline, its state change, its bin return and its notice are stored together.
      await desk.store.withRecords(async (client) => {
        const upd = await client.query(
          `UPDATE claims SET state = 'declined' WHERE reference = $1 AND state = 'quoted' RETURNING reference`,
          [claim.reference],
        );
        if (upd.rowCount === 0) throwApi(opsWrongState(claim.state));
        await client.query(
          'INSERT INTO claim_history (reference, state, at) VALUES ($1, $2, $3)',
          [claim.reference, 'declined', new Date(desk.now())],
        );
        await client.query(
          'INSERT INTO declines (reference, reason, charged_minor, refunded_minor) VALUES ($1, $2, $3, $4)',
          [claim.reference, reason, chargedMinor, refundedMinor],
        );
        if (quote.source === 'bin' && !quote.binReturned) {
          await client.query(
            'UPDATE parts SET bin_count = bin_count + $1 WHERE model_slug = $2 AND booklet_number = $3',
            [claim.quantity ?? 0, claim.modelSlug, claim.bookletNumber ?? 0],
          );
          await client.query(
            'UPDATE quote_revisions SET bin_returned = true WHERE reference = $1 AND revision = $2',
            [claim.reference, quote.revision],
          );
        }
      });

      const share = await desk.store.getActiveShareToken(claim.reference);
      await queueNotice(desk, 'declined', {
        reference: claim.reference,
        email: claim.ownerEmail ?? '',
        language: (claim.language as 'en-GB' | 'pl-PL') ?? 'en-GB',
        refundedMinor: payment === null ? 0 : refundedMinor,
        shareToken: share?.token ?? '',
      });
      const updated = await desk.store.getClaim(claim.reference);
      const view = await claimView(desk, updated as import('../store.js').ClaimRow);
      await storeResponse(desk, claim.reference, key, 'decline', bodyHash(ctx), view);
      json(ctx.res, 200, view);
    });
  }, { session: true });

  router.add('POST', '/api/ops/claims/{reference}/dispatch', async (ctx) => {
    await withBillingAction(desk, ctx, 'dispatch', async (claim, key) => {
      if (claim.state === 'erased') throwApi(opsWrongState('erased'));
      if (claim.state !== 'quoted') throwApi(opsWrongState(claim.state));
      const payment = await desk.store.getPayment(claim.reference);
      if (payment === null) throwApi(apiError({ status: 409, code: 'not_paid', message: operatorMessage('not_paid', {}) }));
      const quote = await desk.store.getCurrentQuote(claim.reference);
      if (quote === null) throwApi(opsWrongState(claim.state));

      // The dispatch note reads its figures from billing.
      const invoice = quote.killbillInvoiceId !== null ? await desk.killbill.readInvoice(quote.killbillInvoiceId) : null;
      const paid = payment.killbillPaymentId !== null ? await desk.killbill.readPayment(payment.killbillPaymentId) : null;
      const part = claim.modelSlug && claim.bookletNumber !== null
        ? await desk.store.getPart(claim.modelSlug, claim.bookletNumber)
        : null;

      const note = renderDispatchNote({
        reference: claim.reference,
        partNumber: part?.partNumber ?? '',
        partName: part?.name ?? '',
        bookletNumber: part?.bookletNumber ?? 0,
        quantity: claim.quantity ?? 0,
        partLineMinor: invoice?.items[0]?.amountMinor ?? quote.partLineMinor,
        carriageLineMinor: invoice?.items[1]?.amountMinor ?? quote.carriageMinor,
        totalMinor: invoice?.amountMinor ?? quote.totalMinor,
        paidMinor: paid?.purchasedMinor ?? payment.paidMinor,
      });

      await desk.storage.putDispatchNote(claim.reference, note);

      await desk.store.withRecords(async (client) => {
        const upd = await client.query(
          `UPDATE claims SET state = 'dispatched', dispatched_at = $2 WHERE reference = $1 AND state = 'quoted' RETURNING reference`,
          [claim.reference, new Date(desk.now())],
        );
        if (upd.rowCount === 0) throwApi(opsWrongState(claim.state));
        await client.query(
          'INSERT INTO claim_history (reference, state, at) VALUES ($1, $2, $3)',
          [claim.reference, 'dispatched', new Date(desk.now())],
        );
        await client.query(
          'INSERT INTO dispatch_notes (reference) VALUES ($1) ON CONFLICT (reference) DO NOTHING',
          [claim.reference],
        );
      });

      const share = await desk.store.getActiveShareToken(claim.reference);
      await queueNotice(desk, 'dispatched', {
        reference: claim.reference,
        email: claim.ownerEmail ?? '',
        language: (claim.language as 'en-GB' | 'pl-PL') ?? 'en-GB',
        paidMinor: payment.paidMinor,
        shareToken: share?.token ?? '',
      });
      const updated = await desk.store.getClaim(claim.reference);
      const view = await claimView(desk, updated as import('../store.js').ClaimRow);
      await storeResponse(desk, claim.reference, key, 'dispatch', bodyHash(ctx), view);
      json(ctx.res, 200, view);
    });
  }, { session: true });

  router.add('GET', '/api/ops/claims/{reference}/dispatch-note', async (ctx) => {
    const claim = await requireClaim(desk, ctx.params['reference'] ?? '');
    const note = await desk.storage.getDispatchNote(claim.reference);
    if (note === null) throwApi(apiError({ status: 404, code: 'not_found', message: 'No dispatch note.' }));
    ctx.res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    ctx.res.end(note);
  }, { session: true });

  router.add('POST', '/api/ops/claims/{reference}/close', async (ctx) => {
    const claim = await requireClaim(desk, ctx.params['reference'] ?? '');
    const body = ctx.body as { reference?: unknown } | undefined;
    if (typeof body?.reference === 'string' && body.reference.toUpperCase() !== claim.reference) throwApi(CLAIM_NOT_FOUND);
    if (claim.state === 'erased') throwApi(opsWrongState('erased'));
    if (claim.state !== 'declined' && claim.state !== 'dispatched') throwApi(opsWrongState(claim.state));

    await desk.store.withRecords(async (client) => {
      const upd = await client.query(
        `UPDATE claims SET state = 'closed', closed_at = $2 WHERE reference = $1 AND state IN ('declined','dispatched') RETURNING reference`,
        [claim.reference, new Date(desk.now())],
      );
      if (upd.rowCount === 0) throwApi(opsWrongState(claim.state));
      await client.query(
        'INSERT INTO claim_history (reference, state, at) VALUES ($1, $2, $3)',
        [claim.reference, 'closed', new Date(desk.now())],
      );
      // The share link ends at the instant the close request is stored.
      await client.query(
        `UPDATE share_tokens SET state = 'ended', ended_at = $2 WHERE reference = $1 AND state = 'active'`,
        [claim.reference, new Date(desk.now())],
      );
    });

    await queueNotice(desk, 'closed', {
      reference: claim.reference,
      email: claim.ownerEmail ?? '',
      language: (claim.language as 'en-GB' | 'pl-PL') ?? 'en-GB',
    });
    const updated = await desk.store.getClaim(claim.reference);
    json(ctx.res, 200, await claimView(desk, updated as import('../store.js').ClaimRow));
  }, { session: true });

  router.add('DELETE', '/api/ops/claims/{reference}/share-link', async (ctx) => {
    const claim = await requireClaim(desk, ctx.params['reference'] ?? '');
    if (claim.state === 'erased') throwApi(opsWrongState('erased'));
    if (!['confirmed', 'identified', 'quoted', 'declined', 'dispatched'].includes(claim.state)) {
      throwApi(opsWrongState(claim.state));
    }
    await desk.store.query(
      `UPDATE share_tokens SET state = 'withdrawn', ended_at = $2 WHERE reference = $1 AND state = 'active'`,
      [claim.reference, new Date(desk.now())],
    );
    ctx.res.writeHead(204);
    ctx.res.end();
  }, { session: true, raw: true });

  router.add('POST', '/api/ops/claims/{reference}/share-link', async (ctx) => {
    const claim = await requireClaim(desk, ctx.params['reference'] ?? '');
    if (claim.state === 'erased') throwApi(opsWrongState('erased'));
    if (!['confirmed', 'identified', 'quoted', 'declined', 'dispatched'].includes(claim.state)) {
      throwApi(opsWrongState(claim.state));
    }
    const token = newToken();
    await desk.store.withRecords(async (client) => {
      await client.query(
        `UPDATE share_tokens SET state = 'ended', ended_at = $2 WHERE reference = $1 AND state = 'active'`,
        [claim.reference, new Date(desk.now())],
      );
      await client.query(
        'INSERT INTO share_tokens (token, reference, state) VALUES ($1, $2, $3)',
        [token, claim.reference, 'active'],
      );
    });
    await queueNotice(desk, 'new_link', {
      reference: claim.reference,
      email: claim.ownerEmail ?? '',
      language: (claim.language as 'en-GB' | 'pl-PL') ?? 'en-GB',
      shareToken: token,
    });
    const updated = await desk.store.getClaim(claim.reference);
    json(ctx.res, 201, await claimView(desk, updated as import('../store.js').ClaimRow));
  }, { session: true, raw: true });

  router.add('POST', '/api/ops/claims/{reference}/erase', async (ctx) => {
    const reference = ctx.params['reference'] ?? '';
    const claim = await requireClaim(desk, reference);
    const body = ctx.body as { confirm_reference?: unknown } | undefined;
    const typed = typeof body?.confirm_reference === 'string' ? body.confirm_reference : '';
    if (typed === '') {
      throwApi(apiError({
        status: 422, code: 'validation_failed', message: 'Some fields need attention.',
        fields: { confirm_reference: 'required' },
      }));
    }
    // Compared exactly as issued, untrimmed, letter case included.
    if (typed !== claim.reference) {
      throwApi(apiError({
        status: 422, code: 'validation_failed', message: 'Some fields need attention.',
        fields: { confirm_reference: 'mismatch' },
      }));
    }
    if (claim.state === 'erased') throwApi(opsWrongState('erased'));
    const email = claim.ownerEmail ?? '';

    // Mail must be reachable so the erasure removes the owner's mail too.
    try {
      await desk.mail.ping();
    } catch {
      throwApi(apiError({ status: 503, code: 'mail_unavailable', message: operatorMessage('mail_unavailable', {}) }));
    }

    // Every claim of this owner, matched by email in any letter case.
    const all = await desk.store.query<{ reference: string; state: string }>(
      'SELECT reference, state FROM claims WHERE owner_email IS NOT NULL AND lower(owner_email) = lower($1) AND state <> $2',
      [email, 'erased'],
    );
    const references = all.rows.map((r) => r.reference);

    // Delete every photo and dispatch-note object from MinIO first.
    for (const ref of references) {
      await desk.storage.deleteClaimObjects(ref);
    }
    // Delete every Mailpit message to this address.
    await desk.mail.eraseMail(email);

    await desk.store.withRecords(async (client) => {
      for (const ref of references) {
        await client.query(
          `UPDATE claims SET state = 'erased', erased_at = $2, owner_name = NULL, owner_email = NULL,
            owner_postcode = NULL, postcode_area = NULL, purchase_date = NULL, club_member = false,
            model_slug = NULL, booklet_number = NULL, quantity = NULL, description = NULL,
            confirm_token = NULL, confirm_used_at = NULL, dispatched_at = NULL, closed_at = NULL
           WHERE reference = $1`,
          [ref, new Date(desk.now())],
        );
        await client.query('DELETE FROM claim_history WHERE reference = $1', [ref]);
        await client.query('DELETE FROM claim_photos WHERE reference = $1', [ref]);
        await client.query('DELETE FROM rulings WHERE reference = $1', [ref]);
        await client.query('DELETE FROM quote_revisions WHERE reference = $1', [ref]);
        await client.query('DELETE FROM payments WHERE reference = $1', [ref]);
        await client.query('DELETE FROM declines WHERE reference = $1', [ref]);
        await client.query('DELETE FROM dispatch_notes WHERE reference = $1', [ref]);
        await client.query('DELETE FROM share_tokens WHERE reference = $1', [ref]);
        await client.query('DELETE FROM idempotency_records WHERE reference = $1', [ref]);
        await client.query('DELETE FROM reference_locks WHERE reference = $1', [ref]);
        await client.query('DELETE FROM notice_queue WHERE reference = $1', [ref]);
      }
      await client.query('DELETE FROM club_roster WHERE lower(email) = lower($1)', [email]);
    });

    json(ctx.res, 200, { erased: references });
  }, { session: true });

  router.add('GET', '/api/ops/stats', async (ctx) => {
    json(ctx.res, 200, await desk.store.stats());
  }, { session: true });

  router.add('GET', '/api/ops/editions', async (ctx) => {
    json(ctx.res, 200, { editions: await desk.store.listEditions() });
  }, { session: true });

  router.add('POST', '/api/ops/editions', async (ctx) => {
    const body = ctx.body as Record<string, unknown> | undefined;
    const code = typeof body?.['code'] === 'string' ? body['code'] : '';
    const title = typeof body?.['title'] === 'string' ? body['title'] : '';
    const startsOn = typeof body?.['starts_on'] === 'string' ? body['starts_on'] : '';
    const standard = body?.['standard_months'];
    const club = body?.['club_months'];
    const percent = body?.['owner_contribution_percent'];
    const fields: Record<string, string> = {};
    if (code === '') fields['code'] = 'required';
    else if (!EDITION_CODE_RE.test(code)) fields['code'] = 'invalid';
    if (title === '') fields['title'] = 'required';
    else if (title.length > 80) fields['title'] = 'too_long';
    if (startsOn === '') fields['starts_on'] = 'required';
    else if (!isRealDate(startsOn)) fields['starts_on'] = 'invalid';
    else if (startsOn <= londonDateOf(desk.now())) fields['starts_on'] = 'must_be_future';
    const months = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isInteger(value)) return value;
      if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
      return null;
    };
    const standardMonths = months(standard);
    const clubMonths = months(club);
    const percentNum = months(percent);
    if (standardMonths === null || standardMonths < 1 || standardMonths > 120) fields['standard_months'] = standard === undefined ? 'required' : 'invalid';
    if (clubMonths === null || clubMonths < 1 || clubMonths > 120) fields['club_months'] = club === undefined ? 'required' : 'invalid';
    if (percentNum === null || percentNum < 0 || percentNum > 100) fields['owner_contribution_percent'] = percent === undefined ? 'required' : 'invalid';
    if (Object.keys(fields).length > 0) {
      throwApi(apiError({ status: 422, code: 'validation_failed', message: 'Some fields need attention.', fields }));
    }
    const existing = await desk.store.listEditions();
    if (existing.some((e) => e.code === code)) {
      throwApi(apiError({ status: 409, code: 'edition_code_taken', message: operatorMessage('edition_code_taken', {}) }));
    }
    if (existing.some((e) => e.starts_on === startsOn)) {
      throwApi(apiError({ status: 409, code: 'edition_date_taken', message: operatorMessage('edition_date_taken', {}) }));
    }
    await desk.store.query(
      `INSERT INTO editions (code, title, starts_on, standard_months, club_months, owner_contribution_percent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [code, title, startsOn, standardMonths, clubMonths, percentNum],
    );
    json(ctx.res, 201, {
      code, title, starts_on: startsOn, standard_months: standardMonths,
      club_months: clubMonths, owner_contribution_percent: percentNum,
    });
  }, { session: true });

  router.add('POST', '/api/ops/imports', async (ctx) => {
    const text = ctx.rawBody.toString('utf8');
    const lines = text.split(/\r?\n/);
    const HEADER = 'model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status';
    if ((lines[0] ?? '') !== HEADER) {
      throwApi(apiError({
        status: 422, code: 'validation_failed', message: 'Some fields need attention.',
        fields: { file: 'bad_header' },
      }));
    }
    const result = await runImport(desk, lines);
    json(ctx.res, 200, result);
  }, { session: true, raw: true, limit: 2_000_000 });
}

async function withBillingAction(
  desk: Desk, ctx: Ctx, action: 'quote' | 'payment' | 'decline' | 'dispatch',
  fn: (claim: import('../store.js').ClaimRow, key: string) => Promise<void>,
): Promise<void> {
  const claim = await requireClaim(desk, ctx.params['reference'] ?? '');
  const { key, error } = idempotencyKeyError(ctx);
  if (error !== null) throwApi(error);
  const existing = await desk.store.query<{ action: string; body_hash: string; status: number; response_body: string }>(
    'SELECT action, body_hash, status, response_body FROM idempotency_records WHERE reference = $1 AND key = $2',
    [claim.reference, key as string],
  );
  const row = existing.rows[0];
  if (row) {
    if (row.action !== action || row.body_hash !== bodyHash(ctx)) {
      throwApi(apiError({ status: 409, code: 'idempotency_conflict', message: operatorMessage('idempotency_conflict', {}) }));
    }
    json(ctx.res, row.status, JSON.parse(row.response_body));
    return;
  }
  await fn(claim, key as string);
}

function writeCookies(ctx: Ctx): void {
  const parts = ctx.setCookies.map((c) => {
    const bits = [`${c.name}=${c.value}`, `Path=${c.path}`, 'SameSite=Strict'];
    if (c.httpOnly) bits.push('HttpOnly');
    if (c.maxAge !== null) bits.push(`Max-Age=${c.maxAge}`);
    return bits.join('; ');
  });
  ctx.res.setHeader('Set-Cookie', parts);
}

function renderDispatchNote(data: {
  reference: string; partNumber: string; partName: string; bookletNumber: number; quantity: number;
  partLineMinor: number; carriageLineMinor: number; totalMinor: number; paidMinor: number;
}): string {
  const money = formatMoneyEn;
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Dispatch note</title></head>',
    '<body style="font-family: IBM Plex Sans, sans-serif; color: #1a2233; background: #fdfbf4;">',
    '<h1>Dispatch note</h1>',
    `<p>Claim ${data.reference}</p>`,
    `<p>Part ${data.bookletNumber}: ${data.partName}</p>`,
    `<p>Part number ${data.partNumber}</p>`,
    `<p>Part ${money(data.partLineMinor)}</p>`,
    `<p>Carriage, band ${money(data.carriageLineMinor)}</p>`,
    `<p>Total ${money(data.totalMinor)}</p>`,
    `<p>Paid ${money(data.paidMinor)}</p>`,
    `<p>Quantity ${data.quantity}</p>`,
    '</body></html>',
  ].join('\n');
}

async function runImport(
  desk: Desk,
  lines: readonly string[],
): Promise<{ created: number; updated: number; unchanged: number; unmatched: Array<{ line: number; reason: string }> }> {
  const models = await desk.store.listModels();
  const retired = await desk.store.listRetiredNames();
  const bySlug = new Map(models.map((m) => [m.slug, { name: m.name, retiredNames: [] as string[] }]));
  for (const r of retired) {
    const entry = bySlug.get(r.slug);
    if (entry) entry.retiredNames.push(r.name);
  }
  const index = buildModelIndex(
    [...bySlug.entries()].map(([slug, info]) => ({ slug, name: info.name, retiredNames: info.retiredNames })),
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const unmatched: Array<{ line: number; reason: string }> = [];
  const seen = new Map<string, boolean>();
  let lineNo = 1;
  for (const rawLine of lines.slice(1)) {
    lineNo += 1;
    if (rawLine.trim() === '') continue;
    const cells = parseCsvLine(rawLine);
    if (cells.length !== 8) {
      unmatched.push({ line: lineNo, reason: 'missing_field' });
      continue;
    }
    const modelName = cells[0] ?? '';
    const bookletRaw = cells[1] ?? '';
    const partNumber = cells[2] ?? '';
    const partName = cells[3] ?? '';
    const priceRaw = cells[4] ?? '';
    const weightRaw = cells[5] ?? '';
    const sideRaw = cells[6] ?? '';
    const status = cells[7] ?? '';
    if ([modelName, bookletRaw, partNumber, partName, priceRaw, weightRaw, sideRaw, status].some((c) => c.trim() === '')) {
      unmatched.push({ line: lineNo, reason: 'missing_field' });
      continue;
    }
    const match = matchModelName(modelName, index);
    if (match.kind === 'unknown') { unmatched.push({ line: lineNo, reason: 'unknown_model' }); continue; }
    if (match.kind === 'ambiguous') { unmatched.push({ line: lineNo, reason: 'ambiguous_model' }); continue; }
    const slug = match.slug;
    const booklet = Number(bookletRaw);
    if (!/^\d+$/.test(bookletRaw) || booklet < 1 || booklet > 99) { unmatched.push({ line: lineNo, reason: 'bad_booklet_number' }); continue; }
    if (!/^\d{6}$|^\d{8}$/.test(partNumber)) { unmatched.push({ line: lineNo, reason: 'bad_part_number' }); continue; }
    const price = Number(priceRaw);
    if (!/^\d+(\.\d{1,2})?$/.test(priceRaw) || !(price >= 0.01)) { unmatched.push({ line: lineNo, reason: 'bad_price' }); continue; }
    if (!/^\d+$/.test(weightRaw) || Number(weightRaw) <= 0) { unmatched.push({ line: lineNo, reason: 'bad_weight' }); continue; }
    if (!/^\d+$/.test(sideRaw) || Number(sideRaw) <= 0) { unmatched.push({ line: lineNo, reason: 'bad_size' }); continue; }
    if (status !== 'active' && status !== 'withdrawn') { unmatched.push({ line: lineNo, reason: 'bad_status' }); continue; }
    const key = `${slug}#${booklet}`;
    if (seen.has(key)) { unmatched.push({ line: lineNo, reason: 'duplicate_row' }); continue; }
    seen.set(key, true);

    const existing = await desk.store.getPart(slug, booklet);
    const priceMinor = Math.round(price * 100);
    const weight = Number(weightRaw);
    const side = Number(sideRaw);
    if (existing === null) {
      await desk.store.query(
        `INSERT INTO parts (model_slug, booklet_number, part_number, name, price_minor, weight_g, longest_side_mm, bin_count, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
        [slug, booklet, partNumber, partName, priceMinor, weight, side, status],
      );
      created += 1;
    } else {
      const differs = existing.partNumber !== partNumber || existing.name !== partName
        || existing.priceMinor !== priceMinor || existing.weightG !== weight
        || existing.longestSideMm !== side || existing.status !== status;
      if (differs) {
        await desk.store.query(
          `UPDATE parts SET part_number = $3, name = $4, price_minor = $5, weight_g = $6, longest_side_mm = $7, status = $8
           WHERE model_slug = $1 AND booklet_number = $2`,
          [slug, booklet, partNumber, partName, priceMinor, weight, side, status],
        );
        updated += 1;
      } else {
        unchanged += 1;
      }
    }
  }
  return { created, updated, unchanged, unmatched };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else current += ch;
  }
  cells.push(current);
  return cells;
}

export { CLAIM_NOT_FOUND, opsWrongState, requireClaim, idempotencyKeyError, bodyHash };
