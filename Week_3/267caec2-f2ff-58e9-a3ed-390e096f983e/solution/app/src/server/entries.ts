import { randomUUID } from "node:crypto";
import type pg from "pg";
import { type SessionUser, optionalUser, requireRole, requireUser } from "./auth.js";
import { BillingUnavailable, chargeEntryFee, refundEntryFee } from "./billing.js";
import { type Db, lockKey, many, one, pool, tx } from "./db.js";
import { COPY, FieldErrors, refuse } from "./errors.js";
import type { ApiRequest, ApiResult } from "./http.js";
import { checkImage } from "./images.js";
import { MailUnavailable, type Message, openMail, queueMail, recordSentMail } from "./mail.js";
import { dollars } from "./money.js";
import {
  AWARDS, type Award, type EntryState, STATUS_LABEL, embargoPassed, entriesOpen, feeInEffect, guardEntriesOpen, guardEntry,
} from "./rules.js";
import { type FeeTier, TIER_LABEL } from "../shared/transitions.js";
import { StorageUnavailable, deletePrefix, deleteObject, getObject, objectExists, putObject } from "./storage.js";
import { deadlineLabel, instantLabel } from "./time.js";
import { text } from "./validate.js";

// Entries: drafts, images, the all-or-nothing submission, withdrawal, and what each role may see of them
// (brief: API, Entries (studio); Business rules).

export interface EntryRow {
  id: string;
  program_id: string;
  category_id: string;
  studio_id: string;
  entry_number: number;
  title: string;
  summary: string;
  site_url: string;
  credits: string;
  state: EntryState;
  award: Award | null;
  disqualify_reason: string | null;
  fee_tier: FeeTier | null;
  fee_cents: number | null;
  invoice_id: string | null;
  invoice_item_id: string | null;
  payment_id: string | null;
  paid_at: Date | null;
  refund_cents: number | null;
  refunded_at: Date | null;
  submitted_at: Date | null;
  category_name: string;
  embargo_at: Date | null;
  time_zone: string;
  early_bird_date: string;
  deadline_date: string;
  early_bird_fee_cents: number;
  standard_fee_cents: number;
  studio_name: string;
  studio_email: string;
  round_1_score: string | null;
  final_score: string | null;
}

interface AssetRow {
  id: string;
  entry_id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  bytes: number;
  storage_key: string;
}

export const ENTRY_SELECT = `
  SELECT e.id, e.program_id, e.category_id, e.studio_id, e.entry_number, e.title, e.summary, e.site_url, e.credits,
    e.state, e.award, e.disqualify_reason, e.fee_tier, e.fee_cents, e.invoice_id, e.invoice_item_id, e.payment_id,
    e.paid_at, e.refund_cents, e.refunded_at, e.submitted_at,
    c.name AS category_name, c.embargo_at, p.time_zone, p.early_bird_date, p.deadline_date, p.early_bird_fee_cents,
    p.standard_fee_cents, s.name AS studio_name, su.email AS studio_email, r1.score AS round_1_score, rf.score AS final_score
  FROM entries e
  JOIN categories c ON c.id = e.category_id
  JOIN programs p ON p.id = e.program_id
  JOIN studios s ON s.id = e.studio_id
  JOIN users su ON su.studio_id = e.studio_id AND su.role = 'studio'
  LEFT JOIN rounds k1 ON k1.category_id = e.category_id AND k1.kind = 'round_1'
  LEFT JOIN round_results r1 ON r1.round_id = k1.id AND r1.entry_id = e.id
  LEFT JOIN rounds kf ON kf.category_id = e.category_id AND kf.kind = 'final'
  LEFT JOIN round_results rf ON rf.round_id = kf.id AND rf.entry_id = e.id`;

const AWARDED = new Set<string>([...AWARDS, "published"]);

function statusLabel(state: EntryState, award: Award | null): string {
  return state === "published" ? STATUS_LABEL[award ?? "winner"] : STATUS_LABEL[state];
}

function assetView(asset: AssetRow) {
  return { id: asset.id, url: `/api/assets/${asset.id}`, name: asset.name, type: asset.type, width: asset.width,
    height: asset.height, bytes: asset.bytes };
}

