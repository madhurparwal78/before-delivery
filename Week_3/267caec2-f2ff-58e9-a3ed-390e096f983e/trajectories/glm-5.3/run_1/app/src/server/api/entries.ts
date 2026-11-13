import type { App } from "../app.js";
import { errors } from "../http/errors.js";
import { newId, row, rows } from "../db.js";
import type { CategoryRow } from "../domain/programs.js";
import { programById } from "../domain/programs.js";
import { windowOpen, deadlineLabel } from "../domain/time.js";
import { isoUtc } from "../http/util.js";
import { assertTransition, studioView, tierLabel, feeTierAtPayment, feeForTier, STATUS_LABELS } from "../domain/entries.js";
import type { EntryState, FeeTier } from "../domain/entries.js";
import { acceptImage, assetKey, entryPrefix, MAX_IMAGES_PER_ENTRY } from "../domain/images.js";
import { StorageUnavailable } from "../providers/storage.js";
import { PaymentsUnavailable } from "../providers/killbill.js";
import { receiptEmail, refundEmail, enqueueEmail, dollars } from "../domain/mail.js";

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
  submitted_at: Date | null;
  paid_fee_cents: number | null;
  fee_tier: FeeTier | null;
  invoice_id: string | null;
  payment_id: string | null;
  paid_at: Date | null;
  refund_amount_cents: number | null;
  refunded_at: Date | null;
  disqualify_reason: string | null;
  award: string | null;
  r1_score: string | null;
  final_score: string | null;
}

interface AssetDbRow {
  id: string;
  entry_id: string;
  name: string;
  type: "image/png" | "image/jpeg";
  width: number;
  height: number;
  bytes: number;
}

async function assetsFor(db: App["db"], entryId: string): Promise<AssetDbRow[]> {
  return rows<AssetDbRow>(db, "SELECT * FROM assets WHERE entry_id = $1 ORDER BY sort ASC, created_at ASC", [entryId]);
}

function assetProjection(asset: AssetDbRow): Record<string, unknown> {
  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    name: asset.name,
    type: asset.type,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
  };
}

export async function entryProjection(app: App, entry: EntryRow, opts: { director: boolean }): Promise<Record<string, unknown>> {
  const program = await programById(app.db, entry.program_id);
  const category = await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [entry.category_id]);
  const assets = await assetsFor(app.db, entry.id);
  const embargoPassed = category?.published_at
    ? (category.embargo_at ? category.embargo_at.getTime() <= Date.now() : true)
    : false;
  const view = studioView(entry, embargoPassed);
  const deadlineOpen = program ? windowOpen(program.deadline_date, program.time_zone) : false;
  const projection: Record<string, unknown> = {
    id: entry.id,
    entryNumber: entry.entry_number,
    programId: entry.program_id,
    categoryId: entry.category_id,
    categoryName: category?.name ?? "",
    title: entry.title,
    summary: entry.summary,
    siteUrl: entry.site_url,
    credits: entry.credits,
    state: view.state,
    statusLabel: view.statusLabel,
    disqualifyReason: view.disqualifyReason,
    award: view.award,
    score: view.score,
    assets: assets.map(assetProjection),
    fee: entry.paid_fee_cents !== null && entry.fee_tier !== null ? { tier: entry.fee_tier, amountCents: entry.paid_fee_cents } : null,
    submittedAt: entry.submitted_at ? isoUtc(entry.submitted_at) : null,
    deadlineLabel: program ? deadlineLabel(program.deadline_date, program.time_zone) : null,
    canWithdraw: entry.state === "submitted",
    refundOnWithdraw: entry.state === "submitted" && deadlineOpen,
  };
  if (opts.director) {
    const studio = await row<{ id: string; name: string; contact_name: string; email: string }>(app.db, "SELECT id, name, contact_name, email FROM studios WHERE id = $1", [entry.studio_id]);
    projection.studioId = studio?.id ?? null;
    projection.studioName = studio?.name ?? null;
    projection.studioEmail = studio?.email ?? null;
    projection.state = entry.state;
    projection.statusLabel = STATUS_LABELS[entry.state];
    projection.score = entry.state === "eliminated" ? entry.r1_score : entry.final_score ?? entry.r1_score;
    projection.award = entry.award;
    projection.disqualifyReason = entry.disqualify_reason;
  }
  return projection;
}

