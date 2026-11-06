import { requireRole, requireSession } from '../auth.ts';
import { query, transact } from '../db/pool.ts';
import { FIELD_COPY } from '../../domain/copy.ts';
import { isCurrency, type Currency } from '../../domain/markets.ts';
import { copenhagenToday, formatInstant, parseDate } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { notFound } from '../http/errors.ts';
import { sendJson } from '../http/respond.ts';
import { integer, list, Problems, readString, record, text } from '../http/validate.ts';
import { newId } from '../services/crypto.ts';

interface ListRow {
  id: string;
  name: string;
  effective_date: string;
  created_at_ms: number;
}

interface PriceRow {
  price_list_id: string;
  style_number: string;
  currency: Currency;
  unit_price_minor: number;
}

export async function listPriceLists(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'finance_lead', 'merchandiser');
  const lists = await query<ListRow>(
    'select id, name, effective_date, created_at_ms from price_lists where workspace_id = $1 order by effective_date, created_at_ms',
    [session.workspaceId],
  );
  const prices =
    lists.length === 0
      ? []
      : await query<PriceRow>(
          'select * from price_list_prices where price_list_id = any($1) order by style_number, currency',
          [lists.map((entry) => entry.id)],
        );
  sendJson(ctx.response, 200, {
    items: lists.map((entry) => ({
      id: entry.id,
      name: entry.name,
      effectiveDate: entry.effective_date,
      prices: prices
        .filter((price) => price.price_list_id === entry.id)
        .map((price) => ({
          styleNumber: price.style_number,
          currency: price.currency,
          unitPriceMinor: Number(price.unit_price_minor),
        })),
      createdAt: formatInstant(Number(entry.created_at_ms)),
    })),
  });
}

export async function createPriceList(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'finance_lead');
  const body = ctx.json();
  const problems = new Problems();
  const name = text(problems, body, 'name', { max: 80 });
  const effectiveDate = text(problems, body, 'effectiveDate');
  if (effectiveDate !== '' && parseDate(effectiveDate) === null) {
    problems.add('effectiveDate', FIELD_COPY.date);
  } else if (effectiveDate !== '' && effectiveDate < copenhagenToday(ctx.nowMs)) {
    problems.add('effectiveDate', FIELD_COPY.priceListPast);
  }

  const entries = list(body, 'prices');
  if (entries.length === 0) problems.add('prices', FIELD_COPY.required);
  const prices: { styleNumber: string; currency: Currency; unitPriceMinor: number }[] = [];
  for (const [index, entry] of entries.entries()) {
    const row = record(entry);
    const styleNumber = text(problems, row, 'styleNumber', { max: 40 }, `prices.${index}.styleNumber`);
    const currency = readString(row, 'currency');
    if (!isCurrency(currency)) {
      problems.add(`prices.${index}.currency`, FIELD_COPY.required);
      continue;
    }
    const unitPriceMinor = integer(
      problems,
      row,
      'unitPriceMinor',
      1,
      100_000_000,
      `prices.${index}.unitPriceMinor`,
    );
    prices.push({ styleNumber, currency, unitPriceMinor });
  }
  problems.throwIfAny();

  const id = newId();
  await transact(async (tx) => {
    await tx.query(
      'insert into price_lists (id, workspace_id, name, effective_date, created_at_ms) values ($1,$2,$3,$4,$5)',
      [id, session.workspaceId, name, effectiveDate, ctx.nowMs],
    );
    for (const price of prices) {
      await tx.query(
        `insert into price_list_prices (price_list_id, style_number, currency, unit_price_minor)
         values ($1,$2,$3,$4)
         on conflict (price_list_id, style_number, currency) do update set unit_price_minor = excluded.unit_price_minor`,
        [id, price.styleNumber, price.currency, price.unitPriceMinor],
      );
    }
  });

  const lists = await query<ListRow>('select * from price_lists where id = $1', [id]);
  const created = lists[0];
  if (created === undefined) throw notFound();
  sendJson(ctx.response, 201, {
    id: created.id,
    name: created.name,
    effectiveDate: created.effective_date,
    prices,
    createdAt: formatInstant(Number(created.created_at_ms)),
  });
}
