// Quote shares are worked from their stored state: every instance picks up pending and waiting shares in its
// database, writes the PDF to MinIO, confirms it, marks the share ready and only then emails each recipient.
import type pg from "pg";
import { lineTotal, orderTotals, type Totals } from "../shared/money.js";
import type { PriceDisplay } from "../shared/types.js";
import { unitPrice, variantRows } from "./catalogue.js";
import { serverDate } from "./dates.js";
import { pool, transaction } from "./db.js";
import { quotePdf, type QuoteLine } from "./documents.js";
import { errorCode, ProviderUnavailable } from "./errors.js";
import { quoteShareMail, sendMail } from "./mail.js";
import { putConfirmed } from "./storage.js";

const RETRY_MS = 10_000;

interface ShareRow {
  id: string;
  project_id: string;
  price_display: PriceDisplay;
  recipients: string[];
  message: string | null;
  project_name: string;
  client_name: string | null;
  sender_name: string;
}

async function quoteFor(share: ShareRow): Promise<{ lines: QuoteLine[]; pdf: Buffer; totals: Totals }> {
  const [lines, variants] = await Promise.all([
    pool.query<{ variant_code: string; quantity: number }>(
      "SELECT variant_code, quantity FROM project_lines WHERE project_id = $1 ORDER BY added_at, variant_code",
      [share.project_id],
    ),
    variantRows(),
  ]);
  const tier = share.price_display === "trade" ? "trade" : "retail";
  const quoteLines = lines.rows.map(({ variant_code, quantity }) => {
    const variant = variants.find((v) => v.code === variant_code)!;
    const unitCents = unitPrice(variant, tier);
    return {
      code: variant.code,
      productName: variant.product_name,
      finishName: variant.finish_name,
      beamDeg: variant.beam_deg,
      cctK: variant.cct_k,
      quantity,
      unitCents,
      lineCents: lineTotal(unitCents, quantity),
    };
  });
  const totals = orderTotals(quoteLines.map((line) => line.lineCents));
  const pdf = quotePdf({
    projectName: share.project_name,
    clientName: share.client_name,
    senderName: share.sender_name,
    date: serverDate(),
    display: share.price_display,
    lines: quoteLines,
    totals,
  });
  return { lines: quoteLines, pdf, totals };
}

async function finish(share: ShareRow, client: pg.PoolClient): Promise<() => Promise<void>> {
  const { lines, pdf, totals } = await quoteFor(share);
  try {
    await putConfirmed(`quotes/${share.project_id}/${share.id}.pdf`, pdf, "application/pdf");
  } catch (error) {
    if (!(error instanceof ProviderUnavailable)) throw error;
    await client.query("UPDATE shares SET pdf_status = 'waiting_for_storage' WHERE id = $1", [share.id]);
    return async () => undefined;
  }
  await client.query("UPDATE shares SET pdf_status = 'ready' WHERE id = $1", [share.id]);
  const priced = share.price_display !== "none";
  return async () => {
    for (const recipient of share.recipients) {
      await sendMail(
        quoteShareMail({
          to: recipient,
          senderName: share.sender_name,
          projectName: share.project_name,
          message: share.message,
          lines: lines.map((line) => ({
            label: `${line.code} x ${line.quantity} · ${line.productName}, ${line.finishName}, ${line.beamDeg}°, ${line.cctK}K`,
            cents: priced ? line.lineCents : null,
          })),
          totals: priced ? totals : null,
          attachment: { filename: `lightfall-quote-${share.id}.pdf`, contentType: "application/pdf", data: pdf },
        }),
      ).catch((error: unknown) =>
        console.error(`quote email for share ${share.id} not sent:`, errorCode(error)),
      );
    }
  };
}

let running = false;
let again = false;

/** One pass over the open shares. Rows are locked with SKIP LOCKED so instances never work the same share. */
async function workShares(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const emails = await transaction(async (client) => {
        const open = await client.query<ShareRow>(
          `SELECT s.id, s.project_id, s.price_display, s.recipients, s.message, p.name AS project_name, p.client_name,
                  u.name AS sender_name
           FROM shares s JOIN projects p ON p.id = s.project_id JOIN users u ON u.id = s.sender_id
           WHERE s.pdf_status <> 'ready' ORDER BY s.created_at LIMIT 10 FOR UPDATE OF s SKIP LOCKED`,
        );
        const sends: (() => Promise<void>)[] = [];
        for (const share of open.rows) sends.push(await finish(share, client));
        return sends;
      });
      for (const send of emails) await send();
    } while (again);
  } catch (error) {
    console.error("share worker:", errorCode(error));
  } finally {
    running = false;
  }
}

export function kickShares(): void {
  void workShares();
}

export function startShareWorker(): void {
  void workShares();
  setInterval(() => void workShares(), RETRY_MS).unref();
}