function validateEntryFields(body: Record<string, unknown>, partial: boolean): { fields: Record<string, string>; title: string; summary: string; siteUrl: string; credits: string } {
  const fields: Record<string, string> = {};
  const title = typeof body.title === "string" ? body.title : "";
  const summary = typeof body.summary === "string" ? body.summary : "";
  const siteUrl = typeof body.siteUrl === "string" ? body.siteUrl : "";
  const credits = typeof body.credits === "string" ? body.credits : "";
  if (!partial || "title" in body) {
    if (title.length < 1 || title.length > 120) {
      fields.title = "Titles are 1 to 120 characters.";
    }
  }
  if (!partial || "summary" in body) {
    if (summary.length < 1 || summary.length > 2000) {
      fields.summary = "Case studies are 1 to 2000 characters.";
    }
  }
  if (!partial || "siteUrl" in body) {
    if (!/^https:\/\/\S+$/.test(siteUrl) || siteUrl.length > 300) {
      fields.siteUrl = "Site addresses are https:// URLs of at most 300 characters.";
    }
  }
  if (!partial || "credits" in body) {
    if (credits.length > 500) {
      fields.credits = "Credits are at most 500 characters.";
    }
  }
  return { fields, title, summary, siteUrl, credits };
}

export function registerEntryRoutes(app: App): void {
  app.post("/api/entries", "studio", async (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
    if (!categoryId) {
      fields.categoryId = "Choose a category.";
    }
    const category = categoryId
      ? await row<CategoryRow & { program_id: string; time_zone: string; deadline_date: string }>(app.db, `
          SELECT c.*, p.time_zone, p.deadline_date FROM categories c JOIN programs p ON p.id = c.program_id WHERE c.id = $1
        `, [categoryId])
      : null;
    if (!category && !fields.categoryId) {
      fields.categoryId = "Choose a category.";
    }
    const validated = validateEntryFields(body, false);
    Object.assign(fields, validated.fields);
    if (Object.keys(fields).length > 0) {
      throw errors.validation(fields);
    }
    if (!category) {
      throw errors.validation({ categoryId: "Choose a category." });
    }
    const program = await programById(app.db, category.program_id);
    if (!program) {
      throw errors.notFound();
    }
    if (!windowOpen(program.deadline_date, program.time_zone)) {
      throw errors.deadlinePassed(deadlineLabel(program.deadline_date, program.time_zone));
    }
    const entryId = newId("ent");
    await app.db.transaction(async (client) => {
      const counter = await client.query<{ next_entry_number: number }>(
        "UPDATE program_counters SET next_entry_number = next_entry_number + 1 WHERE program_id = $1 RETURNING next_entry_number - 1 AS next_entry_number",
        [program.id],
      );
      const entryNumber = counter.rows[0]?.next_entry_number ?? 1;
      await client.query(
        `INSERT INTO entries (id, program_id, category_id, studio_id, entry_number, title, summary, site_url, credits, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')`,
        [entryId, program.id, category.id, ctx.auth!.studioId, entryNumber, validated.title, validated.summary, validated.siteUrl, validated.credits],
      );
    });
    const entry = (await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [entryId]))!;
    return { status: 201, body: { entry: await entryProjection(app, entry, { director: false }) } };
  });

  app.get("/api/entries", "studio", async (ctx) => {
    const entries = await rows<EntryRow>(app.db, "SELECT * FROM entries WHERE studio_id = $1 ORDER BY created_at DESC", [ctx.auth!.studioId]);
    const result = [];
    for (const entry of entries) {
      result.push(await entryProjection(app, entry, { director: false }));
    }
    return { body: { entries: result } };
  });

  app.get("/api/entries/:id", "signedIn", async (ctx) => {
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry) {
      throw errors.notFound();
    }
    const isDirector = ctx.auth!.role === "director";
    const isOwner = ctx.auth!.role === "studio" && ctx.auth!.studioId === entry.studio_id;
    if (!isDirector && !isOwner) {
      throw errors.notFound();
    }
    return { body: { entry: await entryProjection(app, entry, { director: isDirector }) } };
  });

  app.patch("/api/entries/:id", "studio", async (ctx) => {
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry || entry.studio_id !== ctx.auth!.studioId) {
      throw errors.notFound();
    }
    assertTransition(entry.state, "edit");
    const program = await programById(app.db, entry.program_id);
    if (!program) {
      throw errors.notFound();
    }
    if (!windowOpen(program.deadline_date, program.time_zone)) {
      throw errors.deadlinePassed(deadlineLabel(program.deadline_date, program.time_zone));
    }
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const validated = validateEntryFields(body, true);
    if (Object.keys(validated.fields).length > 0) {
      throw errors.validation(validated.fields);
    }
    const title = "title" in body ? validated.title : entry.title;
    const summary = "summary" in body ? validated.summary : entry.summary;
    const siteUrl = "siteUrl" in body ? validated.siteUrl : entry.site_url;
    const credits = "credits" in body ? validated.credits : entry.credits;
    await app.db.query(
      "UPDATE entries SET title = $2, summary = $3, site_url = $4, credits = $5 WHERE id = $1",
      [entry.id, title, summary, siteUrl, credits],
    );
    const updated = (await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [entry.id]))!;
    return { body: { entry: await entryProjection(app, updated, { director: false }) } };
  });

  app.delete("/api/entries/:id", "studio", async (ctx) => {
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry || entry.studio_id !== ctx.auth!.studioId) {
      throw errors.notFound();
    }
    assertTransition(entry.state, "delete");
    const program = await programById(app.db, entry.program_id);
    if (program && !windowOpen(program.deadline_date, program.time_zone)) {
      throw errors.deadlinePassed(deadlineLabel(program.deadline_date, program.time_zone));
    }
    try {
      await app.storage.deletePrefix(entryPrefix(entry.id));
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        throw errors.storageUnavailable("Image storage is unavailable. Your draft is saved — try again shortly.");
      }
      throw error;
    }
    await app.db.query("DELETE FROM entries WHERE id = $1", [entry.id]);
    return { status: 204, body: null };
  });

  app.post("/api/entries/:id/assets", "studio", async (ctx) => {
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry || entry.studio_id !== ctx.auth!.studioId) {
      throw errors.notFound();
    }
    assertTransition(entry.state, "upload");
    const program = await programById(app.db, entry.program_id);
    if (program && !windowOpen(program.deadline_date, program.time_zone)) {
      throw errors.deadlinePassed(deadlineLabel(program.deadline_date, program.time_zone));
    }
    const existing = await assetsFor(app.db, entry.id);
    if (existing.length >= MAX_IMAGES_PER_ENTRY) {
      throw errors.validation({ file: "An entry holds at most 6 images." });
    }
    const file = (ctx.body as { file?: { name: string; data: Buffer } }).file;
    if (!file) {
      throw errors.validation({ file: "Choose an image to upload." });
    }
    const accepted = acceptImage(file.data);
    const assetId = newId("ast");
    try {
      await app.storage.put(assetKey(entry.id, assetId, accepted.type), accepted.bytes, accepted.type);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        throw errors.storageUnavailable("Image storage is unavailable. Your draft is saved — try the upload again shortly.");
      }
      throw error;
    }
    const name = file.name.replace(/^.*[\\/]/, "").slice(0, 100);
    await app.db.query(
      "INSERT INTO assets (id, entry_id, name, type, width, height, bytes, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [assetId, entry.id, name, accepted.type, accepted.width, accepted.height, accepted.bytes.length, existing.length],
    );
    return {
      status: 201,
      body: {
        asset: {
          id: assetId,
          url: `/api/assets/${assetId}`,
          name,
          type: accepted.type,
          width: accepted.width,
          height: accepted.height,
          bytes: accepted.bytes.length,
        },
      },
    };
  });

  app.delete("/api/entries/:id/assets/:assetId", "studio", async (ctx) => {
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry || entry.studio_id !== ctx.auth!.studioId) {
      throw errors.notFound();
    }
    const asset = await row<AssetDbRow>(app.db, "SELECT * FROM assets WHERE id = $1 AND entry_id = $2", [ctx.params.assetId, entry.id]);
    if (!asset) {
      throw errors.notFound();
    }
    assertTransition(entry.state, "remove_image");
    const program = await programById(app.db, entry.program_id);
    if (program && !windowOpen(program.deadline_date, program.time_zone)) {
      throw errors.deadlinePassed(deadlineLabel(program.deadline_date, program.time_zone));
    }
    try {
      await app.storage.delete(assetKey(entry.id, asset.id, asset.type));
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        throw errors.storageUnavailable("Image storage is unavailable. Your draft is saved — try again shortly.");
      }
      throw error;
    }
    await app.db.query("DELETE FROM assets WHERE id = $1", [asset.id]);
    return { status: 204, body: null };
  });

  app.post("/api/entries/:id/submit", "studio", async (ctx) => {
    const idempotencyKey = ctx.idempotencyKey;
    if (!idempotencyKey || idempotencyKey.length < 1 || idempotencyKey.length > 100) {
      throw errors.validation({ idempotencyKey: "Send an Idempotency-Key header of 1 to 100 characters." });
    }
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry || entry.studio_id !== ctx.auth!.studioId) {
      throw errors.notFound();
    }
    const program = await programById(app.db, entry.program_id);
    if (!program) {
      throw errors.notFound();
    }
    const studio = await row<{ id: string; name: string; email: string }>(app.db, "SELECT id, name, email FROM studios WHERE id = $1", [entry.studio_id]);
    if (!studio) {
      throw errors.notFound();
    }
    const category = await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [entry.category_id]);

    const result = await app.db.transaction(async (client) => {
      // Lock the entry first: parallel submits of one draft settle here in one order.
      const locked = await client.query<EntryRow>("SELECT * FROM entries WHERE id = $1 FOR UPDATE", [entry.id]);
      const current = locked.rows[0];
      if (!current) {
        throw errors.notFound();
      }
      // Idempotency: replay a stored 201, refuse a key reused for another entry.
      const existing = await client.query<{ entry_id: string | null; status: number | null; body: unknown }>(
        "SELECT entry_id, status, body FROM idempotency WHERE studio_id = $1 AND key = $2 FOR UPDATE",
        [ctx.auth!.studioId, idempotencyKey],
      );
      const stored = existing.rows[0];
      if (stored && stored.status === 201) {
        if (stored.entry_id !== entry.id) {
          throw errors.idempotencyKeyReused();
        }
        return { replay: true, status: 201, body: stored.body };
      }
      assertTransition(current.state, "submit");
      if (!windowOpen(program.deadline_date, program.time_zone)) {
        throw errors.deadlinePassed(deadlineLabel(program.deadline_date, program.time_zone));
      }
      const assetRows = await client.query<{ id: string }>("SELECT id FROM assets WHERE entry_id = $1", [entry.id]);
      if (assetRows.rows.length === 0) {
        throw errors.validation({ assets: "Add at least one case-study image." });
      }
      // Claim the key so parallel calls serialise behind the entry lock.
      await client.query(
        `INSERT INTO idempotency (studio_id, key, entry_id, status, body) VALUES ($1, $2, $3, NULL, NULL)
         ON CONFLICT (studio_id, key) DO NOTHING`,
        [ctx.auth!.studioId, idempotencyKey, entry.id],
      );
      // Storage must confirm every image object before anything is charged.
      try {
        for (const assetRow of assetRows.rows) {
          const asset = await client.query<{ type: "image/png" | "image/jpeg" }>("SELECT type FROM assets WHERE id = $1", [assetRow.id]);
          const type = asset.rows[0].type;
          await app.storage.get(assetKey(entry.id, assetRow.id, type));
        }
      } catch (error) {
        if (error instanceof StorageUnavailable) {
          throw errors.storageUnavailable("Image storage is unavailable, so nothing was charged. Your draft is saved — try again shortly.");
        }
        throw error;
      }
      // The fee tier is fixed at the moment of payment.
      const tier = feeTierAtPayment(program);
      const feeCents = feeForTier(program, tier);
      let invoiceId: string | null = null;
      let paymentId: string | null = null;
      try {
        const accountId = await app.killbill.ensureAccount(studio.id, studio.name, studio.email);
        const paymentMethodId = await app.killbill.ensureExternalPaymentMethod(accountId);
        const invoice = await app.killbill.createInvoice(
          accountId,
          feeCents,
          `Entry ${current.entry_number} — ${tierLabel(tier)} entry fee`,
        );
        invoiceId = invoice.invoiceId;
        const payment = await app.killbill.createPurchase(accountId, paymentMethodId, feeCents, entry.id);
        paymentId = payment.paymentId;
      } catch (error) {
        if (error instanceof PaymentsUnavailable) {
          if (invoiceId) {
            await app.killbill.adjustInvoiceToZero(invoiceId);
          }
          throw errors.paymentsPaused("Payments are paused. Your draft is saved — try again shortly.");
        }
        throw error;
      }
      // The receipt must be sent for the submission to complete.
      const receipt = receiptEmail({
        entryNumber: current.entry_number,
        title: current.title,
        categoryName: category?.name ?? "",
        feeCents,
        tierLabel: tierLabel(tier),
        invoiceId: invoiceId ?? "",
        deadlineLabel: deadlineLabel(program.deadline_date, program.time_zone),
      });
      const mail = await app.mailer.send(studio.email, receipt.subject, `${receipt.body}\nPaid: $${dollars(feeCents)}\n`);
      if (!mail.ok) {
        if (paymentId) {
          await app.killbill.createRefund(paymentId, feeCents, entry.id);
        }
        if (invoiceId) {
          await app.killbill.adjustInvoiceToZero(invoiceId);
        }
        throw errors.mailUnavailable("We couldn't send your receipt, so nothing was charged. Your draft is saved — try again shortly.");
      }
      const paidAt = new Date();
      await client.query(
        `UPDATE entries SET state = 'submitted', submitted_at = $2, paid_fee_cents = $3, fee_tier = $4,
         invoice_id = $5, payment_id = $6, paid_at = $2 WHERE id = $1`,
        [entry.id, paidAt, feeCents, tier, invoiceId, paymentId],
      );
      await client.query(
        `INSERT INTO killbill_mirror (invoice_id, studio_id, entry_id, entry_number, amount_cents, currency, tier, status, paid_at)
         VALUES ($1, $2, $3, $4, $5, 'USD', $6, 'paid', $7)`,
        [invoiceId, studio.id, entry.id, current.entry_number, feeCents, tier, paidAt],
      );
      const receiptBody = {
        entryNumber: current.entry_number,
        title: current.title,
        amountCents: feeCents,
        currency: "USD",
        tier,
        invoiceId,
        paymentId,
        paidAt: isoUtc(paidAt),
        refund: null,
      };
      const responseBody = {
        entry: await entryProjection(app, { ...current, state: "submitted", submitted_at: paidAt, paid_fee_cents: feeCents, fee_tier: tier, invoice_id: invoiceId, payment_id: paymentId, paid_at: paidAt }, { director: false }),
        receipt: receiptBody,
      };
      await client.query(
        "UPDATE idempotency SET status = 201, body = $3 WHERE studio_id = $1 AND key = $2",
        [ctx.auth!.studioId, idempotencyKey, JSON.stringify(responseBody)],
      );
      return { replay: false, status: 201, body: responseBody };
    });
    return { status: result.status, body: result.body };
  });

  app.post("/api/entries/:id/withdraw", "studio", async (ctx) => {
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry || entry.studio_id !== ctx.auth!.studioId) {
      throw errors.notFound();
    }
    const program = await programById(app.db, entry.program_id);
    if (!program) {
      throw errors.notFound();
    }
    const deadlineOpen = windowOpen(program.deadline_date, program.time_zone);
    const refundMessage = "Refunds are paused. Your entry is still submitted — try again shortly.";
    const result = await app.db.transaction(async (client) => {
      const locked = await client.query<EntryRow>("SELECT * FROM entries WHERE id = $1 FOR UPDATE", [entry.id]);
      const current = locked.rows[0];
      if (!current) {
        throw errors.notFound();
      }
      assertTransition(current.state, "withdraw");
      let refund: { amountCents: number; refundedAt: string } | null = null;
      if (deadlineOpen && current.paid_fee_cents !== null && current.payment_id) {
        try {
          await app.killbill.createRefund(current.payment_id, current.paid_fee_cents, current.id);
        } catch (error) {
          if (error instanceof PaymentsUnavailable) {
            throw errors.paymentsPaused(refundMessage);
          }
          throw error;
        }
        const refundedAt = new Date();
        await client.query(
          "UPDATE entries SET state = 'withdrawn', refund_amount_cents = $2, refunded_at = $3 WHERE id = $1",
          [current.id, current.paid_fee_cents, refundedAt],
        );
        await client.query("UPDATE killbill_mirror SET status = 'refunded' WHERE entry_id = $1", [current.id]);
        const studio = await client.query<{ email: string }>("SELECT email FROM studios WHERE id = $1", [current.studio_id]);
        const email = refundEmail(current.entry_number, current.title, current.paid_fee_cents ?? 0);
        await enqueueEmail(client, "refund", studio.rows[0]?.email ?? "", email.subject, email.body);
        refund = { amountCents: current.paid_fee_cents ?? 0, refundedAt: isoUtc(refundedAt) };
      } else {
        await client.query("UPDATE entries SET state = 'withdrawn' WHERE id = $1", [current.id]);
      }
      const updated = await client.query<EntryRow>("SELECT * FROM entries WHERE id = $1", [current.id]);
      return { entry: updated.rows[0], refund };
    });
    return { status: 200, body: { entry: await entryProjection(app, result.entry, { director: false }), refund: result.refund } };
  });

  app.get("/api/entries/:id/receipt", "signedIn", async (ctx) => {
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry) {
      throw errors.notFound();
    }
    const isDirector = ctx.auth!.role === "director";
    const isOwner = ctx.auth!.role === "studio" && ctx.auth!.studioId === entry.studio_id;
    if (!isDirector && !isOwner) {
      throw errors.notFound();
    }
    if (!entry.paid_fee_cents || !entry.fee_tier) {
      throw errors.notFound();
    }
    return {
      body: {
        receipt: {
          entryNumber: entry.entry_number,
          title: entry.title,
          amountCents: entry.paid_fee_cents,
          currency: "USD",
          tier: entry.fee_tier,
          invoiceId: entry.invoice_id,
          paymentId: entry.payment_id,
          paidAt: entry.paid_at ? isoUtc(entry.paid_at) : null,
          refund: entry.refunded_at
            ? { amountCents: entry.refund_amount_cents ?? entry.paid_fee_cents, refundedAt: isoUtc(entry.refunded_at) }
            : null,
        },
      },
    };
  });

  app.get("/api/invoices/:invoiceId", "signedIn", async (ctx) => {
    const invoice = await row<{
      invoice_id: string; entry_id: string; studio_id: string; entry_number: number; amount_cents: number; currency: string; tier: string; status: string;
    }>(app.db, "SELECT * FROM killbill_mirror WHERE invoice_id = $1", [ctx.params.invoiceId]);
    if (!invoice) {
      throw errors.notFound();
    }
    const isDirector = ctx.auth!.role === "director";
    const isOwner = ctx.auth!.role === "studio" && ctx.auth!.studioId === invoice.studio_id;
    if (!isDirector && !isOwner) {
      throw errors.notFound();
    }
    return {
      body: {
        invoice: {
          invoiceId: invoice.invoice_id,
          entryNumber: invoice.entry_number,
          amountCents: invoice.amount_cents,
          currency: invoice.currency,
          tier: invoice.tier,
          status: invoice.status,
        },
      },
    };
  });

  app.get("/api/assets/:assetId", "public", async (ctx) => {
    const asset = await row<AssetDbRow>(app.db, "SELECT * FROM assets WHERE id = $1", [ctx.params.assetId]);
    if (!asset) {
      throw errors.notFound();
    }
    const entry = await row<EntryRow>(app.db, "SELECT * FROM entries WHERE id = $1", [asset.entry_id]);
    if (!entry) {
      throw errors.notFound();
    }
    let allowed = false;
    if (ctx.auth) {
      if (ctx.auth.role === "director") {
        allowed = true;
      } else if (ctx.auth.role === "studio" && ctx.auth.studioId === entry.studio_id) {
        allowed = true;
      } else if (ctx.auth.role === "juror") {
        const assigned = await row<{ id: string }>(
          app.db,
          `SELECT a.id FROM assignments a JOIN rounds r ON r.id = a.round_id
           WHERE a.juror_id = $1 AND a.entry_id = $2 AND r.state = 'open'`,
          [ctx.auth.userId, entry.id],
        );
        allowed = Boolean(assigned);
      }
    }
    if (!allowed) {
      // Published entries' images are public once the embargo has passed.
      const category = await row<{ embargo_at: Date | null; published_at: Date | null }>(app.db, "SELECT embargo_at, published_at FROM categories WHERE id = $1", [entry.category_id]);
      if (entry.state === "published" && category?.published_at && category.embargo_at && category.embargo_at.getTime() <= Date.now()) {
        allowed = true;
      }
    }
    if (!allowed) {
      throw errors.notFound();
    }
    let bytes: Buffer;
    try {
      bytes = await app.storage.get(assetKey(entry.id, asset.id, asset.type));
    } catch {
      throw errors.notFound();
    }
    return { raw: bytes, contentType: asset.type };
  });
}
