import { config } from "./config.js";
import { one, unlocked } from "./db.js";
import { exists, storePdf } from "./storage.js";
import { serverNow } from "./time.js";
import { statementHtml } from "./statements.js";

// Statement PDFs are rendered after the settlement commits, from the render queue held in Postgres: a settlement
// whose `pdf_rendered_at` is still null is waiting. Each is rendered by one process at a time and stored once.

/** Renders the statement lines to a PDF with Gotenberg. */
async function renderPdf(lines: string[]): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([await statementHtml(lines)], { type: "text/html" }), "index.html");
  const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Gotenberg: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export const pdfKey = (kind: string, settlementId: string) => `statements/${kind}/${settlementId}.pdf`;

/**
 * Renders waiting statements oldest first, one transaction each. A settlement is claimed with a row lock other
 * processes skip, and marked rendered only after its PDF is in storage; while Gotenberg or storage is unreachable
 * the round stops and the settlement stays queued for the next one.
 */
export async function renderQueuedPdfs(): Promise<void> {
  for (let rendered = true; rendered; ) {
    rendered = await unlocked(async (tx) => {
      const waiting = await one<{ settlement_id: string; kind: string; statement_text: string }>(
        tx,
        "SELECT settlement_id, kind, statement_text FROM settlements WHERE pdf_rendered_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!waiting) return false;
      const key = pdfKey(waiting.kind, waiting.settlement_id);
      if (!(await exists(key))) await storePdf(key, await renderPdf(waiting.statement_text.trimEnd().split("\n")));
      await tx.query("UPDATE settlements SET pdf_rendered_at = $2 WHERE settlement_id = $1", [waiting.settlement_id, serverNow()]);
      return true;
    });
  }
}
