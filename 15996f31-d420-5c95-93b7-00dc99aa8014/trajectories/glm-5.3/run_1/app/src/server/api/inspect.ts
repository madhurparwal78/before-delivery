import type { Response } from "express";
import Busboy from "busboy";
import { one, withTransaction } from "../db.ts";
import { ApiError } from "../errors.ts";
import { newId } from "../seed.ts";
import {
  loadOrderContext, sha256, newToken, audit, strengthByBlock, deliveredHivesByBlock, samplesRequired,
  orchardPayableCents, type LinkRow, type OrderContext, type PhotoRow,
} from "../store.ts";
import { TIER_LABELS, type Tier } from "../domain/model.ts";
import { formatDateTimeText, formatAverage, formatMoney } from "../domain/dates.ts";
import { buildReportPdf, type ReportBlock } from "../services/pdf.ts";
import { queueEmail } from "../services/mailer.ts";
import { detectImageFormat, contentTypeFor, type PhotoFormat } from "../services/storage.ts";
import type { AppServices, TypedRequest } from "../context.ts";
import { bodyOf, param } from "../context.ts";
import { idempotent, idempotencyKeyOf } from "./idempotency.ts";

const PHOTO_LIMIT = 8_000_000;

export interface LinkContext {
  link: LinkRow;
  context: OrderContext;
}

/** Resolves a link token: unknown tokens answer 404, dead ones 410. */
export async function resolveLink(services: AppServices, token: string): Promise<LinkContext> {
  const link = await one<LinkRow>(services.pool, "SELECT * FROM inspection_links WHERE token_hash = $1", [sha256(token)]);
  if (!link) throw ApiError.notFound();
  const context = await loadOrderContext(services.pool, link.order_id);
  if (!context) throw ApiError.notFound();
  return { link, context };
}

export function assertLinkLive(link: LinkRow): void {
  if (link.status === "signed") {
    throw new ApiError(410, "link_signed", "The report for this orchard has been signed.");
  }
  if (link.status === "expired" || link.expires_at.getTime() <= Date.now()) {
    throw new ApiError(410, "link_expired", "Ask the broker for a new link.");
  }
}

/** GET /api/inspect/{token} — the inspection sheet, no sign-in. */
export async function inspectionSheet(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const { link, context } = await resolveLink(services, param(req, "token"));
  assertLinkLive(link);
  if (link.status === "issued") {
    await services.pool.query(
      "UPDATE inspection_links SET status = 'used', used_at = now() WHERE id = $1 AND status = 'issued'",
      [link.id],
    );
  }
  const delivered = deliveredHivesByBlock(context);
  const strengths = strengthByBlock(context);
  const blocks = context.blocks.map((block) => {
    const strength = strengths.get(block.id)!;
    const yards = context.drops
      .filter((d) => d.block_id === block.id && d.status !== "committed")
      .sort((a, b) => (`${a.delivered_on}${a.id}`).localeCompare(`${b.delivered_on}${b.id}`))
      .map((d) => ({ drop_id: d.id, yard_name: d.yard_name, hives: d.hives }));
    const samples = context.samples
      .filter((s) => s.block_id === block.id)
      .map((sample) => ({
        id: sample.id,
        drop_id: sample.drop_id,
        colony_label: sample.colony_label,
        frames: sample.frames_tenths / 10,
        photos: (context.photos.get(sample.id) ?? []).map((photo) => ({
          id: photo.id,
          url: `/api/inspect/${req.params.token}/photos/${photo.id}`,
        })),
      }));
    return {
      id: block.id,
      name: block.name,
      hives_delivered: delivered.get(block.id) ?? 0,
      samples_required: samplesRequired(delivered.get(block.id) ?? 0),
      sample_count: strength.sample_count,
      average_frames: strength.average_frames,
      tier: strength.tier,
      payable_cents: strength.payable_cents,
      yards,
      samples,
    };
  });
  res.status(200).json({
    order: { ref: context.order.ref },
    orchard: { name: context.orchard.name, county: context.orchard.county },
    link: { status: link.status === "issued" ? "used" : link.status, expires_at: link.expires_at.toISOString() },
    blocks,
    payable_cents: orchardPayableCents(context),
  });
}