/** What a studio may see of its own entry: results stay masked until the category's embargo passes. */
function studioFacing(entry: EntryRow, now: Date): { state: EntryState; award: Award | null; score: string | null } {
  const revealed = embargoPassed(entry.embargo_at, now);
  if (AWARDED.has(entry.state)) {
    return revealed ? { state: "published", award: entry.award, score: entry.final_score }
      : { state: "final_round", award: null, score: null };
  }
  return { state: entry.state, award: null, score: entry.state === "eliminated" && revealed ? entry.round_1_score : null };
}

/** The Entry projection for the owning studio, or EntryDirector (never masked) for the director. */
export function entryView(entry: EntryRow, assets: AssetRow[], viewer: "studio" | "director", now: Date) {
  const shown = viewer === "studio" ? studioFacing(entry, now)
    : { state: entry.state, award: entry.award, score: entry.final_score ?? entry.round_1_score };
  const canWithdraw = entry.state === "submitted";
  const view = {
    id: entry.id,
    entryNumber: entry.entry_number,
    programId: entry.program_id,
    categoryId: entry.category_id,
    categoryName: entry.category_name,
    title: entry.title,
    summary: entry.summary,
    siteUrl: entry.site_url,
    credits: entry.credits,
    state: shown.state,
    statusLabel: statusLabel(shown.state, shown.award),
    disqualifyReason: entry.state === "disqualified" ? entry.disqualify_reason : null,
    award: shown.award,
    score: shown.score,
    assets: assets.filter((a) => a.entry_id === entry.id).map(assetView),
    fee: entry.fee_tier && entry.fee_cents !== null ? { tier: entry.fee_tier, amountCents: entry.fee_cents } : null,
    submittedAt: entry.submitted_at?.toISOString() ?? null,
    deadlineLabel: deadlineLabel(entry.deadline_date, entry.time_zone),
    canWithdraw,
    refundOnWithdraw: canWithdraw && entriesOpen(entry, now),
  };
  return viewer === "studio" ? view
    : { ...view, studioId: entry.studio_id, studioName: entry.studio_name, studioEmail: entry.studio_email };
}

export async function assetsOf(db: Db, entryIds: string[]): Promise<AssetRow[]> {
  return many<AssetRow>(db, "SELECT id, entry_id, name, type, width, height, bytes, storage_key FROM assets WHERE entry_id = ANY($1) ORDER BY seq",
    [entryIds]);
}

export async function viewOf(db: Db, entry: EntryRow, viewer: "studio" | "director") {
  return entryView(entry, await assetsOf(db, [entry.id]), viewer, new Date());
}

export async function entryById(db: Db, id: string): Promise<EntryRow | null> {
  return one<EntryRow>(db, `${ENTRY_SELECT} WHERE e.id = $1`, [id]);
}

/** A juror may see an entry only while it is assigned to them in an open round. */
async function assignedInOpenRound(db: Db, jurorId: string, entryId: string): Promise<boolean> {
  return (await one(db, `SELECT 1 FROM assignments a JOIN rounds r ON r.id = a.round_id
    WHERE a.juror_id = $1 AND a.entry_id = $2 AND r.state = 'open' LIMIT 1`, [jurorId, entryId])) !== null;
}

/** The entry if the caller may see it, else 404 (brief: Business rules, Visibility). */
export async function visibleEntry(db: Db, user: SessionUser, id: string): Promise<EntryRow> {
  const entry = await entryById(db, id);
  const visible = entry !== null && (user.role === "director"
    || (user.role === "studio" && entry.studio_id === user.studio_id)
    || (user.role === "juror" && await assignedInOpenRound(db, user.id, entry.id)));
  if (!entry || !visible) throw refuse("not_found");
  return entry;
}

/** Loads the caller's own entry for a studio-only write, locked for the rest of the transaction. */
async function ownEntryForWrite(client: pg.PoolClient, req: ApiRequest): Promise<{ user: SessionUser; entry: EntryRow }> {
  const user = await requireUser(req);
  const found = await visibleEntry(client, user, req.params.id ?? "");
  requireRole(user, "studio");
  await lockKey(client, `entry:${found.id}`);
  return { user, entry: (await entryById(client, found.id)) as EntryRow };
}

