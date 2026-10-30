/** Compliance documents: upload (stored before its record), review, and file access. */

import { randomUUID } from "node:crypto";
import type { Document } from "../../../shared/api-types.js";
import { uuid } from "../../db.js";
import type { Storage } from "../../providers/storage.js";
import { queueEmail, approvalEmail, rejectionEmail } from "../../email.js";
import { DOCUMENT_KIND_LABELS } from "../../../shared/api-types.js";
import { err, notFound, validation } from "../errors.js";
import { parseMultipart, readRawBody, uploadBodyLimit, type App, type RouteContext } from "../server.js";
import { json, readJson, requireRole, requireUser, str } from "./helpers.js";
import type { DocumentRow } from "../../domain/tenants.js";
import type { UserRow } from "./helpers.js";

const FILE_SIZE_LIMIT = 5_000_000;

/** Accepted only when the first bytes are a real PDF, JPEG or PNG, whatever the name says. */
export function detectFileType(bytes: Buffer): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes.subarray(1, 4).toString("latin1") === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

const EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png"
};

/** The client name's last segment, control characters removed, cut to 120 characters. */
export function storedFileName(clientName: string): string {
  const lastSegment = clientName.split(/[/\\]/).pop() ?? "";
  const cleaned = lastSegment.replace(/[\x00-\x1f\x7f]/g, "");
  const cut = cleaned.slice(0, 120);
  return cut === "" ? "document" : cut;
}

export function documentJson(row: DocumentRow, today: string): Document {
  const valid = row.status === "approved" && row.expires_on >= today;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    kind: row.kind,
    holder_name: row.holder_name,
    expires_on: row.expires_on,
    status: row.status,
    valid,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at.toISOString(),
    reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    rejection_reason: row.rejection_reason
  };
}

