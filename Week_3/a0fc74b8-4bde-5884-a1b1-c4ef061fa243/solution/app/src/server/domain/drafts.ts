import type { Db } from "../db.js";
import { ApiError, invalidState, notFound, validation } from "../errors.js";
import { VALIDATION_COPY } from "../../shared/copy.js";
import { roundBox } from "../../shared/geometry.js";
import type { Box, FieldJson, FieldKind, PageSize, RecipientJson } from "../../shared/types.js";
import { newId } from "../util.js";
import { appendAudit } from "./audit.js";
import { originalKey } from "../storage.js";
import {
  type Body,
  type Problems,
  boxProblem,
  emailProblem,
  isFieldKind,
  labelProblem,
  nameProblem,
  numbersOf,
  recipientLimitProblem,
  throwIfAny,
  timeZoneProblem,
  titleProblem,
} from "./validate.js";
import { type DocumentRow, type FieldRow, type RecipientRow, fieldsOf, recipientsOf, touchDocument } from "./rows.js";
import { fieldJson, recipientJson } from "./serialize.js";
import { isUuid } from "../util.js";

export function assertDraft(document: DocumentRow): void {
  if (document.status !== "draft") throw invalidState(document.status);
}

interface NewDraft {
  teamId: string;
  owner: { id: string; email: string };
  title: string;
  originalSha256: string;
  pageCount: number;
  pageSizes: PageSize[];
  timeZone: string;
  storeOriginal: (key: string) => Promise<void>;
}

