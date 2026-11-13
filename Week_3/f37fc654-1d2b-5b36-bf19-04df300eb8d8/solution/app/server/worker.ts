// What each durable job does once its service answers, plus the periodic sweeps
// (hold edges, invite expiry, due load-in alerts, maintenance receipts).
import { createHash } from "node:crypto";
import { usd } from "../shared/format.js";
import { queueDueLoadInAlerts } from "./alerts.js";
import { applyMove, endLapsedHolds, loadCommission, userById } from "./commissions.js";
import { notify, one, pool, query, tx } from "./db.js";
import { contractHtml, invoiceHtml, type ContractSnapshot, type InvoiceSnapshot } from "./documents.js";
import { NotYet, enqueue, type Job, type JobKind } from "./jobs.js";
import { usersWithRole } from "./keycloak.js";
import { renderPdf } from "./providers/gotenberg.js";
import { accountInvoices, accountPayments, ensureAccount } from "./providers/killbill.js";
import { sendMail } from "./providers/mail.js";
import { postAlert } from "./providers/ntfy.js";
import { submitRender } from "./providers/renderProvider.js";
import { getObject, objectExists, putObject } from "./providers/s3.js";
import { createMessage } from "./providers/svix.js";
import { fileKey } from "./routes/files.js";
import { expireInvites } from "./routes/funders.js";
import { previewKey } from "./routes/renders.js";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

async function email(job: Job): Promise<void> {
  const p = job.payload as { to: string[]; subject: string; text: string; toProducers?: boolean };
  const producers = p.toProducers ? (await usersWithRole("producer")).map((u) => u.email ?? u.username) : [];
  await sendMail({ to: [...new Set([...p.to, ...producers])], subject: p.subject, text: p.text, messageId: job.id });
}

async function pdf(job: Job): Promise<void> {
  const doc = await one<{ id: string; commission_id: string; kind: string; storage_key: string; status: string; snapshot: ContractSnapshot & InvoiceSnapshot }>(
    "SELECT * FROM documents WHERE id = $1", [String(job.payload.documentId)],
  );
  if (!doc || doc.status === "issued") return;
  // A PDF is stored once under its fixed key; a rerun after a crash reuses the stored bytes.
  const bytes = (await objectExists(doc.storage_key))
    ? await getObject(doc.storage_key)
    : await renderPdf(doc.kind === "contract" ? contractHtml(doc.snapshot) : invoiceHtml(doc.snapshot));
  if (!(await objectExists(doc.storage_key))) await putObject(doc.storage_key, bytes, "application/pdf");
  await query("UPDATE documents SET status = 'issued', size_bytes = $2, sha256 = $3, issued_at = now() WHERE id = $1", [doc.id, bytes.length, sha256(bytes)]);
}

async function crewAlert(job: Job): Promise<void> {
  const p = job.payload as { title: string; message: string; installDayId: string };
  const day = await one("SELECT 1 FROM install_days WHERE id = $1 AND released_at IS NULL", [p.installDayId]);
  if (day) await postAlert(p.title, p.message);
}

async function webhook(job: Job): Promise<void> {
  const p = job.payload as { eventId: string; type: string; occurredAt: string; commissionId: string; clientId: string; data: Record<string, unknown> };
  const data = { ...p.data };
  if (p.type === "contract.signed") {
    const contract = await one<{ sha256: string | null; status: string }>("SELECT sha256, status FROM documents WHERE id = $1", [String(data.contractDocumentId)]);
    if (!contract || contract.status !== "issued") throw new NotYet("waiting for the contract PDF");
    data.contractSha256 = contract.sha256;
  }
  const client = await userById(pool, p.clientId);
  await createMessage(p.clientId, client.name, p.eventId, p.type, { eventId: p.eventId, type: p.type, occurredAt: p.occurredAt, commissionId: p.commissionId, data });
}

