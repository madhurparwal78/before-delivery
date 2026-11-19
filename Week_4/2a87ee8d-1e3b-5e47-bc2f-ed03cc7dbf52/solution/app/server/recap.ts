// The recap pipeline: files, then the sponsor invoice, then the emails; each step resumes on any instance.
import { config } from "./config.js";
import { db, tx, type Db } from "./db.js";
import { fail } from "./errors.js";
import { reply, type Reply, type Req } from "./http.js";
import { record } from "./activity.js";
import { sponsorInvoice } from "./billing.js";
import { BillingDown } from "./killbill.js";
import { findWorkshop, type WorkshopRow } from "./store.js";
import { commit } from "./versions.js";
import { clusterNoteIds, loadBoard, rankClusters, recapInvoice, recipientsOf, type BoardState, type RecapRow } from "./projection.js";
import { getObject, putObject, StorageDown } from "./storage.js";
import { MailDown, send } from "./smtp.js";
import { formatLocal } from "./zone.js";
import { boardPdf, framePng, noteText, notesCsv, type RecapContent, type RecapNote } from "./recap/files.js";
import { formatAmount } from "../shared/copy.js";
import { isEnded } from "../shared/states.js";

/** What a recap may show: frames not in trash and revealed, non-facilitator-only notes, never author names. */
function contentOf(w: WorkshopRow, state: BoardState): RecapContent {
  const shown = state.notes.filter((n) => n.revealed && !n.facilitator_only);
  const toNote = (n: (typeof shown)[number]): RecapNote => ({ id: n.id, kind: n.kind, text: n.text, x: n.x, y: n.y });
  const ranked = rankClusters(state);
  const byFrame = new Map(state.frames.map((f) => [f.id, f]));
  const clusterNotes = (clusterId: string) =>
    clusterNoteIds(state, clusterId)
      .map((id) => shown.find((n) => n.id === id))
      .filter((n): n is (typeof shown)[number] => n !== undefined)
      .map(toNote);
  return {
    title: w.title,
    when: `${formatLocal(w.start_at, w.time_zone)} to ${formatLocal(w.end_at, w.time_zone)} (${w.time_zone})`,
    frames: state.frames.map((f) => ({
      id: f.id,
      title: f.title,
      width: f.width,
      height: f.height,
      clusters: ranked
        .filter((r) => r.cluster.frame_id === f.id)
        .map((r) => ({ id: r.cluster.id, title: r.cluster.title, x: r.cluster.x, y: r.cluster.y, dots: r.dots, notes: clusterNotes(r.cluster.id) })),
      loose: shown
        .filter((n) => n.frame_id === f.id && n.cluster_id === null)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map(toNote),
    })),
    ranking: ranked.map((r) => ({
      frame: byFrame.get(r.cluster.frame_id)?.title ?? "",
      title: r.cluster.title,
      dots: r.dots,
      notes: clusterNotes(r.cluster.id).map(noteText),
    })),
  };
}

