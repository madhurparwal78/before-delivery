import { ApiError, validationError } from '../domain/errors.js';
import { today } from '../domain/clock.js';
import { compareDates, dateFromBatchStamp } from '../domain/dates.js';
import { latestVersion, type PriceBook } from '../domain/price.js';
import { sentences } from '../domain/sentences.js';
import { databaseAvailable, ping, query } from '../db/pool.js';
import { loadPriceBook } from '../db/queries.js';
import { copyId } from '../identity.js';
import { searchDown, searchSkuCodes } from '../services/search.js';
import { noticePdfKey, signedGetUrl, storageDown } from '../services/storage.js';
import { searchBehind } from '../services/outbox.js';
import { countLookup } from './guards.js';
import { route, type Ctx, type Reply } from './server.js';
import { catalogueSkuView, noticeView, noticeVersionView, packFactsView, skuView, unitSalePriceOf } from './views.js';

const BATCH_CODE = /^[A-Z]{2,12}-\d{6}-\d{1,4}$/;
const BATCH_SHAPED = /^[A-Za-z]+-\d{6}-\d{1,4}$/;
const NOTICE_SHAPED = /^[A-Za-z]+-\d+-\d+$/;
const SKU_SHAPED = /^[A-Za-z]+-\d+-[A-Za-z]+$/;

function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function batchCodeIsWellFormed(code: string): boolean {
  if (code.length > 24 || !BATCH_CODE.test(code)) return false;
  return dateFromBatchStamp(code.split('-')[1]) !== null;
}

async function searchState(): Promise<'current' | 'behind' | 'down'> {
  if (searchDown()) return 'down';
  return (await searchBehind()) ? 'behind' : 'current';
}

function noticesNewestFirst(book: PriceBook) {
  return [...book.world.notices].sort((a, b) => {
    const left = latestVersion(a).effectiveDate;
    const right = latestVersion(b).effectiveDate;
    if (left !== right) return compareDates(right, left);
    return a.number < b.number ? 1 : -1;
  });
}

