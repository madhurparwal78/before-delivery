import type { Db } from "../db.js";
import { invalidState, notFound, validation } from "../errors.js";
import { VALIDATION_COPY } from "../../shared/copy.js";
import type { FieldKind, TemplateFieldJson, TemplateJson, TemplateStatus } from "../../shared/types.js";
import { copyObject, originalKey, templateOriginalKey } from "../storage.js";
import { isUuid, newId } from "../util.js";
import type { Actor } from "./permissions.js";
import { can } from "./permissions.js";
import { announce, fieldsOf, recipientsOf, type DocumentRow } from "./rows.js";
import { addField, addRecipient, assertDraft, createDraft } from "./drafts.js";
import { emailProblem, nameProblem, type Body } from "./validate.js";
import type { PageSize } from "../../shared/types.js";

interface TemplateRow {
  id: string;
  team_id: string;
  name: string;
  status: TemplateStatus;
  page_count: number;
  page_sizes: PageSize[];
  original_sha256: string;
  signer_count: number;
}

interface TemplateFieldRow {
  signer: number;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function templateJson(db: Db, row: TemplateRow): Promise<TemplateJson> {
  const { rows } = await db.query<TemplateFieldRow>("SELECT * FROM template_fields WHERE template_id = $1 ORDER BY created_seq", [row.id]);
  const fields: TemplateFieldJson[] = rows.map((f) => ({
    signer: f.signer,
    kind: f.kind,
    label: f.label,
    required: f.required,
    page: f.page,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
  }));
  return { id: row.id, name: row.name, status: row.status, pageCount: row.page_count, signerCount: row.signer_count, fields };
}

function visibleTo(actor: Actor, row: TemplateRow): boolean {
  return row.team_id === actor.teamId && (can(actor, "template.manage") || row.status === "shared");
}

export async function listTemplates(db: Db, actor: Actor): Promise<TemplateJson[]> {
  const { rows } = await db.query<TemplateRow>("SELECT * FROM templates WHERE team_id = $1 ORDER BY created_at DESC", [actor.teamId]);
  return Promise.all(rows.filter((r) => visibleTo(actor, r)).map((r) => templateJson(db, r)));
}

export async function loadTemplate(db: Db, actor: Actor, templateId: string, lock = false): Promise<TemplateRow> {
  if (!isUuid(templateId)) throw notFound();
  const { rows } = await db.query<TemplateRow>(`SELECT * FROM templates WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [templateId]);
  const row = rows[0];
  if (!row || !visibleTo(actor, row)) throw notFound();
  return row;
}

export const templateView = templateJson;

export async function saveAsTemplate(db: Db, document: DocumentRow): Promise<TemplateRow> {
  assertDraft(document);
  const recipients = await recipientsOf(db, document.id);
  const fields = await fieldsOf(db, document.id);
  const id = newId();
  await copyObject(originalKey(document.id), templateOriginalKey(id));
  await db.query(
    `INSERT INTO templates (id, team_id, name, status, page_count, page_sizes, original_sha256, signer_count)
     VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)`,
    [id, document.team_id, document.title, document.page_count, JSON.stringify(document.page_sizes), document.original_sha256, recipients.length],
  );
  for (const field of fields) {
    const signer = recipients.find((r) => r.id === field.recipient_id)?.signing_order ?? 1;
    await db.query(
      `INSERT INTO template_fields (id, template_id, signer, kind, label, required, page, x, y, w, h)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [newId(), id, signer, field.kind, field.label, field.required, field.page, field.x, field.y, field.w, field.h],
    );
  }
  const { rows } = await db.query<TemplateRow>("SELECT * FROM templates WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) throw notFound();
  await announce(db, { type: "templates", teamId: document.team_id });
  return row;
}

const TRANSITIONS: Record<"share" | "retire", { from: TemplateStatus; to: TemplateStatus }> = {
  share: { from: "draft", to: "shared" },
  retire: { from: "shared", to: "retired" },
};

export async function moveTemplate(db: Db, template: TemplateRow, action: "share" | "retire"): Promise<TemplateRow> {
  const { from, to } = TRANSITIONS[action];
  if (template.status !== from) throw invalidState(template.status);
  await db.query("UPDATE templates SET status = $2 WHERE id = $1", [template.id, to]);
  await announce(db, { type: "templates", teamId: template.team_id });
  return { ...template, status: to };
}

export async function useTemplate(db: Db, template: TemplateRow, actor: Actor, body: Body): Promise<DocumentRow> {
  if (template.status !== "shared") throw invalidState(template.status);
  const signers = body["signers"];
  const valid =
    Array.isArray(signers) &&
    signers.length === template.signer_count &&
    signers.every((s: unknown) => {
      const entry = typeof s === "object" && s !== null ? (s as Body) : {};
      return nameProblem(entry["name"]) === null && emailProblem(entry["email"]) === null;
    }) &&
    new Set(signers.map((s: Body) => String(s["email"]).trim().toLowerCase())).size === signers.length;
  if (!valid || !Array.isArray(signers)) throw validation({ signers: VALIDATION_COPY.signers });
  const draft = await createDraft(db, {
    teamId: actor.teamId,
    owner: actor,
    title: template.name,
    originalSha256: template.original_sha256,
    pageCount: template.page_count,
    pageSizes: template.page_sizes,
    timeZone: "UTC",
    storeOriginal: (key) => copyObject(templateOriginalKey(template.id), key),
  });
  const created: string[] = [];
  for (const signer of signers as Body[]) {
    const recipient = await addRecipient(db, draft, { name: signer["name"], email: signer["email"] });
    created.push(recipient.id);
  }
  const { rows } = await db.query<TemplateFieldRow>("SELECT * FROM template_fields WHERE template_id = $1 ORDER BY created_seq", [template.id]);
  for (const field of rows) {
    const recipientId = created[field.signer - 1];
    if (!recipientId) continue;
    await addField(db, draft, { ...field, recipientId });
  }
  return draft;
}
