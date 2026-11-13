import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError, validationError } from '../domain/errors.js';
import { today } from '../domain/clock.js';
import { compareDates, dateFromBatchStamp, isValidIsoDate, yearOf } from '../domain/dates.js';
import { latestVersion, type PriceBook, type PublishedVersion } from '../domain/price.js';
import {
  parseNoticeInput,
  previewRows,
  runPublishChecks,
  type Proposal,
  type ProposalRow,
} from '../domain/rules.js';
import { sentences } from '../domain/sentences.js';
import { isUniqueViolation, query, withTransaction } from '../db/pool.js';
import { loadHeldWork, loadPriceBook } from '../db/queries.js';
import { allLiveEndpoints, insertDelivery, loadVersion, skuHistory } from '../db/repo.js';
import { copyId } from '../identity.js';
import { brokerDown } from '../services/broker.js';
import { enqueue, enqueueIndex, renderJob, searchBehind, sendJob } from '../services/outbox.js';
import { searchDown } from '../services/search.js';
import { svixDown } from '../services/svix.js';
import { draftView, loadDraft, openDrafts, writeDraftRows, type DraftRecord } from './draftStore.js';
import { requireRole } from './guards.js';
import { jsonBody, requireBodySize, route, type Ctx, type Reply } from './server.js';
import { catalogueSkuView, noticeView, noticeVersionView, packFactsView } from './views.js';

const PUBLISH_LOCK = 'interval:publish';
const BATCH_CODE = /^[A-Z]{2,12}-\d{6}-\d{1,4}$/;

async function takePublishLock(client: PoolClient): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [PUBLISH_LOCK]);
}

function noticePdfPath(number: string, version: number): string {
  return `/api/notices/${number}/versions/${version}/pdf`;
}

