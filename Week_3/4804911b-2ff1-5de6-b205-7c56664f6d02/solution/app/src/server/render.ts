import { createHash } from "node:crypto";
import { kolkataDay } from "./clock.js";
import { db } from "./db.js";
import { exclusive } from "./locks.js";
import { copyId } from "./meta.js";
import { renderPdf } from "./pdf.js";
import { pdfKey, storeOnce } from "./s3.js";

const RENDER_BUDGET_MS = 17_000;

/** The `render` job: prints a pending version once. Anything else (already printed, failed) changes nothing. */
export function runRender(number: string, version: number): Promise<"done" | "missing"> {
  return exclusive(`render:${number}:${version}`, async () => {
    const v = (await db.query("SELECT * FROM notice_versions WHERE number = $1 AND version = $2", [number, version])).rows[0];
    if (!v) return "missing";
    if (v.print_state !== "pending") return "done";
    const rows = (await db.query("SELECT name, old_mrp_paise, revised_mrp_paise FROM notice_rows WHERE number = $1 AND version = $2 ORDER BY position", [number, version])).rows;
    try {
      const bytes = await renderPdf(
        {
          number, version, title: v.title as string, effectiveDate: v.effective_date as string, publishedDay: kolkataDay((v.published_at as Date).getTime()),
          runOutUntil: (v.run_out_until as string | null) ?? null, reason: (v.reason as string | null) ?? null,
          rows: rows.map((r) => ({ name: r.name as string, oldMrpPaise: r.old_mrp_paise as number, revisedMrpPaise: r.revised_mrp_paise as number })),
        },
        AbortSignal.timeout(RENDER_BUDGET_MS),
      );
      const stored = await storeOnce(pdfKey(await copyId(), number, version), bytes, "application/pdf");
      await db.query("UPDATE notice_versions SET print_state = 'printable', pdf_sha256 = $3 WHERE number = $1 AND version = $2 AND print_state = 'pending'", [
        number, version, createHash("sha256").update(stored).digest("hex"),
      ]);
    } catch {
      await db.query("UPDATE notice_versions SET print_state = 'failed' WHERE number = $1 AND version = $2 AND print_state = 'pending'", [number, version]);
    }
    return "done";
  });
}