export function registerPublicRoutes(): void {
  route('GET', '/api/health', async (): Promise<Reply> => {
    const ok = databaseAvailable() ? true : await ping();
    return ok ? { status: 200, body: { status: 'ok' } } : { status: 503, body: { status: 'unavailable' } };
  });

  route('GET', '/api/catalogue', async (): Promise<Reply> => {
    const book = await loadPriceBook();
    const todayDate = today();
    return {
      status: 200,
      body: {
        today: todayDate,
        counts: book.counts(todayDate),
        drinks: book.drinks().map((drink) => ({
          id: drink.id,
          name: drink.name,
          carbonated: drink.carbonated,
          skus: book
            .skus()
            .filter((sku) => sku.drinkId === drink.id)
            .map((sku) => catalogueSkuView(book, sku, todayDate)),
        })),
      },
    };
  });

  route('GET', '/api/skus/:code', async (ctx: Ctx): Promise<Reply> => {
    const book = await loadPriceBook();
    const todayDate = today();
    const sku = book.sku(normaliseCode(ctx.params.code));
    if (sku === null) throw new ApiError(404, 'not_found', sentences.unknownPack);
    const storyBatch = book.storyBatch(sku.code, todayDate);
    const base = skuView(book, sku, todayDate);
    return {
      status: 200,
      body: {
        ...base,
        currentSource: book.currentSource(sku.code, todayDate),
        unitSalePrice: unitSalePriceOf(book.currentMrpPaise(sku.code, todayDate), sku.sizeMl),
        storyBatch: storyBatch === null ? null : packFactsView(book.decide(storyBatch, todayDate)),
      },
    };
  });

  route('GET', '/api/batches/:code', async (ctx: Ctx): Promise<Reply> => {
    countLookup(ctx);
    const code = normaliseCode(ctx.params.code);
    if (!batchCodeIsWellFormed(code)) {
      throw new ApiError(422, 'unknown_batch', sentences.unknownBatch);
    }
    const book = await loadPriceBook();
    const batch = book.batch(code);
    if (batch === null) throw new ApiError(404, 'unknown_batch', sentences.unknownBatch);
    return { status: 200, body: packFactsView(book.decide(batch, today())) };
  });

  route('GET', '/api/search', async (ctx: Ctx): Promise<Reply> => {
    const raw = ctx.query.get('q') ?? '';
    if (raw.length > 80) {
      throw validationError({ q: 'A query of at most 80 characters is allowed.' });
    }
    const queryText = raw.trim();
    if (BATCH_SHAPED.test(queryText)) countLookup(ctx);
    const state = await searchState();
    if (queryText === '') {
      return { status: 200, body: { query: raw, searchState: state, results: [] } };
    }
    const book = await loadPriceBook();
    const todayDate = today();
    const results: Record<string, unknown>[] = [];

    const skuResult = (skuCode: string): Record<string, unknown> | null => {
      const sku = book.sku(skuCode);
      if (sku === null) return null;
      return {
        kind: 'sku',
        skuCode: sku.code,
        name: book.skuNameOf(sku),
        batchCode: null,
        retailPricePaise: book.currentMrpPaise(sku.code, todayDate),
        sourceNotice: book.currentSource(sku.code, todayDate),
      };
    };

    if (BATCH_SHAPED.test(queryText)) {
      const batch = book.batch(queryText.toUpperCase());
      if (batch !== null) {
        const facts = book.decide(batch, todayDate);
        results.push({
          kind: 'batch',
          skuCode: facts.skuCode,
          name: facts.skuName,
          batchCode: facts.batchCode,
          retailPricePaise: facts.retailPricePaise,
          sourceNotice: facts.sourceNotice,
        });
      }
    } else if (SKU_SHAPED.test(queryText)) {
      const result = skuResult(queryText.toUpperCase());
      if (result !== null) results.push(result);
    } else if (NOTICE_SHAPED.test(queryText)) {
      const notice = book.world.notices.find(
        (entry) => entry.number.toUpperCase() === queryText.toUpperCase(),
      );
      if (notice !== undefined) {
        for (const row of latestVersion(notice).rows) {
          const result = skuResult(row.skuCode);
          if (result !== null) results.push(result);
        }
      }
    } else if (!searchDown()) {
      try {
        for (const skuCode of await searchSkuCodes(copyId(), queryText)) {
          const result = skuResult(skuCode);
          if (result !== null) results.push(result);
        }
      } catch {
        return {
          status: 200,
          body: { query: raw, searchState: 'down', results: [] },
          headers: { 'cache-control': 'no-store' },
        };
      }
    }

    return {
      status: 200,
      body: { query: raw, searchState: await searchState(), results },
      headers: { 'cache-control': 'no-store' },
    };
  });

  route('GET', '/api/notices', async (): Promise<Reply> => {
    const book = await loadPriceBook();
    const todayDate = today();
    return {
      status: 200,
      body: {
        notices: noticesNewestFirst(book).map((notice) => {
          const view = noticeView(notice, todayDate);
          return {
            number: notice.number,
            state: view.state,
            currentVersion: noticeVersionView(notice, latestVersion(notice), todayDate),
          };
        }),
      },
    };
  });

  route('GET', '/api/notices/:number', async (ctx: Ctx): Promise<Reply> => {
    const book = await loadPriceBook();
    const notice = book.world.notices.find((entry) => entry.number === ctx.params.number);
    if (notice === undefined) throw new ApiError(404, 'not_found', 'That notice is not in the programme.');
    return { status: 200, body: noticeView(notice, today()) };
  });

  route('GET', '/api/notices/:number/versions/:version/link', async (ctx: Ctx): Promise<Reply> => {
    const { number, version, sha256 } = await printableVersion(ctx);
    const key = noticePdfKey(copyId(), number, version);
    return {
      status: 200,
      body: {
        url: signedGetUrl(key, {
          expiresInSeconds: 60,
          contentDisposition: `attachment; filename="interval-notice-${number}-v${version}.pdf"`,
          contentType: 'application/pdf',
        }),
        expiresInSeconds: 60,
        sha256,
      },
      headers: { 'cache-control': 'no-store' },
    };
  });

  route('GET', '/api/notices/:number/versions/:version/pdf', async (ctx: Ctx): Promise<Reply> => {
    const { number, version } = await printableVersion(ctx);
    const key = noticePdfKey(copyId(), number, version);
    return {
      status: 302,
      location: signedGetUrl(key, {
        expiresInSeconds: 60,
        contentDisposition: `attachment; filename="interval-notice-${number}-v${version}.pdf"`,
        contentType: 'application/pdf',
      }),
      headers: { 'cache-control': 'no-store' },
    };
  });
}

async function printableVersion(ctx: Ctx): Promise<{ number: string; version: number; sha256: string }> {
  const number = ctx.params.number;
  const version = Number(ctx.params.version);
  const result = await query<{ print_state: string; pdf_sha256: string | null }>(
    `select v.print_state, v.pdf_sha256 from notice_versions v
       join notices n on n.id = v.notice_id
      where n.number = $1 and v.version = $2`,
    [number, Number.isInteger(version) ? version : -1],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, 'not_found', 'That notice version is not in the programme.');
  if (row.print_state === 'pending') {
    throw new ApiError(409, 'print_pending', 'This notice is still being printed.');
  }
  if (row.print_state === 'failed') {
    throw new ApiError(503, 'print_unavailable', sentences.printOutage);
  }
  if (storageDown()) {
    throw new ApiError(503, 'storage_unavailable', sentences.storageOutage);
  }
  return { number, version, sha256: row.pdf_sha256 ?? '' };
}
