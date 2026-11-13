// Public endpoints: everything an owner can reach without an account.
import type { Router, Desk } from '../server.js';
import { throwApi, newReference, newToken, ApiErrorSignal } from '../server.js';
import { json, type Ctx } from '../http.js';
import { apiError } from '../errors.js';
import { ownerRefusalForApi } from '../copy.js';
import type { Store } from '../store.js';
import type { ApiError } from '../errors.js';
import {
  judgePhoto, parseUkPostcode, EMAIL_RE, REFERENCE_RE,
  isRealDate, instantIsBeforeClose,
} from '../domain.js';
import { londonDateOf, formatInstant } from '../clock.js';
import { linkLifetimeLine } from '../format.js';
import { MailUnavailable } from '../services/mail.js';

const UNNAMED_CLAIM_NOT_FOUND = apiError({
  status: 404, code: 'claim_unknown', message: "We couldn't find that claim.",
});

export function registerPublicRoutes(router: Router, desk: Desk): void {
  router.add('GET', '/api/models', async (ctx) => {
    const models = await desk.store.listModels();
    const retired = await desk.store.listRetiredNames();
    const bySlug = new Map<string, string[]>();
    for (const r of retired) {
      const list = bySlug.get(r.slug) ?? [];
      list.push(r.name);
      bySlug.set(r.slug, list);
    }
    const out = [];
    for (const m of models) {
      const parts = await desk.store.listParts(m.slug);
      out.push({
        slug: m.slug,
        name: m.name,
        axis: m.axis,
        diagram: m.axis !== null,
        part_count: parts.length,
      });
    }
    json(ctx.res, 200, { models: out });
  });

  router.add('GET', '/api/models/{slug}', async (ctx) => {
    const slug = ctx.params['slug'] ?? '';
    const model = await desk.store.getModel(slug);
    if (model === null) {
      throwApi(apiError({ status: 404, code: 'not_found', message: 'Choose the broken or missing part.' }));
    }
    const parts = await desk.store.listParts(slug);
    json(ctx.res, 200, {
      slug: model.slug,
      name: model.name,
      axis: model.axis,
      diagram: model.axis !== null,
      parts: parts.map((p) => ({
        booklet_number: p.bookletNumber,
        part_number: p.partNumber,
        name: p.name,
        longest_side_mm: p.longestSideMm,
        status: p.status,
      })),
    });
  });

  router.add('GET', '/api/parts', async (ctx) => {
    const limitRaw = ctx.query.get('limit');
    const cursorRaw = ctx.query.get('cursor');
    let limit = 20;
    if (limitRaw !== null) {
      if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1) {
        throwApi(apiError({
          status: 422, code: 'validation_failed', message: 'Some fields need attention.',
          fields: { limit: 'invalid' },
        }));
      }
      limit = Math.min(Number(limitRaw), 50);
    }
    if (cursorRaw !== null && !/^\d+$/.test(cursorRaw)) {
      throwApi(apiError({
        status: 422, code: 'validation_failed', message: 'Some fields need attention.',
        fields: { cursor: 'invalid' },
      }));
    }

    // Rate limit per caller, shared through Postgres.
    const caller = ctx.callerAddress;
    const allowed = await consumeRate(desk, caller);
    if (!allowed.allowed) {
      throwApi(apiError({
        status: 429, code: 'rate_limited', message: 'Too many requests. Please wait a moment.',
        headers: { 'Retry-After': String(Math.max(1, allowed.retryAfterSeconds)) },
      }));
    }

    const after = cursorRaw === null ? 0 : Number(cursorRaw);
    const rows = await desk.store.query<{
      model_slug: string; booklet_number: number; part_number: string; name: string; price_minor: number; status: string; rowid: number;
    }>(
      `SELECT model_slug, booklet_number, part_number, name, price_minor, status, (row_number() OVER (ORDER BY model_slug, booklet_number, part_number))::int AS rowid
       FROM parts ORDER BY model_slug, booklet_number, part_number LIMIT $1 OFFSET $2`,
      [limit + 1, after],
    );
    const hasMore = rows.rows.length > limit;
    const page = rows.rows.slice(0, limit);
    json(ctx.res, 200, {
      parts: page.map((p) => ({
        model: p.model_slug,
        booklet_number: p.booklet_number,
        part_number: p.part_number,
        name: p.name,
        price_minor: p.price_minor,
        status: p.status,
      })),
      next_cursor: hasMore ? String(after + page.length) : null,
    });
  });

  router.add('GET', '/api/carriage-estimate', async (ctx) => {
    const modelSlug = ctx.query.get('model') ?? '';
    const partRaw = ctx.query.get('part') ?? '';
    const quantityRaw = ctx.query.get('quantity') ?? '';
    const postcode = ctx.query.get('postcode') ?? '';

    const fields: Record<string, string> = {};
    if (modelSlug === '') fields['model'] = 'required';
    if (partRaw === '') fields['part'] = 'required';
    if (quantityRaw === '') fields['quantity'] = 'required';
    if (postcode === '') fields['postcode'] = 'required';
    let quantity = Number(quantityRaw);
    if (quantityRaw !== '' && (!Number.isInteger(quantity) || quantity < 1 || quantity > 20)) {
      fields['quantity'] = 'invalid';
    }
    const pc = parseUkPostcode(postcode);
    if (postcode !== '' && !pc.valid) fields['postcode'] = 'invalid';

    // Model and part are looked up first.
    let part: Awaited<ReturnType<Store['getPart']>> = null;
    let partNotFound = false;
    if (modelSlug !== '' && partRaw !== '') {
      const booklet = Number(partRaw);
      const model = await desk.store.getModel(modelSlug);
      if (model !== null && Number.isInteger(booklet)) {
        part = await desk.store.getPart(modelSlug, booklet);
        partNotFound = part === null;
      } else if (model === null) {
        partNotFound = true;
      }
    }

    if (Object.keys(fields).length > 0) {
      throwApi(apiError({
        status: 422, code: 'validation_failed', message: 'Some fields need attention.', fields,
      }));
    }
    if (part === null || partNotFound) {
      throwApi(apiError({ status: 404, code: 'not_found', message: 'Choose the broken or missing part.' }));
    }
    if (part.status === 'withdrawn') {
      throwApi(apiError({ status: 409, code: 'part_withdrawn', message: ownerRefusalForApi('part_withdrawn', { number: String(part.bookletNumber) }) }));
    }
    const result = await desk.carrier.quote({
      weightG: part.weightG * quantity,
      longestSideMm: part.longestSideMm,
      postcodeArea: pc.area,
    });
    if (result.kind === 'timeout') throwApi(apiError({ status: 504, code: 'carrier_timeout', message: ownerRefusalForApi('carrier_timeout') }));
    if (result.kind === 'unavailable') throwApi(apiError({ status: 503, code: 'carrier_unavailable', message: ownerRefusalForApi('carrier_unavailable') }));
    if (result.kind === 'malformed') throwApi(apiError({ status: 502, code: 'carrier_malformed', message: ownerRefusalForApi('carrier_malformed') }));
    json(ctx.res, 200, {
      band: result.band,
      charge_minor: result.chargeMinor,
      currency: 'GBP',
      valid_until: formatInstant(result.validUntil),
    });
  });

  router.add('POST', '/api/claims', (ctx) => handleClaimStart(ctx, desk), { raw: true, limit: 33_000_000 });

  router.add('GET', '/api/claims/{reference}/confirmation', async (ctx) => {
    const reference = ctx.params['reference'] ?? '';
    if (!REFERENCE_RE.test(reference)) throwApi(UNNAMED_CLAIM_NOT_FOUND);
    const claim = await desk.store.getClaim(reference);
    if (claim === null || claim.state === 'erased') throwApi(UNNAMED_CLAIM_NOT_FOUND);
    const linkState = claim.state === 'started'
      ? (desk.now() < (claim.confirmBy?.getTime() ?? 0) ? 'live' : 'lapsed')
      : 'used';
    json(ctx.res, 200, {
      reference: claim.reference,
      link_state: linkState,
      confirm_by: claim.confirmBy ? claim.confirmBy.toISOString() : null,
    });
  });

  router.add('POST', '/api/claims/confirm', async (ctx) => {
    const body = ctx.body as { token?: unknown; reference?: unknown } | undefined;
    const token = typeof body?.token === 'string' ? body.token : '';
    if (token === '') {
      throwApi(apiError({
        status: 422, code: 'validation_failed', message: 'Some fields need attention.',
        fields: { token: 'required' },
      }));
    }
    // A share token is never accepted as a confirmation token; a body reference
    // naming another claim answers like an unknown one.
    const shareHit = await desk.store.getShareToken(token);
    if (shareHit !== null) throwApi(apiError({ status: 404, code: 'link_unknown', message: ownerRefusalForApi('link_unknown') }));

    // Look the claim up by token, then through the same row mapper every claim
    // read uses, so the property names agree.
    const found = await desk.store.query<Record<string, unknown>>(
      'SELECT reference FROM claims WHERE confirm_token = $1', [token],
    );
    const hit = found.rows[0];
    if (!hit) throwApi(apiError({ status: 404, code: 'link_unknown', message: ownerRefusalForApi('link_unknown') }));
    const claimRow = await desk.store.getClaim(String(hit['reference']));
    if (claimRow === null) throwApi(apiError({ status: 404, code: 'link_unknown', message: ownerRefusalForApi('link_unknown') }));
    if (typeof body?.reference === 'string' && body.reference.toUpperCase() !== claimRow.reference) {
      throwApi(apiError({ status: 404, code: 'link_unknown', message: ownerRefusalForApi('link_unknown') }));
    }
    if (claimRow.state !== 'started') {
      throwApi(apiError({ status: 409, code: 'link_used', message: ownerRefusalForApi('link_used') }));
    }
    const confirmBy = claimRow.confirmBy?.getTime() ?? 0;
    if (!instantIsBeforeClose(desk.now(), confirmBy)) {
      throwApi(apiError({ status: 410, code: 'link_lapsed', message: ownerRefusalForApi('link_lapsed') }));
    }

    // One instant is stored and reused everywhere for this confirmation.
    const confirmedAt = new Date(desk.now());
    await desk.store.withRecords(async (client) => {
      const updated = await client.query(
        `UPDATE claims SET state = 'confirmed', confirmed_at = $2, confirm_used_at = $3
         WHERE reference = $1 AND state = 'started' RETURNING reference`,
        [claimRow.reference, confirmedAt, confirmedAt],
      );
      if (updated.rowCount === 0) {
        throw new ApiErrorSignal(apiError({ status: 409, code: 'link_used', message: ownerRefusalForApi('link_used') }));
      }
      await client.query(
        'INSERT INTO claim_history (reference, state, at) VALUES ($1, $2, $3)',
        [claimRow.reference, 'confirmed', confirmedAt],
      );
      const tokenValue = newToken();
      await client.query('UPDATE share_tokens SET state = $2 WHERE reference = $1', [claimRow.reference, 'ended']);
      await client.query(
        'INSERT INTO share_tokens (token, reference, state) VALUES ($1, $2, $3)',
        [tokenValue, claimRow.reference, 'active'],
      );
      return undefined;
    });

    const share = await desk.store.getActiveShareToken(claimRow.reference);
    json(ctx.res, 200, {
      reference: claimRow.reference,
      state: 'confirmed',
      share_url: `/s/${share?.token ?? ''}`,
    });
  });

  router.add('POST', '/api/claims/lookup', async (ctx) => {
    const body = ctx.body as { reference?: unknown; email?: unknown } | undefined;
    const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const fields: Record<string, string> = {};
    if (reference === '') fields['reference'] = 'required';
    if (email === '') fields['email'] = 'required';
    if (Object.keys(fields).length > 0) {
      throwApi(apiError({ status: 422, code: 'validation_failed', message: 'Some fields need attention.', fields }));
    }

    // Wrong tries count against the reference named, and are shared across copies.
    const normRef = reference.toUpperCase();
    if (!REFERENCE_RE.test(normRef)) {
      throwApi(apiError({ status: 404, code: 'not_found', message: ownerRefusalForApi('not_found') }));
    }
    const lock = await readReferenceLock(desk, normRef);
    if (lock !== null) {
      const seconds = Math.max(1, Math.ceil((lock - desk.now()) / 1000));
      throwApi(apiError({
        status: 423, code: 'reference_locked', message: ownerRefusalForApi('reference_locked'),
        headers: { 'Retry-After': String(seconds) },
      }));
    }

    const claim = await desk.store.getClaim(normRef);
    const NOT_FOUND = apiError({ status: 404, code: 'not_found', message: ownerRefusalForApi('not_found') });
    if (claim === null || claim.state === 'erased') throwApi(NOT_FOUND);
    const emailMatch = claim.ownerEmail !== null && claim.ownerEmail.toLowerCase() === email.toLowerCase();
    if (!emailMatch) {
      await countWrongTry(desk, normRef);
      throwApi(NOT_FOUND);
    }
    await resetWrongTries(desk, normRef);
    if (claim.state === 'started') {
      throwApi(apiError({ status: 409, code: 'wrong_state', message: ownerRefusalForApi('wrong_state') }));
    }
    const share = await desk.store.getActiveShareToken(normRef);
    if (share === null) {
      const token = await desk.store.getShareTokenForRef(normRef);
      if (claim.state === 'closed') {
        throwApi(apiError({ status: 410, code: 'claim_closed', message: ownerRefusalForApi('claim_closed') }));
      }
      if (token !== null && token.state === 'withdrawn') {
        throwApi(apiError({ status: 410, code: 'link_withdrawn', message: ownerRefusalForApi('link_withdrawn') }));
      }
      throwApi(NOT_FOUND);
    }
    json(ctx.res, 200, { share_url: `/s/${share.token}` });
  });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    router.add(method, '/api/share/{token}', async (ctx) => {
      throwApi(apiError({ status: 405, code: 'read_only', message: 'This link is read-only.' }));
    }, { raw: true });
  }

  router.add('GET', '/api/share/{token}', async (ctx) => {
    const token = ctx.params['token'] ?? '';
    const hit = await desk.store.getShareToken(token);
    const unknown = apiError({ status: 404, code: 'share_unknown', message: ownerRefusalForApi('share_unknown') });
    if (hit === null) throwApi(unknown);
    const claim = await desk.store.getClaim(hit.reference);
    if (claim === null || claim.state === 'erased') throwApi(unknown);
    if (hit.state === 'ended' || claim.state === 'closed') {
      throwApi(apiError({ status: 410, code: 'claim_closed', message: ownerRefusalForApi('claim_closed') }));
    }
    if (hit.state === 'withdrawn') {
      throwApi(apiError({ status: 410, code: 'link_withdrawn', message: ownerRefusalForApi('link_withdrawn') }));
    }
    json(ctx.res, 200, await shareView(desk, claim));
  });
}