function viewerOf(user: SessionUser): "studio" | "director" {
  requireRole(user, "studio", "director");
  return user.role === "director" ? "director" : "studio";
}

function checkEntryFields(body: Record<string, unknown>, errors: FieldErrors, partial: boolean): Record<string, string> {
  const values: Record<string, string> = {};
  const rules: [string, string, number, number, string][] = [
    ["title", "title", 1, 120, "Give a title of 1 to 120 characters."],
    ["summary", "summary", 1, 2000, "Give a case study of 1 to 2,000 characters."],
    ["credits", "credits", 0, 500, "Keep credits to 500 characters or fewer."],
  ];
  for (const [field, column, min, max, copy] of rules) {
    if (partial && body[field] === undefined) continue;
    const value = field === "credits" && body[field] === undefined ? "" : text(body[field], min, max);
    if (value === null) errors.add(field, copy);
    else values[column] = value;
  }
  if (!partial || body.siteUrl !== undefined) {
    const site = text(body.siteUrl, 9, 300);
    const valid = site !== null && /^https:\/\/[^\s/?#]+\.[^\s]*$/i.test(site) && URL.canParse(site);
    if (valid) values.site_url = site;
    else errors.add("siteUrl", "Give an https:// address of up to 300 characters.");
  }
  return values;
}

export async function createEntry(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "studio");
  const entry = await tx(async (client) => {
    const category = typeof req.body.categoryId === "string"
      ? await one<{ id: string; program_id: string; time_zone: string; early_bird_date: string; deadline_date: string }>(client,
        `SELECT c.id, c.program_id, p.time_zone, p.early_bird_date, p.deadline_date
         FROM categories c JOIN programs p ON p.id = c.program_id WHERE c.id = $1`, [req.body.categoryId])
      : null;
    if (category) guardEntriesOpen(category, new Date());
    const errors = new FieldErrors();
    if (!category) errors.add("categoryId", "Choose a category that is open for entries.");
    const values = checkEntryFields(req.body, errors, false);
    errors.throwIfAny();
    const open = category as NonNullable<typeof category>;
    const numbered = await one<{ last_entry_number: number }>(client,
      "UPDATE programs SET last_entry_number = last_entry_number + 1 WHERE id = $1 RETURNING last_entry_number", [open.program_id]);
    const id = randomUUID();
    await client.query(
      `INSERT INTO entries (id, program_id, category_id, studio_id, entry_number, title, summary, site_url, credits)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, open.program_id, open.id, user.studio_id, numbered?.last_entry_number, values.title, values.summary,
        values.site_url, values.credits ?? ""]);
    return viewOf(client, (await entryById(client, id)) as EntryRow, "studio");
  });
  return { status: 201, json: { entry } };
}

export async function listEntries(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "studio");
  const rows = await many<EntryRow>(pool, `${ENTRY_SELECT} WHERE e.studio_id = $1 ORDER BY e.created_at DESC`, [user.studio_id]);
  const assets = await assetsOf(pool, rows.map((r) => r.id));
  const now = new Date();
  return { status: 200, json: { entries: rows.map((r) => entryView(r, assets, "studio", now)) } };
}

export async function getEntry(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  const entry = await visibleEntry(pool, user, req.params.id ?? "");
  return { status: 200, json: { entry: await viewOf(pool, entry, viewerOf(user)) } };
}

export async function updateEntry(req: ApiRequest): Promise<ApiResult> {
  const entry = await tx(async (client) => {
    const { entry: found } = await ownEntryForWrite(client, req);
    guardEntry(found.state, "edit");
    guardEntriesOpen(found, new Date());
    const errors = new FieldErrors();
    if (req.body.categoryId !== undefined) {
      const moved = typeof req.body.categoryId === "string" && await one(client,
        "SELECT 1 FROM categories WHERE id = $1 AND program_id = $2", [req.body.categoryId, found.program_id]);
      if (!moved) errors.add("categoryId", "Choose a category in this entry's program.");
    }
    const values = checkEntryFields(req.body, errors, true);
    errors.throwIfAny();
    if (req.body.categoryId !== undefined) values.category_id = req.body.categoryId as string;
    const columns = Object.keys(values);
    if (columns.length) {
      await client.query(`UPDATE entries SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [found.id, ...columns.map((c) => values[c])]);
    }
    return viewOf(client, (await entryById(client, found.id)) as EntryRow, "studio");
  });
  return { status: 200, json: { entry } };
}

