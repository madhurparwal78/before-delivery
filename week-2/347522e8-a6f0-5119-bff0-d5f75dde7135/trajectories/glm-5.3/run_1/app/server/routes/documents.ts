import { ApiError } from "../errors.js";
import { json, parseJsonBody, route, requireOperator, requireUser, renterScoped, type RouteContext } from "../router.js";
import { one, rows } from "../db.js";
import { hasAllThreeKinds, loadDocuments, complianceOf } from "../compliance.js";
import { kitchenToday, isValidDate } from "../kitchenTime.js";
import { boundaryOf, parseMultipart } from "../multipart.js";
import { extensionFor, sanitizeOriginalName, sniffType } from "../upload.js";
import { putObject, signedUrl } from "../storage.js";
import { balances } from "../ledger.js";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

route("POST", "/api/renters/{renter_id}/documents", "renter", async (ctx: RouteContext) => {
  const renterId = ctx.url.pathname.split("/")[3]!;
  renterScoped(ctx, renterId);
  const contentType = ctx.req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw ApiError.unsupportedMediaType();
  }
  const boundary = boundaryOf(contentType);
  if (!boundary || !ctx.req.body) throw ApiError.validationError({ body: "A multipart body is required." });
  const parts = parseMultipart(ctx.req.body, boundary);
  const fields = new Map<string, string>();
  let file: { data: Buffer; filename: string } | null = null;
  for (const part of parts) {
    if (part.filename !== null) {
      if (part.name === "file") file = { data: part.data, filename: part.filename };
    } else if (part.value !== null) {
      fields.set(part.name, part.value);
    }
  }
  const kind = text(fields.get("kind"));
  const expiresOn = text(fields.get("expires_on"));
  if (kind !== "coi" && kind !== "food_handler_card" && kind !== "business_licence") {
    throw ApiError.validationError({ kind: "Choose a document type." });
  }
  if ((kind === "coi" || kind === "food_handler_card") && !expiresOn) {
    throw ApiError.validationError({ expires_on: "Enter the expiry date." });
  }
  if (expiresOn && !isValidDate(expiresOn)) {
    throw ApiError.validationError({ expires_on: "Enter the expiry date as YYYY-MM-DD." });
  }
  const today = kitchenToday(ctx.now);
  if (expiresOn && expiresOn < today) {
    throw ApiError.validationError({ expires_on: "The expiry date is before today." });
  }
  if (!file || file.data.length === 0) {
    throw ApiError.validationError({ file: "Choose a scan file." });
  }
  if (file.data.length > 5000000) throw ApiError.fileTooLarge();
  const sniffed = sniffType(file.data);
  if (!sniffed) throw ApiError.unsupportedType();

  const renter = await one<{ status: string; business_name: string }>(
    ctx.db,
    "select status, business_name from renters where id = $1",
    [renterId],
  );
  if (!renter) throw ApiError.notFound();
  if (renter.status === "offboarded") throw ApiError.renterOffboarded();

  const idResult = await rows<{ id: string }>(
    ctx.db,
    "insert into documents (renter_id, kind, expires_on, status, object_key, original_name, size_bytes, content_type) values ($1, $2, $3, 'pending_review', '', $4, $5, $6) returning id",
    [renterId, kind, expiresOn || null, sanitizeOriginalName(file.filename), file.data.length, sniffed],
  );
  const documentId = idResult[0]!.id;
  const objectKey = `renters/${renterId}/documents/${documentId}.${extensionFor(sniffed)}`;
  await ctx.db.query("update documents set object_key = $1 where id = $2", [objectKey, documentId]);

  const stored = await putObject(objectKey, file.data, sniffed);
  if (stored.kind === "unavailable") {
    await ctx.db.query("delete from documents where id = $1", [documentId]);
    throw ApiError.storageUnavailable();
  }

  const documents = await loadDocuments(ctx.db, renterId);
  if (hasAllThreeKinds(documents)) {
    await ctx.db.query("update renters set status = 'documents_review' where id = $1 and status = 'applied'", [
      renterId,
    ]);
  }
  const documentsAfter = await loadDocuments(ctx.db, renterId);
  const document = documentsAfter.find((d) => d.id === documentId);
  if (!document) throw ApiError.notFound();
  return json({ document }, 201);
});

route("POST", "/api/documents/{document_id}/review", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const documentId = ctx.url.pathname.split("/")[3]!;
  const body = parseJsonBody<{ decision?: unknown; note?: unknown }>(ctx);
  const decision = text(body.decision);
  const note = typeof body.note === "string" ? body.note : null;
  if (decision !== "approve" && decision !== "reject") {
    throw ApiError.validationError({ decision: "Choose approve or reject." });
  }
  const found = await one<{ id: string; renter_id: string; status: string; expires_on: string | null; kind: string }>(
    ctx.db,
    "select id, renter_id, status, expires_on::text as expires_on, kind from documents where id = $1",
    [documentId],
  );
  if (!found) throw ApiError.notFound();
  if (found.status !== "pending_review") {
    throw ApiError.invalidTransition(found.status, decision === "approve" ? "approved" : "rejected");
  }
  const today = kitchenToday(ctx.now);
  if (decision === "approve" && found.expires_on !== null && found.expires_on < today) {
    throw ApiError.documentExpired();
  }
  const renterRow = await one<{ id: string; status: string; email: string }>(
    ctx.db,
    "select id, status, email from renters where id = $1",
    [found.renter_id],
  );
  if (!renterRow) throw ApiError.notFound();
  await ctx.db.query("update documents set status = $1 where id = $2", [
    decision === "approve" ? "approved" : "rejected",
    documentId,
  ]);
  // Reinstatement (DP-33): an approval that leaves COI and card current moves
  // a suspended renter back to active.
  const documents = await loadDocuments(ctx.db, found.renter_id);
  const compliance = complianceOf(documents, today);
  if (decision === "approve" && renterRow.status === "suspended" && compliance.state !== "incomplete" && compliance.state !== "lapsed") {
    await ctx.db.query("update renters set status = 'active' where id = $1", [found.renter_id]);
  }
  const renterAfter = await one<{
    business_name: string;
    contact_name: string;
    phone: string;
    status: string;
  }>(
    ctx.db,
    "select business_name, contact_name, phone, status from renters where id = $1",
    [found.renter_id],
  );
  const balance = await balances(ctx.db, found.renter_id);
  const document = documents.find((d) => d.id === documentId);
  if (!document) throw ApiError.notFound();
  return json({
    document,
    renter: {
      id: renterRow.id,
      business_name: renterAfter?.business_name ?? "",
      contact_name: renterAfter?.contact_name ?? "",
      email: renterRow.email,
      phone: renterAfter?.phone ?? "",
      status: renterAfter?.status ?? "",
      balance_minutes: balance.balanceMinutes,
      held_minutes: balance.heldMinutes,
      compliance,
    },
  });
});


route("GET", "/api/documents/{document_id}/file", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const documentId = ctx.url.pathname.split("/")[3]!;
  const found = await one<{ renter_id: string; object_key: string }>(
    ctx.db,
    "select renter_id, object_key from documents where id = $1",
    [documentId],
  );
  if (!found) throw ApiError.notFound();
  if (user.role === "renter") renterScoped(ctx, found.renter_id);
  else if (user.role !== "operator" && user.role !== "shift_lead") throw ApiError.forbidden();
  const url = await signedUrl(found.object_key);
  if (!url) throw ApiError.storageUnavailable();
  return new Response(null, { status: 302, headers: { Location: url } });
});