async function consumeRate(desk: Desk, caller: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const limit = desk.config.partsRateLimitPerMinute;
  if (limit === 0) return { allowed: false, retryAfterSeconds: 60 };
  try {
    return await desk.store.withRecords(async (client) => {
      // Prune stale windows, then count this caller's requests in the last 60 seconds.
      await client.query('DELETE FROM rate_windows WHERE window_start < now() - interval \'70 seconds\'');
      const res = await client.query<{ window_start: Date; count: number }>(
        `SELECT window_start, count FROM rate_windows WHERE caller = $1 AND window_start > now() - interval '60 seconds'`,
        [caller],
      );
      const recent = res.rows;
      const total = recent.reduce((sum, r) => sum + r.count, 0);
      const now = desk.now();
      const start = new Date(now - (now % 60_000));
      if (total >= limit) {
        const newest = recent.reduce((acc, r) => (r.window_start.getTime() > acc.getTime() ? r.window_start : acc), new Date(0));
        const retryAfter = Math.max(1, Math.ceil((newest.getTime() + 60_000 - now) / 1000));
        return { allowed: false, retryAfterSeconds: retryAfter };
      }
      await client.query(
        `INSERT INTO rate_windows (caller, window_start, count) VALUES ($1, $2, 1)
         ON CONFLICT (caller, window_start) DO UPDATE SET count = rate_windows.count + 1`,
        [caller, start],
      );
      return { allowed: true, retryAfterSeconds: 0 };
    });
  } catch {
    throw new ApiErrorSignal(apiError({ status: 503, code: 'database_unavailable', message: ownerRefusalForApi('database_unavailable') }));
  }
}

