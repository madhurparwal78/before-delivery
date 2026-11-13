import { randomUUID } from 'node:crypto';
import type {
  EngagementState,
  IntakeKind,
  IntakeStatus,
  InvoiceStatus,
  MeasurementState,
  Milestone,
  ReviewMilestone,
  UnitDecision,
} from '../../shared/domain.js';
import type { CurrencyCode } from '../../shared/money.js';
import { query, transaction, type Queryable } from './pool.js';

export type EngagementRow = {
  id: string;
  brand_id: string;
  reference: string;
  title: string;
  state: EngagementState;
  finals_out: boolean;
  revision_milestone: ReviewMilestone | null;
  quote_revision: number;
  fx_rate_e4: string | null;
  fx_locked_at: Date | null;
  brand_name: string;
  brand_currency: CurrencyCode;
  killbill_account_id: string | null;
};

const ENGAGEMENT_SELECT = `
  SELECT e.id, e.brand_id, e.reference, e.title, e.state, e.finals_out, e.revision_milestone,
         e.quote_revision, e.fx_rate_e4, e.fx_locked_at,
         b.name AS brand_name, b.currency AS brand_currency, b.killbill_account_id
  FROM engagements e JOIN brands b ON b.id = e.brand_id`;

export const findEngagement = async (id: string): Promise<EngagementRow | null> => {
  if (!isUuid(id)) return null;
  return (await query<EngagementRow>(`${ENGAGEMENT_SELECT} WHERE e.id = $1`, [id])).rows[0] ?? null;
};

export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const listBrandEngagements = async (brandId: string): Promise<EngagementRow[]> =>
  (
    await query<EngagementRow>(`${ENGAGEMENT_SELECT} WHERE e.brand_id = $1 ORDER BY e.created_at`, [
      brandId,
    ])
  ).rows;

export const listAllEngagements = async (): Promise<EngagementRow[]> =>
  (await query<EngagementRow>(`${ENGAGEMENT_SELECT} ORDER BY e.created_at`)).rows;

export type QuoteLineRowDb = {
  shot_code: string;
  quantity: number;
  locked_title: string | null;
  locked_price_pence: number | null;
};

export const listQuoteLines = async (
  engagementId: string,
  client: Queryable = { query },
): Promise<QuoteLineRowDb[]> =>
  (
    await client.query<QuoteLineRowDb>(
      'SELECT shot_code, quantity, locked_title, locked_price_pence FROM quote_lines WHERE engagement_id = $1',
      [engagementId],
    )
  ).rows;

export type QuoteWriteResult = { revision: number; lines: QuoteLineRowDb[] };

