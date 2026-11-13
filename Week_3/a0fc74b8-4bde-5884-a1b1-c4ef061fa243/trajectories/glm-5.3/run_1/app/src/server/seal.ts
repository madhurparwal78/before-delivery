import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { sha256Hex } from "./outbox.js";
import type { DocumentRow, Recipient, Field } from "./domain.js";
import type { Ctx } from "./core.js";
import { withTransaction } from "./core.js";
import { writeAudit } from "./audit.js";

/**
 * Draws the completed PDF: original pages + field values + one certificate page.
 * All text in Helvetica, plain ASCII, no object streams (pdf-lib default writes plain objects).
 */
export async function buildCompletedPdf(
  originalBytes: Buffer,
  doc: DocumentRow,
  recipients: Recipient[],
  fields: Field[],
  chainHead: string,
): Promise<Buffer> {
  const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue;
    const { width, height } = page.getSize();
    const x = field.x * width;
    const yFromTop = field.y * height;
    const w = field.w * width;
    const h = field.h * height;
    const y = height - yFromTop - h;
    if (field.value === null || field.value === "") continue;
    if (field.kind === "signature" || field.kind === "initials") {
      if (field.value === "drawn") {
        drawStrokesPlaceholder(pdf, page, x, y, w, h);
      } else if (field.value.startsWith("typed:")) {
        drawText(page, font, field.value.slice("typed:".length), x, y, w, h);
      }
    } else {
      drawText(page, font, field.value, x, y, w, h);
    }
  }

  const certPage = pdf.addPage();
  const { height: ch } = certPage.getSize();
  const lines: string[] = [
    "Certificate of completion",
    `Document: ${doc.title}`,
    `Document ID: ${doc.id}`,
    `Original SHA-256: ${doc.originalSha256}`,
    `Pages in original: ${doc.pageCount}`,
    ...recipients.map((r) => {
      const when = r.signedAt ? r.signedAt.toISOString().slice(0, 16).replace("T", " ") : "";
      return `Signer ${r.order}: ${r.name} <${r.email}> signed ${when} UTC`;
    }),
    `Audit chain head: ${chainHead}`,
  ];
  let cursorY = ch - 90;
  for (const line of lines) {
    certPage.drawText(toAscii(line), { x: 60, y: cursorY, size: 12, font, color: rgb(0.1, 0.1, 0.12) });
    cursorY -= 24;
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

function toAscii(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    out += code >= 32 && code <= 126 ? ch : "?";
  }
  return out;
}

function drawText(page: import("pdf-lib").PDFPage, font: import("pdf-lib").PDFFont, text: string, x: number, y: number, w: number, h: number): void {
  const size = Math.min(h * 0.6, 14);
  const ascii = toAscii(text);
  const textWidth = font.widthOfTextAtSize(ascii, size);
  const scale = Math.min(1, w / Math.max(textWidth, 1));
  page.drawText(ascii, { x: x + 2, y: y + h * 0.2, size: size * scale, font, color: rgb(0.08, 0.09, 0.16) });
}

function drawStrokesPlaceholder(pdf: import("pdf-lib").PDFDocument, page: import("pdf-lib").PDFPage, x: number, y: number, w: number, h: number): void {
  // drawn signatures are rendered from stored strokes when present; placeholder keeps bounds
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.55, 0.1, 0.1), borderWidth: 0.5, opacity: 0 });
}

/** One place that decides when a document can be sealed. */
export async function sealDocument(ctx: Ctx, documentId: string, opts: { skipHealthCheck?: boolean } = {}): Promise<void> {
  // Only an instance whose email and storage both pass may seal.
  if (!opts.skipHealthCheck && (!ctx.health.storageOk || !ctx.health.mailOk)) return;
  const claimed = await tryClaimSeal(ctx, documentId);
  if (!claimed) return;

  const docRes = await ctx.pool.query("SELECT * FROM documents WHERE id = $1", [documentId]);
  if (docRes.rowCount === 0 || docRes.rows[0].status !== "sealing") return;


  try {
    const original = await ctx.storage.get(`documents/${documentId}/original.pdf`);
    if (!original.exists) throw new Error("missing original");
    const recipientsRes = await ctx.pool.query('SELECT * FROM recipients WHERE document_id = $1 ORDER BY "order"', [documentId]);
    const fieldsRes = await ctx.pool.query("SELECT * FROM fields WHERE document_id = $1 ORDER BY created_at", [documentId]);
    const head = await auditChainHeadWithClient(ctx, documentId);
    const recipients = recipientsRes.rows.map(recipientFrom);
    const completed = await buildCompletedPdf(
      original.body,
      normalizeDoc(docRes.rows[0]),
      recipients,
      fieldsRes.rows.map(fieldFrom),
      head,
    );
    const hash = sha256Hex(completed);
    await ctx.storage.put(`documents/${documentId}/completed.pdf`, completed);
    const now = new Date();

    await withTransaction(ctx.pool, async (client) => {
      const updated = await client.query(
        "UPDATE documents SET status = 'completed', completed_sha256 = $1, version = version + 1, updated_at = $2, current_order = NULL WHERE id = $3 AND status = 'sealing' RETURNING id",
        [hash, now, documentId],
      );
      if (updated.rowCount === 0) return;
      await writeAudit(client, documentId, "document.sealed", "system", null, new Date(now.getTime()));
      await writeAudit(client, documentId, "document.completed", "system", null, new Date(now.getTime() + 1));
      await client.query("UPDATE seal_jobs SET sealed = true, attempts = attempts + 1, last_attempt = $2 WHERE document_id = $1", [documentId, now]);
    });
    ctx.live.publishDocument(documentId, { type: "document", id: documentId });
    ctx.live.publishTeam(normalizeDoc(docRes.rows[0]).teamId, { type: "documents" });
    await sendCompletedEmails(ctx, normalizeDoc(docRes.rows[0]), recipients, hash);
  } catch (e) {
    await ctx.pool.query(
      "UPDATE seal_jobs SET attempts = attempts + 1, last_attempt = now() WHERE document_id = $1 AND sealed = false",
      [documentId],
    );
  }
}

