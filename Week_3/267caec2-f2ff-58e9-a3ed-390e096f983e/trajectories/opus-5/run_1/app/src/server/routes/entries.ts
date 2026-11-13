import {
  deadlinePassed,
  forbidden,
  idempotencyKeyReused,
  mailUnavailableOnPay,
  missingAssets,
  notFound,
  badIdempotencyKey,
  paymentsPausedOnPay,
  paymentsPausedOnRefund,
  storageUnavailableOnDraft,
  storageUnavailableOnPay,
  tooManyImages,
} from '../copy';
import {
  assetsOf,
  embargoPassed,
  entryContext,
  loadCategory,
  loadEntry,
  loadProgram,
  queueEmail,
  recordSentEmail,
} from '../data';
import { inTransaction, newId, pool, withLock } from '../db';
import { dollars, entriesOpen, feeCentsAt, tierAt, TIER_LABEL } from '../domain/fees';
import { acceptImage, MAX_IMAGES_PER_ENTRY, safeFileName } from '../domain/images';
import { requireEntryState } from '../domain/states';
import { dateLabel } from '../domain/time';
import type { AssetRow, EntryRow, FeeTier } from '../domain/types';
import {
  BillingUnavailableError,
  chargeEntryFee,
  refundEntryFee,
  type EntryCharge,
} from '../providers/killbill';
import { MailUnavailableError, sendMail } from '../providers/mail';
import {
  deleteObject,
  deletePrefix,
  getObject,
  objectExists,
  putObject,
  StorageUnavailableError,
} from '../providers/storage';
import { invalid } from '../http/errors';
import { boundaryOf, parseMultipart } from '../http/multipart';
import { bytes, empty, json, requireActor, route, type Ctx, type Reply } from '../http/router';
import { Problems, text } from '../http/validate';
import { assetJson, entryJson, receiptJson } from '../view';

async function visibleEntry(ctx: Ctx, id: string): Promise<EntryRow> {
  const actor = requireActor(ctx);
  const entry = await loadEntry(pool, id);
  if (entry === null) throw notFound();
  if (actor.role === 'studio' && entry.studio_id !== actor.studioId) throw notFound();
  if (actor.role === 'juror') throw notFound();
  return entry;
}

async function ownEntry(ctx: Ctx, id: string): Promise<EntryRow> {
  const entry = await visibleEntry(ctx, id);
  if (ctx.actor?.role !== 'studio') throw forbidden();
  return entry;
}

async function entryBody(entry: EntryRow, asDirector: boolean, now: Date): Promise<Record<string, unknown>> {
  return entryJson(await entryContext(pool, entry, now), asDirector, now);
}

function validateDetails(body: Record<string, unknown>, problems: Problems): void {
  const title = text(body, 'title');
  const summary = text(body, 'summary');
  const siteUrl = text(body, 'siteUrl');
  const credits = text(body, 'credits');
  problems.check(title.length >= 1 && title.length <= 120, 'title', 'Give a title of 1 to 120 characters.');
  problems.check(
    summary.length >= 1 && summary.length <= 2000,
    'summary',
    'Give a case study of 1 to 2000 characters.',
  );
  problems.check(
    /^https:\/\/\S+$/.test(siteUrl) && siteUrl.length <= 300,
    'siteUrl',
    'Give an https:// address of at most 300 characters.',
  );
  problems.check(credits.length <= 500, 'credits', 'Keep credits to 500 characters or fewer.');
}

