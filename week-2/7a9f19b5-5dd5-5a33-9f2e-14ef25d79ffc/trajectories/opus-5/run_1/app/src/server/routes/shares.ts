/**
 * Quote shares. A share starts `pending`; the server writes the PDF to MinIO,
 * confirms the stored object exists, then sends one email per recipient with the
 * PDF attached. While MinIO is unreachable the share reads `waiting_for_storage`,
 * sends nothing, and is finished later by the worker.
 *
 * Shares are worked from their stored state, so a share survives a restart.
 */

import { query, queryOne } from "../db/pool.js";
import { isValidEmail, LIMITS } from "../../shared/domain.js";
import { totalsFor } from "../../shared/gst.js";
import type { PdfStatus, PriceDisplay, QuoteShare } from "../../shared/types.js";
import { readJson, sendJson, type Ctx } from "../http/context.js";
import { notFound, ownerOnly, pdfNotReady } from "../http/errors.js";
import { requireUser } from "../http/router.js";
import { FieldErrors, oneOf, optionalString } from "../http/validate.js";
import { findVisibleProject } from "../domain/projects.js";
import { buildQuotePdf, type QuoteLine } from "../pdf/quote.js";
import { getObject, objectExists, objectKeys, putObject } from "../services/storage.js";
import { sendQuoteShare } from "../services/mail.js";
import { ProviderUnavailable } from "../services/provider.js";

/** The server retries waiting shares on this cadence. */
const WORKER_INTERVAL_MS = 10_000;

interface ShareRow {
  id: string;
  project_id: string;
  sender_id: string;
  price_display: PriceDisplay;
  recipients: string[];
  message: string | null;
  pdf_status: PdfStatus;
  pdf_key: string | null;
  emails_sent_at: Date | null;
  created_at: Date;
}

function toShare(row: ShareRow): QuoteShare {
  return {
    id: row.id,
    price_display: row.price_display,
    recipients: row.recipients,
    pdf_status: row.pdf_status,
    created_at: row.created_at.toISOString(),
  };
}

