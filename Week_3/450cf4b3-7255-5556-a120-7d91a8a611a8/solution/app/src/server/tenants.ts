// Tenant records: application, the owner's table and approval, and the signed-in Me view.

import type { DocumentRecord, Me, PackDetail, Tenant, TenantDetail } from "../shared/api.js";
import { hashPassword, startSession, type Caller } from "./auth.js";
import { db } from "./db.js";
import { conflict } from "./errors.js";
import { iso, kitchenTime } from "./kitchen.js";
import { asOnboarding, lapse, tenantStatus, type CurrentCover, type Onboarding } from "./onboarding.js";
import { col, only, PgError, type Queryable, type Row } from "./postgres.js";

const TENANT_SELECT = `
  SELECT t.id, t.business_name, t.contact_name, t.onboarding, t.created_at, t.killbill_account_id, u.email,
         (SELECT c.expires_on::text FROM current_documents c WHERE c.tenant_id = t.id AND c.kind = 'insurance_certificate') AS insurance_expires_on,
         (SELECT c.expires_on::text FROM current_documents c WHERE c.tenant_id = t.id AND c.kind = 'food_handler_card') AS food_handler_expires_on
    FROM tenants t JOIN users u ON u.tenant_id = t.id`;

interface TenantRecord {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  onboarding: Onboarding;
  cover: CurrentCover;
  /** Set once the tenant's Kill Bill account is fully set up, so later purchases skip setup. */
  killbillAccountId: string | null;
  createdAt: Date;
}

function tenantRecord(row: Row): TenantRecord {
  return {
    id: col.text(row, "id"),
    businessName: col.text(row, "business_name"),
    contactName: col.text(row, "contact_name"),
    email: col.text(row, "email"),
    onboarding: asOnboarding(col.text(row, "onboarding")),
    cover: {
      insuranceExpiresOn: col.textOrNull(row, "insurance_expires_on"),
      foodHandlerExpiresOn: col.textOrNull(row, "food_handler_expires_on"),
    },
    killbillAccountId: col.textOrNull(row, "killbill_account_id"),
    createdAt: col.time(row, "created_at"),
  };
}

export async function findTenant(q: Queryable, id: string, lock = false): Promise<TenantRecord | null> {
  if (lock) await q.query("SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE", [id]);
  const [row] = await q.query(`${TENANT_SELECT} WHERE t.id = $1`, [id]);
  return row ? tenantRecord(row) : null;
}

export async function tenantExists(id: string): Promise<boolean> {
  return (await db.query("SELECT 1 FROM tenants WHERE id = $1", [id])).length === 1;
}

export async function tenantDetail(id: string, packs: PackDetail[], documents: DocumentRecord[]): Promise<TenantDetail> {
  const row = only(await db.query(`${TENANT_SELECT} WHERE t.id = $1`, [id]));
  return { ...tenantView(tenantRecord(row), (await kitchenTime(db)).today), packs, documents };
}

function tenantView(t: TenantRecord, today: string): Tenant {
  const { status, suspendedReason } = tenantStatus(t.onboarding, t.cover, today);
  return {
    id: t.id, businessName: t.businessName, contactName: t.contactName, email: t.email, status, suspendedReason,
    insuranceExpiresOn: t.cover.insuranceExpiresOn, foodHandlerExpiresOn: t.cover.foodHandlerExpiresOn,
    createdAt: iso(t.createdAt),
  };
}

export async function me(caller: Caller): Promise<Me> {
  const tenant = caller.tenantId ? await findTenant(db, caller.tenantId) : null;
  const { today } = await kitchenTime(db);
  return {
    id: caller.userId,
    role: caller.role,
    email: caller.email,
    displayName: caller.displayName,
    tenant: tenant ? { id: tenant.id, businessName: tenant.businessName, ...tenantStatus(tenant.onboarding, tenant.cover, today) } : null,
  };
}

export async function listTenants(): Promise<Tenant[]> {
  const rows = await db.query(`${TENANT_SELECT} ORDER BY lower(t.business_name), t.id`);
  const { today } = await kitchenTime(db);
  return rows.map((row) => tenantView(tenantRecord(row), today));
}

interface Application {
  businessName: string;
  contactName: string;
  email: string;
  password: string;
}

/** A new business becomes a signed-in tenant in the applied state. Returns the new session token. */
export async function apply(input: Application): Promise<{ token: string; caller: Caller }> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const tenantId = col.text(only(await tx.query(
        "INSERT INTO tenants (business_name, contact_name, onboarding) VALUES ($1, $2, 'applied') RETURNING id",
        [input.businessName, input.contactName],
      )), "id");
      const userId = col.text(only(await tx.query(
        "INSERT INTO users (role, email, display_name, password_hash, tenant_id) VALUES ('tenant', $1, $2, $3, $4) RETURNING id",
        [input.email, input.contactName, passwordHash, tenantId],
      )), "id");
      const token = await startSession(tx, userId);
      const caller: Caller = { userId, role: "tenant", email: input.email, displayName: input.contactName, tenantId };
      return { token, caller };
    });
  } catch (error) {
    if (error instanceof PgError && error.code === "23505") throw conflict("email_taken", "An account already uses that email.");
    throw error;
  }
}

/** documents_pending → approved by the owner, when both current documents run through today. */
export async function approve(tenantId: string): Promise<Tenant> {
  return db.transaction(async (tx) => {
    const tenant = await findTenant(tx, tenantId, true);
    if (!tenant || tenant.onboarding !== "documents_pending") {
      throw conflict("invalid_transition", "Only a tenant waiting for review can be approved.");
    }
    const { today } = await kitchenTime(tx);
    if (lapse(tenant.cover, today) !== null) {
      throw conflict("documents_not_valid", "A current document has lapsed, so this tenant can't be approved.");
    }
    await tx.query("UPDATE tenants SET onboarding = 'approved' WHERE id = $1", [tenantId]);
    return tenantView({ ...tenant, onboarding: "approved" }, today);
  });
}