const fileKey = (workshopId: string, name: string) =>
  name.startsWith("frame-") ? `workshops/${workshopId}/recap/frames/${name.slice(6, -4)}.png` : `workshops/${workshopId}/recap/${name}`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function recapMail(to: string, content: RecapContent, recapUrl: string, invoiceLine: string | null) {
  const ranking = content.ranking.map((r, i) => `${i + 1}. ${r.title} — ${r.dots} ${r.dots === 1 ? "dot" : "dots"} (${r.frame})\r\n${r.notes.map((n) => `   - ${n}`).join("\r\n")}`);
  return {
    to,
    subject: `Recap: ${content.title}`,
    text: [`Recap: ${content.title}`, content.when, "", "Cluster ranking", ...ranking, "", ...(invoiceLine ? [invoiceLine, ""] : []), `Files and the full recap: ${recapUrl}`, "", "Lanternfold Rooms"].join(
      "\r\n",
    ),
    html:
      `<!doctype html><html><body style="font-family:Georgia,serif;color:#2a2420;background:#f6f1e7;padding:24px">` +
      `<h1 style="font-weight:400">Recap: ${escapeHtml(content.title)}</h1><p style="color:#675d52">${escapeHtml(content.when)}</p>` +
      `<h2 style="font-weight:400">Cluster ranking</h2><ol>${content.ranking
        .map((r) => `<li><strong>${escapeHtml(r.title)}</strong> — ${r.dots} ${r.dots === 1 ? "dot" : "dots"} (${escapeHtml(r.frame)})<ul>${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul></li>`)
        .join("")}</ol>` +
      (invoiceLine ? `<p>${escapeHtml(invoiceLine)}</p>` : "") +
      `<p><a href="${escapeHtml(recapUrl)}">${escapeHtml(recapUrl)}</a></p></body></html>`,
  };
}

async function setReason(workshopId: string, reason: string): Promise<void> {
  await tx(async (t) => {
    await t.run("UPDATE recaps SET reason = $2, attempts = attempts + 1, lease_until = NULL WHERE workshop_id = $1", [workshopId, reason]);
    await commit(t, workshopId);
  });
}

/** One attempt, on whichever instance claims the recap's lease; it continues from the first unfinished step and is
 * counted in `attempts` when it records its outcome. */
export async function attemptRecap(workshopId: string): Promise<void> {
  const claimed = await db.one<RecapRow>(
    `UPDATE recaps SET lease_until = now() + interval '30 seconds'
     WHERE workshop_id = $1 AND status = 'queued' AND (lease_until IS NULL OR lease_until < now()) RETURNING *`,
    [workshopId],
  );
  if (!claimed) return;
  const w = await findWorkshop(db, workshopId);
  if (!w) return;
  const content = contentOf(w, await loadBoard(db, w));
  if (!claimed.files_stored_at) {
    try {
      await putObject(fileKey(w.id, "board.pdf"), boardPdf(content), "application/pdf");
      await putObject(fileKey(w.id, "notes.csv"), notesCsv(content), "text/csv; charset=utf-8");
      for (const frame of content.frames) await putObject(fileKey(w.id, `frame-${frame.id}.png`), framePng(frame, claimed.scale), "image/png");
    } catch (error) {
      if (!(error instanceof StorageDown)) throw error;
      await setReason(w.id, "storage_unavailable");
      return;
    }
    await db.run("UPDATE recaps SET files_stored_at = now(), reason = NULL WHERE workshop_id = $1", [w.id]);
  }
  let invoice = recapInvoice(claimed);
  if (w.fee_cents > 0 && !claimed.invoice_id) {
    try {
      const raised = await sponsorInvoice(w.sponsor_email, w.id, w.title, w.fee_cents);
      await tx(async (t) => {
        await t.run("UPDATE recaps SET invoice_id = $2, invoice_number = $3, invoice_amount_cents = $4 WHERE workshop_id = $1", [
          w.id, raised.id, raised.number, raised.amountCents,
        ]);
        await record(t, w.facilitator_id, "sponsor.invoiced", w.id);
      });
      invoice = recapInvoice({ ...claimed, invoice_id: raised.id, invoice_number: raised.number, invoice_amount_cents: raised.amountCents });
    } catch (error) {
      if (!(error instanceof BillingDown)) throw error;
      await setReason(w.id, "billing_unavailable");
      return;
    }
  }
  const recapUrl = `${config.publicBaseUrl}/recap/${claimed.token}`;
  const line = invoice ? `Invoice ${invoice.number} — €${formatAmount(invoice.amount)}` : null;
  const recipients = await recipientsOf(db, w);
  const sent = new Set((await db.rows<{ email: string }>("SELECT email FROM recap_mails WHERE workshop_id = $1 AND sent_at IS NOT NULL", [w.id])).map((r) => r.email));
  for (const to of recipients.filter((r) => !sent.has(r))) {
    try {
      await send(recapMail(to, content, recapUrl, line));
    } catch (error) {
      if (!(error instanceof MailDown)) throw error;
      await setReason(w.id, "mail_unavailable");
      return;
    }
    await db.run("INSERT INTO recap_mails (workshop_id, email, sent_at) VALUES ($1, $2, now()) ON CONFLICT (workshop_id, email) DO UPDATE SET sent_at = now()", [
      w.id,
      to,
    ]);
  }
  await tx(async (t) => {
    await t.run("UPDATE recaps SET status = 'complete', reason = NULL, attempts = attempts + 1, email_sent_at = now(), lease_until = NULL WHERE workshop_id = $1", [w.id]);
    await record(t, w.facilitator_id, "recap.completed", w.id);
    await commit(t, w.id);
  });
}

export async function retryRecaps(): Promise<void> {
  const due = await db.rows<{ workshop_id: string }>("SELECT workshop_id FROM recaps WHERE status = 'queued' AND (lease_until IS NULL OR lease_until < now()) LIMIT 20");
  for (const r of due) await attemptRecap(r.workshop_id);
}

async function byToken(t: Db, token: string) {
  const recap = await t.one<RecapRow>("SELECT * FROM recaps WHERE token = $1", [token]);
  const w = recap ? await findWorkshop(t, recap.workshop_id) : undefined;
  if (!recap || !w || !isEnded(w.status)) fail("not_found");
  return { recap, w };
}

export async function publicRecap(_req: Req, p: Record<string, string>): Promise<Reply> {
  const { recap, w } = await byToken(db, p.token ?? "");
  const content = contentOf(w, await loadBoard(db, w));
  const base = `/api/recaps/${recap.token}/files`;
  const files = recap.files_stored_at
    ? [
        { name: "board.pdf", label: "Board PDF", url: `${base}/board.pdf`, contentType: "application/pdf" },
        { name: "notes.csv", label: "Notes and votes CSV", url: `${base}/notes.csv`, contentType: "text/csv; charset=utf-8" },
        ...content.frames.map((f) => ({ name: `frame-${f.id}.png`, label: `Frame image: ${f.title}`, url: `${base}/frame-${f.id}.png`, contentType: "image/png" })),
      ]
    : [];
  return reply(200, {
    workshop: { title: w.title, scheduledStart: w.scheduled_start, scheduledEnd: w.scheduled_end, timeZone: w.time_zone },
    status: recap.status,
    reason: recap.reason,
    invoice: recapInvoice(recap),
    files,
    clusters: content.ranking.map((r) => ({ frame: r.frame, title: r.title, dotTotal: r.dots, notes: r.notes })),
  });
}

const FILE_NAME = /^(board\.pdf|notes\.csv|frame-[A-Za-z0-9_-]+\.png)$/;
const FILE_TYPES: Record<string, string> = { pdf: "application/pdf", csv: "text/csv; charset=utf-8", png: "image/png" };

export async function recapFile(_req: Req, p: Record<string, string>): Promise<Reply> {
  const { recap, w } = await byToken(db, p.token ?? "");
  const name = p.name ?? "";
  if (!FILE_NAME.test(name)) fail("not_found");
  if (!recap.files_stored_at) fail("recap_not_ready");
  let bytes: Buffer | null;
  try {
    bytes = await getObject(fileKey(w.id, name));
  } catch (error) {
    if (error instanceof StorageDown) fail("storage_unavailable");
    throw error;
  }
  if (!bytes) fail("not_found");
  return {
    status: 200,
    bytes,
    contentType: FILE_TYPES[name.split(".").pop() ?? ""] ?? "application/octet-stream",
    headers: { "Content-Disposition": `${name.endsWith(".png") ? "inline" : "attachment"}; filename="${name}"` },
  };
}