/** The block strength and orchard payable in the sample-change shape. */
async function blockAndPayable(services: AppServices, orderId: string, blockId: string): Promise<{
  block: { id: string; sample_count: number; average_frames: number | null; tier: string | null; payable_cents: number };
  payable_cents: number;
}> {
  const context = await loadOrderContext(services.pool, orderId);
  if (!context) throw ApiError.notFound();
  const strengths = strengthByBlock(context);
  const strength = strengths.get(blockId)!;
  return {
    block: {
      id: blockId,
      sample_count: strength.sample_count,
      average_frames: strength.average_frames,
      tier: strength.tier,
      payable_cents: strength.payable_cents,
    },
    payable_cents: orchardPayableCents(context),
  };
}

/** POST /api/inspect/{token}/samples — the inspector records a sample. */
export async function addSample(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const { link, context } = await resolveLink(services, param(req, "token"));
  assertLinkLive(link);
  const body = bodyOf(req);
  const blockId = typeof body.block_id === "string" ? body.block_id : "";
  const dropId = typeof body.drop_id === "string" ? body.drop_id : "";
  const colonyLabel = typeof body.colony_label === "string" ? body.colony_label.trim() : "";
  const frames = typeof body.frames === "number" ? body.frames : Number.NaN;

  const block = context.blocks.find((b) => b.id === blockId);
  if (!block) throw ApiError.notFound();

  const fields: Record<string, string> = {};
  const delivered = deliveredHivesByBlock(context);
  const drop = context.drops.find((d) => d.id === dropId && d.block_id === blockId && d.status !== "committed");
  if (!drop) fields.drop_id = "Choose a yard delivered to this block";
  if (colonyLabel.length < 1 || colonyLabel.length > 20) {
    fields.colony_label = "Colony must be 1 to 20 characters";
  } else if (context.samples.some((s) => s.block_id === blockId && s.colony_label === colonyLabel)) {
    fields.colony_label = `Colony ${colonyLabel} is already sampled in ${block.name}`;
  }
  if (!Number.isFinite(frames) || frames < 0 || frames > 20 || Math.round(frames * 10) !== frames * 10) {
    fields.frames = "Frames must be from 0.0 to 20.0 with one decimal";
  }
  const blockDelivered = delivered.get(blockId) ?? 0;
  if (context.samples.filter((s) => s.block_id === blockId).length >= blockDelivered) {
    fields.block_id = `${block.name} already has a sample for every hive`;
  }
  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

  const sampleId = newId("smp");
  await withTransaction(services.pool, async (client) => {
    await client.query(
      `INSERT INTO samples (id, order_id, block_id, drop_id, colony_label, frames_tenths)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sampleId, context.order.id, blockId, dropId, colonyLabel, Math.round(frames * 10)],
    );
    await audit(client, "sample", sampleId, "recorded", link.inspector_email);
  });

  const strength = await blockAndPayable(services, context.order.id, blockId);
  res.status(201).json({
    sample: {
      id: sampleId,
      drop_id: dropId,
      colony_label: colonyLabel,
      frames,
      photos: [],
    },
    block: strength.block,
    payable_cents: strength.payable_cents,
  });
}

/** DELETE /api/inspect/{token}/samples/{id} — the inspector removes a sample. */
export async function removeSample(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const { link, context } = await resolveLink(services, param(req, "token"));
  assertLinkLive(link);
  const sample = context.samples.find((s) => s.id === req.params.sampleId);
  if (!sample) throw ApiError.notFound();
  await withTransaction(services.pool, async (client) => {
    await client.query("DELETE FROM photos WHERE sample_id = $1", [sample.id]);
    await client.query("DELETE FROM samples WHERE id = $1", [sample.id]);
    await audit(client, "sample", sample.id, "removed", link.inspector_email);
  });
  res.status(200).json(await blockAndPayable(services, context.order.id, sample.block_id));
}

/** Streams the one `photo` file field, rejecting anything over the limit. */
function readMultipartFile(req: TypedRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fields: 4, fieldSize: 1024 } });
    let settled = false;
    const chunks: Buffer[] = [];
    let total = 0;
    let sawFile = false;
    const tooLarge = () => {
      if (settled) return;
      settled = true;
      reject(new ApiError(413, "payload_too_large", "Photos must be 8,000,000 bytes or smaller.", {
        fields: { photo: "Photos must be 8,000,000 bytes or smaller." },
      }));
      req.destroy();
    };
    busboy.on("file", (name, stream) => {
      if (name !== "photo") {
        stream.resume();
        return;
      }
      sawFile = true;
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > PHOTO_LIMIT) {
          tooLarge();
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        if (!settled) {
          settled = true;
          resolve(Buffer.concat(chunks));
        }
      });
    });
    busboy.on("finish", () => {
      if (settled) return;
      settled = true;
      if (sawFile) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new ApiError(422, "validation_failed", "Choose a JPEG, PNG or WebP photo.", {
          fields: { photo: "Choose a JPEG, PNG or WebP photo" },
        }));
      }
    });
    busboy.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    req.pipe(busboy);
  });
}

/** POST /api/inspect/{token}/samples/{id}/photos — a frame photo, judged by content. */
export async function uploadSamplePhoto(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const { link, context } = await resolveLink(services, param(req, "token"));
  assertLinkLive(link);
  const sample = context.samples.find((s) => s.id === req.params.sampleId);
  if (!sample) throw ApiError.notFound();
  if ((context.photos.get(sample.id) ?? []).length >= 4) {
    throw ApiError.validation({ photo: "A sample holds at most 4 photos" });
  }
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new ApiError(415, "unsupported_media_type", "Photos must be JPEG, PNG or WebP images.", {
      fields: { photo: "Photos must be JPEG, PNG or WebP images." },
    });
  }

  const bytes = await readMultipartFile(req);
  const format = detectImageFormat(bytes);
  if (!format) {
    throw new ApiError(415, "unsupported_media_type", "Photos must be JPEG, PNG or WebP images.", {
      fields: { photo: "Photos must be JPEG, PNG or WebP images." },
    });
  }
  const photoId = newId("pht");
  const key = services.storage.photoKey(context.order.id, photoId, format);
  await services.storage.put(key, bytes, contentTypeFor(format));
  await withTransaction(services.pool, async (client) => {
    await client.query(
      "INSERT INTO photos (id, sample_id, s3_key, content_type, ext) VALUES ($1,$2,$3,$4,$5)",
      [photoId, sample.id, key, contentTypeFor(format), format],
    );
    await audit(client, "photo", photoId, "uploaded", link.inspector_email);
  });
  res.status(201).json({ photo: { id: photoId, url: `/api/inspect/${req.params.token}/photos/${photoId}` } });
}

/** GET /api/inspect/{token}/photos/{id} — 302 to a short-lived photo link. */
export async function inspectionPhoto(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const { link, context } = await resolveLink(services, param(req, "token"));
  assertLinkLive(link);
  const photo = await one<PhotoRow>(services.pool, "SELECT * FROM photos WHERE id = $1", [req.params.photoId]);
  const belongs = photo ? context.photos.get(photo.sample_id) : undefined;
  if (!photo || !belongs) throw ApiError.notFound();
  const token = newToken();
  await services.pool.query(
    "INSERT INTO file_links (token_hash, kind, photo_id, expires_at) VALUES ($1,'photo',$2,$3)",
    [sha256(token), photo.id, new Date(Date.now() + services.config.fileUrlTtlSeconds * 1000).toISOString()],
  );
  res.setHeader("Location", `/files/${token}`);
  res.status(302).end();
}

/** POST /api/inspect/{token}/sign — all-or-nothing signing. */
export async function signReport(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const token = param(req, "token");
  const key = idempotencyKeyOf(req);
  const body = bodyOf(req);
  const bodyText = JSON.stringify(body);

  const result = await idempotent(services.pool, "sign", token, key, bodyText, async () => {
    const { link, context } = await resolveLink(services, token);
    assertLinkLive(link);
    const fields: Record<string, string> = {};
    const inspectorName = typeof body.inspector_name === "string" ? body.inspector_name.trim() : "";
    if (inspectorName.length < 2 || inspectorName.length > 80) {
      fields.inspector_name = "Full name must be 2 to 80 characters";
    }
    if (body.attest !== true) {
      fields.attest = "Confirm that you counted these colonies";
    }
    if (!key || key.length < 1 || key.length > 100) {
      fields["Idempotency-Key"] = "Idempotency-Key must be 1 to 100 characters";
    }
    const delivered = deliveredHivesByBlock(context);
    const strengths = strengthByBlock(context);
    for (const block of context.blocks) {
      const blockDelivered = delivered.get(block.id) ?? 0;
      if (blockDelivered === 0) continue;
      const required = samplesRequired(blockDelivered);
      const taken = context.samples.filter((s) => s.block_id === block.id).length;
      if (taken < required) {
        fields[block.id] = `${block.name} needs ${required - taken} more samples`;
      }
    }
    if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

    const payable = orchardPayableCents(context);
    const reportKey = services.storage.reportKey(context.order.id, link.id);
    const tierLabel = (blockId: string): string => {
      const tier = strengths.get(blockId)?.tier as Tier | null;
      return tier ? TIER_LABELS[tier] : "Not inspected";
    };
    const reportBlocks: ReportBlock[] = context.blocks.map((block) => ({
      name: block.name,
      samples: context.samples
        .filter((s) => s.block_id === block.id)
        .map((s) => ({ colony_label: s.colony_label, frames_text: formatAverage(s.frames_tenths) })),
      average_text: strengths.get(block.id)?.average_tenths != null
        ? formatAverage(strengths.get(block.id)!.average_tenths!)
        : null,
      tier_label: tierLabel(block.id),
      payable_text: formatMoney(strengths.get(block.id)?.payable_cents ?? 0),
    }));
    const signedAt = new Date();
    const pdf = buildReportPdf({
      orchardName: context.orchard.name,
      county: context.orchard.county,
      ref: context.order.ref,
      blocks: reportBlocks,
      payableText: formatMoney(payable),
      inspectorName,
      signedAtText: formatDateTimeText(signedAt),
    });

    // All or nothing: the PDF, the invoice and credit, the state change and
    // the notice either all take effect or none of them do.
    await services.storage.put(reportKey, pdf, "application/pdf");

    const accountId = context.order.kb_account_id ?? await services.killbill.ensureAccount({
      id: context.grower.id, name: context.grower.name, email: context.grower.email,
    });
    let balanceInvoiceId: string | null = null;
    let creditInvoiceId: string | null = null;
    try {
      const charges = context.blocks
        .map((block) => ({
          description: `${context.order.ref} · ${block.name} · ${tierLabel(block.id)} · ${delivered.get(block.id) ?? 0} hives`,
          cents: strengths.get(block.id)?.payable_cents ?? 0,
        }))
        .filter((charge) => charge.cents !== 0);
      if (charges.length > 0) {
        balanceInvoiceId = await services.killbill.createChargeInvoice(accountId, charges);
      }
      creditInvoiceId = await services.killbill.createCredit(accountId, context.order.deposit_cents, `Deposit applied · ${context.order.ref}`);
      await withTransaction(services.pool, async (client) => {
        const updated = await client.query(
          `UPDATE orders SET status = 'inspected', kb_account_id = $2, kb_balance_invoice_id = $3,
             kb_credit_invoice_id = $4, report_key = $5, signed_at = $6
           WHERE id = $1 AND status = 'placed'`,
          [context.order.id, accountId, balanceInvoiceId, creditInvoiceId, reportKey, signedAt.toISOString()],
        );
        if (updated.rowCount === 0) {
          throw ApiError.invalidTransition(context.order.ref, context.order.status);
        }
        await client.query("UPDATE drops SET status = 'inspected' WHERE order_id = $1 AND status = 'delivered'", [context.order.id]);
        await client.query("UPDATE inspection_links SET status = 'signed', signed_at = $2 WHERE id = $1", [link.id, signedAt.toISOString()]);
        const lines = context.blocks
          .map((block) => {
            const strength = strengths.get(block.id)!;
            const average = strength.average_tenths != null ? formatAverage(strength.average_tenths!) : "no samples";
            return `${block.name}: ${average} frames, ${tierLabel(block.id)}, ${formatMoney(strength.payable_cents)}`;
          })
          .join("\n");
        await queueEmail(client, {
          to: context.grower.email,
          subject: `Inspection signed: ${context.orchard.name} · ${context.order.ref}`,
          body: `${lines}\nPayable: ${formatMoney(payable)}\nThe signed report is in Bloom Desk.`,
        });
        await audit(client, "order", context.order.id, "signed", inspectorName);
      });
      services.mailer.kick();
    } catch (error) {
      if (creditInvoiceId) await services.killbill.voidInvoice(creditInvoiceId).catch(() => undefined);
      if (balanceInvoiceId) await services.killbill.voidInvoice(balanceInvoiceId).catch(() => undefined);
      await services.storage.remove(reportKey);
      throw error;
    }

    return {
      status: 200,
      body: {
        status: "signed",
        signed_at: signedAt.toISOString(),
        payable_cents: payable,
        blocks: context.blocks.map((block) => ({
          id: block.id,
          average_frames: strengths.get(block.id)?.average_frames ?? null,
          tier: strengths.get(block.id)?.tier ?? null,
          payable_cents: strengths.get(block.id)?.payable_cents ?? 0,
        })),
      },
    };
  });
  res.status(result.status).json(result.body);
}