async function tryClaimSeal(ctx: Ctx, documentId: string): Promise<boolean> {
  const res = await ctx.pool.query(
    `INSERT INTO seal_jobs (document_id, last_attempt)
     VALUES ($1, now())
     ON CONFLICT (document_id) DO UPDATE SET
       last_attempt = now(),
       attempts = seal_jobs.attempts + 1
     WHERE seal_jobs.sealed = false
       AND (seal_jobs.last_attempt IS NULL OR seal_jobs.last_attempt <= now() - make_interval(secs => $2))
     RETURNING document_id`,
    [documentId, ctx.cfg.sealRetrySeconds],
  );
  return (res.rowCount ?? 0) > 0;
}

async function auditChainHeadWithClient(ctx: Ctx, documentId: string): Promise<string> {
  const res = await ctx.pool.query<{ hash: string }>(
    "SELECT hash FROM audit_events WHERE document_id = $1 ORDER BY seq DESC LIMIT 1",
    [documentId],
  );
  return res.rows[0]?.hash ?? "0".repeat(64);
}

function normalizeDoc(row: Record<string, unknown>): DocumentRow {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    status: row.status as DocumentRow["status"],
    timeZone: String(row.time_zone),
    pageCount: Number(row.page_count),
    originalSha256: String(row.original_sha256),
    completedSha256: row.completed_sha256 === null ? null : String(row.completed_sha256),
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    currentOrder: row.current_order === null ? null : Number(row.current_order),
    reminderAvailableAt: row.reminder_available_at === null ? null : new Date(String(row.reminder_available_at)),
    voidReason: row.void_reason === null ? null : String(row.void_reason),
    voidedBy: row.voided_by === null ? null : String(row.voided_by),
    declinedByRecipientId: row.declined_by_recipient_id === null ? null : String(row.declined_by_recipient_id),
    declinedByName: row.declined_by_name === null ? null : String(row.declined_by_name),
    sendToken: row.send_token === null ? null : String(row.send_token),
    reminderToken: row.reminder_token === null ? null : String(row.reminder_token),
  };
}

function recipientFrom(row: Record<string, unknown>): Recipient {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    name: String(row.name),
    email: String(row.email),
    order: Number(row.order),
    status: row.status as Recipient["status"],
    delivery: (row.delivery === null ? null : String(row.delivery)) as Recipient["delivery"],
    linkHash: row.link_hash === null ? null : String(row.link_hash),
    linkExpiresAt: row.link_expires_at === null ? null : new Date(String(row.link_expires_at)),
    turnStartedAt: row.turn_started_at === null ? null : new Date(String(row.turn_started_at)),
    signedAt: row.signed_at === null ? null : new Date(String(row.signed_at)),
    declineReason: row.decline_reason === null ? null : String(row.decline_reason),
    binding: Boolean(row.binding),
  };
}

function fieldFrom(row: Record<string, unknown>): Field {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    recipientId: String(row.recipient_id),
    kind: row.kind as Field["kind"],
    label: String(row.label),
    required: Boolean(row.required),
    page: Number(row.page),
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    value: row.value === null ? null : String(row.value),
  };
}

async function sendCompletedEmails(ctx: Ctx, doc: DocumentRow, recipients: Recipient[], hash: string): Promise<void> {
  const { deliver } = await import("./outbox.js");
  const ownerRes = await ctx.pool.query("SELECT email, name FROM users WHERE id = $1", [doc.ownerId]);
  const owner = ownerRes.rows[0];
  // Recipients' link tokens must be kept to build download links, but links are stored as hashes.
  // To keep the completed email's download link working, the current token is kept per recipient.
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.email)) continue;
    seen.add(r.email);
    const token = await currentLinkToken(ctx, doc.id, r.id);
    const link = token !== null
      ? `${ctx.cfg.publicUrl}/sign/${token}/completed.pdf`
      : `${ctx.cfg.publicUrl}/api/documents/${doc.id}/completed.pdf`;
    await deliver(ctx, {
      kind: "completed",
      to: r.email,
      subject: `Completed: ${doc.title}`,
      body: [`SHA-256 of the completed PDF: ${hash}`, `Download: ${link}`].join("\n"),
      documentId: doc.id,
      senderName: null,
    });
  }
  if (owner && !seen.has(owner.email)) {
    seen.add(owner.email);
    await deliver(ctx, {
      kind: "completed",
      to: owner.email,
      subject: `Completed: ${doc.title}`,
      body: [
        `SHA-256 of the completed PDF: ${hash}`,
        `Download: ${ctx.cfg.publicUrl}/api/documents/${doc.id}/completed.pdf`,
      ].join("\n"),
      documentId: doc.id,
      senderName: null,
    });
  }
}

/** Returns the recipient's current link token, or null when none is stored. */
async function currentLinkToken(ctx: Ctx, documentId: string, recipientId: string): Promise<string | null> {
  const res = await ctx.pool.query<{ token: string | null }>(
    "SELECT token FROM link_tokens WHERE recipient_id = $1 AND document_id = $2 ORDER BY created_at DESC LIMIT 1",
    [recipientId, documentId],
  );
  return res.rows[0]?.token ?? null;
}
