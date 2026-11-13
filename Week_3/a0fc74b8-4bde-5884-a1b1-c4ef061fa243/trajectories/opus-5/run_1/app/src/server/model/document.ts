import type pg from 'pg';
import { query } from '../db/pool.ts';
import { nextStepText } from '../../shared/nextStep.ts';
import type {
  Delivery,
  DocumentFilter,
  DocumentJson,
  DocumentRowJson,
  DocumentStatus,
  FieldJson,
  FieldKind,
  RecipientJson,
  RecipientStatus,
  Stroke,
} from '../../shared/types.ts';

export type DocumentRow = {
  id: string;
  team_id: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  title: string;
  status: DocumentStatus;
  time_zone: string;
  page_count: number;
  original_sha256: string;
  completed_sha256: string | null;
  version: number;
  reminder_available_at: Date | null;
  declined_by: string | null;
  decline_reason: string | null;
  voided_by: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
  updated_at: Date;
};

export type RecipientRow = {
  id: string;
  name: string;
  email: string;
  order_index: number;
  stored_status: RecipientStatus;
  delivery: Delivery | null;
  signed_at: Date | null;
  decline_reason: string | null;
  binding: boolean;
  link_issued_at: Date | null;
  link_expires_at: Date | null;
};

export type FieldRow = {
  id: string;
  recipient_id: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
  strokes: Stroke[] | null;
};

