// The inspector's link-only routes (brief: API → /api/inspect/{token}). The token is accepted nowhere else.

import type { BlockStrength, LinkStatus, Sheet, SignResult } from "../../shared/api.js";
import { tierLabel } from "../../shared/api.js";
import { countyName, frames, humanDate, humanDateTime, money } from "../../shared/format.js";
import { samplesRequired, tenthsToNumber } from "../../shared/strength.js";
import { hashToken, newId } from "../auth.js";
import { audit, one, tx, type Db } from "../db.js";
import { PHOTO_LIMIT, PHOTOS_PER_SAMPLE, multipartFile, sniffPhoto } from "../domain/photo.js";
import { dropTransition, isDelivered, linkStatus, orderTransition } from "../domain/transitions.js";
import { ApiError, FieldErrors, gone, notFound, readBody, tenths, text, type Reply, type Route } from "../http.js";
import { idempotencyKey, remember, replay, requireKey } from "../idempotency.js";
import { assess, loadOrder, lockOrder, type Assessment, type BlockAssessment, type OrderRecord } from "../model.js";
import { creditAccount, growerAccount, invoiceCharges, voidInvoice } from "../services/killbill.js";
import { queueMail } from "../services/mailer.js";
import { renderPdf, type Line } from "../services/pdf.js";
import { deleteObject, putObject } from "../services/storage.js";
import { fileRedirect } from "./files.js";

interface LinkRow {
  id: string;
  order_id: string;
  status: LinkStatus;
  expires_at: Date;
  orchard_name: string;
}

async function linkFor(db: Db, token: string): Promise<LinkRow> {
  const link = await one<LinkRow>(
    db,
    `SELECT l.id, l.order_id, l.status, l.expires_at, c.name AS orchard_name
       FROM inspection_links l JOIN orders o ON o.id = l.order_id JOIN orchards c ON c.id = o.orchard_id WHERE l.token_hash = $1`,
    [hashToken(token)],
  );
  if (link === null) throw notFound();
  return link;
}

function ensureLive(link: LinkRow, now: Date): void {
  const status = linkStatus(link.status, link.expires_at, now);
  if (status === "signed") throw gone("link_signed", `The report for ${link.orchard_name} has been signed.`);
  if (status === "expired") throw gone("link_expired", "This inspection link has expired. Ask the broker for a new link.");
}

/** Resolves the token, locks its order, then re-reads the link under the lock. */
async function lockedSheet(db: Db, token: string): Promise<{ link: LinkRow; order: OrderRecord }> {
  const found = await linkFor(db, token);
  const order = await lockOrder(db, found.order_id);
  if (order === null) throw notFound();
  return { link: await linkFor(db, token), order };
}

function photoUrl(token: string, photoId: string): string {
  return `/api/inspect/${token}/photos/${photoId}`;
}

function strength(entry: BlockAssessment): BlockStrength {
  return {
    id: entry.block.id,
    sample_count: entry.samples.length,
    average_frames: tenthsToNumber(entry.averageTenths),
    tier: entry.tier,
    payable_cents: entry.payableCents,
  };
}

function sheetView(order: OrderRecord, figures: Assessment, link: LinkRow, token: string, now: Date): Sheet {
  return {
    order: { ref: order.ref },
    orchard: { name: order.orchard.name, county: order.orchard.county },
    link: { status: linkStatus(link.status, link.expires_at, now), expires_at: link.expires_at.toISOString() },
    blocks: figures.blocks.map((entry) => ({
      id: entry.block.id,
      name: entry.block.name,
      hives_delivered: entry.hivesDelivered,
      samples_required: samplesRequired(entry.hivesDelivered),
      sample_count: entry.samples.length,
      average_frames: tenthsToNumber(entry.averageTenths),
      tier: entry.tier,
      payable_cents: entry.payableCents,
      yards: order.drops
        .filter((drop) => drop.block_id === entry.block.id && isDelivered(drop.status))
        .map((drop) => ({ drop_id: drop.id, yard_name: drop.yard_name, hives: drop.hives })),
      samples: entry.samples.map((sample) => ({
        id: sample.id,
        drop_id: sample.drop_id,
        colony_label: sample.colony_label,
        frames: sample.frames_tenths / 10,
        photos: order.photos.filter((photo) => photo.sample_id === sample.id).map((photo) => ({ id: photo.id, url: photoUrl(token, photo.id) })),
      })),
    })),
    payable_cents: figures.payableCents,
  };
}