async function readReferenceLock(desk: Desk, reference: string): Promise<number | null> {
  const res = await desk.store.query<{ wrong_count: number; locked_until: Date | null }>(
    'SELECT wrong_count, locked_until FROM reference_locks WHERE reference = $1', [reference],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.locked_until === null) return null;
  if (row.locked_until.getTime() <= desk.now()) {
    // The lock has ended: the count starts again.
    await desk.store.query('DELETE FROM reference_locks WHERE reference = $1', [reference]);
    return null;
  }
  return row.locked_until.getTime();
}

async function countWrongTry(desk: Desk, reference: string): Promise<void> {
  const lockSeconds = desk.config.referenceLockSeconds;
  await desk.store.withRecords(async (client) => {
    const res = await client.query<{ wrong_count: number }>(
      'SELECT wrong_count FROM reference_locks WHERE reference = $1', [reference],
    );
    const current = res.rows[0]?.wrong_count ?? 0;
    const next = current + 1;
    if (next >= 5) {
      const until = new Date(desk.now() + lockSeconds * 1000);
      await client.query(
        `INSERT INTO reference_locks (reference, wrong_count, locked_until) VALUES ($1, $2, $3)
         ON CONFLICT (reference) DO UPDATE SET wrong_count = $2, locked_until = $3`,
        [reference, next, until],
      );
    } else {
      await client.query(
        `INSERT INTO reference_locks (reference, wrong_count) VALUES ($1, $2)
         ON CONFLICT (reference) DO UPDATE SET wrong_count = $2`,
        [reference, next],
      );
    }
  });
}