async function createEntry(ctx: Ctx): Promise<Reply> {
  const actor = requireActor(ctx);
  if (actor.role !== 'studio') throw forbidden();
  const now = new Date();
  const categoryId = text(ctx.body, 'categoryId');
  const category = await loadCategory(pool, categoryId);
  const program = category === null ? null : await loadProgram(pool, category.program_id);
  if (program !== null && !entriesOpen(program, now)) {
    throw deadlinePassed(dateLabel(program.deadline_date, program.time_zone));
  }

  const problems = new Problems();
  problems.check(category !== null, 'categoryId', 'Choose a category.');
  validateDetails(ctx.body, problems);
  problems.throwIfAny();

  const numbered = await pool.query<{ next_entry_number: number }>(
    'UPDATE programs SET next_entry_number = next_entry_number + 1 WHERE id = $1 RETURNING next_entry_number',
    [(program as NonNullable<typeof program>).id],
  );
  const entryNumber = numbered.rows[0].next_entry_number - 1;
  const id = newId('ent');
  const inserted = await pool.query<EntryRow>(
    `INSERT INTO entries (id, program_id, category_id, studio_id, entry_number, title, summary, site_url, credits)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      id,
      (program as NonNullable<typeof program>).id,
      categoryId,
      actor.studioId,
      entryNumber,
      text(ctx.body, 'title'),
      text(ctx.body, 'summary'),
      text(ctx.body, 'siteUrl'),
      text(ctx.body, 'credits'),
    ],
  );
  return json(201, { entry: await entryBody(inserted.rows[0], false, now) });
}

async function listEntries(ctx: Ctx): Promise<Reply> {
  const actor = requireActor(ctx);
  if (actor.role !== 'studio') throw forbidden();
  const now = new Date();
  const result = await pool.query<EntryRow>(
    'SELECT * FROM entries WHERE studio_id = $1 ORDER BY created_at DESC, seq DESC',
    [actor.studioId],
  );
  const entries = [];
  for (const entry of result.rows) entries.push(await entryBody(entry, false, now));
  return json(200, { entries });
}

async function showEntry(ctx: Ctx): Promise<Reply> {
  const entry = await visibleEntry(ctx, ctx.params.id);
  return json(200, { entry: await entryBody(entry, ctx.actor?.role === 'director', new Date()) });
}

async function requireOpenDraft(entry: EntryRow, action: 'edit' | 'delete' | 'add_asset' | 'remove_asset'): Promise<void> {
  requireEntryState(entry.state, action);
  const program = await loadProgram(pool, entry.program_id);
  if (program === null) throw notFound();
  if (!entriesOpen(program, new Date())) {
    throw deadlinePassed(dateLabel(program.deadline_date, program.time_zone));
  }
}

async function patchEntry(ctx: Ctx): Promise<Reply> {
  const entry = await ownEntry(ctx, ctx.params.id);
  await requireOpenDraft(entry, 'edit');

  const next = {
    categoryId: 'categoryId' in ctx.body ? text(ctx.body, 'categoryId') : entry.category_id,
    title: 'title' in ctx.body ? text(ctx.body, 'title') : entry.title,
    summary: 'summary' in ctx.body ? text(ctx.body, 'summary') : entry.summary,
    siteUrl: 'siteUrl' in ctx.body ? text(ctx.body, 'siteUrl') : entry.site_url,
    credits: 'credits' in ctx.body ? text(ctx.body, 'credits') : entry.credits,
  };
  const category = await loadCategory(pool, next.categoryId);
  const problems = new Problems();
  problems.check(
    category !== null && category.program_id === entry.program_id,
    'categoryId',
    'Choose a category.',
  );
  validateDetails(next as unknown as Record<string, unknown>, problems);
  problems.throwIfAny();

  const updated = await pool.query<EntryRow>(
    `UPDATE entries SET category_id = $2, title = $3, summary = $4, site_url = $5, credits = $6
     WHERE id = $1 RETURNING *`,
    [entry.id, next.categoryId, next.title, next.summary, next.siteUrl, next.credits],
  );
  return json(200, { entry: await entryBody(updated.rows[0], false, new Date()) });
}

async function deleteEntry(ctx: Ctx): Promise<Reply> {
  const entry = await ownEntry(ctx, ctx.params.id);
  await requireOpenDraft(entry, 'delete');
  try {
    await deletePrefix(`entries/${entry.id}/`);
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw storageUnavailableOnDraft();
    throw error;
  }
  await pool.query('DELETE FROM entries WHERE id = $1', [entry.id]);
  return empty(204);
}

async function addAsset(ctx: Ctx): Promise<Reply> {
  const entry = await ownEntry(ctx, ctx.params.id);
  await requireOpenDraft(entry, 'add_asset');

  const boundary = boundaryOf(String(ctx.headers['content-type'] ?? ''));
  const parts = boundary === null ? [] : parseMultipart(ctx.raw, boundary);
  const file = parts.find((part) => part.name === 'file');
  if (file === undefined) throw invalid({ file: 'Attach a PNG or JPEG image.' });

  const image = acceptImage(file.data);
  const existing = await assetsOf(pool, entry.id);
  if (existing.length >= MAX_IMAGES_PER_ENTRY) throw tooManyImages();

  const assetId = newId('ast');
  const key = `entries/${entry.id}/${assetId}.${image.extension}`;
  try {
    await putObject(key, image.bytes, image.contentType);
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw storageUnavailableOnDraft();
    throw error;
  }
  const inserted = await pool.query<AssetRow>(
    `INSERT INTO assets (id, entry_id, storage_key, name, content_type, width, height, bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      assetId,
      entry.id,
      key,
      safeFileName(file.fileName),
      image.contentType,
      image.width,
      image.height,
      image.bytes.length,
    ],
  );
  return json(201, { asset: assetJson(inserted.rows[0]) });
}