export async function deleteEntry(req: ApiRequest): Promise<ApiResult> {
  await tx(async (client) => {
    const { entry } = await ownEntryForWrite(client, req);
    guardEntry(entry.state, "delete");
    guardEntriesOpen(entry, new Date());
    await client.query("DELETE FROM entries WHERE id = $1", [entry.id]);
    try {
      await deletePrefix(`entries/${entry.id}/`);
    } catch (error) {
      throw error instanceof StorageUnavailable ? refuse("storage_unavailable") : error;
    }
  });
  return { status: 204 };
}

/** The original file name with any path removed, cut to 100 characters. */
function fileName(name: string): string {
  return [...(name.split(/[\\/]/).pop() ?? "")].slice(0, 100).join("");
}

export async function uploadAsset(req: ApiRequest): Promise<ApiResult> {
  const asset = await tx(async (client) => {
    const { entry } = await ownEntryForWrite(client, req);
    guardEntry(entry.state, "upload");
    guardEntriesOpen(entry, new Date());
    if (!req.upload) throw refuse("unsupported_type");
    const held = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM assets WHERE entry_id = $1", [entry.id]);
    const image = checkImage(req.upload.data, held?.n ?? 0);
    const id = randomUUID();
    const key = `entries/${entry.id}/${id}.${image.extension}`;
    try {
      await putObject(key, image.data, image.type);
    } catch (error) {
      throw error instanceof StorageUnavailable ? refuse("storage_unavailable") : error;
    }
    const row: AssetRow = { id, entry_id: entry.id, name: fileName(req.upload.name), type: image.type, width: image.width,
      height: image.height, bytes: image.data.length, storage_key: key };
    await client.query(
      "INSERT INTO assets (id, entry_id, name, type, width, height, bytes, storage_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [row.id, row.entry_id, row.name, row.type, row.width, row.height, row.bytes, row.storage_key]);
    return assetView(row);
  });
  return { status: 201, json: { asset } };
}

export async function removeAsset(req: ApiRequest): Promise<ApiResult> {
  await tx(async (client) => {
    const user = await requireUser(req);
    const entry = await visibleEntry(client, user, req.params.id ?? "");
    const asset = await one<AssetRow>(client, "SELECT id, entry_id, storage_key FROM assets WHERE id = $1 AND entry_id = $2",
      [req.params.assetId, entry.id]);
    if (!asset) throw refuse("not_found");
    requireRole(user, "studio");
    await lockKey(client, `entry:${entry.id}`);
    const fresh = (await entryById(client, entry.id)) as EntryRow;
    guardEntry(fresh.state, "remove_image");
    guardEntriesOpen(fresh, new Date());
    await client.query("DELETE FROM assets WHERE id = $1", [asset.id]);
    try {
      await deleteObject(asset.storage_key);
    } catch (error) {
      throw error instanceof StorageUnavailable ? refuse("storage_unavailable") : error;
    }
  });
  return { status: 204 };
}

function receiptView(entry: EntryRow) {
  return {
    entryNumber: entry.entry_number,
    title: entry.title,
    amountCents: entry.fee_cents,
    currency: "USD",
    tier: entry.fee_tier,
    invoiceId: entry.invoice_id,
    paymentId: entry.payment_id,
    paidAt: entry.paid_at?.toISOString() ?? null,
    refund: entry.refund_cents !== null && entry.refunded_at
      ? { amountCents: entry.refund_cents, refundedAt: entry.refunded_at.toISOString() } : null,
  };
}

function receiptMessage(entry: EntryRow, tier: FeeTier, amountCents: number, invoiceId: string, paidAt: Date): Message {
  const deadline = deadlineLabel(entry.deadline_date, entry.time_zone);
  return {
    to: entry.studio_email,
    subject: `Cutline receipt: Entry ${entry.entry_number} — ${entry.title}`,
    body: [
      `Thank you, ${entry.studio_name}. Entry ${entry.entry_number} — ${entry.title} is submitted.`,
      "",
      `Category: ${entry.category_name}`,
      `Entry fee: $${dollars(amountCents)} (${TIER_LABEL[tier]})`,
      `Invoice: ${invoiceId}`,
      `Paid: ${instantLabel(paidAt, entry.time_zone)}`,
      "",
      `Withdraw before ${deadline} for a full refund.`,
      "",
      "Cutline Jury Desk",
    ].join("\n"),
  };
}

const IDEMPOTENCY_KEY = /^.{1,100}$/su;

/** All or nothing: paid in Kill Bill, images confirmed in storage and the receipt sent, or an unchanged draft. */
export async function submitEntry(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  const header = req.headers["idempotency-key"];
  const key = typeof header === "string" && IDEMPOTENCY_KEY.test(header) ? header : null;
  return tx(async (client) => {
    const visible = await visibleEntry(client, user, req.params.id ?? "");
    requireRole(user, "studio");
    if (key) {
      await lockKey(client, `submit:${user.studio_id}:${key}`);
      const stored = await one<{ entry_id: string; status: number; body: unknown }>(client,
        "SELECT entry_id, status, body FROM idempotency_records WHERE studio_id = $1 AND key = $2", [user.studio_id, key]);
      if (stored && stored.entry_id !== visible.id) throw refuse("idempotency_key_reused");
      if (stored) return { status: stored.status, json: stored.body };
    }
    await lockKey(client, `entry:${visible.id}`);
    const entry = (await entryById(client, visible.id)) as EntryRow;
    guardEntry(entry.state, "submit");
    guardEntriesOpen(entry, new Date());
    const assets = await assetsOf(client, [entry.id]);
    const errors = new FieldErrors();
    errors.check(key !== null, "idempotencyKey", COPY.idempotencyKey);
    errors.check(assets.length > 0, "assets", COPY.assets);
    errors.throwIfAny();

    try {
      for (const asset of assets) {
        if (!(await objectExists(asset.storage_key))) throw new StorageUnavailable(`missing ${asset.storage_key}`);
      }
    } catch (error) {
      throw error instanceof StorageUnavailable ? refuse("storage_unavailable", COPY.storage_unavailable_submit) : error;
    }

    let mail;
    try {
      mail = await openMail(entry.studio_email);
    } catch (error) {
      if (!(error instanceof MailUnavailable)) throw error;
      throw refuse("mail_unavailable");
    }
    const fee = feeInEffect(entry, new Date());
    const description = `Entry ${entry.entry_number} — ${TIER_LABEL[fee.tier]} entry fee`;
    let charge;
    try {
      charge = await chargeEntryFee({ id: entry.studio_id, name: entry.studio_name, email: entry.studio_email }, entry.id,
        description, fee.amountCents);
    } catch (error) {
      mail.abort();
      if (!(error instanceof BillingUnavailable)) throw error;
      console.error(`entry ${entry.id}: ${error.message}`);
      throw refuse("payments_paused");
    }
    const paidAt = new Date();
    const receipt = receiptMessage(entry, fee.tier, fee.amountCents, charge.invoiceId, paidAt);
    try {
      await mail.send(receipt);
    } catch (error) {
      if (!(error instanceof MailUnavailable)) throw error;
      try {
        await refundEntryFee(charge.paymentId, charge.invoiceItemId, fee.amountCents);
      } catch (refundError) {
        if (!(refundError instanceof BillingUnavailable)) throw refundError;
        console.error(`entry ${entry.id}: receipt failed and the refund did not reach Kill Bill: ${refundError.message}`);
        throw refuse("payments_paused");
      }
      throw refuse("mail_unavailable");
    }

    await client.query(
      `UPDATE entries SET state = 'submitted', fee_tier = $2, fee_cents = $3, invoice_id = $4, invoice_item_id = $5,
         payment_id = $6, paid_at = $7, submitted_at = $7 WHERE id = $1`,
      [entry.id, fee.tier, fee.amountCents, charge.invoiceId, charge.invoiceItemId, charge.paymentId, paidAt]);
    await recordSentMail(client, "receipt", receipt);
    const submitted = (await entryById(client, entry.id)) as EntryRow;
    const body = { entry: entryView(submitted, assets, "studio", new Date()), receipt: receiptView(submitted) };
    await client.query("INSERT INTO idempotency_records (studio_id, key, entry_id, status, body) VALUES ($1, $2, $3, 201, $4)",
      [user.studio_id, key, entry.id, JSON.stringify(body)]);
    return { status: 201, json: body };
  });
}

/** Before the deadline: a full Kill Bill refund, then one database step; after it: withdrawn with no refund. */
export async function withdrawEntry(req: ApiRequest): Promise<ApiResult> {
  return tx(async (client) => {
    const { entry } = await ownEntryForWrite(client, req);
    guardEntry(entry.state, "withdraw");
    const fee = entry.fee_cents as number;
    const refunded = entriesOpen(entry, new Date());
    if (refunded) {
      try {
        await refundEntryFee(entry.payment_id as string, entry.invoice_item_id as string, fee);
      } catch (error) {
        throw error instanceof BillingUnavailable ? refuse("payments_paused", COPY.refunds_paused) : error;
      }
    }
    const refundedAt = refunded ? new Date() : null;
    await client.query("UPDATE entries SET state = 'withdrawn', refund_cents = $2, refunded_at = $3 WHERE id = $1",
      [entry.id, refunded ? fee : null, refundedAt]);
    if (refunded) {
      await queueMail(client, "refund", {
        to: entry.studio_email,
        subject: `Cutline refund: Entry ${entry.entry_number} — ${entry.title}`,
        body: [
          `Entry ${entry.entry_number} — ${entry.title} is withdrawn.`,
          "",
          `$${dollars(fee)} refunded to ${entry.studio_name} for invoice ${entry.invoice_id}.`,
          "",
          "Cutline Jury Desk",
        ].join("\n"),
      });
    }
    const after = (await entryById(client, entry.id)) as EntryRow;
    return {
      status: 200,
      json: {
        entry: await viewOf(client, after, "studio"),
        refund: refundedAt ? { amountCents: fee, refundedAt: refundedAt.toISOString() } : null,
      },
    };
  });
}

export async function getReceipt(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  const entry = await visibleEntry(pool, user, req.params.id ?? "");
  viewerOf(user);
  if (!entry.invoice_id) throw refuse("not_found");
  return { status: 200, json: { receipt: receiptView(entry) } };
}

export async function getInvoice(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  const found = await one<{ id: string }>(pool, "SELECT id FROM entries WHERE invoice_id = $1", [req.params.invoiceId]);
  if (!found) throw refuse("not_found");
  const entry = await visibleEntry(pool, user, found.id);
  viewerOf(user);
  return {
    status: 200,
    json: {
      invoice: {
        invoiceId: entry.invoice_id, entryNumber: entry.entry_number, amountCents: entry.fee_cents, currency: "USD",
        tier: entry.fee_tier, status: entry.refund_cents !== null ? "refunded" : "paid",
      },
    },
  };
}

/** Image bytes, re-encoded by the server, for callers allowed to see the entry (brief: Business rules, Visibility). */
export async function getAsset(req: ApiRequest): Promise<ApiResult> {
  const user = await optionalUser(req);
  const asset = await one<AssetRow & { entry_id: string }>(pool,
    "SELECT id, entry_id, name, type, width, height, bytes, storage_key FROM assets WHERE id = $1", [req.params.assetId]);
  const entry = asset ? await entryById(pool, asset.entry_id) : null;
  if (!asset || !entry) throw refuse("not_found");
  const publicNow = entry.state === "published" && embargoPassed(entry.embargo_at, new Date());
  const allowed = publicNow || (user !== null && (user.role === "director"
    || (user.role === "studio" && user.studio_id === entry.studio_id)
    || (user.role === "juror" && await assignedInOpenRound(pool, user.id, entry.id))));
  if (!allowed) throw refuse("not_found");
  let data: Buffer | null;
  try {
    data = await getObject(asset.storage_key);
  } catch (error) {
    throw error instanceof StorageUnavailable ? refuse("storage_unavailable") : error;
  }
  if (!data) throw refuse("not_found");
  return { status: 200, bytes: { data, type: asset.type }, headers: { "Cache-Control": "private, no-cache" } };
}
