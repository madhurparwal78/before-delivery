import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { loadPriceBook } from '../db/queries.js';
import { stickerCeilingPaise } from '../domain/money.js';
import type { PriceBook, RowKind } from '../domain/price.js';
import { parseNoticeInput, type ProposalRow } from '../domain/rules.js';

type Runner = Pick<PoolClient, 'query'>;

function runner(client?: Runner): Runner {
  return client ?? (pool as unknown as Runner);
}

export interface DraftRecord {
  id: string;
  revision: number;
  title: string;
  effectiveDate: string;
  runOutUntil: string | null;
  sheetId: string | null;
  sheetSha256: string | null;
  rows: ProposalRow[];
  published: boolean;
}

interface DraftShape {
  id: string;
  revision: number;
  title: string;
  effective_date: string;
  run_out_until: string | null;
  sheet_id: string | null;
  sheet_sha256: string | null;
  published: boolean;
}

interface DraftRowShape {
  sku_code: string;
  kind: RowKind;
  revised_mrp_paise: number;
  old_rate: number | null;
  new_rate: number | null;
}

async function rowsOf(draftId: string, client?: Runner): Promise<ProposalRow[]> {
  const result = await runner(client).query<DraftRowShape>(
    'select * from draft_rows where draft_id = $1 order by position',
    [draftId],
  );
  return result.rows.map((row) => ({
    skuCode: row.sku_code,
    kind: row.kind,
    revisedMrpPaise: row.revised_mrp_paise,
    oldRate: row.old_rate,
    newRate: row.new_rate,
  }));
}

export async function loadDraft(id: string, client?: Runner, forUpdate = false): Promise<DraftRecord | null> {
  const result = await runner(client).query<DraftShape>(
    `select d.*, s.sha256 as sheet_sha256 from drafts d left join sheets s on s.id = d.sheet_id
      where d.id = $1${forUpdate ? ' for update of d' : ''}`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    revision: row.revision,
    title: row.title,
    effectiveDate: row.effective_date,
    runOutUntil: row.run_out_until,
    sheetId: row.sheet_id,
    sheetSha256: row.sheet_sha256,
    rows: await rowsOf(row.id, client),
    published: row.published,
  };
}

export async function openDrafts(client?: Runner): Promise<DraftRecord[]> {
  const result = await runner(client).query<{ id: string }>(
    'select id from drafts where published = false order by seq desc',
  );
  const drafts: DraftRecord[] = [];
  for (const row of result.rows) {
    const draft = await loadDraft(row.id, client);
    if (draft !== null) drafts.push(draft);
  }
  return drafts;
}

export function draftView(book: PriceBook, draft: DraftRecord): Record<string, unknown> {
  return {
    id: draft.id,
    state: 'draft',
    revision: draft.revision,
    title: draft.title,
    effectiveDate: draft.effectiveDate,
    runOutUntil: draft.runOutUntil,
    sheet: draft.sheetId === null ? null : { id: draft.sheetId, sha256: draft.sheetSha256 ?? '' },
    rows: draft.rows.map((row) => {
      const sku = book.sku(row.skuCode);
      const oldMrpPaise = book.oldMrpPaiseFor(row.skuCode, draft.effectiveDate, null);
      return {
        skuCode: row.skuCode,
        name: sku === null ? row.skuCode : book.skuNameOf(sku),
        kind: row.kind,
        oldMrpPaise,
        revisedMrpPaise: row.revisedMrpPaise,
        oldRate: row.oldRate,
        newRate: row.newRate,
        ceilingPaise:
          row.kind === 'sticker'
            ? stickerCeilingPaise(oldMrpPaise, row.oldRate as number, row.newRate as number)
            : null,
      };
    }),
  };
}

export async function writeDraftRows(
  client: PoolClient,
  draftId: string,
  rows: ProposalRow[],
): Promise<void> {
  await client.query('delete from draft_rows where draft_id = $1', [draftId]);
  for (const [position, row] of rows.entries()) {
    await client.query(
      `insert into draft_rows (draft_id, position, sku_code, kind, revised_mrp_paise, old_rate, new_rate)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [draftId, position, row.skuCode, row.kind, row.revisedMrpPaise, row.oldRate, row.newRate],
    );
  }
}

export async function createDraftFromRows(
  client: PoolClient,
  input: {
    title: unknown;
    effectiveDate: unknown;
    runOutUntil: unknown;
    rows: ProposalRow[];
    sheetId: string | null;
  },
): Promise<Record<string, unknown>> {
  const parsed = parseNoticeInput(
    {
      title: input.title,
      effectiveDate: input.effectiveDate,
      runOutUntil: input.runOutUntil,
      rows: input.rows,
    },
    { titleField: 'title' },
  );
  const id = randomUUID();
  await client.query(
    'insert into drafts (id, revision, title, effective_date, run_out_until, sheet_id) values ($1, 1, $2, $3, $4, $5)',
    [id, parsed.title, parsed.effectiveDate, parsed.runOutUntil, input.sheetId],
  );
  await writeDraftRows(client, id, parsed.rows);
  const draft = await loadDraft(id, client);
  const book = await loadPriceBook(client);
  return draftView(book, draft as DraftRecord);
}