async function removeAsset(ctx: Ctx): Promise<Reply> {
  const entry = await ownEntry(ctx, ctx.params.id);
  const found = await pool.query<AssetRow>('SELECT * FROM assets WHERE id = $1 AND entry_id = $2', [
    ctx.params.assetId,
    entry.id,
  ]);
  const asset = found.rows[0];
  if (asset === undefined) throw notFound();
  await requireOpenDraft(entry, 'remove_asset');
  try {
    await deleteObject(asset.storage_key);
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw storageUnavailableOnDraft();
    throw error;
  }
  await pool.query('DELETE FROM assets WHERE id = $1', [asset.id]);
  return empty(204);
}

interface ReceiptMail {
  entryNumber: number;
  title: string;
  categoryName: string;
  tier: FeeTier;
  amountCents: number;
  invoiceId: string;
  deadlineLabel: string;
}

function receiptMail(receipt: ReceiptMail): { subject: string; body: string } {
  return {
    subject: `Cutline receipt: Entry ${receipt.entryNumber} — ${receipt.title}`,
    body: [
      `Entry ${receipt.entryNumber} — ${receipt.title}`,
      `Category: ${receipt.categoryName}`,
      `Amount: $${dollars(receipt.amountCents)}`,
      `Fee tier: ${TIER_LABEL[receipt.tier]}`,
      `Invoice id: ${receipt.invoiceId}`,
      `Withdraw before ${receipt.deadlineLabel} for a full refund.`,
    ].join('\n'),
  };
}

