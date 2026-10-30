import { requireActor, requireRole, type Actor } from "../auth.js";
import { all, newId, one, pool } from "../db.js";
import type { DocumentKind, DocumentRow } from "../documents.js";
import { ApiError, invalid, json, multipart, route } from "../http.js";
import { documentKey, getObject, putObject } from "../s3.js";
import { renterInScope, type SiteRow } from "../scope.js";
import { daysBetween, isLocalDate, localDate } from "../time.js";

const FILE_LIMIT = 5000000;
const KINDS: DocumentKind[] = ["liability", "food_handler"];

/** File type judged by its leading bytes only (brief: Documents). */
function sniff(data: Buffer): { type: string; extension: string } | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return { type: "application/pdf", extension: "pdf" };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", extension: "png" };
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { type: "image/jpeg", extension: "jpg" };
  return null;
}

const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

/** Document body, with its status on the renter's home-site date (Current, Expires in n days, Expired, Not yet valid). */
function documentJson(doc: DocumentRow, today: string) {
  const daysLeft = daysBetween(today, doc.expires_on);
  const status = doc.valid_from > today ? "not_yet_valid" : daysLeft < 0 ? "expired" : daysLeft <= 14 ? "expiring" : "current";
  return {
    id: doc.id, kind: doc.kind, valid_from: doc.valid_from, expires_on: doc.expires_on, content_type: doc.content_type,
    size_bytes: doc.size_bytes, uploaded_at: doc.uploaded_at.toISOString(), status, days_left: daysLeft,
  };
}

async function homeToday(renterId: string): Promise<string> {
  const site = await one<SiteRow>(pool, "SELECT s.* FROM sites s JOIN renters r ON r.home_site_id = s.id WHERE r.id = $1", [renterId]);
  return localDate(site?.time_zone ?? "UTC", new Date());
}

route("POST", "/api/documents", async (request) => {
  const actor = await requireActor(request);
  requireRole(actor, "renter");
  const renterId = actor.renterId ?? "";
  const parts = multipart(request);
  const text = (name: string): string => parts.find((part) => part.name === name && part.filename === null)?.data.toString("utf8").trim() ?? "";
  const file = parts.find((part) => part.name === "file" && part.filename !== null);
  const kind = text("kind") as DocumentKind;
  const validFrom = text("valid_from");
  const expiresOn = text("expires_on");
  const fields: Record<string, string> = {};
  if (!KINDS.includes(kind)) fields.kind = "Choose Liability certificate or Food handler card.";
  if (!isLocalDate(validFrom)) fields.valid_from = "Use a date in the form YYYY-MM-DD.";
  if (!isLocalDate(expiresOn)) fields.expires_on = "Use a date in the form YYYY-MM-DD.";
  else if (isLocalDate(validFrom) && expiresOn < validFrom) fields.expires_on = "The expiry date can't be before the valid-from date.";
  if (!file || file.data.length === 0) fields.file = "Choose a PDF, PNG or JPEG file.";
  if (Object.keys(fields).length > 0 || !file) throw invalid(fields);
  if (file.data.length > FILE_LIMIT) throw new ApiError(413, "file_too_large", { limit_bytes: FILE_LIMIT });
  const detected = sniff(file.data);
  if (!detected) throw new ApiError(415, "unsupported_file_type");
  const doc: DocumentRow = {
    id: newId("doc"), renter_id: renterId, kind, valid_from: validFrom, expires_on: expiresOn, content_type: detected.type,
    size_bytes: file.data.length, uploaded_at: new Date(), reminder_queued_at: null,
  };
  await putObject(documentKey(renterId, doc.id), file.data, detected.type);
  await pool.query(
    "INSERT INTO documents (id, renter_id, kind, valid_from, expires_on, content_type, size_bytes, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [doc.id, renterId, doc.kind, doc.valid_from, doc.expires_on, doc.content_type, doc.size_bytes, doc.uploaded_at]);
  return json(201, { document: documentJson(doc, await homeToday(renterId)) });
}, "multipart");

/** The renter whose documents are asked for: the renter themself, or one of the operator's renters for staff. */
async function documentOwner(actor: Actor, requested: string | null): Promise<string> {
  if (actor.role === "renter") return actor.renterId ?? "";
  if (!requested) throw invalid({ renter_id: "Choose a renter." });
  return (await renterInScope(pool, actor, requested)).id;
}

route("GET", "/api/documents", async (request) => {
  const actor = await requireActor(request);
  const renterId = await documentOwner(actor, request.query.get("renter_id"));
  const docs = await all<DocumentRow>(pool, "SELECT * FROM documents WHERE renter_id = $1 ORDER BY uploaded_at DESC, id", [renterId]);
  const today = await homeToday(renterId);
  return json(200, { documents: docs.map((doc) => documentJson(doc, today)) });
});

route("GET", "/api/documents/:id/file", async (request) => {
  const actor = await requireActor(request);
  const doc = await one<DocumentRow & { operator_id: string }>(pool,
    "SELECT d.*, r.operator_id FROM documents d JOIN renters r ON r.id = d.renter_id WHERE d.id = $1", [request.params.id ?? ""]);
  const visible = doc && (actor.role === "renter" ? doc.renter_id === actor.renterId : doc.operator_id === actor.operatorId);
  if (!doc || !visible) throw new ApiError(404, "not_found");
  const stored = await getObject(documentKey(doc.renter_id, doc.id));
  if (!stored) throw new ApiError(404, "not_found");
  return {
    status: 200,
    raw: {
      data: stored.body, type: doc.content_type,
      headers: { "Content-Disposition": `inline; filename="${doc.id}.${EXTENSIONS[doc.content_type] ?? "bin"}"`, "Cache-Control": "private, no-store" },
    },
  };
});