/** Writes one notice version, its work and one delivery per endpoint live now. */
async function writeVersion(
  client: PoolClient,
  book: PriceBook,
  input: {
    noticeId: string;
    number: string;
    version: number;
    title: string;
    effectiveDate: string;
    runOutUntil: string | null;
    reason: string | null;
    sheetId: string | null;
    rows: ProposalRow[];
    supersedesVersion: number | null;
  },
): Promise<void> {
  await client.query(
    `insert into notice_versions
       (notice_id, version, title, effective_date, run_out_until, published_at, reason, print_state, sheet_id)
     values ($1, $2, $3, $4, $5, now(), $6, 'pending', $7)`,
    [input.noticeId, input.version, input.title, input.effectiveDate, input.runOutUntil, input.reason, input.sheetId],
  );
  const publishedRows: { skuCode: string; name: string; kind: string; oldMrpPaise: number; revisedMrpPaise: number }[] =
    [];
  for (const [position, row] of input.rows.entries()) {
    const sku = book.sku(row.skuCode);
    const name = sku === null ? row.skuCode : book.skuNameOf(sku);
    const oldMrpPaise = book.oldMrpPaiseFor(row.skuCode, input.effectiveDate, input.number);
    await client.query(
      `insert into notice_rows
         (notice_id, version, position, sku_code, name, kind, old_mrp_paise, revised_mrp_paise, old_rate, new_rate)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.noticeId,
        input.version,
        position,
        row.skuCode,
        name,
        row.kind,
        oldMrpPaise,
        row.revisedMrpPaise,
        row.oldRate,
        row.newRate,
      ],
    );
    publishedRows.push({
      skuCode: row.skuCode,
      name,
      kind: row.kind,
      oldMrpPaise,
      revisedMrpPaise: row.revisedMrpPaise,
    });
  }

  await enqueue(client, renderJob(input.number, input.version));
  await enqueueIndex(client, input.rows.map((row) => row.skuCode));

  const eventType = input.version === 1 ? 'notice.published' : 'notice.corrected';
  for (const endpoint of await allLiveEndpoints(client)) {
    const eventId = `${input.number}-v${input.version}-${endpoint.id}`;
    await insertDelivery(client, {
      eventId,
      accountId: endpoint.accountId,
      endpointId: endpoint.id,
      eventType,
      noticeNumber: input.number,
      noticeVersion: input.version,
      payload: {
        eventType,
        eventId,
        noticeNumber: input.number,
        version: input.version,
        supersedesVersion: input.supersedesVersion,
        effectiveDate: input.effectiveDate,
        title: input.title,
        rows: publishedRows,
        pdfPath: noticePdfPath(input.number, input.version),
      },
    });
    await enqueue(client, sendJob(eventId));
  }
}

async function nextNoticeNumber(client: PoolClient, year: number): Promise<{ number: string; sequence: number }> {
  const result = await client.query<{ last_sequence: number }>(
    `insert into notice_sequence (year, last_sequence) values ($1, 1)
     on conflict (year) do update set last_sequence = notice_sequence.last_sequence + 1
     returning last_sequence`,
    [year],
  );
  const sequence = result.rows[0].last_sequence;
  return { number: `VT-${year}-${String(sequence).padStart(2, '0')}`, sequence };
}

function readBaseRevision(body: Record<string, unknown>, draft: DraftRecord): void {
  const given = body.baseRevision;
  if (typeof given !== 'number' || !Number.isInteger(given)) {
    throw validationError({ baseRevision: 'The revision this draft was loaded at is needed.' });
  }
  if (given !== draft.revision) {
    throw new ApiError(409, 'stale_draft', sentences.staleDraft);
  }
}

function proposalFromDraft(draft: DraftRecord): Proposal {
  return {
    noticeNumber: null,
    baseVersion: null,
    title: draft.title,
    effectiveDate: draft.effectiveDate,
    runOutUntil: draft.runOutUntil,
    rows: draft.rows,
  };
}

function previewBody(book: PriceBook, proposal: Proposal, isCorrection: boolean): Record<string, unknown> {
  const blocking = runPublishChecks(book, proposal, today(), isCorrection);
  return {
    blocking: blocking === null ? null : blocking.body(),
    rows: previewRows(book, proposal),
  };
}

function blockedPreview(error: ApiError): Record<string, unknown> {
  return { blocking: error.body(), rows: [] };
}

async function correctionProposal(
  client: PoolClient,
  book: PriceBook,
  number: string,
  body: Record<string, unknown>,
): Promise<{ proposal: Proposal; latest: PublishedVersion; reason: string }> {
  const notice = book.world.notices.find((entry) => entry.number === number);
  if (notice === undefined) throw new ApiError(404, 'not_found', 'That notice is not in the programme.');
  const latest = latestVersion(notice);
  if (body.baseVersion !== latest.version) {
    throw new ApiError(409, 'stale_version', 'That notice has a newer version.');
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason === '' || reason.length > 200) {
    throw validationError({ reason: 'A reason of 1 to 200 characters is needed.' });
  }
  const runOutUntil = body.runOutUntil === undefined ? latest.runOutUntil : body.runOutUntil;
  const parsed = parseNoticeInput(
    { title: latest.title, effectiveDate: body.effectiveDate, runOutUntil, rows: body.rows },
    { titleField: null },
  );
  if (
    compareDates(latest.effectiveDate, today()) <= 0 &&
    parsed.effectiveDate !== latest.effectiveDate
  ) {
    throw new ApiError(409, 'effective_date_locked', "An in-effect notice's date cannot change.");
  }
  return {
    proposal: {
      noticeNumber: number,
      baseVersion: latest,
      title: latest.title,
      effectiveDate: parsed.effectiveDate,
      runOutUntil: parsed.runOutUntil,
      rows: parsed.rows,
    },
    latest,
    reason,
  };
}

export function registerEditorNoticeRoutes(): void {
  route('GET', '/api/editor/notices', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    const book = await loadPriceBook();
    const todayDate = today();
    const drafts = await openDrafts();
    const notices = [...book.world.notices].sort((a, b) =>
      compareDates(latestVersion(b).effectiveDate, latestVersion(a).effectiveDate),
    );
    return {
      status: 200,
      body: {
        copyId: copyId(),
        messagesQueued: svixDown(),
        workQueued: brokerDown(),
        searchState: searchDown() ? 'down' : (await searchBehind()) ? 'behind' : 'current',
        heldWork: await loadHeldWork(),
        counts: book.counts(todayDate),
        drafts: drafts.map((draft) => draftView(book, draft)),
        notices: notices.map((notice) => noticeView(notice, todayDate)),
      },
      headers: { 'cache-control': 'no-store' },
    };
  });

  route('POST', '/api/editor/notices', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const parsed = parseNoticeInput(body, { titleField: 'title' });
    return withTransaction(async (client) => {
      const id = randomUUID();
      await client.query(
        'insert into drafts (id, revision, title, effective_date, run_out_until, sheet_id) values ($1, 1, $2, $3, $4, null)',
        [id, parsed.title, parsed.effectiveDate, parsed.runOutUntil],
      );
      await writeDraftRows(client, id, parsed.rows);
      const draft = await loadDraft(id, client);
      const book = await loadPriceBook(client);
      return { status: 201, body: draftView(book, draft as DraftRecord) };
    });
  });

  route('PUT', '/api/editor/notices/:id', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    return withTransaction(async (client) => {
      const draft = await loadDraft(ctx.params.id, client, true);
      if (draft === null) throw new ApiError(404, 'not_found', 'That draft is not on file.');
      if (draft.published) throw new ApiError(409, 'not_draft', 'That notice is already published.');
      readBaseRevision(body, draft);
      const parsed = parseNoticeInput(body, { titleField: 'title' });
      await client.query(
        'update drafts set revision = revision + 1, title = $2, effective_date = $3, run_out_until = $4 where id = $1',
        [draft.id, parsed.title, parsed.effectiveDate, parsed.runOutUntil],
      );
      await writeDraftRows(client, draft.id, parsed.rows);
      const saved = await loadDraft(draft.id, client);
      const book = await loadPriceBook(client);
      return { status: 200, body: draftView(book, saved as DraftRecord) };
    });
  });

  route('POST', '/api/editor/notices/:id/preview', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const draft = await loadDraft(ctx.params.id);
    if (draft === null) throw new ApiError(404, 'not_found', 'That draft is not on file.');
    const book = await loadPriceBook();
    try {
      if (draft.published) throw new ApiError(409, 'not_draft', 'That notice is already published.');
      readBaseRevision(body, draft);
      const parsed = parseNoticeInput(body, { titleField: 'title' });
      return {
        status: 200,
        body: previewBody(
          book,
          { noticeNumber: null, baseVersion: null, ...parsed },
          false,
        ),
        headers: { 'cache-control': 'no-store' },
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return { status: 200, body: blockedPreview(error), headers: { 'cache-control': 'no-store' } };
      }
      throw error;
    }
  });

  route('POST', '/api/editor/notices/:id/publish', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    return withTransaction(async (client) => {
      await takePublishLock(client);
      const draft = await loadDraft(ctx.params.id, client, true);
      if (draft === null) throw new ApiError(404, 'not_found', 'That draft is not on file.');
      if (draft.published) throw new ApiError(409, 'not_draft', 'That notice is already published.');
      readBaseRevision(body, draft);
      const book = await loadPriceBook(client);
      const todayDate = today();
      const proposal = proposalFromDraft(draft);
      const refusal = runPublishChecks(book, proposal, todayDate, false);
      if (refusal !== null) throw refusal;

      const noticeId = randomUUID();
      const year = yearOf(todayDate);
      const { number, sequence } = await nextNoticeNumber(client, year);
      await client.query('insert into notices (id, number, year, sequence) values ($1, $2, $3, $4)', [
        noticeId,
        number,
        year,
        sequence,
      ]);
      await writeVersion(client, book, {
        noticeId,
        number,
        version: 1,
        title: draft.title,
        effectiveDate: draft.effectiveDate,
        runOutUntil: draft.runOutUntil,
        reason: null,
        sheetId: draft.sheetId,
        rows: draft.rows,
        supersedesVersion: null,
      });
      await client.query('update drafts set published = true where id = $1', [draft.id]);
      const written = await loadVersion(number, 1, client);
      const fresh = await loadPriceBook(client);
      const notice = fresh.world.notices.find((entry) => entry.number === number);
      return {
        status: 200,
        body: {
          number,
          version: noticeVersionView(
            notice as NonNullable<typeof notice>,
            written as PublishedVersion,
            todayDate,
          ),
        },
      };
    });
  });

  route('POST', '/api/editor/notices/:number/corrections/preview', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const book = await loadPriceBook();
    if (book.world.notices.every((entry) => entry.number !== ctx.params.number)) {
      throw new ApiError(404, 'not_found', 'That notice is not in the programme.');
    }
    return withTransaction(async (client) => {
      try {
        const { proposal } = await correctionProposal(client, book, ctx.params.number, body);
        return {
          status: 200,
          body: previewBody(book, proposal, true),
          headers: { 'cache-control': 'no-store' },
        };
      } catch (error) {
        if (error instanceof ApiError && error.status !== 404) {
          return { status: 200, body: blockedPreview(error), headers: { 'cache-control': 'no-store' } };
        }
        throw error;
      }
    });
  });

  route('POST', '/api/editor/notices/:number/corrections', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    return withTransaction(async (client) => {
      await takePublishLock(client);
      const book = await loadPriceBook(client);
      const { proposal, latest, reason } = await correctionProposal(client, book, ctx.params.number, body);
      const todayDate = today();
      const refusal = runPublishChecks(book, proposal, todayDate, true);
      if (refusal !== null) throw refusal;
      const version = latest.version + 1;
      await writeVersion(client, book, {
        noticeId: latest.noticeId,
        number: latest.number,
        version,
        title: latest.title,
        effectiveDate: proposal.effectiveDate,
        runOutUntil: proposal.runOutUntil,
        reason,
        sheetId: null,
        rows: proposal.rows,
        supersedesVersion: latest.version,
      });
      await enqueueIndex(client, [
        ...latest.rows.map((row) => row.skuCode),
        ...proposal.rows.map((row) => row.skuCode),
      ]);
      const written = await loadVersion(latest.number, version, client);
      const fresh = await loadPriceBook(client);
      const notice = fresh.world.notices.find((entry) => entry.number === latest.number);
      return {
        status: 201,
        body: {
          number: latest.number,
          version: noticeVersionView(
            notice as NonNullable<typeof notice>,
            written as PublishedVersion,
            todayDate,
          ),
        },
      };
    });
  });

  route('POST', '/api/editor/notices/:number/versions/:version/print', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    return withTransaction(async (client) => {
      const version = Number(ctx.params.version);
      const record = await loadVersion(ctx.params.number, Number.isInteger(version) ? version : -1, client);
      if (record === null) throw new ApiError(404, 'not_found', 'That notice version is not in the programme.');
      if (record.printState !== 'failed') {
        throw new ApiError(409, 'print_not_failed', 'That version is not waiting for a new print.');
      }
      await client.query(
        "update notice_versions set print_state = 'pending' where notice_id = $1 and version = $2",
        [record.noticeId, version],
      );
      await enqueue(client, renderJob(record.number, version));
      return { status: 202, body: { printState: 'pending' } };
    });
  });

  route('PATCH', '/api/editor/drinks/:id', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '' || name.length > 80) {
      throw validationError({ name: 'A name of 1 to 80 characters is needed.' });
    }
    return withTransaction(async (client) => {
      const found = await client.query<{ id: string; name: string }>(
        'select id, name from drinks where id = $1 for update',
        [ctx.params.id],
      );
      const drink = found.rows[0];
      if (!drink) throw new ApiError(404, 'not_found', 'That drink is not in the programme.');
      const clash = await client.query(
        'select 1 from drinks where lower(name) = lower($1) and id <> $2',
        [name, drink.id],
      );
      if (clash.rowCount && clash.rowCount > 0) {
        throw new ApiError(409, 'name_taken', 'Another drink already has that name.');
      }
      try {
        await client.query('update drinks set name = $2 where id = $1', [drink.id, name]);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(409, 'name_taken', 'Another drink already has that name.');
        }
        throw error;
      }
      const skus = await client.query<{ code: string }>('select code from skus where drink_id = $1', [drink.id]);
      for (const sku of skus.rows) {
        await client.query(
          'insert into sku_history (sku_code, at, field, from_value, to_value) values ($1, now(), $2, $3, $4)',
          [sku.code, 'drink_name', drink.name, name],
        );
      }
      await enqueueIndex(client, skus.rows.map((sku) => sku.code));
      const book = await loadPriceBook(client);
      const todayDate = today();
      const renamed = book.drink(drink.id);
      return {
        status: 200,
        body: {
          id: renamed.id,
          name: renamed.name,
          carbonated: renamed.carbonated,
          skus: book
            .skus()
            .filter((sku) => sku.drinkId === renamed.id)
            .map((sku) => catalogueSkuView(book, sku, todayDate)),
        },
      };
    });
  });

  route('PATCH', '/api/editor/skus/:code', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const variant = typeof body.variant === 'string' ? body.variant.trim() : '';
    if (variant === '' || variant.length > 80) {
      throw validationError({ variant: 'A pack wording of 1 to 80 characters is needed.' });
    }
    return withTransaction(async (client) => {
      const code = ctx.params.code.trim().toUpperCase();
      const found = await client.query<{ code: string; variant: string }>(
        'select code, variant from skus where code = $1 for update',
        [code],
      );
      const sku = found.rows[0];
      if (!sku) throw new ApiError(404, 'not_found', sentences.unknownPack);
      await client.query('update skus set variant = $2 where code = $1', [sku.code, variant]);
      await client.query(
        'insert into sku_history (sku_code, at, field, from_value, to_value) values ($1, now(), $2, $3, $4)',
        [sku.code, 'variant', sku.variant, variant],
      );
      await enqueueIndex(client, [sku.code]);
      const book = await loadPriceBook(client);
      const renamed = book.sku(sku.code);
      return {
        status: 200,
        body: catalogueSkuView(book, renamed as NonNullable<typeof renamed>, today()),
      };
    });
  });

  route('GET', '/api/editor/skus/:code/history', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    const code = ctx.params.code.trim().toUpperCase();
    const book = await loadPriceBook();
    if (book.sku(code) === null) throw new ApiError(404, 'not_found', sentences.unknownPack);
    return { status: 200, body: { history: await skuHistory(code) } };
  });

  route('POST', '/api/editor/batches', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const skuCode = typeof body.skuCode === 'string' ? body.skuCode.trim().toUpperCase() : '';
    const oldWrapper = body.oldWrapper === true;
    return withTransaction(async (client) => {
      await takePublishLock(client);
      const book = await loadPriceBook(client);
      if (book.sku(skuCode) === null) throw new ApiError(404, 'not_found', sentences.unknownPack);
      if (book.batch(code) !== null) {
        throw new ApiError(409, 'batch_exists', 'That batch code is already registered.');
      }
      const packedDate = code.length <= 24 && BATCH_CODE.test(code) ? dateFromBatchStamp(code.split('-')[1]) : null;
      const todayDate = today();
      if (packedDate === null || !isValidIsoDate(packedDate)) {
        throw validationError({ code: 'A batch code reads like NSK-260915-07.' });
      }
      if (compareDates(packedDate, todayDate) > 0) {
        throw validationError({ code: 'A batch cannot be packed after today.' });
      }
      if (oldWrapper) {
        const window = book.qualifyingWrapperNotice({ code, skuCode, packedDate, oldWrapper: true });
        if (window === null) {
          throw new ApiError(422, 'wrapper_window_closed', sentences.closedWrapperWindow);
        }
      }
      await client.query('insert into batches (code, sku_code, packed_date, old_wrapper) values ($1, $2, $3, $4)', [
        code,
        skuCode,
        packedDate,
        oldWrapper,
      ]);
      const fresh = await loadPriceBook(client);
      const batch = fresh.batch(code);
      return {
        status: 201,
        body: packFactsView(fresh.decide(batch as NonNullable<typeof batch>, todayDate)),
      };
    });
  });
}