export const putQuoteLine = async (
  engagementId: string,
  shotCode: string,
  quantity: number,
): Promise<QuoteWriteResult> =>
  transaction(async (client) => {
    await client.query(
      `INSERT INTO quote_lines (id, engagement_id, shot_code, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (engagement_id, shot_code) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [randomUUID(), engagementId, shotCode, quantity],
    );
    return bumpRevision(client, engagementId);
  });

export const deleteQuoteLine = async (
  engagementId: string,
  shotCode: string,
): Promise<QuoteWriteResult> =>
  transaction(async (client) => {
    await client.query('DELETE FROM quote_lines WHERE engagement_id = $1 AND shot_code = $2', [
      engagementId,
      shotCode,
    ]);
    return bumpRevision(client, engagementId);
  });

const bumpRevision = async (
  client: Queryable,
  engagementId: string,
): Promise<QuoteWriteResult> => {
  const revision = (
    await client.query<{ quote_revision: number }>(
      'UPDATE engagements SET quote_revision = quote_revision + 1 WHERE id = $1 RETURNING quote_revision',
      [engagementId],
    )
  ).rows[0].quote_revision;
  return { revision, lines: await listQuoteLines(engagementId, client) };
};

export type IntakeFileRow = {
  id: string;
  engagement_id: string;
  name: string;
  kind: IntakeKind;
  size_bytes: string;
  status: IntakeStatus;
  object_key: string;
  content_type: string;
  measurement: MeasurementState | null;
  measure_failures: number;
  measured: boolean;
  unit: UnitDecision | null;
  dim_x: string | null;
  dim_y: string | null;
  dim_z: string | null;
  seq: string;
};

const FILE_COLUMNS = `id, engagement_id, name, kind, size_bytes, status, object_key, content_type,
  measurement, measure_failures, measured, unit, dim_x, dim_y, dim_z, seq`;

export const listIntakeFiles = async (engagementId: string): Promise<IntakeFileRow[]> =>
  (
    await query<IntakeFileRow>(
      `SELECT ${FILE_COLUMNS} FROM intake_files WHERE engagement_id = $1 ORDER BY seq`,
      [engagementId],
    )
  ).rows;

export const findIntakeFile = async (id: string): Promise<IntakeFileRow | null> => {
  if (!isUuid(id)) return null;
  return (
    (await query<IntakeFileRow>(`SELECT ${FILE_COLUMNS} FROM intake_files WHERE id = $1`, [id]))
      .rows[0] ?? null
  );
};

export type NewIntakeFile = {
  id: string;
  engagementId: string;
  name: string;
  kind: IntakeKind;
  sizeBytes: number;
  objectKey: string;
  contentType: string;
};

export const insertIntakeFile = async (input: NewIntakeFile): Promise<IntakeFileRow> =>
  transaction(async (client) => {
    if (input.kind === 'model') {
      await client.query(
        `UPDATE intake_files SET status = 'superseded', unit = NULL
         WHERE engagement_id = $1 AND kind = 'model' AND status = 'received'`,
        [input.engagementId],
      );
    }
    const row = (
      await client.query<IntakeFileRow>(
        `INSERT INTO intake_files (id, engagement_id, name, kind, size_bytes, status, object_key, content_type, measurement)
         VALUES ($1, $2, $3, $4, $5, 'received', $6, $7, $8)
         RETURNING ${FILE_COLUMNS}`,
        [
          input.id,
          input.engagementId,
          input.name,
          input.kind,
          input.sizeBytes,
          input.objectKey,
          input.contentType,
          input.kind === 'model' ? 'pending' : null,
        ],
      )
    ).rows[0];
    if (input.kind === 'model')
      await client.query(
        "INSERT INTO measure_jobs (intake_file_id, state) VALUES ($1, 'queued')",
        [input.id],
      );
    return row;
  });

export const setMeasurementState = async (
  fileId: string,
  state: MeasurementState,
): Promise<void> => {
  await query('UPDATE intake_files SET measurement = $2 WHERE id = $1 AND measured = false', [
    fileId,
    state,
  ]);
};

export type MeasurementRecord = { x: string; y: string; z: string; unit: UnitDecision | null };

/** One measurement record per file, whatever the redeliveries. */
export const recordMeasurement = async (
  fileId: string,
  dimensions: MeasurementRecord,
): Promise<boolean> =>
  (
    await query(
      `UPDATE intake_files
       SET measured = true, measurement = 'measured', dim_x = $2, dim_y = $3, dim_z = $4, unit = $5
       WHERE id = $1 AND measured = false`,
      [fileId, dimensions.x, dimensions.y, dimensions.z, dimensions.unit],
    )
  ).rowCount === 1;

export const recordMeasurementFailure = async (fileId: string): Promise<number> =>
  (
    await query<{ measure_failures: number }>(
      `UPDATE intake_files SET measure_failures = measure_failures + 1 WHERE id = $1 AND measured = false
       RETURNING measure_failures`,
      [fileId],
    )
  ).rows[0]?.measure_failures ?? 0;

export const markMeasurementFailed = async (fileId: string): Promise<void> => {
  await query(
    "UPDATE intake_files SET measurement = 'failed', measured = true WHERE id = $1",
    [fileId],
  );
};

export const setUnitDecision = async (fileId: string, unit: UnitDecision): Promise<void> => {
  await query('UPDATE intake_files SET unit = $2 WHERE id = $1', [fileId, unit]);
};

export const currentModel = async (engagementId: string): Promise<IntakeFileRow | null> =>
  (
    await query<IntakeFileRow>(
      `SELECT ${FILE_COLUMNS} FROM intake_files
       WHERE engagement_id = $1 AND kind = 'model' AND status = 'received'
       ORDER BY seq DESC LIMIT 1`,
      [engagementId],
    )
  ).rows[0] ?? null;

export const delayedMeasurementFiles = async (): Promise<IntakeFileRow[]> =>
  (
    await query<IntakeFileRow>(
      `SELECT ${FILE_COLUMNS} FROM intake_files WHERE measurement = 'delayed' AND measured = false`,
    )
  ).rows;

export type StillRow = {
  id: string;
  engagement_id: string;
  shot_code: string;
  milestone: ReviewMilestone;
  object_key: string;
  content_type: string;
};

export const listStills = async (engagementId: string): Promise<StillRow[]> =>
  (
    await query<StillRow>(
      'SELECT id, engagement_id, shot_code, milestone, object_key, content_type FROM stills WHERE engagement_id = $1',
      [engagementId],
    )
  ).rows;

export const upsertStill = async (input: {
  engagementId: string;
  shotCode: string;
  milestone: ReviewMilestone;
  objectKey: string;
  contentType: string;
}): Promise<StillRow> =>
  (
    await query<StillRow>(
      `INSERT INTO stills (id, engagement_id, shot_code, milestone, object_key, content_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (engagement_id, shot_code, milestone)
       DO UPDATE SET object_key = EXCLUDED.object_key, content_type = EXCLUDED.content_type, created_at = now()
       RETURNING id, engagement_id, shot_code, milestone, object_key, content_type`,
      [
        randomUUID(),
        input.engagementId,
        input.shotCode,
        input.milestone,
        input.objectKey,
        input.contentType,
      ],
    )
  ).rows[0];

export const findStill = async (id: string): Promise<StillRow | null> => {
  if (!isUuid(id)) return null;
  return (
    (
      await query<StillRow>(
        'SELECT id, engagement_id, shot_code, milestone, object_key, content_type FROM stills WHERE id = $1',
        [id],
      )
    ).rows[0] ?? null
  );
};

export type ReviewLinkRow = {
  id: string;
  engagement_id: string;
  milestone: ReviewMilestone;
  created_at: Date;
  revoked_at: Date | null;
  age_seconds: number;
};

export const createReviewLink = async (
  engagementId: string,
  milestone: ReviewMilestone,
  tokenHash: string,
): Promise<Date> =>
  transaction(async (client) => {
    await client.query(
      'UPDATE review_links SET revoked_at = now() WHERE engagement_id = $1 AND revoked_at IS NULL',
      [engagementId],
    );
    return (
      await client.query<{ created_at: Date }>(
        `INSERT INTO review_links (id, engagement_id, token_hash, milestone)
         VALUES ($1, $2, $3, $4) RETURNING created_at`,
        [randomUUID(), engagementId, tokenHash, milestone],
      )
    ).rows[0].created_at;
  });

export const revokeReviewLinks = async (engagementId: string): Promise<void> => {
  await query(
    'UPDATE review_links SET revoked_at = now() WHERE engagement_id = $1 AND revoked_at IS NULL',
    [engagementId],
  );
};

export const findReviewLinkByHash = async (tokenHash: string): Promise<ReviewLinkRow | null> => {
  const row = (
    await query<Omit<ReviewLinkRow, 'age_seconds'> & { age: string }>(
      `SELECT id, engagement_id, milestone, created_at, revoked_at,
              extract(epoch FROM (now() - created_at))::text AS age
       FROM review_links WHERE token_hash = $1`,
      [tokenHash],
    )
  ).rows[0];
  return row === undefined ? null : { ...row, age_seconds: Number(row.age) };
};

export const activeReviewLink = async (engagementId: string): Promise<ReviewLinkRow | null> => {
  const row = (
    await query<Omit<ReviewLinkRow, 'age_seconds'> & { age: string }>(
      `SELECT id, engagement_id, milestone, created_at, revoked_at,
              extract(epoch FROM (now() - created_at))::text AS age
       FROM review_links WHERE engagement_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [engagementId],
    )
  ).rows[0];
  return row === undefined ? null : { ...row, age_seconds: Number(row.age) };
};

export const countRevisionRounds = async (
  engagementId: string,
): Promise<{ look_dev: number; final_delivery: number }> => {
  const rows = (
    await query<{ milestone: ReviewMilestone; count: string }>(
      'SELECT milestone, count(*)::text AS count FROM revision_rounds WHERE engagement_id = $1 GROUP BY milestone',
      [engagementId],
    )
  ).rows;
  return {
    look_dev: Number(rows.find((row) => row.milestone === 'look_dev')?.count ?? '0'),
    final_delivery: Number(rows.find((row) => row.milestone === 'final_delivery')?.count ?? '0'),
  };
};

export const insertRevisionRound = async (
  client: Queryable,
  engagementId: string,
  milestone: ReviewMilestone,
  note: string,
): Promise<number> => {
  const round = (
    await client.query<{ round: number }>(
      `INSERT INTO revision_rounds (id, engagement_id, milestone, round, note)
       SELECT $1, $2, $3, coalesce(max(round), 0) + 1, $4
       FROM revision_rounds WHERE engagement_id = $2 AND milestone = $3
       RETURNING round`,
      [randomUUID(), engagementId, milestone, note],
    )
  ).rows[0].round;
  return round;
};

export type InvoiceRow = {
  id: string;
  engagement_id: string;
  milestone: Milestone;
  status: InvoiceStatus;
  number: string | null;
  killbill_invoice_id: string | null;
  amount_minor: string;
  currency: CurrencyCode;
  failed_attempts: number;
  first_failed_at: Date | null;
  overdue_at: Date | null;
  issued_at: Date | null;
};

export type InvoiceLineRow = { description: string; amount_minor: string; sort: number };

const INVOICE_COLUMNS = `id, engagement_id, milestone, status, number, killbill_invoice_id,
  amount_minor, currency, failed_attempts, first_failed_at, overdue_at, issued_at`;

export const listInvoices = async (engagementId: string): Promise<InvoiceRow[]> =>
  (
    await query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE engagement_id = $1`,
      [engagementId],
    )
  ).rows;

export const findInvoice = async (id: string): Promise<InvoiceRow | null> => {
  if (!isUuid(id)) return null;
  return (
    (await query<InvoiceRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1`, [id]))
      .rows[0] ?? null
  );
};