async function resetWrongTries(desk: Desk, reference: string): Promise<void> {
  await desk.store.query('DELETE FROM reference_locks WHERE reference = $1', [reference]);
}

export async function shareView(desk: Desk, claim: import('../store.js').ClaimRow): Promise<Record<string, unknown>> {
  const model = claim.modelSlug ? await desk.store.getModel(claim.modelSlug) : null;
  const part = claim.modelSlug && claim.bookletNumber !== null
    ? await desk.store.getPart(claim.modelSlug, claim.bookletNumber)
    : null;
  const ruling = await desk.store.getRuling(claim.reference);
  const quote = await desk.store.getCurrentQuote(claim.reference);
  const payment = await desk.store.getPayment(claim.reference);
  const decline = await desk.store.getDecline(claim.reference);
  const history = await desk.store.getHistory(claim.reference);
  return {
    reference: claim.reference,
    state: claim.state,
    language: claim.language,
    model: model ? { name: model.name } : null,
    part: part ? {
      booklet_number: part.bookletNumber,
      part_number: part.partNumber,
      name: part.name,
    } : null,
    quantity: claim.quantity,
    purchase_date: claim.purchaseDate,
    ruling: ruling ? {
      inside: ruling.inside,
      edition: ruling.editionCode,
      cover_ends_at: ruling.coverEndsAt.toISOString(),
      cover_ends_on: ruling.coverEndsOn,
    } : null,
    quote: quote ? {
      revision: quote.revision,
      part_line_minor: quote.partLineMinor,
      carriage_minor: quote.carriageMinor,
      total_minor: quote.totalMinor,
      band: quote.band,
      promise: { kind: quote.promiseKind, date: quote.promiseDate },
    } : null,
    paid_minor: payment ? payment.paidMinor : null,
    decline: decline ? {
      reason: decline.reason,
      charged_minor: decline.chargedMinor,
      refunded_minor: decline.refundedMinor,
    } : null,
    dispatched_at: claim.dispatchedAt ? claim.dispatchedAt.toISOString() : null,
    history: history.map((h) => ({ state: h.state, at: h.at.toISOString() })),
  };
}