export interface Aggregate {
  doc: DocumentRow;
  recipients: RecipientRow[];
  fields: FieldRow[];
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.team_id, d.owner_id, d.title, d.status, d.time_zone, d.page_count,
         d.original_sha256, d.completed_sha256, d.version, d.reminder_available_at,
         d.declined_by, d.decline_reason, d.voided_by, d.void_reason, d.updated_at,
         o.name AS owner_name, o.email AS owner_email, v.name AS voided_by_name
  FROM documents d
  JOIN users o ON o.id = d.owner_id
  LEFT JOIN users v ON v.id = d.voided_by`;

const RECIPIENT_SELECT = `
  SELECT r.id, r.name, r.email, r.order_index, r.status AS stored_status, r.delivery,
         r.signed_at, r.decline_reason, r.binding,
         l.issued_at AS link_issued_at, l.expires_at AS link_expires_at
  FROM recipients r
  LEFT JOIN LATERAL (
    SELECT issued_at, expires_at FROM links
    WHERE links.recipient_id = r.id AND links.active
    ORDER BY issued_at DESC LIMIT 1
  ) l ON true
  WHERE r.document_id = $1
  ORDER BY r.order_index`;

const FIELD_SELECT = `
  SELECT id, recipient_id, kind, label, required, page, x, y, w, h, value, strokes
  FROM fields WHERE document_id = $1 ORDER BY seq`;

const runner =
  (client?: pg.PoolClient) =>
  async <T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T[]> => {
    if (client) {
      const result = await client.query<T>(text, values);
      return result.rows;
    }
    return query<T>(text, values);
  };

export const loadAggregate = async (
  documentId: string,
  teamId: string | null,
  client?: pg.PoolClient,
): Promise<Aggregate | null> => {
  const run = runner(client);
  const where = teamId === null ? 'WHERE d.id = $1' : 'WHERE d.id = $1 AND d.team_id = $2';
  const values = teamId === null ? [documentId] : [documentId, teamId];
  const docs = await run<DocumentRow>(`${DOCUMENT_SELECT} ${where}`, values);
  const doc = docs[0];
  if (!doc) return null;
  const recipients = await run<RecipientRow>(RECIPIENT_SELECT, [documentId]);
  const fields = await run<FieldRow>(FIELD_SELECT, [documentId]);
  return { doc, recipients, fields };
};

export const isExpired = (recipient: RecipientRow, now: Date): boolean =>
  (recipient.stored_status === 'invited' || recipient.stored_status === 'viewed') &&
  recipient.link_expires_at !== null &&
  recipient.link_expires_at.getTime() <= now.getTime();

/** The one place that turns a stored recipient row into its effective status. */
export const recipientStatus = (recipient: RecipientRow, now: Date): RecipientStatus =>
  isExpired(recipient, now) ? 'expired' : recipient.stored_status;

export const currentRecipient = (aggregate: Aggregate): RecipientRow | null => {
  if (aggregate.doc.status !== 'in_progress') return null;
  return aggregate.recipients.find((row) => row.stored_status !== 'signed') ?? null;
};

export const nextStepOf = (aggregate: Aggregate, now: Date): string => {
  const current = currentRecipient(aggregate);
  return nextStepText({
    status: aggregate.doc.status,
    recipientCount: aggregate.recipients.length,
    current:
      current === null
        ? null
        : {
            name: current.name,
            order: current.order_index,
            status: recipientStatus(current, now),
            delivery: current.delivery,
          },
  });
};

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export const recipientJson = (recipient: RecipientRow, now: Date): RecipientJson => ({
  id: recipient.id,
  name: recipient.name,
  email: recipient.email,
  order: recipient.order_index,
  status: recipientStatus(recipient, now),
  delivery: recipient.delivery,
  linkExpiresAt: iso(recipient.link_expires_at),
  signedAt: iso(recipient.signed_at),
  declineReason: recipient.decline_reason,
  binding: recipient.binding,
});

export const fieldJson = (field: FieldRow): FieldJson => ({
  id: field.id,
  recipientId: field.recipient_id,
  kind: field.kind,
  label: field.label,
  required: field.required,
  page: field.page,
  x: field.x,
  y: field.y,
  w: field.w,
  h: field.h,
  value: field.value,
});

export const documentJson = (aggregate: Aggregate, now: Date): DocumentJson => {
  const { doc } = aggregate;
  const current = currentRecipient(aggregate);
  const cooldownRunning =
    doc.status === 'in_progress' &&
    doc.reminder_available_at !== null &&
    doc.reminder_available_at.getTime() > now.getTime();
  const decliner = aggregate.recipients.find((row) => row.id === doc.declined_by) ?? null;
  return {
    id: doc.id,
    title: doc.title,
    status: doc.status,
    teamId: doc.team_id,
    ownerId: doc.owner_id,
    ownerName: doc.owner_name,
    timeZone: doc.time_zone,
    pageCount: doc.page_count,
    originalSha256: doc.original_sha256,
    completedSha256: doc.completed_sha256,
    version: doc.version,
    currentOrder: current === null ? null : current.order_index,
    reminderAvailableAt: cooldownRunning ? iso(doc.reminder_available_at) : null,
    nextStep: nextStepOf(aggregate, now),
    declinedBy: decliner === null ? null : decliner.name,
    declineReason: doc.decline_reason,
    voidedBy: doc.voided_by_name,
    voidReason: doc.void_reason,
    updatedAt: doc.updated_at.toISOString(),
    recipients: aggregate.recipients.map((row) => recipientJson(row, now)),
    fields: aggregate.fields.map(fieldJson),
  };
};

const FILTER_SQL: Record<DocumentFilter, string> = {
  all: '',
  in_progress: "AND d.status IN ('draft', 'in_progress', 'sealing')",
  completed: "AND d.status = 'completed'",
  closed: "AND d.status IN ('declined', 'voided')",
};

export const listDocuments = async (
  teamId: string,
  filter: DocumentFilter,
  now: Date,
): Promise<DocumentRowJson[]> => {
  const rows = await query<DocumentRow>(
    `${DOCUMENT_SELECT} WHERE d.team_id = $1 ${FILTER_SQL[filter]} ORDER BY d.updated_at DESC`,
    [teamId],
  );
  const ids = rows.map((row) => row.id);
  const recipients =
    ids.length === 0
      ? []
      : await query<RecipientRow & { document_id: string }>(
          `SELECT r.document_id, r.id, r.name, r.email, r.order_index, r.status AS stored_status,
                  r.delivery, r.signed_at, r.decline_reason, r.binding,
                  l.issued_at AS link_issued_at, l.expires_at AS link_expires_at
           FROM recipients r
           LEFT JOIN LATERAL (
             SELECT issued_at, expires_at FROM links
             WHERE links.recipient_id = r.id AND links.active
             ORDER BY issued_at DESC LIMIT 1
           ) l ON true
           WHERE r.document_id = ANY($1::uuid[])
           ORDER BY r.order_index`,
          [ids],
        );
  const byDocument = new Map<string, RecipientRow[]>();
  for (const row of recipients) {
    const list = byDocument.get(row.document_id) ?? [];
    list.push(row);
    byDocument.set(row.document_id, list);
  }
  return rows.map((doc) => ({
    id: doc.id,
    title: doc.title,
    status: doc.status,
    nextStep: nextStepOf({ doc, recipients: byDocument.get(doc.id) ?? [], fields: [] }, now),
    updatedAt: doc.updated_at.toISOString(),
  }));
};

export const touchDocument = async (client: pg.PoolClient, documentId: string): Promise<void> => {
  await client.query(
    'UPDATE documents SET version = version + 1, updated_at = now() WHERE id = $1',
    [documentId],
  );
};