async function sampleChange(db: Db, orderId: string, blockId: string): Promise<{ order: OrderRecord; block: BlockStrength; payable_cents: number }> {
  const order = await loadOrder(db, orderId);
  const entry = order ? assess(order) : null;
  const block = entry?.blockById.get(blockId);
  if (!order || !entry || !block) throw notFound();
  return { order, block: strength(block), payable_cents: entry.payableCents };
}

function reportPdf(order: OrderRecord, figures: Assessment, inspectorName: string, signedAt: Date): Buffer {
  const lines: Line[] = [
    { text: "Swarmline Bloom Desk", font: "bold", size: 18 },
    { text: "Signed inspection report", size: 13, gap: 2 },
    { text: `Orchard: ${order.orchard.name}, ${countyName(order.orchard.county)}`, gap: 10 },
    { text: `Order: ${order.ref}` },
    { text: `Bloom: ${humanDate(order.bloom_start)} to ${humanDate(order.bloom_end)}` },
  ];
  for (const entry of figures.blocks) {
    lines.push({ text: `${entry.block.name} · ${entry.hivesDelivered} hives delivered · ${entry.samples.length} samples`, font: "bold", size: 12, gap: 12 });
    for (const sample of entry.samples) {
      const yard = order.drops.find((drop) => drop.id === sample.drop_id)?.yard_name ?? "";
      lines.push({ text: `  ${sample.colony_label.padEnd(20)} ${frames(sample.frames_tenths).padStart(5)} frames   ${yard}`, font: "mono", size: 9.5 });
    }
    const average = entry.averageTenths === null ? "no samples" : `${frames(entry.averageTenths)} frames`;
    lines.push({ text: `Average ${average} · ${tierLabel(entry.tier)} · Payable ${money(entry.payableCents)}`, gap: 2 });
  }
  lines.push({ text: `Orchard payable: ${money(figures.payableCents)}`, font: "bold", size: 12, gap: 14 });
  lines.push({ text: `Signed by ${inspectorName} on ${humanDateTime(signedAt)} Pacific`, gap: 12 });
  lines.push({ text: "I counted these colonies and these figures are true." });
  return renderPdf(lines);
}

