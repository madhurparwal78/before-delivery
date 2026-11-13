import type { PoolClient } from 'pg';
import { pool } from './pool.js';
import {
  PriceBook,
  type BatchRecord,
  type DrinkRecord,
  type PackFormat,
  type PrintState,
  type PublishedNotice,
  type PublishedRow,
  type PublishedVersion,
  type RowKind,
  type SkuRecord,
} from '../domain/price.js';

type Runner = Pick<PoolClient, 'query'>;

function runner(client?: Runner): Runner {
  return client ?? (pool as unknown as Runner);
}

interface DrinkRowShape {
  id: string;
  name: string;
  carbonated: boolean;
  sugar_mg_per_100ml: number;
  position: number;
}

interface SkuRowShape {
  code: string;
  drink_id: string;
  variant: string;
  format: PackFormat;
  size_ml: number;
  shelf_days: number;
  launch_mrp_paise: number;
  position: number;
}

interface BatchRowShape {
  code: string;
  sku_code: string;
  packed_date: string;
  old_wrapper: boolean;
}

interface VersionRowShape {
  notice_id: string;
  number: string;
  year: number;
  sequence: number;
  version: number;
  title: string;
  effective_date: string;
  run_out_until: string | null;
  published_at: Date;
  reason: string | null;
  print_state: PrintState;
  pdf_sha256: string | null;
  sheet_id: string | null;
  sheet_sha256: string | null;
}

interface NoticeRowShape {
  notice_id: string;
  version: number;
  position: number;
  sku_code: string;
  name: string;
  kind: RowKind;
  old_mrp_paise: number;
  revised_mrp_paise: number;
  old_rate: number | null;
  new_rate: number | null;
}

export async function loadPriceBook(client?: Runner): Promise<PriceBook> {
  const run = runner(client);
  const [drinkRows, skuRows, batchRows, versionRows, rowRows] = await Promise.all([
    run.query<DrinkRowShape>('select * from drinks order by position'),
    run.query<SkuRowShape>('select * from skus order by position'),
    run.query<BatchRowShape>('select * from batches order by packed_date, code'),
    run.query<VersionRowShape>(
      `select n.id as notice_id, n.number, n.year, n.sequence, v.version, v.title, v.effective_date,
              v.run_out_until, v.published_at, v.reason, v.print_state, v.pdf_sha256, v.sheet_id,
              s.sha256 as sheet_sha256
         from notices n
         join notice_versions v on v.notice_id = n.id
         left join sheets s on s.id = v.sheet_id
        order by n.number, v.version`,
    ),
    run.query<NoticeRowShape>('select * from notice_rows order by notice_id, version, position'),
  ]);

  const drinks: DrinkRecord[] = drinkRows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    carbonated: row.carbonated,
    sugarMgPer100Ml: row.sugar_mg_per_100ml,
    position: row.position,
  }));

  const skus: SkuRecord[] = skuRows.rows.map((row) => ({
    code: row.code,
    drinkId: row.drink_id,
    variant: row.variant,
    format: row.format,
    sizeMl: row.size_ml,
    shelfDays: row.shelf_days,
    launchMrpPaise: row.launch_mrp_paise,
    position: row.position,
  }));

  const batches: BatchRecord[] = batchRows.rows.map((row) => ({
    code: row.code,
    skuCode: row.sku_code,
    packedDate: row.packed_date,
    oldWrapper: row.old_wrapper,
  }));

  const rowsByVersion = new Map<string, PublishedRow[]>();
  for (const row of rowRows.rows) {
    const key = `${row.notice_id}:${row.version}`;
    const list = rowsByVersion.get(key) ?? [];
    list.push({
      skuCode: row.sku_code,
      name: row.name,
      kind: row.kind,
      oldMrpPaise: row.old_mrp_paise,
      revisedMrpPaise: row.revised_mrp_paise,
      oldRate: row.old_rate,
      newRate: row.new_rate,
    });
    rowsByVersion.set(key, list);
  }

  const noticesById = new Map<string, PublishedNotice>();
  for (const row of versionRows.rows) {
    let notice = noticesById.get(row.notice_id);
    if (!notice) {
      notice = { id: row.notice_id, number: row.number, year: row.year, sequence: row.sequence, versions: [] };
      noticesById.set(row.notice_id, notice);
    }
    const version: PublishedVersion = {
      noticeId: row.notice_id,
      number: row.number,
      version: row.version,
      title: row.title,
      effectiveDate: row.effective_date,
      runOutUntil: row.run_out_until,
      publishedAt: row.published_at.toISOString(),
      reason: row.reason,
      printState: row.print_state,
      pdfSha256: row.pdf_sha256,
      sheet: row.sheet_id === null ? null : { id: row.sheet_id, sha256: row.sheet_sha256 ?? '' },
      rows: rowsByVersion.get(`${row.notice_id}:${row.version}`) ?? [],
    };
    notice.versions.push(version);
  }

  const notices = [...noticesById.values()].sort((a, b) => (a.number < b.number ? -1 : 1));
  return new PriceBook({ drinks, skus, batches, notices });
}

export async function loadCopyId(client?: Runner): Promise<string> {
  const result = await runner(client).query<{ copy_id: string }>('select copy_id from copy_identity');
  return result.rows[0].copy_id;
}

export async function loadHeldWork(client?: Runner): Promise<number> {
  const result = await runner(client).query<{ value: number }>(
    "select value from counters where name = 'held_work'",
  );
  return result.rows[0]?.value ?? 0;
}

export async function loadAliasesBySku(client?: Runner): Promise<Map<string, string[]>> {
  const result = await runner(client).query<{ normalised: string; sku_code: string }>(
    'select normalised, sku_code from aliases order by normalised',
  );
  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const list = map.get(row.sku_code) ?? [];
    list.push(row.normalised);
    map.set(row.sku_code, list);
  }
  return map;
}

export async function loadNoticeTitlesBySku(client?: Runner): Promise<Map<string, string[]>> {
  const result = await runner(client).query<{ sku_code: string; title: string }>(
    `select distinct r.sku_code, v.title
       from notice_rows r
       join notice_versions v on v.notice_id = r.notice_id and v.version = r.version
      where v.version = (select max(v2.version) from notice_versions v2 where v2.notice_id = r.notice_id)`,
  );
  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const list = map.get(row.sku_code) ?? [];
    list.push(row.title);
    map.set(row.sku_code, list);
  }
  return map;
}
