import type { Db } from "../db.js";
import type {
  DocumentJson,
  DocumentSummary,
  FieldJson,
  RecipientJson,
  SignFieldJson,
} from "../../shared/types.js";
import { nextStep } from "./nextStep.js";
import { type DocumentRow, type FieldRow, type RecipientRow, fieldsOf, ownerOf, recipientsOf } from "./rows.js";

export function recipientJson(document: Pick<DocumentRow, "status">, row: RecipientRow): RecipientJson {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    order: row.signing_order,
    status: row.status,
    delivery: row.delivery,
    linkExpiresAt: row.link_expires_at?.toISOString() ?? null,
    signedAt: row.signed_at?.toISOString() ?? null,
    declineReason: row.decline_reason,
    binding: document.status !== "declined" && document.status !== "voided",
  };
}

export function fieldJson(row: FieldRow): FieldJson {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    kind: row.kind,
    label: row.label,
    required: row.required,
    page: row.page,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    value: row.value,
  };
}

export function signFieldJson(row: FieldRow): SignFieldJson {
  return { ...fieldJson(row), strokes: row.value === "drawn" ? row.strokes : null };
}

export async function documentJson(db: Db, document: DocumentRow): Promise<DocumentJson> {
  const [recipients, fields, owner] = await Promise.all([recipientsOf(db, document.id), fieldsOf(db, document.id), ownerOf(db, document.owner_id)]);
  const { rows: voiders } = await db.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [document.voided_by]);
  const cooling = document.status === "in_progress" && document.reminder_available_at !== null && document.reminder_available_at > new Date();
  return {
    id: document.id,
    title: document.title,
    status: document.status,
    teamId: document.team_id,
    ownerId: document.owner_id,
    ownerName: owner.name,
    timeZone: document.time_zone,
    pageCount: document.page_count,
    pageSizes: document.page_sizes,
    originalSha256: document.original_sha256,
    completedSha256: document.completed_sha256,
    version: document.version,
    currentOrder: document.status === "in_progress" ? document.current_order : null,
    reminderAvailableAt: cooling ? (document.reminder_available_at?.toISOString() ?? null) : null,
    nextStep: nextStep(document, recipients),
    voidReason: document.void_reason,
    voidedByName: voiders[0]?.name ?? null,
    recipients: recipients.map((r) => recipientJson(document, r)),
    fields: fields.map(fieldJson),
  };
}

export async function documentSummaries(db: Db, teamId: string, filter: string): Promise<DocumentSummary[]> {
  const statuses: Record<string, string[] | undefined> = {
    in_progress: ["in_progress", "sealing"],
    completed: ["completed"],
    closed: ["declined", "voided"],
  };
  const wanted = statuses[filter];
  const { rows: documents } = await db.query<DocumentRow>(
    `SELECT * FROM documents WHERE team_id = $1 ${wanted ? "AND status = ANY($2::text[])" : ""} ORDER BY updated_at DESC, created_at DESC`,
    wanted ? [teamId, wanted] : [teamId],
  );
  if (documents.length === 0) return [];
  const { rows: recipients } = await db.query<RecipientRow>(
    "SELECT * FROM recipients WHERE document_id = ANY($1::uuid[]) ORDER BY signing_order",
    [documents.map((d) => d.id)],
  );
  return documents.map((document) => ({
    id: document.id,
    title: document.title,
    status: document.status,
    nextStep: nextStep(document, recipients.filter((r) => r.document_id === document.id)),
    updatedAt: document.updated_at.toISOString(),
  }));
}
