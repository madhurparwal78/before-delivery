// Sheet rendering: one app copy at a time renders a queued sheet to PDF through
// Gotenberg, stores it confirmed, and marks it ready. Three consecutive printing
// or read-back failures mark it failed. Unreachable services keep it queued.

import type { Pool } from "pg";
import { s3PutConfirmed, s3Get, sha256 } from "./storage.js";
import { sheetHtml, renderPdf, footerHtml, type SheetStopView } from "./printing.js";
import { getSheet, getReel, rowToSheet } from "./repo.js";
import { sheetTransition } from "./states.js";
import { statuses } from "./status.js";
import type { Sheet } from "../shared/domain.js";

const gotenbergUrl = process.env.GOTENBERG_URL!;

export async function renderSheet(pool: Pool, sheetId: string): Promise<void> {
  const sheet = await getSheet(pool, sheetId);
  if (!sheet || sheet.state !== "rendering") return;
  if (!statuses.printing || !statuses.storage) {
    // Goes back to queued; never failed for unreachability.
    await pool.query(`UPDATE sheets SET state = 'queued' WHERE id = $1 AND state = 'rendering'`, [sheetId]);
    return;
  }
  const reel = await getReel(pool, sheet.reel_id);
  try {
    const stops: SheetStopView[] = [];
    for (const stop of sheet.stops) {
      let photoDataUrl = "";
      const obj = await s3Get(`references/${stop.reference_id}/display.jpg`);
      if (obj) photoDataUrl = `data:image/jpeg;base64,${obj.buf.toString("base64")}`;
      stops.push({
        position: stop.position,
        title: stop.title,
        maker: stop.maker,
        year: stop.year,
        sizeText: stop.size_text,
        swatch: stop.swatch,
        photoDataUrl,
      });
    }
    const html = sheetHtml({ reelName: reel?.name ?? "", paper: sheet.paper, stops });
    const footer = footerHtml(reel?.name ?? "");
    const pdf = await renderPdf(gotenbergUrl, html, footer, sheet.paper);
    const key = `sheets/${sheetId}.pdf`;
    await s3PutConfirmed(key, pdf, "application/pdf");
    const back = await s3Get(key);
    if (!back || sha256(back.buf) !== sha256(pdf)) throw new Error("pdf read-back mismatch");
    await pool.query(
      `UPDATE sheets SET state = 'ready', ready_at = now(), pdf_bytes = $2, pdf_sha256 = $3
       WHERE id = $1 AND state = 'rendering'`,
      [sheetId, pdf.length, sha256(pdf)]);
  } catch (err) {
    void err;
    const { rows } = await pool.query(
      `UPDATE sheets SET fail_count = fail_count + 1
       WHERE id = $1 RETURNING fail_count`, [sheetId]);
    const failCount = rows[0]?.fail_count ?? 1;
    // Three failures in a row fail the sheet; anything else goes back to
    // queued, never failed for unreachability.
    const nextState = failCount >= 3 && sheetTransition("rendering", "fail").ok ? "failed" : "queued";
    await pool.query(`UPDATE sheets SET state = $2, fail_count = $3 WHERE id = $1`,
      [sheetId, nextState, nextState === "failed" ? failCount : 0]);
  }
}
