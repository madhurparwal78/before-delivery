import busboy from "busboy";
import { audit, pool, transaction } from "../db.js";
import { DOCUMENT_LABELS, type DocumentRow, type DocumentType, type Member, type User } from "../domain.js";
import { refuse } from "../errors.js";
import { type ApiRequest, json, route } from "../http.js";
import { isCalendarDate, kitchenDate } from "../kitchenTime.js";
import { scanReminders } from "../reminders.js";
import { documentReview, documentState } from "../rules.js";
import { requireUp } from "../services.js";
import { getFile, putFile } from "../storage.js";
import { loadKitchen, memberFor } from "../store.js";
import { newId } from "../bookingUnit.js";
import { allow, authed, bodyOf, type Errors, failIfAny } from "../validate.js";
import { documentView } from "../views.js";

const FILE_LIMIT = 5_000_000;
const DOCUMENT_COLUMNS = `id, kitchen_id, member_id, type, state, expires_on, original_name, size_bytes, content_type, uploaded_at,
  reject_reason, file_stored`;

interface Upload {
  fields: Record<string, string>;
  file: { name: string | undefined; bytes: Buffer } | null;
}

function parseUpload(request: ApiRequest): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const upload: Upload = { fields: {}, file: null };
    const parser = busboy({
      headers: request.headers,
      preservePath: true,
      limits: { fileSize: FILE_LIMIT + 1, files: 1, fields: 10, fieldSize: 1_000 },
    });
    parser.on("field", (name, value) => {
      upload.fields[name] = value;
    });
    parser.on("file", (name, stream, info) => {
      const chunks: Buffer[] = [];
      const file = { name: name === "file" ? info.filename : undefined, bytes: Buffer.alloc(0) };
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        file.bytes = Buffer.concat(chunks);
        if (name === "file") upload.file = file;
      });
    });
    parser.on("close", () => resolve(upload));
    parser.on("error", () => reject(refuse.validation({ file: "The upload could not be read." })));
    parser.end(request.raw);
  });
}

/** The content type judged from the file's first bytes. */
function detectType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  return null;
}

function safeName(name: string): boolean {
  return name !== "" && name.length <= 200 && !name.includes("/") && !name.includes("\\") && !name.includes("..") && !/[\x00-\x1f\x7f]/.test(name);
}

const isDocumentType = (value: unknown): value is DocumentType =>
  value === "insurance" || value === "food_handler" || value === "kitchen_agreement";

const fileKey = (doc: Pick<DocumentRow, "kitchen_id" | "member_id" | "id">): string =>
  `documents/${doc.kitchen_id}/${doc.member_id}/${doc.id}`;

async function documentFor(user: User, id: string): Promise<DocumentRow> {
  const found = await pool.query<DocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = $1 AND kitchen_id = $2`, [
    id,
    user.kitchen_id,
  ]);
  const doc = found.rows[0];
  if (!doc || (user.role === "member" && doc.member_id !== user.member_id)) throw refuse.notFound();
  return doc;
}

route(
  "GET",
  "/api/documents",
  authed(async (_request, user, now) => {
    allow(user, "operator", "member");
    const kitchen = await loadKitchen(user.kitchen_id);
    const found = await pool.query<DocumentRow>(
      `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE kitchen_id = $1 AND ($2::text IS NULL OR member_id = $2)
        ORDER BY uploaded_at DESC, id`,
      [kitchen.id, user.role === "member" ? user.member_id : null],
    );
    const today = kitchenDate(kitchen.timezone, now);
    return json(200, { documents: found.rows.map((d) => documentView(d, today)) });
  }),
);

route(
  "POST",
  "/api/documents",
  authed(async (request, user, now) => {
    const upload = await parseUpload(request);
    const { fields, file } = upload;
    let member: Member | null = null;
    if (fields.member_id !== undefined) member = await memberFor(user, fields.member_id);
    else if (user.role === "member" && user.member_id) member = await memberFor(user, user.member_id);
    allow(user, "operator", "member");
    if (user.role === "member" && fields.type === "kitchen_agreement") throw refuse.forbidden();
    const kitchen = await loadKitchen(user.kitchen_id);
    const today = kitchenDate(kitchen.timezone, now);
    const errors: Errors = {};
    const type = isDocumentType(fields.type) ? fields.type : "insurance";
    if (!isDocumentType(fields.type)) errors.type = "Choose a document type.";
    if (!member) errors.member_id = "Choose the member this document belongs to.";
    const expiresOn = fields.expires_on ?? "";
    if (type === "kitchen_agreement") {
      if (expiresOn !== "") errors.expires_on = "A kitchen-use agreement has no expiry date.";
    } else if (!isCalendarDate(expiresOn) || expiresOn < today) {
      errors.expires_on = "Choose an expiry date from today onward.";
    }
    const name = file?.name ?? "";
    const bytes = file?.bytes ?? Buffer.alloc(0);
    if (!file) errors.file = "Choose a file to upload.";
    else if (!safeName(name)) errors.file = "That file name is not allowed. Rename the file and try again.";
    else if (bytes.length === 0) errors.file = "The file is empty.";
    if (!member) throw refuse.validation(errors);
    failIfAny(errors);
    if (bytes.length > FILE_LIMIT) throw refuse.fileTooLarge();
    const contentType = detectType(bytes);
    if (!contentType) throw refuse.unsupportedType();
    requireUp("files");
    const doc: DocumentRow = {
      id: newId("doc"),
      kitchen_id: kitchen.id,
      member_id: member.id,
      type,
      state: "uploaded",
      expires_on: type === "kitchen_agreement" ? null : expiresOn,
      original_name: name,
      size_bytes: bytes.length,
      content_type: contentType,
      uploaded_at: now,
      reject_reason: null,
      file_stored: true,
    };
    await putFile(fileKey(doc), bytes, contentType);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO documents (${DOCUMENT_COLUMNS}) VALUES ($1,$2,$3,$4,'uploaded',$5,$6,$7,$8,$9,NULL,true)`,
        [doc.id, doc.kitchen_id, doc.member_id, doc.type, doc.expires_on, doc.original_name, doc.size_bytes, doc.content_type, now],
      );
      await audit(client, user.id, "document", doc.id, null, "uploaded", now);
    });
    return json(201, { document: documentView(doc, today) });
  }),
  true,
);