export const findInvoiceByMilestone = async (
  engagementId: string,
  milestone: Milestone,
): Promise<InvoiceRow | null> =>
  (
    await query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE engagement_id = $1 AND milestone = $2`,
      [engagementId, milestone],
    )
  ).rows[0] ?? null;

export const listInvoiceLines = async (invoiceId: string): Promise<InvoiceLineRow[]> =>
  (
    await query<InvoiceLineRow>(
      'SELECT description, amount_minor, sort FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort',
      [invoiceId],
    )
  ).rows;

export const insertInvoice = async (
  client: Queryable,
  input: {
    id: string;
    engagementId: string;
    milestone: Milestone;
    status: InvoiceStatus;
    amountMinor: bigint;
    currency: CurrencyCode;
    number?: string | null;
    killbillInvoiceId?: string | null;
    issuedAt?: Date | null;
    lines: { description: string; amountMinor: bigint }[];
  },
): Promise<void> => {
  await client.query(
    `INSERT INTO invoices (id, engagement_id, milestone, status, number, killbill_invoice_id, amount_minor, currency, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.engagementId,
      input.milestone,
      input.status,
      input.number ?? null,
      input.killbillInvoiceId ?? null,
      input.amountMinor.toString(),
      input.currency,
      input.issuedAt ?? null,
    ],
  );
  for (const [index, line] of input.lines.entries())
    await client.query(
      'INSERT INTO invoice_lines (id, invoice_id, description, amount_minor, sort) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), input.id, line.description, line.amountMinor.toString(), index],
    );
};