export function registerDocumentRoutes(app: App, storage: Storage): void {
  app.route("POST", "/api/documents", "signed_in", async (rc: RouteContext) => {
    const user = await requireUser(rc);
    const contentType = rc.ctx.req.headers["content-type"] ?? "";
    if (!contentType.startsWith("multipart/form-data")) {
      throw err(415, "unsupported_media_type", "That kind of content isn't accepted.");
    }
    const raw = await readRawBody(rc.ctx.req, uploadBodyLimit, "file_too_large");
    const form = parseMultipart(raw, contentType);

    let tenantId: string;
    if (user.role === "operator") {
      tenantId = form.fields["tenant_id"] ?? "";
      if (tenantId === "") {
        throw validation({ tenant_id: "Choose the tenant this document belongs to." });
      }
    } else {
      tenantId = user.tenant_id as string;
    }
    const tenantRows = await rc.db.query<{ id: string; business_name: string }>(
      "SELECT id, business_name FROM tenants WHERE id = $1",
      [tenantId]
    );
    if (tenantRows.length === 0 || (user.tenant_id !== null && tenantId !== user.tenant_id)) {
      throw notFound();
    }

    const kind = form.fields["kind"] ?? "";
    const expiresOn = form.fields["expires_on"] ?? "";
    const holderName = (form.fields["holder_name"] ?? "").trim();
    const details: Record<string, string> = {};
    if (!(kind in DOCUMENT_KIND_LABELS)) {
      details["kind"] = "Choose the document type.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
      details["expires_on"] = "Give the expiry date.";
    } else if (expiresOn < rc.db.clock.today()) {
      details["expires_on"] = "The expiry date must be today or later.";
    }
    if (kind === "food_handler_card" && (holderName === "" || holderName.length > 120)) {
      details["holder_name"] = "Give the name on the card (at most 120 characters).";
    }
    if (form.file === null || form.file.bytes.length === 0) {
      details["file"] = "Choose the document file.";
    }
    if (Object.keys(details).length > 0) {
      throw validation(details);
    }
    if (form.file === null) {
      throw validation({ file: "Choose the document file." });
    }
    const detected = detectFileType(form.file.bytes);
    if (detected === null) {
      throw err(415, "unsupported_file_type", "Only PDF, JPEG or PNG files are accepted. This file is not one of them.");
    }
    if (form.file.bytes.length > FILE_SIZE_LIMIT) {
      throw err(413, "file_too_large", "That file is larger than the upload limit.");
    }

    // The file is stored before its record exists.
    const id = uuid();
    const key = `tenants/${tenantId}/documents/${id}.${EXT_BY_TYPE[detected]}`;
    await storage.putObject(key, form.file.bytes, detected);
    try {
      await rc.db.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO documents
           (id, tenant_id, kind, holder_name, expires_on, status, file_name, content_type, size_bytes,
            storage_key, uploaded_at)
           VALUES ($1,$2,$3,$4,$5::date,'pending_review',$6,$7,$8,$9, now())`,
          [
            id,
            tenantId,
            kind,
            kind === "food_handler_card" ? holderName : null,
            expiresOn,
            storedFileName(form.file?.fileName ?? ""),
            detected,
            form.file?.bytes.length ?? 0,
            key
          ]
        );
        // The tenant's first successful upload moves it from applied to documents review.
        await client.query(
          "UPDATE tenants SET status = 'documents_review' WHERE id = $1 AND status = 'applied'",
          [tenantId]
        );
      });
    } catch (e) {
      await storage.deleteObject(key).catch(() => undefined);
      throw e;
    }
    await rc.db.audit(user.id, "upload_document", "document", id, { kind, expiresOn });
    const rows = await loadDocumentRow(rc, id);
    return json(201, documentJson(rows, rc.db.clock.today()));
  });

  app.route("GET", "/api/documents", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    let tenantId: string | null = null;
    const filter = rc.ctx.url.searchParams.get("tenant_id");
    if (user.role === "operator") {
      if (filter !== null) {
        tenantId = filter;
      }
    } else {
      tenantId = user.tenant_id;
    }
    const params: unknown[] = [];
    let where = "TRUE";
    if (tenantId !== null) {
      params.push(tenantId);
      where = `tenant_id = $${params.length}`;
      if (user.tenant_id !== null && tenantId !== user.tenant_id) {
        throw notFound();
      }
    }
    const docs = await rc.db.query<DocumentRow>(
      `SELECT id, tenant_id, kind, holder_name, expires_on::text AS expires_on, status, file_name,
              content_type, size_bytes, storage_key, uploaded_at, reviewed_at, rejection_reason, reminder_sent_at
       FROM documents WHERE ${where} ORDER BY uploaded_at DESC, id DESC`,
      params
    );
    const today = rc.db.clock.today();
    return json(200, { documents: docs.map((d) => documentJson(d, today)) });
  });

  app.route("GET", "/api/documents/:id", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const row = await loadDocumentRow(rc, rc.ctx.params["id"] ?? "");
    if (user.tenant_id !== null && row.tenant_id !== user.tenant_id) {
      throw notFound();
    }
    return json(200, documentJson(row, rc.db.clock.today()));
  });

  app.route("GET", "/api/documents/:id/file", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const row = await loadDocumentRow(rc, rc.ctx.params["id"] ?? "");
    if (user.tenant_id !== null && row.tenant_id !== user.tenant_id) {
      throw notFound();
    }
    const bytes = await storage.getObject(row.storage_key);
    return {
      status: 200,
      body: bytes,
      contentType: row.content_type,
      disposition: `attachment; filename="${row.file_name}"`
    };
  });

  app.route("POST", "/api/documents/:id/approve", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const row = await loadDocumentRow(rc, rc.ctx.params["id"] ?? "");
    if (row.status !== "pending_review") {
      throw err(409, "invalid_transition", "That can't be done in this record's current state.");
    }
    // Approval first reads the stored file back in full and compares its size.
    let bytes: Buffer;
    try {
      bytes = await storage.getObject(row.storage_key);
    } catch {
      throw err(409, "file_missing", "The stored file can't be read. Ask the tenant to upload it again.");
    }
    if (bytes.length !== row.size_bytes) {
      throw err(409, "file_missing", "The stored file can't be read. Ask the tenant to upload it again.");
    }
    const tenantRows = await rc.db.query<{ owner_email: string }>(
      "SELECT owner_email FROM tenants WHERE id = $1",
      [row.tenant_id]
    );
    await rc.db.withTransaction(async (client) => {
      await client.query(
        "UPDATE documents SET status = 'approved', reviewed_at = now() WHERE id = $1",
        [row.id]
      );
      await queueEmail(client, approvalEmail(tenantRows[0].owner_email, row.kind, row.expires_on));
    });
    await rc.db.audit(user.id, "approve_document", "document", row.id, {});
    const updated = await loadDocumentRow(rc, row.id);
    return json(200, documentJson(updated, rc.db.clock.today()));
  });

  app.route("POST", "/api/documents/:id/reject", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const row = await loadDocumentRow(rc, rc.ctx.params["id"] ?? "");
    if (row.status !== "pending_review") {
      throw err(409, "invalid_transition", "That can't be done in this record's current state.");
    }
    const body = await readJson(rc.ctx);
    const reason = str(body["reason"]) ?? "";
    if (reason.length < 1 || reason.length > 500) {
      throw validation({ reason: "Give a reason for the tenant." });
    }
    const tenantRows = await rc.db.query<{ owner_email: string }>(
      "SELECT owner_email FROM tenants WHERE id = $1",
      [row.tenant_id]
    );
    await rc.db.withTransaction(async (client) => {
      await client.query(
        "UPDATE documents SET status = 'rejected', reviewed_at = now(), rejection_reason = $1 WHERE id = $2",
        [reason, row.id]
      );
      await queueEmail(client, rejectionEmail(tenantRows[0].owner_email, row.kind, reason));
    });
    await rc.db.audit(user.id, "reject_document", "document", row.id, { reason });
    const updated = await loadDocumentRow(rc, row.id);
    return json(200, documentJson(updated, rc.db.clock.today()));
  });
}

export async function loadDocumentRow(rc: RouteContext, id: string): Promise<DocumentRow> {
  const rows = await rc.db.query<DocumentRow>(
    `SELECT id, tenant_id, kind, holder_name, expires_on::text AS expires_on, status, file_name,
            content_type, size_bytes, storage_key, uploaded_at, reviewed_at, rejection_reason, reminder_sent_at
     FROM documents WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) {
    throw notFound();
  }
  return rows[0];
}