route(
  "GET",
  "/api/documents/:document_id",
  authed(async (request, user, now) => {
    const doc = await documentFor(user, request.params.document_id ?? "");
    allow(user, "operator", "member");
    const kitchen = await loadKitchen(user.kitchen_id);
    return json(200, { document: documentView(doc, kitchenDate(kitchen.timezone, now)) });
  }),
);

/** A small one-page PDF standing in for a seeded document's scan. */
function seedPdf(text: string): Buffer {
  const stream = `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** Stores the generated PDF of a seeded document the first time storage is reachable. */
export async function storeSeedFiles(): Promise<void> {
  const pending = await pool.query<DocumentRow & { business: string }>(
    `SELECT d.id, d.kitchen_id, d.member_id, d.type, d.expires_on, m.business
       FROM documents d JOIN members m ON m.id = d.member_id WHERE NOT d.file_stored`,
  );
  for (const doc of pending.rows) {
    const pdf = seedPdf(`${DOCUMENT_LABELS[doc.type]} - ${doc.business}${doc.expires_on ? ` - expires ${doc.expires_on}` : ""}`);
    await putFile(fileKey(doc), pdf, "application/pdf");
    await pool.query("UPDATE documents SET file_stored = true, size_bytes = $1 WHERE id = $2", [pdf.length, doc.id]);
  }
}

function attachment(name: string): string {
  if (/^[\x20-\x7e]*$/.test(name)) return `attachment; filename="${name.replace(/"/g, '\\"')}"`;
  return `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, '\\"')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

route(
  "GET",
  "/api/documents/:document_id/file",
  authed(async (request, user) => {
    const doc = await documentFor(user, request.params.document_id ?? "");
    allow(user, "operator", "member");
    requireUp("files");
    if (!doc.file_stored) await storeSeedFiles();
    const bytes = await getFile(fileKey(doc));
    return {
      status: 200,
      bytes,
      headers: {
        "Content-Type": doc.content_type,
        "Content-Disposition": attachment(doc.original_name),
        "Cache-Control": "private, no-store",
      },
    };
  }),
);

function review(to: "verified" | "rejected") {
  return authed(async (request, user, now) => {
    const doc = await documentFor(user, request.params.document_id ?? "");
    allow(user, "operator");
    const kitchen = await loadKitchen(user.kitchen_id);
    const today = kitchenDate(kitchen.timezone, now);
    const current = documentState(doc, today);
    documentReview(current, to);
    const body = bodyOf(request);
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (to === "rejected" && (reason.trim().length < 1 || reason.length > 300)) {
      throw refuse.validation({ reason: "Give a reason of 1 to 300 characters." });
    }
    const updated: DocumentRow = { ...doc, state: to, reject_reason: to === "rejected" ? reason : null };
    await transaction(async (client) => {
      await client.query("UPDATE documents SET state = $1, reject_reason = $2 WHERE id = $3", [to, updated.reject_reason, doc.id]);
      await audit(client, user.id, "document", doc.id, current, to, now);
    });
    if (to === "verified") void scanReminders();
    return json(200, { document: documentView(updated, today) });
  });
}

route("POST", "/api/documents/:document_id/verify", review("verified"));
route("POST", "/api/documents/:document_id/reject", review("rejected"));