export type LedgerRow = {
  id: string;
  engagement_id: string;
  kind: 'deposit' | 'invoice_payment' | 'refund';
  amount_minor: string;
  currency: CurrencyCode;
  invoice_id: string | null;
  killbill_payment_id: string;
  transaction_key: string | null;
  created_at: Date;
  seq: string;
};

const LEDGER_COLUMNS = `id, engagement_id, kind, amount_minor, currency, invoice_id,
  killbill_payment_id, transaction_key, created_at, seq`;

export const listLedger = async (engagementId: string): Promise<LedgerRow[]> =>
  (
    await query<LedgerRow>(
      `SELECT ${LEDGER_COLUMNS} FROM ledger_entries WHERE engagement_id = $1 ORDER BY seq`,
      [engagementId],
    )
  ).rows;

export const insertLedgerEntry = async (
  client: Queryable,
  input: {
    id: string;
    engagementId: string;
    kind: 'deposit' | 'invoice_payment' | 'refund';
    amountMinor: bigint;
    currency: CurrencyCode;
    invoiceId: string | null;
    killbillPaymentId: string;
    transactionKey: string | null;
  },
): Promise<void> => {
  await client.query(
    `INSERT INTO ledger_entries (id, engagement_id, kind, amount_minor, currency, invoice_id, killbill_payment_id, transaction_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (transaction_key) DO NOTHING`,
    [
      input.id,
      input.engagementId,
      input.kind,
      input.amountMinor.toString(),
      input.currency,
      input.invoiceId,
      input.killbillPaymentId,
      input.transactionKey,
    ],
  );
};

export const setEngagementPhase = async (
  client: Queryable,
  engagementId: string,
  phase: { state: EngagementState; finalsOut: boolean; revisionMilestone: ReviewMilestone | null },
): Promise<void> => {
  await client.query(
    'UPDATE engagements SET state = $2, finals_out = $3, revision_milestone = $4 WHERE id = $1',
    [engagementId, phase.state, phase.finalsOut, phase.revisionMilestone],
  );
};