export const inspectRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/inspect/:token",
    body: "none",
    auth: false,
    handler: ({ params, now }) =>
      tx(async (db) => {
        const link = await linkFor(db, params.token);
        ensureLive(link, now);
        await db.query("UPDATE inspection_links SET status = 'used' WHERE id = $1 AND status = 'issued'", [link.id]);
        const order = await loadOrder(db, link.order_id);
        if (order === null) throw notFound();
        return { status: 200, json: sheetView(order, assess(order), { ...link, status: "used" }, params.token, now) };
      }),
  },
  {
    method: "POST",
    path: "/api/inspect/:token/samples",
    body: "json",
    auth: false,
    handler: ({ params, body, now }) =>
      tx(async (db) => {
        const { link, order } = await lockedSheet(db, params.token);
        ensureLive(link, now);
        const figures = assess(order);
        const block = figures.blocks.find((entry) => entry.block.id === body.block_id);
        if (block === undefined) throw notFound();
        const fields = new FieldErrors();
        const drop = order.drops.find((entry) => entry.id === body.drop_id && entry.block_id === block.block.id && isDelivered(entry.status));
        if (drop === undefined) fields.add("drop_id", "Choose a yard delivered to this block");
        const label = text(body.colony_label, 1, 20);
        if (label === null) fields.add("colony_label", "Colony must be 1 to 20 characters");
        else if (block.samples.some((sample) => sample.colony_label === label)) fields.add("colony_label", `Colony ${label} is already sampled in ${block.block.name}`);
        const framesTenths = tenths(body.frames, 0, 200);
        if (framesTenths === null) fields.add("frames", "Frames must be from 0.0 to 20.0 with one decimal");
        if (block.samples.length >= block.hivesDelivered) fields.add("block_id", `${block.block.name} already has a sample for every hive`);
        fields.throwIfAny();
        const sampleId = newId("smp");
        await db.query("INSERT INTO samples (id, order_id, block_id, drop_id, colony_label, frames_tenths) VALUES ($1, $2, $3, $4, $5, $6)", [
          sampleId,
          order.id,
          block.block.id,
          drop?.id,
          label,
          framesTenths,
        ]);
        await audit(db, `link:${link.id}`, "sample", "sample", sampleId, { block_id: block.block.id, frames_tenths: framesTenths });
        const change = await sampleChange(db, order.id, block.block.id);
        return {
          status: 201,
          json: {
            sample: { id: sampleId, drop_id: drop?.id, colony_label: label, frames: (framesTenths ?? 0) / 10, photos: [] },
            block: change.block,
            payable_cents: change.payable_cents,
          },
        };
      }),
  },
  {
    method: "DELETE",
    path: "/api/inspect/:token/samples/:sampleId",
    body: "none",
    auth: false,
    async handler({ params, now }) {
      const { reply, keys } = await tx(async (db) => {
        const { link, order } = await lockedSheet(db, params.token);
        ensureLive(link, now);
        const sample = order.samples.find((entry) => entry.id === params.sampleId);
        if (sample === undefined) throw notFound();
        const removed = await db.query<{ object_key: string }>("SELECT object_key FROM photos WHERE sample_id = $1", [sample.id]);
        await db.query("DELETE FROM samples WHERE id = $1", [sample.id]);
        await audit(db, `link:${link.id}`, "remove_sample", "sample", sample.id, { frames_tenths: sample.frames_tenths });
        const change = await sampleChange(db, order.id, sample.block_id);
        return { reply: { status: 200, json: { block: change.block, payable_cents: change.payable_cents } }, keys: removed.rows.map((row) => row.object_key) };
      });
      await Promise.all(keys.map((key) => deleteObject(key).catch(() => undefined)));
      return reply;
    },
  },
  {
    method: "POST",
    path: "/api/inspect/:token/samples/:sampleId/photos",
    body: "multipart",
    auth: false,
    async handler({ req, params, now }) {
      await tx(async (db) => {
        const link = await linkFor(db, params.token);
        ensureLive(link, now);
        const sample = await one(db, "SELECT id FROM samples WHERE id = $1 AND order_id = $2", [params.sampleId, link.order_id]);
        if (sample === null) throw notFound();
      });
      const tooLarge = new ApiError(413, "payload_too_large", "Photos must be 8,000,000 bytes or smaller.", { photo: "Photos must be 8,000,000 bytes or smaller." });
      const raw = await readBody(req, PHOTO_LIMIT + 64_000);
      if (raw === null) throw tooLarge;
      const file = multipartFile(raw, req.headers["content-type"] ?? "", "photo");
      if (file === null) throw new ApiError(422, "validation_failed", "Some fields need attention.", { photo: "Choose a photo to upload" });
      if (file.length > PHOTO_LIMIT) throw tooLarge;
      const type = sniffPhoto(file);
      if (type === null) {
        throw new ApiError(415, "unsupported_media_type", "Photos must be JPEG, PNG or WebP images.", { photo: "Photos must be JPEG, PNG or WebP images." });
      }
      return tx(async (db): Promise<Reply> => {
        const { link, order } = await lockedSheet(db, params.token);
        ensureLive(link, now);
        const sample = order.samples.find((entry) => entry.id === params.sampleId);
        if (sample === undefined) throw notFound();
        if (order.photos.filter((photo) => photo.sample_id === sample.id).length >= PHOTOS_PER_SAMPLE) {
          throw new ApiError(422, "validation_failed", "Some fields need attention.", { photo: "A sample holds at most 4 photos" });
        }
        const photoId = newId("pho");
        const key = `inspections/${order.id}/photos/${photoId}.${type.extension}`;
        await putObject(key, file, type.contentType);
        await db.query("INSERT INTO photos (id, sample_id, order_id, object_key, content_type) VALUES ($1, $2, $3, $4, $5)", [
          photoId,
          sample.id,
          order.id,
          key,
          type.contentType,
        ]);
        await audit(db, `link:${link.id}`, "photo", "photo", photoId, { sample_id: sample.id });
        return { status: 201, json: { photo: { id: photoId, url: photoUrl(params.token, photoId) } } };
      });
    },
  },
  {
    method: "GET",
    path: "/api/inspect/:token/photos/:photoId",
    body: "none",
    auth: false,
    handler: ({ params, now }) =>
      tx(async (db) => {
        const link = await linkFor(db, params.token);
        ensureLive(link, now);
        const photo = await one<{ id: string; object_key: string; content_type: string }>(
          db,
          "SELECT id, object_key, content_type FROM photos WHERE id = $1 AND order_id = $2",
          [params.photoId, link.order_id],
        );
        if (photo === null) throw notFound();
        return fileRedirect(db, photo.object_key, photo.content_type, `${photo.id}.${photo.object_key.split(".").at(-1) ?? ""}`);
      }),
  },
  {
    method: "POST",
    path: "/api/inspect/:token/sign",
    body: "json",
    auth: false,
    handler: (ctx) =>
      tx(async (db, undo) => {
        const { link, order } = await lockedSheet(db, ctx.params.token);
        const scope = `sign:${link.id}`;
        const key = idempotencyKey(ctx);
        const replayed = await replay(db, scope, key, ctx.body);
        if (replayed) return replayed;
        ensureLive(link, ctx.now);
        orderTransition("sign", order.status);
        const figures = assess(order);
        const fields = new FieldErrors();
        const inspectorName = text(ctx.body.inspector_name, 2, 80);
        if (inspectorName === null) fields.add("inspector_name", "Full name must be 2 to 80 characters");
        if (ctx.body.attest !== true) fields.add("attest", "Confirm that you counted these colonies");
        requireKey(key, fields);
        for (const entry of figures.blocks) {
          const missing = samplesRequired(entry.hivesDelivered) - entry.samples.length;
          if (missing > 0) fields.add(entry.block.id, `${entry.block.name} needs ${missing} more samples`);
        }
        fields.throwIfAny();
        const signedAt = ctx.now;
        const reportKey = `inspections/${order.id}/report-${link.id}.pdf`;
        // All or nothing: every outside effect registers its reversal, run if anything later fails, COMMIT included.
        await putObject(reportKey, reportPdf(order, figures, inspectorName ?? "", signedAt), "application/pdf");
        undo(() => deleteObject(reportKey));
        const account = await growerAccount(db, order.orchard.grower_id);
        const charges = figures.blocks
          .filter((entry) => entry.payableCents > 0)
          .map((entry) => ({ cents: entry.payableCents, description: `${order.ref} · ${entry.block.name} · ${tierLabel(entry.tier)} · ${entry.hivesDelivered} hives` }));
        const balanceInvoiceId = charges.length > 0 ? await invoiceCharges(account, charges) : null;
        if (balanceInvoiceId !== null) undo(() => voidInvoice(balanceInvoiceId));
        const creditInvoiceId = await creditAccount(account, figures.depositCents, `Deposit applied · ${order.ref}`);
        undo(() => voidInvoice(creditInvoiceId));
        await db.query(
          "UPDATE orders SET status = $2, balance_invoice_id = $3, report_key = $4, inspector_name = $5, signed_at = $6 WHERE id = $1",
          [order.id, orderTransition("sign", order.status), balanceInvoiceId, reportKey, inspectorName, signedAt],
        );
        for (const drop of order.drops.filter((entry) => entry.status === "delivered")) {
          await db.query("UPDATE drops SET status = $2 WHERE id = $1", [drop.id, dropTransition("inspect", drop.status)]);
        }
        await db.query("UPDATE inspection_links SET status = 'signed' WHERE id = $1", [link.id]);
        const grower = await one<{ email: string; contact_name: string }>(db, "SELECT email, contact_name FROM users WHERE id = $1", [order.orchard.grower_id]);
        await queueMail(db, {
          to: grower?.email ?? "",
          subject: `Inspection signed: ${order.orchard.name} · ${order.ref}`,
          body: [
            `Hello ${grower?.contact_name ?? ""},`,
            "",
            `${inspectorName} signed the inspection of ${order.orchard.name} (${countyName(order.orchard.county)}) for order ${order.ref}.`,
            "",
            ...figures.blocks.map((entry) =>
              entry.averageTenths === null
                ? `${entry.block.name}: no samples, ${tierLabel(null)}, ${money(entry.payableCents)}`
                : `${entry.block.name}: ${frames(entry.averageTenths)} frames, ${tierLabel(entry.tier)}, ${money(entry.payableCents)}`,
            ),
            "",
            `Payable: ${money(figures.payableCents)}`,
            "The signed report is in Bloom Desk.",
            "",
            "Swarmline Bloom Desk",
          ].join("\n"),
        });
        await audit(db, `link:${link.id}`, "sign", "order", order.id, { balance_invoice_id: balanceInvoiceId, report_key: reportKey });
        const result: SignResult = {
          status: "signed",
          signed_at: signedAt.toISOString(),
          payable_cents: figures.payableCents,
          blocks: figures.blocks.map((entry) => ({
            id: entry.block.id,
            average_frames: tenthsToNumber(entry.averageTenths),
            tier: entry.tier,
            payable_cents: entry.payableCents,
          })),
        };
        const reply: Reply = { status: 200, json: result };
        await remember(db, scope, key ?? "", ctx.body, reply);
        return reply;
      }),
  },
];