async function submitEntry(ctx: Ctx): Promise<Reply> {
  const outer = await ownEntry(ctx, ctx.params.id);
  const studioId = outer.studio_id;
  const header = ctx.headers['idempotency-key'];
  const key = typeof header === 'string' ? header : '';

  return withLock(outer.id, async () => {
    const entry = (await loadEntry(pool, outer.id)) as EntryRow;

    if (key !== '') {
      const stored = await pool.query<{ entry_id: string; status: number | null; response: unknown }>(
        'SELECT entry_id, status, response FROM idempotency_keys WHERE studio_id = $1 AND key = $2',
        [studioId, key],
      );
      const record = stored.rows[0];
      if (record !== undefined) {
        if (record.entry_id !== entry.id) throw idempotencyKeyReused();
        return json(record.status as number, record.response);
      }
    }

    requireEntryState(entry.state, 'submit');
    const program = await loadProgram(pool, entry.program_id);
    if (program === null) throw notFound();
    const deadline = dateLabel(program.deadline_date, program.time_zone);
    if (!entriesOpen(program, new Date())) throw deadlinePassed(deadline);

    if (key === '' || key.length > 100) throw badIdempotencyKey();
    const assets = await assetsOf(pool, entry.id);
    if (assets.length === 0) throw missingAssets();

    try {
      for (const asset of assets) {
        if (!(await objectExists(asset.storage_key))) throw new StorageUnavailableError('missing object');
      }
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailableOnPay();
      throw error;
    }

    const studio = await pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM studios WHERE id = $1',
      [studioId],
    );
    const category = await loadCategory(pool, entry.category_id);
    if (category === null) throw notFound();

    const paidAt = new Date();
    const tier = tierAt(program, paidAt);
    const amountCents = feeCentsAt(program, paidAt);

    let charge: EntryCharge;
    try {
      charge = await chargeEntryFee({
        studio: { studioId, name: studio.rows[0].name, email: studio.rows[0].email },
        entryId: entry.id,
        entryNumber: entry.entry_number,
        tier,
        amountCents,
        attempt: entry.charge_attempts,
      });
    } catch (error) {
      if (error instanceof BillingUnavailableError) throw paymentsPausedOnPay();
      throw error;
    }

    const mail = receiptMail({
      entryNumber: entry.entry_number,
      title: entry.title,
      categoryName: category.name,
      tier,
      amountCents,
      invoiceId: charge.invoiceId,
      deadlineLabel: deadline,
    });
    try {
      await sendMail(studio.rows[0].email, mail.subject, mail.body);
    } catch (error) {
      if (error instanceof MailUnavailableError) {
        await refundEntryFee({
          paymentId: charge.paymentId,
          invoiceItemId: charge.invoiceItemId,
          amountCents,
        });
        await pool.query('UPDATE entries SET charge_attempts = charge_attempts + 1 WHERE id = $1', [entry.id]);
        throw mailUnavailableOnPay();
      }
      throw error;
    }

    const submitted = await inTransaction(async (db) => {
      const updated = await db.query<EntryRow>(
        `UPDATE entries SET state = 'submitted', fee_tier = $2, fee_cents = $3, invoice_id = $4,
           invoice_item_id = $5, payment_id = $6, paid_at = $7, submitted_at = $7 WHERE id = $1 RETURNING *`,
        [entry.id, tier, amountCents, charge.invoiceId, charge.invoiceItemId, charge.paymentId, paidAt],
      );
      await recordSentEmail(db, `receipt:${entry.id}`, studio.rows[0].email, mail.subject, mail.body);
      return updated.rows[0];
    });

    const body = {
      entry: await entryBody(submitted, false, new Date()),
      receipt: receiptJson(submitted, submitted.title),
    };
    await pool.query(
      'INSERT INTO idempotency_keys (studio_id, key, entry_id, status, response) VALUES ($1, $2, $3, 201, $4)',
      [studioId, key, entry.id, JSON.stringify(body)],
    );
    return json(201, body);
  });
}

async function withdrawEntry(ctx: Ctx): Promise<Reply> {
  const outer = await ownEntry(ctx, ctx.params.id);
  return withLock(outer.id, async () => {
    const entry = (await loadEntry(pool, outer.id)) as EntryRow;
    requireEntryState(entry.state, 'withdraw');
    const program = await loadProgram(pool, entry.program_id);
    if (program === null) throw notFound();
    const now = new Date();
    const refundable = entriesOpen(program, now);
    const amountCents = entry.fee_cents as number;

    if (!refundable) {
      const updated = await pool.query<EntryRow>(
        "UPDATE entries SET state = 'withdrawn' WHERE id = $1 RETURNING *",
        [entry.id],
      );
      return json(200, { entry: await entryBody(updated.rows[0], false, now), refund: null });
    }

    try {
      await refundEntryFee({
        paymentId: entry.payment_id as string,
        invoiceItemId: entry.invoice_item_id as string,
        amountCents,
      });
    } catch (error) {
      if (error instanceof BillingUnavailableError) throw paymentsPausedOnRefund();
      throw error;
    }

    const studio = await pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM studios WHERE id = $1',
      [entry.studio_id],
    );
    const refundedAt = new Date();
    const updated = await inTransaction(async (db) => {
      const row = await db.query<EntryRow>(
        "UPDATE entries SET state = 'withdrawn', refund_amount_cents = $2, refunded_at = $3 WHERE id = $1 RETURNING *",
        [entry.id, amountCents, refundedAt],
      );
      await queueEmail(
        db,
        `refund:${entry.id}`,
        studio.rows[0].email,
        `Cutline refund: Entry ${entry.entry_number} — ${entry.title}`,
        [
          `Entry ${entry.entry_number} — ${entry.title}`,
          `$${dollars(amountCents)} refunded to ${studio.rows[0].name}.`,
        ].join('\n'),
      );
      return row.rows[0];
    });
    return json(200, {
      entry: await entryBody(updated, false, now),
      refund: { amountCents, refundedAt: refundedAt.toISOString() },
    });
  });
}