export const lockEngagement = async (
  client: Queryable,
  engagementId: string,
): Promise<EngagementRow | null> =>
  (
    await client.query<EngagementRow>(
      `${ENGAGEMENT_SELECT} WHERE e.id = $1 FOR NO KEY UPDATE OF e`,
      [engagementId],
    )
  ).rows[0] ?? null;

export const lockQuoteAndTitles = async (
  client: Queryable,
  engagementId: string,
  rateE4: bigint,
  lockedAt: Date,
  resolved: { shotCode: string; title: string; unitPricePence: number }[],
): Promise<void> => {
  await client.query('UPDATE engagements SET fx_rate_e4 = $2, fx_locked_at = $3 WHERE id = $1', [
    engagementId,
    rateE4.toString(),
    lockedAt,
  ]);
  for (const line of resolved)
    await client.query(
      'UPDATE quote_lines SET locked_title = $3, locked_price_pence = $4 WHERE engagement_id = $1 AND shot_code = $2',
      [engagementId, line.shotCode, line.title, line.unitPricePence],
    );
};

export const lockInvoice = async (
  client: Queryable,
  invoiceId: string,
): Promise<InvoiceRow | null> =>
  (
    await client.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1 FOR NO KEY UPDATE`,
      [invoiceId],
    )
  ).rows[0] ?? null;

export const recordPaymentFailure = async (
  client: Queryable,
  invoiceId: string,
  overdueAt: (firstFailedAt: Date) => Date,
): Promise<InvoiceRow> => {
  const failed = (
    await client.query<InvoiceRow>(
      `UPDATE invoices
       SET failed_attempts = failed_attempts + 1,
           status = 'payment_failed',
           first_failed_at = coalesce(first_failed_at, now())
       WHERE id = $1
       RETURNING ${INVOICE_COLUMNS}`,
      [invoiceId],
    )
  ).rows[0];
  if (failed.overdue_at !== null || failed.first_failed_at === null) return failed;
  return (
    await client.query<InvoiceRow>(
      `UPDATE invoices SET overdue_at = $2 WHERE id = $1 RETURNING ${INVOICE_COLUMNS}`,
      [invoiceId, overdueAt(failed.first_failed_at)],
    )
  ).rows[0];
};

export const markInvoicePaid = async (client: Queryable, invoiceId: string): Promise<void> => {
  await client.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [invoiceId]);
};

export const markInvoiceIssued = async (
  client: Queryable,
  invoiceId: string,
  number: string,
  killbillInvoiceId: string,
): Promise<InvoiceRow> =>
  (
    await client.query<InvoiceRow>(
      `UPDATE invoices SET status = 'issued', number = $2, killbill_invoice_id = $3, issued_at = now()
       WHERE id = $1 RETURNING ${INVOICE_COLUMNS}`,
      [invoiceId, number, killbillInvoiceId],
    )
  ).rows[0];

export const markInvoiceOverdue = async (
  client: Queryable,
  invoiceId: string,
): Promise<boolean> =>
  (
    await client.query(
      "UPDATE invoices SET status = 'overdue' WHERE id = $1 AND status = 'payment_failed'",
      [invoiceId],
    )
  ).rowCount === 1;

export const markInvoiceVoid = async (client: Queryable, invoiceId: string): Promise<void> => {
  await client.query("UPDATE invoices SET status = 'void' WHERE id = $1", [invoiceId]);
};

export const failedInvoicesWithDeadline = async (): Promise<InvoiceRow[]> =>
  (
    await query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices
       WHERE status = 'payment_failed' AND overdue_at IS NOT NULL`,
    )
  ).rows;

export const brandHasOverdueInvoice = async (
  brandId: string,
  exceptInvoiceIds: readonly string[] = [],
): Promise<boolean> =>
  (
    await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM invoices i
       JOIN engagements e ON e.id = i.engagement_id
       WHERE e.brand_id = $1 AND i.status = 'overdue' AND NOT (i.id = ANY($2::uuid[]))`,
      [brandId, exceptInvoiceIds],
    )
  ).rows[0].count !== '0';

export const claimCancel = async (engagementId: string): Promise<boolean> =>
  (
    await query(
      'UPDATE engagements SET cancelling = true WHERE id = $1 AND cancelling = false',
      [engagementId],
    )
  ).rowCount === 1;

export const releaseCancel = async (engagementId: string): Promise<void> => {
  await query('UPDATE engagements SET cancelling = false WHERE id = $1', [engagementId]);
};
