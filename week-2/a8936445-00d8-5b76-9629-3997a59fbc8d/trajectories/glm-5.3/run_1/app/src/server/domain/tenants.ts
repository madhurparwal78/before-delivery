/**
 * Domain: tenants, their required documents, validity edges and lifecycle statuses.
 * Each rule has exactly one definition here; every surface applies these functions.
 */

import type { KitchenDate } from "../../shared/kitchen-time.js";
import { Db } from "../db.js";
import type { DocumentKind, Tenant, TenantStatus } from "../../shared/api-types.js";

export const REQUIRED_KINDS: DocumentKind[] = [
  "certificate_of_insurance",
  "health_permit",
  "food_handler_card"
];

export interface TenantRow {
  id: string;
  business_name: string;
  status: TenantStatus;
  owner_name: string;
  owner_email: string;
}

export interface DocumentRow {
  id: string;
  tenant_id: string;
  kind: DocumentKind;
  holder_name: string | null;
  expires_on: KitchenDate;
  status: "pending_review" | "approved" | "rejected";
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  uploaded_at: Date;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  reminder_sent_at: Date | null;
}

export interface RequiredDocumentView {
  valid: boolean;
  expires_on: KitchenDate | null;
}

export async function loadTenantDocuments(db: Db, tenantId: string): Promise<DocumentRow[]> {
  return db.query<DocumentRow>(
    `SELECT id, tenant_id, kind, holder_name, expires_on::text AS expires_on, status, file_name,
            content_type, size_bytes, storage_key, uploaded_at, reviewed_at, rejection_reason, reminder_sent_at
     FROM documents WHERE tenant_id = $1`,
    [tenantId]
  );
}

/**
 * The required-document state of a tenant. A kind is valid through the end of its expiry day;
 * an approved document's edge is 00:00 on the day after its latest expiry. Food handler cards
 * need at least one valid card.
 */
export function requiredDocuments(
  docs: DocumentRow[],
  today: KitchenDate
): Record<DocumentKind, RequiredDocumentView> {
  const out = {} as Record<DocumentKind, RequiredDocumentView>;
  for (const kind of REQUIRED_KINDS) {
    const approved = docs.filter((d) => d.kind === kind && d.status === "approved");
    const latest = latestExpiry(approved);
    out[kind] = {
      valid: latest !== null && latest >= today,
      expires_on: latest
    };
  }
  return out;
}

export function latestExpiry(docs: Pick<DocumentRow, "expires_on">[]): KitchenDate | null {
  if (docs.length === 0) return null;
  return docs.reduce((latest, d) => (d.expires_on > latest ? d.expires_on : latest), docs[0].expires_on);
}

/**
 * Statuses derive from document validity at each request: active tenants whose documents lapse
 * suspend automatically, and suspended tenants whose documents are all valid reinstate.
 */
export async function resolveTenantStatuses(db: Db): Promise<void> {
  const today = db.clock.today();
  const tenants = await db.query<TenantRow>(
    "SELECT id, business_name, status, owner_name, owner_email FROM tenants WHERE status IN ('active','suspended')"
  );
  for (const tenant of tenants) {
    const docs = await loadTenantDocuments(db, tenant.id);
    const required = requiredDocuments(docs, today);
    const allValid = REQUIRED_KINDS.every((k) => required[k].valid);
    if (tenant.status === "active" && !allValid) {
      await db.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [tenant.id]);
    } else if (tenant.status === "suspended" && allValid) {
      await db.query("UPDATE tenants SET status = 'active' WHERE id = $1", [tenant.id]);
    }
  }
}

export interface TenantDetail {
  row: TenantRow;
  required: Record<DocumentKind, RequiredDocumentView>;
  shelves: string[];
  hour_balance_minutes: number;
}

export async function loadTenantDetail(db: Db, tenantId: string): Promise<TenantDetail | null> {
  const rows = await db.query<TenantRow>(
    "SELECT id, business_name, status, owner_name, owner_email FROM tenants WHERE id = $1",
    [tenantId]
  );
  if (rows.length === 0) return null;
  const docs = await loadTenantDocuments(db, tenantId);
  const shelves = await db.query<{ id: string }>("SELECT id FROM shelves WHERE tenant_id = $1", [tenantId]);
  const balance = await db.query<{ balance: string }>(
    "SELECT coalesce(sum(minutes),0)::text AS balance FROM hour_ledger_entries WHERE tenant_id = $1 AND account = 'tenant_pack'",
    [tenantId]
  );
  return {
    row: rows[0],
    required: requiredDocuments(docs, db.clock.today()),
    shelves: shelves.map((s) => s.id),
    hour_balance_minutes: Number(balance[0].balance)
  };
}

export async function tenantJson(db: Db, tenantId: string): Promise<Tenant | null> {
  const detail = await loadTenantDetail(db, tenantId);
  if (detail === null) return null;
  return detailToTenantJson(detail);
}

export function detailToTenantJson(detail: TenantDetail): Tenant {
  return {
    id: detail.row.id,
    business_name: detail.row.business_name,
    status: detail.row.status,
    owner_name: detail.row.owner_name,
    owner_email: detail.row.owner_email,
    required_documents: detail.required,
    shelves: detail.shelves,
    hour_balance_minutes: detail.hour_balance_minutes
  };
}