export async function createDraft(db: Db, draft: NewDraft): Promise<DocumentRow> {
  const id = newId();
  await db.query(
    `INSERT INTO documents (id, team_id, owner_id, title, status, time_zone, page_count, page_sizes, original_sha256)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8)`,
    [id, draft.teamId, draft.owner.id, draft.title, draft.timeZone, draft.pageCount, JSON.stringify(draft.pageSizes), draft.originalSha256],
  );
  await draft.storeOriginal(originalKey(id));
  await appendAudit(db, id, "document.created", draft.owner.email, null);
  const { rows } = await db.query<DocumentRow>("SELECT * FROM documents WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) throw notFound();
  return row;
}

export async function updateDocument(db: Db, document: DocumentRow, body: Body): Promise<void> {
  assertDraft(document);
  const problems: Problems = {};
  if ("title" in body) {
    const problem = titleProblem(body["title"]);
    if (problem) problems["title"] = problem;
  }
  if ("timeZone" in body) {
    const problem = timeZoneProblem(body["timeZone"]);
    if (problem) problems["timeZone"] = problem;
  }
  throwIfAny(problems);
  if (typeof body["title"] === "string") await db.query("UPDATE documents SET title = $2 WHERE id = $1", [document.id, body["title"].trim()]);
  if (typeof body["timeZone"] === "string") await db.query("UPDATE documents SET time_zone = $2 WHERE id = $1", [document.id, body["timeZone"]]);
  await touchDocument(db, document);
}

async function recipientProblems(
  document: DocumentRow,
  existing: RecipientRow[],
  body: Body,
  current: RecipientRow | null,
): Promise<Problems> {
  const problems: Problems = {};
  if (!current || "name" in body) {
    const problem = nameProblem(body["name"]);
    if (problem) problems["name"] = problem;
  }
  if (!current || "email" in body) {
    const problem = emailProblem(body["email"]);
    if (problem) problems["email"] = problem;
    else if (typeof body["email"] === "string") {
      const lowered = body["email"].trim().toLowerCase();
      if (existing.some((r) => r.email === lowered && r.id !== current?.id)) problems["email"] = VALIDATION_COPY.emailTaken;
    }
  }
  if (!current) {
    const problem = recipientLimitProblem(existing.length);
    if (problem) problems["recipients"] = problem;
  }
  return problems;
}

export async function addRecipient(db: Db, document: DocumentRow, body: Body): Promise<RecipientJson> {
  assertDraft(document);
  const existing = await recipientsOf(db, document.id);
  throwIfAny(await recipientProblems(document, existing, body, null));
  const id = newId();
  await db.query("INSERT INTO recipients (id, document_id, name, email, signing_order) VALUES ($1, $2, $3, $4, $5)", [
    id,
    document.id,
    String(body["name"]).trim(),
    String(body["email"]).trim().toLowerCase(),
    existing.length + 1,
  ]);
  await touchDocument(db, document);
  const created = (await recipientsOf(db, document.id)).find((r) => r.id === id);
  if (!created) throw notFound();
  return recipientJson(document, created);
}

export async function findRecipient(db: Db, document: DocumentRow, recipientId: unknown): Promise<RecipientRow> {
  if (typeof recipientId !== "string" || !isUuid(recipientId)) throw notFound();
  const found = (await recipientsOf(db, document.id)).find((r) => r.id === recipientId);
  if (!found) throw notFound();
  return found;
}

export async function updateRecipient(db: Db, document: DocumentRow, recipient: RecipientRow, body: Body): Promise<RecipientJson> {
  assertDraft(document);
  const existing = await recipientsOf(db, document.id);
  throwIfAny(await recipientProblems(document, existing, body, recipient));
  if (typeof body["name"] === "string") await db.query("UPDATE recipients SET name = $2 WHERE id = $1", [recipient.id, body["name"].trim()]);
  if (typeof body["email"] === "string") await db.query("UPDATE recipients SET email = $2 WHERE id = $1", [recipient.id, body["email"].trim().toLowerCase()]);
  await touchDocument(db, document);
  const updated = (await recipientsOf(db, document.id)).find((r) => r.id === recipient.id);
  if (!updated) throw notFound();
  return recipientJson(document, updated);
}

export async function removeRecipient(db: Db, document: DocumentRow, recipient: RecipientRow): Promise<void> {
  assertDraft(document);
  await db.query("DELETE FROM recipients WHERE id = $1", [recipient.id]);
  await db.query(
    `UPDATE recipients r SET signing_order = n.rank
     FROM (SELECT id, row_number() OVER (ORDER BY signing_order) AS rank FROM recipients WHERE document_id = $1) n
     WHERE r.id = n.id`,
    [document.id],
  );
  await touchDocument(db, document);
}

export async function moveRecipient(db: Db, document: DocumentRow, recipient: RecipientRow, direction: unknown): Promise<RecipientJson[]> {
  assertDraft(document);
  if (direction !== "up" && direction !== "down") throw validation({ direction: VALIDATION_COPY.direction });
  const recipients = await recipientsOf(db, document.id);
  const neighbour = recipients.find((r) => r.signing_order === recipient.signing_order + (direction === "up" ? -1 : 1));
  if (!neighbour) throw new ApiError(409, { error: "cannot_move" });
  await db.query("UPDATE recipients SET signing_order = $2 WHERE id = $1", [recipient.id, neighbour.signing_order]);
  await db.query("UPDATE recipients SET signing_order = $2 WHERE id = $1", [neighbour.id, recipient.signing_order]);
  await touchDocument(db, document);
  return (await recipientsOf(db, document.id)).map((r) => recipientJson(document, r));
}

const KIND_NAMES: Record<FieldKind, string> = { signature: "Signature", initials: "Initials", date: "Date", text: "Text" };

function defaultLabel(kind: FieldKind, fields: FieldRow[]): string {
  const taken = new Set(fields.map((f) => f.label));
  let count = fields.filter((f) => f.kind === kind).length + 1;
  while (taken.has(`${KIND_NAMES[kind]} ${count}`)) count += 1;
  return `${KIND_NAMES[kind]} ${count}`;
}

function boxOf(row: FieldRow): Box {
  return { x: row.x, y: row.y, w: row.w, h: row.h };
}

export async function addField(db: Db, document: DocumentRow, body: Body): Promise<FieldJson> {
  const recipient = await findRecipient(db, document, body["recipientId"]);
  assertDraft(document);
  const problems: Problems = {};
  const kind = body["kind"];
  if (!isFieldKind(kind)) problems["kind"] = VALIDATION_COPY.kind;
  if ("label" in body && body["label"] !== undefined) {
    const problem = labelProblem(body["label"]);
    if (problem) problems["label"] = problem;
  }
  const numbers = numbersOf(body, ["x", "y", "w", "h"]);
  const box = { x: numbers.x ?? NaN, y: numbers.y ?? NaN, w: numbers.w ?? NaN, h: numbers.h ?? NaN };
  const problem = boxProblem(box, body["page"], document.page_count);
  if (problem) problems["geometry"] = problem;
  throwIfAny(problems);
  if (!isFieldKind(kind)) throw validation(problems);
  const fields = await fieldsOf(db, document.id);
  const label = typeof body["label"] === "string" ? body["label"].trim() : defaultLabel(kind, fields);
  const rounded = roundBox(box);
  const id = newId();
  await db.query(
    "INSERT INTO fields (id, document_id, recipient_id, kind, label, required, page, x, y, w, h) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [id, document.id, recipient.id, kind, label, body["required"] !== false, body["page"], rounded.x, rounded.y, rounded.w, rounded.h],
  );
  await touchDocument(db, document);
  const created = (await fieldsOf(db, document.id)).find((f) => f.id === id);
  if (!created) throw notFound();
  return fieldJson(created);
}

export async function findField(db: Db, document: DocumentRow, fieldId: string): Promise<FieldRow> {
  if (!isUuid(fieldId)) throw notFound();
  const found = (await fieldsOf(db, document.id)).find((f) => f.id === fieldId);
  if (!found) throw notFound();
  return found;
}

export async function updateField(db: Db, document: DocumentRow, field: FieldRow, body: Body): Promise<FieldJson> {
  const recipient = "recipientId" in body ? await findRecipient(db, document, body["recipientId"]) : null;
  assertDraft(document);
  const problems: Problems = {};
  if ("label" in body) {
    const problem = labelProblem(body["label"]);
    if (problem) problems["label"] = problem;
  }
  const numbers = numbersOf(body, ["x", "y", "w", "h"]);
  const touchesGeometry = "page" in body || "x" in body || "y" in body || "w" in body || "h" in body;
  const next = { ...boxOf(field), ...numbers };
  const page = "page" in body ? body["page"] : field.page;
  if (touchesGeometry) {
    const problem = boxProblem(next, page, document.page_count);
    if (problem) problems["geometry"] = problem;
  }
  throwIfAny(problems);
  const rounded = roundBox(next);
  await db.query(
    "UPDATE fields SET recipient_id = $2, label = $3, required = $4, page = $5, x = $6, y = $7, w = $8, h = $9 WHERE id = $1",
    [
      field.id,
      recipient?.id ?? field.recipient_id,
      typeof body["label"] === "string" ? body["label"].trim() : field.label,
      typeof body["required"] === "boolean" ? body["required"] : field.required,
      page,
      rounded.x,
      rounded.y,
      rounded.w,
      rounded.h,
    ],
  );
  await touchDocument(db, document);
  const updated = (await fieldsOf(db, document.id)).find((f) => f.id === field.id);
  if (!updated) throw notFound();
  return fieldJson(updated);
}

export async function removeField(db: Db, document: DocumentRow, field: FieldRow): Promise<void> {
  assertDraft(document);
  await db.query("DELETE FROM fields WHERE id = $1", [field.id]);
  await touchDocument(db, document);
}