async function showReceipt(ctx: Ctx): Promise<Reply> {
  const entry = await visibleEntry(ctx, ctx.params.id);
  if (entry.paid_at === null) throw notFound();
  return json(200, { receipt: receiptJson(entry, entry.title) });
}

async function showInvoice(ctx: Ctx): Promise<Reply> {
  const actor = requireActor(ctx);
  const found = await pool.query<EntryRow>('SELECT * FROM entries WHERE invoice_id = $1', [
    ctx.params.invoiceId,
  ]);
  const entry = found.rows[0];
  if (entry === undefined) throw notFound();
  if (actor.role === 'studio' && entry.studio_id !== actor.studioId) throw notFound();
  if (actor.role === 'juror') throw notFound();
  return json(200, {
    invoice: {
      invoiceId: entry.invoice_id,
      entryNumber: entry.entry_number,
      amountCents: entry.fee_cents,
      currency: 'USD',
      tier: entry.fee_tier,
      status: entry.refunded_at === null ? 'paid' : 'refunded',
    },
  });
}

async function maySeeAsset(ctx: Ctx, entry: EntryRow): Promise<boolean> {
  const category = await loadCategory(pool, entry.category_id);
  if (category !== null && embargoPassed(category, new Date()) && entry.award !== null) return true;
  const actor = ctx.actor;
  if (actor === null) return false;
  if (actor.role === 'director') return true;
  if (actor.role === 'studio') return entry.studio_id === actor.studioId;
  const assigned = await pool.query(
    `SELECT 1 FROM assignments a JOIN rounds r ON r.id = a.round_id
     WHERE a.juror_id = $1 AND a.entry_id = $2 AND a.recused_at IS NULL AND r.state = 'open'`,
    [actor.id, entry.id],
  );
  return assigned.rowCount !== 0;
}

async function showAsset(ctx: Ctx): Promise<Reply> {
  const found = await pool.query<AssetRow>('SELECT * FROM assets WHERE id = $1', [ctx.params.assetId]);
  const asset = found.rows[0];
  if (asset === undefined) throw notFound();
  const entry = await loadEntry(pool, asset.entry_id);
  if (entry === null || !(await maySeeAsset(ctx, entry))) throw notFound();
  const data = await getObject(asset.storage_key);
  if (data === null) throw notFound();
  return bytes(asset.content_type, data);
}

export const entryRoutes = [
  route('POST', '/api/entries', createEntry),
  route('GET', '/api/entries', listEntries),
  route('GET', '/api/entries/:id', showEntry),
  route('PATCH', '/api/entries/:id', patchEntry),
  route('DELETE', '/api/entries/:id', deleteEntry),
  route('POST', '/api/entries/:id/assets', addAsset),
  route('DELETE', '/api/entries/:id/assets/:assetId', removeAsset),
  route('POST', '/api/entries/:id/submit', submitEntry),
  route('POST', '/api/entries/:id/withdraw', withdrawEntry),
  route('GET', '/api/entries/:id/receipt', showReceipt),
  route('GET', '/api/invoices/:invoiceId', showInvoice),
  route('GET', '/api/assets/:assetId', showAsset),
];