async function renderSubmit(job: Job): Promise<void> {
  const render = await one<{
    id: string; commission_id: string; venue_photo_file_id: string; state: string; layout: unknown; reference_url: string | null;
    reference_content_type: string | null; reference_sha256: string | null; reference_bytes: Buffer | null;
  }>("SELECT * FROM render_jobs WHERE id = $1", [String(job.payload.renderJobId)]);
  if (!render || render.state !== "queued") return;
  const c = await loadCommission(pool, render.commission_id);
  const photo = await one<{ content_type: string; size_bytes: number; sha256: string }>("SELECT content_type, size_bytes, sha256 FROM files WHERE id = $1", [render.venue_photo_file_id]);
  if (!c || !photo) return;
  const bytes = await getObject(fileKey(c.id, render.venue_photo_file_id));
  const outcome = await submitRender(render.id, {
    jobRef: render.id,
    installationType: c.installationType,
    room: c.room,
    layout: render.layout,
    brief: { title: c.title, audience: c.audience, notes: c.notes },
    venuePhoto: { contentType: photo.content_type, sizeBytes: photo.size_bytes, sha256: photo.sha256, base64: bytes.toString("base64") },
    referenceImage: render.reference_bytes
      ? { sourceUrl: render.reference_url, contentType: render.reference_content_type, sha256: render.reference_sha256, base64: render.reference_bytes.toString("base64") }
      : null,
    callbackUrl: String(job.payload.callbackUrl),
  });
  if (outcome.kind === "retry") throw new Error(outcome.reason);
  await tx(async (db) => {
    if (outcome.kind === "accepted") {
      await db.query("UPDATE render_jobs SET state = CASE WHEN state = 'queued' THEN 'submitted' ELSE state END, provider_job_id = $2, updated_at = now() WHERE id = $1", [render.id, outcome.providerJobId]);
    } else {
      await db.query("UPDATE render_jobs SET state = 'failed', failure_reason = 'provider_rejected', updated_at = now() WHERE id = $1 AND terminal_event IS NULL", [render.id]);
    }
    await notify(db, "render.updated", { renderId: render.id, state: outcome.kind === "accepted" ? "submitted" : "failed", progress: 0, commissionId: c.id });
  });
}

async function renderStore(job: Job): Promise<void> {
  const render = await one<{ id: string; commission_id: string; state: string; preview_bytes: Buffer | null }>(
    "SELECT id, commission_id, state, preview_bytes FROM render_jobs WHERE id = $1", [String(job.payload.renderJobId)],
  );
  if (!render || render.state === "ready" || !render.preview_bytes) return;
  await putObject(previewKey(render.commission_id, render.id), render.preview_bytes, "image/png");
  await tx(async (db) => {
    await db.query("UPDATE render_jobs SET state = 'ready', preview_bytes = NULL, updated_at = now() WHERE id = $1", [render.id]);
    const c = await loadCommission(db, render.commission_id, true);
    if (c) await applyMove(db, c, "previewed", "system");
    await notify(db, "render.updated", { renderId: render.id, state: "ready", progress: 100, commissionId: render.commission_id });
  });
}

export const handlers: Record<JobKind, (job: Job) => Promise<void>> = {
  email, pdf, crew_alert: crewAlert, webhook, render_submit: renderSubmit, render_store: renderStore,
};

let lastReceiptSweep = 0;

/** A receipt, once, for every maintenance invoice Kill Bill records a payment for. */
async function maintenanceReceipts(): Promise<void> {
  const rows = await query<{ commission_id: string; killbill_subscription_id: string }>("SELECT commission_id, killbill_subscription_id FROM maintenance");
  for (const row of rows) {
    const c = await loadCommission(pool, row.commission_id);
    if (!c) continue;
    const client = await userById(pool, c.clientId);
    const accountId = await ensureAccount(client);
    const invoices = (await accountInvoices(accountId)).filter((i) => i.items.some((item) => item.subscriptionId === row.killbill_subscription_id));
    for (const payment of await accountPayments(accountId)) {
      const invoice = invoices.find((i) => payment.targetInvoiceIds.includes(i.invoiceId));
      if (!payment.succeeded || !invoice) continue;
      await tx(async (db) => {
        const fresh = await one("INSERT INTO maintenance_receipts (killbill_payment_id, commission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1", [payment.paymentId, c.id], db);
        if (!fresh) return;
        await enqueue(db, "email", c.id, {
          to: [client.email],
          subject: `Receipt — ${c.title} — Maintenance`,
          text: `Thank you. Your maintenance invoice for ${c.title} is paid.\n\nAmount paid: ${usd(invoice.amountCents)}\nKill Bill invoice: ${invoice.invoiceNumber}\nPayment reference: ${payment.paymentId}\n`,
        });
      });
    }
  }
}

export async function sweeps(): Promise<void> {
  const now = Date.now();
  await tx((db) => endLapsedHolds(db, now));
  await expireInvites(pool, now);
  await tx((db) => queueDueLoadInAlerts(db, now));
  if (now - lastReceiptSweep > 60_000) {
    lastReceiptSweep = now;
    await maintenanceReceipts().catch(() => undefined);
  }
}