async function handleClaimStart(ctx: Ctx, desk: Desk): Promise<void> {
  // Multipart form parsing, done by hand so we can enforce the byte limits.
  const contentType = ctx.req.headers['content-type'] ?? '';
  const m = /boundary=(?:"([^"]+)"|([^\s;]+))/.exec(contentType);
  if (!m) {
    throwApi(apiError({ status: 415, code: 'unsupported_media_type', message: 'Send the claim as multipart form data.' }));
  }
  const boundary = `--${m[1] ?? m[2]}`;
  const fields: Record<string, string> = {};
  const photos: Array<{ name: string; bytes: Buffer }> = [];
  const body = ctx.rawBody;

  let idx = body.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    let part = body.subarray(start, next);
    // Trim leading CRLF and trailing CRLF.
    if (part[0] === 13 && part[1] === 10) part = part.subarray(2);
    if (part[part.length - 2] === 13 && part[part.length - 1] === 10) part = part.subarray(0, part.length - 2);
    if (part.length === 0 || (part[0] === 45 && part[1] === 45)) { idx = next; continue; }
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) { idx = next; continue; }
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const content = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const name = nameMatch?.[1] ?? '';
    if (fileMatch !== null) {
      if (content.length > 0) photos.push({ name: fileMatch[1] ?? '', bytes: Buffer.from(content) });
    } else if (name !== '') {
      fields[name] = content.toString('utf8');
    }
    idx = next;
  }

  const claimStart = validateClaimStart(fields, photos, desk);
  if (claimStart.errors !== null) {
    throwApi(claimStart.errors);
  }
  const data = claimStart.data;

  // A withdrawn part can no longer be claimed; the answer comes before any
  // storage, mail or carrier call.
  if (data.model !== '' && data.bookletNumber !== null) {
    const model = await desk.store.getModel(data.model);
    const part = model !== null ? await desk.store.getPart(data.model, data.bookletNumber) : null;
    if (model === null || part === null) {
      throwApi(apiError({ status: 404, code: 'not_found', message: 'Choose the broken or missing part.' }));
    }
    if (part.status === 'withdrawn') {
      throwApi(apiError({
        status: 409, code: 'part_withdrawn',
        message: ownerRefusalForApi('part_withdrawn', { number: String(part.bookletNumber) }),
      }));
    }
  }

  // All-or-nothing claim start.
  const reference = newReference();
  const confirmToken = newToken();
  const confirmBy = new Date(desk.now() + desk.config.confirmLinkTtlSeconds * 1000);
  const language = fields['language'] === 'pl-PL' ? 'pl-PL' : 'en-GB';

  // Mail must accept the confirmation email before anything is stored.
  try {
    await desk.mail.ping();
  } catch {
    throwApi(apiError({ status: 503, code: 'mail_unavailable', message: ownerRefusalForApi('mail_unavailable') }));
  }

  const stmts = async (client: import('pg').PoolClient) => {
    const clubJoined = data.email ? await desk.store.getClubJoinDate(data.email) : null;
    const clubMember = clubJoined !== null && data.purchaseDate !== null && clubJoined < data.purchaseDate;
    await client.query(
      `INSERT INTO claims (reference, state, owner_name, owner_email, owner_postcode, postcode_area,
        purchase_date, club_member, model_slug, booklet_number, quantity, description, language,
        confirm_token, confirm_by, created_at)
       VALUES ($1,'started',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        reference, data.name, data.email, data.postcode, data.postcodeArea,
        data.purchaseDate, clubMember, data.model, data.bookletNumber, data.quantity,
        data.description, language, confirmToken, confirmBy, new Date(desk.now()),
      ],
    );
    await client.query(
      'INSERT INTO claim_history (reference, state, at) VALUES ($1, $2, $3)',
      [reference, 'started', new Date(desk.now())],
    );
    const photoRows: Array<{ index: number; content_type: string; bytes: number }> = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]!;
      const verdict = judgePhoto(photo.bytes);
      if (!verdict.ok) continue;
      photoRows.push({ index: i + 1, content_type: verdict.contentType, bytes: photo.bytes.length });
    }
    return photoRows;
  };

  let storedPhotoRows: Array<{ index: number; content_type: string; bytes: number }> = [];
  const uploadedKeys: string[] = [];
  let claimStored = false;
  try {
    // Photos go to MinIO first; on any later failure everything is removed.
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]!;
      const verdict = judgePhoto(photo.bytes);
      if (!verdict.ok) continue;
      await desk.storage.putPhoto(reference, i + 1, photo.bytes, verdict.contentType);
      uploadedKeys.push(`claims/${reference}/photos/${i + 1}`);
    }
    storedPhotoRows = await desk.store.withRecords(stmts);
    claimStored = true;
    // Record photo metadata.
    for (const row of storedPhotoRows) {
      await desk.store.query(
        'INSERT INTO claim_photos (reference, index, content_type, bytes) VALUES ($1,$2,$3,$4)',
        [reference, row.index, row.content_type, row.bytes],
      );
    }
    // Send the confirmation email.
    await desk.mail.send({
      to: data.email,
      subject: language === 'pl-PL'
        ? `Potwierdź zgłoszenie Holmgarth ${reference}`
        : `Confirm your Holmgarth claim ${reference}`,
      text:
        `Open this link to confirm your claim:\n${desk.config.appPublicUrl}/confirm/${confirmToken}\n\n` +
        linkLifetimeLine(confirmBy.getTime(), language) + '\n',
    });
  } catch (e) {
    // Nothing was saved: remove every object already written.
    for (const key of uploadedKeys) {
      try { await desk.storage.deleteObject(key); } catch { /* best effort */ }
    }
    if (claimStored) {
      try { await desk.store.query('DELETE FROM claims WHERE reference = $1', [reference]); } catch { /* best effort */ }
      try { await desk.store.query('DELETE FROM claim_history WHERE reference = $1', [reference]); } catch { /* best effort */ }
      try { await desk.store.query('DELETE FROM claim_photos WHERE reference = $1', [reference]); } catch { /* best effort */ }
    }
    const err = e as { name?: string };
    if (err.name === 'ApiErrorSignal') {
      throwApi((e as ApiErrorSignal).error);
    }
    if (err.name === 'StorageUnavailable') {
      throwApi(apiError({ status: 503, code: 'storage_unavailable', message: ownerRefusalForApi('storage_unavailable') }));
    }
    if (err.name === 'MailUnavailable') {
      throwApi(apiError({ status: 503, code: 'mail_unavailable', message: ownerRefusalForApi('mail_unavailable') }));
    }
    throwApi(apiError({ status: 503, code: 'database_unavailable', message: ownerRefusalForApi('database_unavailable') }));
  }

  json(ctx.res, 201, { reference, state: 'started', confirm_by: confirmBy.toISOString() });
}

function validateClaimStart(
  fields: Record<string, string>,
  photos: ReadonlyArray<{ name: string; bytes: Buffer }>,
  desk: Desk,
): { data: ClaimStartData; errors: ApiError | null } {
  const errors: Record<string, string> = {};
  const name = (fields['name'] ?? '').trim();
  const email = (fields['email'] ?? '').trim();
  const postcodeRaw = (fields['postcode'] ?? '').trim();
  const model = (fields['model'] ?? '').trim();
  const bookletRaw = (fields['booklet_number'] ?? '').trim();
  const quantityRaw = (fields['quantity'] ?? '').trim();
  const purchaseDate = (fields['purchase_date'] ?? '').trim();
  const description = fields['description'] ?? '';
  const language = fields['language'] ?? '';

  if (name === '') errors['name'] = 'required';
  else if (name.length > 120) errors['name'] = 'too_long';
  if (email === '') errors['email'] = 'required';
  else if (!EMAIL_RE.test(email)) errors['email'] = 'invalid';
  const pc = parseUkPostcode(postcodeRaw);
  if (postcodeRaw === '') errors['postcode'] = 'required';
  else if (!pc.valid) errors['postcode'] = 'invalid';

  // Model and booklet are looked up before other validation.
  let bookletNumber: number | null = null;
  if (model === '') errors['model'] = 'required';
  const bookletNum = Number(bookletRaw);
  if (bookletRaw === '') errors['booklet_number'] = 'required';
  else if (!Number.isInteger(bookletNum) || bookletNum < 1 || bookletNum > 99) errors['booklet_number'] = 'invalid';
  else bookletNumber = bookletNum;

  // quantity
  let quantity: number | null = null;
  const quantityNum = Number(quantityRaw);
  if (quantityRaw === '') errors['quantity'] = 'required';
  else if (!Number.isInteger(quantityNum) || quantityNum < 1 || quantityNum > 20) errors['quantity'] = 'invalid';
  else quantity = quantityNum;

  // purchase date
  if (purchaseDate === '') errors['purchase_date'] = 'required';
  else if (!isRealDate(purchaseDate)) errors['purchase_date'] = 'invalid';
  else if (purchaseDate > londonDateOf(desk.now())) errors['purchase_date'] = 'in_future';

  if (description.length > 1000) errors['description'] = 'too_long';
  if (language !== 'en-GB' && language !== 'pl-PL') errors['language'] = 'invalid';

  if (photos.length < 1 || photos.length > 4) errors['photos'] = 'count';
  photos.forEach((photo, i) => {
    const verdict = judgePhoto(photo.bytes);
    if (!verdict.ok) errors[`photos.${i + 1}`] = verdict.code;
  });

  if (Object.keys(errors).length === 0 && model !== '' && bookletNumber !== null && quantity !== null) {
    // Well-formed slug and booklet number not in the catalogue answer 404.
    // The model slug must exist and hold the booklet number.
    return {
      data: {
        name, email, postcode: postcodeRaw, postcodeArea: pc.area, model,
        bookletNumber, quantity, purchaseDate, description,
        language: language === 'pl-PL' ? 'pl-PL' : 'en-GB',
        photos,
      },
      errors: null,
    };
  }
  return {
    data: {
      name, email, postcode: postcodeRaw, postcodeArea: pc.valid ? pc.area : '',
      model, bookletNumber: bookletNumber ?? 1, quantity: quantity ?? 1, purchaseDate, description,
      language: language === 'pl-PL' ? 'pl-PL' : 'en-GB',
      photos,
    },
    errors: apiError({ status: 422, code: 'validation_failed', message: 'Some fields need attention.', fields: errors }),
  };
}

interface ClaimStartData {
  name: string;
  email: string;
  postcode: string;
  postcodeArea: string;
  model: string;
  bookletNumber: number;
  quantity: number;
  purchaseDate: string;
  description: string;
  language: 'en-GB' | 'pl-PL';
  photos: ReadonlyArray<{ name: string; bytes: Buffer }>;
}