export async function createShare(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const project = await findVisibleProject(ctx.params.id ?? "", user.id);
  if (!project) throw notFound();
  if (project.owner_id !== user.id) throw ownerOnly();

  const body = readJson<{ recipients?: unknown; price_display?: unknown; message?: unknown }>(ctx);
  const errors = new FieldErrors();

  const raw = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients = raw
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
  const unique = [...new Set(recipients)];

  if (
    unique.length < LIMITS.shareRecipients.min ||
    unique.length > LIMITS.shareRecipients.max ||
    !unique.every((entry) => isValidEmail(entry))
  ) {
    errors.set("recipients", "invalid");
  }
  const priceDisplay = oneOf(errors, "price_display", body.price_display, ["trade", "retail", "none"] as const);
  const message = optionalString(errors, "message", body.message, { max: LIMITS.shareMessage.max });
  errors.throwIfAny();

  const created = await queryOne<ShareRow>(
    `INSERT INTO quote_shares (project_id, sender_id, price_display, recipients, message, pdf_status)
     VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
    [project.id, user.id, priceDisplay, JSON.stringify(unique), message],
  );
  if (!created) throw new Error("failed to queue the quote share");

  // Work it now; whatever is left waiting is picked up by the worker.
  void progressShare(created.id).catch(() => undefined);
  sendJson(ctx.res, 201, { share: toShare(created) });
}

export async function listShares(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const project = await findVisibleProject(ctx.params.id ?? "", user.id);
  if (!project) throw notFound();

  const rows = await query<ShareRow>(
    "SELECT * FROM quote_shares WHERE project_id = $1 ORDER BY created_at DESC",
    [project.id],
  );
  sendJson(ctx.res, 200, { shares: rows.map(toShare) });
}

export async function getSharePdf(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const shareId = ctx.params.shareId ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(shareId)) throw notFound();

  const share = await queryOne<ShareRow>("SELECT * FROM quote_shares WHERE id = $1", [shareId]);
  if (!share) throw notFound();
  if (!(await findVisibleProject(share.project_id, user.id))) throw notFound();
  if (share.pdf_status !== "ready" || !share.pdf_key) throw pdfNotReady();

  const bytes = await getObject(share.pdf_key);
  if (!bytes) throw pdfNotReady();
  ctx.res.writeHead(200, {
    "content-type": "application/pdf",
    "content-length": bytes.length,
    "content-disposition": `inline; filename="lightfall-quote-${share.id}.pdf"`,
    "cache-control": "no-store",
  });
  ctx.res.end(bytes);
}

interface QuoteSource {
  project_name: string;
  client_name: string | null;
  sender_name: string;
  sender_email: string;
}

async function buildLines(projectId: string, priceDisplay: PriceDisplay): Promise<QuoteLine[]> {
  const rows = await query<{
    variant_code: string;
    product_name: string;
    finish_name: string;
    beam_deg: number;
    cct_k: number;
    quantity: number;
    retail_price_cents: number;
    trade_price_cents: number;
  }>(
    `SELECT pl.variant_code, p.name AS product_name, v.finish_name, v.beam_deg, v.cct_k, pl.quantity,
            v.retail_price_cents, v.trade_price_cents
     FROM project_lines pl
     JOIN variants v ON v.code = pl.variant_code
     JOIN products p ON p.slug = v.product_slug
     WHERE pl.project_id = $1
     ORDER BY pl.added_at, pl.variant_code`,
    [projectId],
  );

  return rows.map((row) => {
    const unit =
      priceDisplay === "none"
        ? null
        : priceDisplay === "trade"
          ? row.trade_price_cents
          : row.retail_price_cents;
    return {
      variant_code: row.variant_code,
      product_name: row.product_name,
      finish_name: row.finish_name,
      beam_deg: row.beam_deg,
      cct_k: row.cct_k,
      quantity: row.quantity,
      unit_price_cents: unit,
      line_total_cents: unit === null ? null : unit * row.quantity,
    };
  });
}

/**
 * Moves one share as far as it can: writes and confirms the PDF, then sends the
 * emails. Leaves it waiting when MinIO is unreachable.
 */
export async function progressShare(shareId: string): Promise<void> {
  const share = await queryOne<ShareRow>("SELECT * FROM quote_shares WHERE id = $1", [shareId]);
  if (!share || share.emails_sent_at !== null) return;

  const source = await queryOne<QuoteSource>(
    `SELECT pr.name AS project_name, pr.client_name, u.name AS sender_name, u.email AS sender_email
     FROM quote_shares qs
     JOIN projects pr ON pr.id = qs.project_id
     JOIN users u ON u.id = qs.sender_id
     WHERE qs.id = $1`,
    [shareId],
  );
  if (!source) return;

  const lines = await buildLines(share.project_id, share.price_display);
  const showPrices = share.price_display !== "none";
  const totals = showPrices
    ? totalsFor(lines.map((line) => ({ unit_price_cents: line.unit_price_cents ?? 0, quantity: line.quantity })))
    : null;

  const pdf = buildQuotePdf({
    projectName: source.project_name,
    clientName: source.client_name,
    senderName: source.sender_name,
    message: share.message,
    priceDisplay: share.price_display,
    lines,
    totals,
  });

  const key = objectKeys.quote(share.project_id, share.id);
  try {
    await putObject(key, pdf, "application/pdf");
    if (!(await objectExists(key))) throw new ProviderUnavailable("minio");
  } catch (error) {
    if (!(error instanceof ProviderUnavailable)) throw error;
    await query("UPDATE quote_shares SET pdf_status = 'waiting_for_storage' WHERE id = $1", [shareId]);
    return;
  }

  await query("UPDATE quote_shares SET pdf_status = 'ready', pdf_key = $2 WHERE id = $1", [shareId, key]);

  // Claim the send so two instances cannot both email the recipients.
  const claimed = await query<{ id: string }>(
    "UPDATE quote_shares SET emails_sent_at = now() WHERE id = $1 AND emails_sent_at IS NULL RETURNING id",
    [shareId],
  );
  if (claimed.length === 0) return;

  try {
    for (const recipient of share.recipients) {
      await sendQuoteShare({
        to: recipient,
        senderName: source.sender_name,
        projectName: source.project_name,
        message: share.message,
        priceDisplay: share.price_display,
        lines: lines.map((line) => ({
          variant_code: line.variant_code,
          product_name: line.product_name,
          finish_name: line.finish_name,
          beam_deg: line.beam_deg,
          cct_k: line.cct_k,
          quantity: line.quantity,
          line_total_cents: line.line_total_cents,
        })),
        totals,
        shareId: share.id,
        pdf,
      });
    }
  } catch {
    await query("UPDATE quote_shares SET emails_sent_at = NULL WHERE id = $1", [shareId]);
  }
}

/**
 * Picks up every unfinished share in this instance's database, so a share left
 * waiting is finished by whichever instance next reaches MinIO.
 */
export function startShareWorker(): void {
  const tick = async (): Promise<void> => {
    const pending = await query<{ id: string }>(
      "SELECT id FROM quote_shares WHERE pdf_status IN ('pending','waiting_for_storage') OR emails_sent_at IS NULL",
    );
    for (const share of pending) await progressShare(share.id);
  };
  setInterval(() => {
    void tick().catch(() => undefined);
  }, WORKER_INTERVAL_MS).unref();
}
