/** Tenants, their lifecycle actions, inspection links, the inspector view and storage shelves. */

import { randomBytes } from "node:crypto";
import type { Shelf, Tenant } from "../../../shared/api-types.js";
import { DOCUMENT_KIND_LABELS } from "../../../shared/api-types.js";
import { uuid } from "../../db.js";
import type { Storage } from "../../providers/storage.js";
import {
  REQUIRED_KINDS,
  loadTenantDetail,
  loadTenantDocuments,
  requiredDocuments,
  resolveTenantStatuses,
  detailToTenantJson,
  latestExpiry
} from "../../domain/tenants.js";
import { err, notFound, validation } from "../errors.js";
import type { App, RouteContext } from "../server.js";
import { int, json, noContent, readJson, requireRole, requireUser } from "./helpers.js";
import type { UserRow } from "./helpers.js";

const LINK_MIN_SECONDS = 10;
const LINK_MAX_SECONDS = 604_800;

export function registerTenantRoutes(app: App): void {
  app.route("GET", "/api/tenants", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    await resolveTenantStatuses(rc.db);
    if (user.role === "operator") {
      const tenants = await rc.db.query<{ id: string }>("SELECT id FROM tenants ORDER BY business_name");
      const out: Tenant[] = [];
      for (const row of tenants) {
        const detail = await loadTenantDetail(rc.db, row.id);
        if (detail) out.push(detailToTenantJson(detail));
      }
      return json(200, { tenants: out });
    }
    const detail = await loadTenantDetail(rc.db, user.tenant_id as string);
    return json(200, { tenants: detail ? [detailToTenantJson(detail)] : [] });
  });

  app.route("GET", "/api/tenants/:id", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    await resolveTenantStatuses(rc.db);
    const id = rc.ctx.params["id"] ?? "";
    if (user.tenant_id !== null && id !== user.tenant_id) {
      throw notFound();
    }
    const detail = await loadTenantDetail(rc.db, id);
    if (detail === null) {
      throw notFound();
    }
    return json(200, detailToTenantJson(detail));
  });

  app.route("POST", "/api/tenants/:id/activate", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    await resolveTenantStatuses(rc.db);
    const id = rc.ctx.params["id"] ?? "";
    const rows = await rc.db.query<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [id]);
    if (rows.length === 0) {
      throw notFound();
    }
    if (rows[0].status !== "documents_review") {
      throw err(409, "invalid_transition", "That can't be done in this record's current state.");
    }
    const docs = await loadTenantDocuments(rc.db, id);
    const required = requiredDocuments(docs, rc.db.clock.today());
    const missing = REQUIRED_KINDS.filter((k) => !required[k].valid);
    if (missing.length > 0) {
      throw err(409, "documents_incomplete", "The tenant is missing an approved, valid document.", {
        missing
      });
    }
    await rc.db.query("UPDATE tenants SET status = 'active' WHERE id = $1", [id]);
    await rc.db.audit(user.id, "activate_tenant", "tenant", id, {});
    const detail = await loadTenantDetail(rc.db, id);
    return json(200, detailToTenantJson(detail as never));
  });

  app.route("POST", "/api/tenants/:id/offboard", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const id = rc.ctx.params["id"] ?? "";
    const rows = await rc.db.query<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [id]);
    if (rows.length === 0) {
      throw notFound();
    }
    if (rows[0].status !== "active" && rows[0].status !== "suspended") {
      throw err(409, "invalid_transition", "That can't be done in this record's current state.");
    }
    const open = await rc.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM bookings WHERE tenant_id = $1 AND status = ANY($2::text[])",
      [id, ["held", "confirmed", "checked_in"]]
    );
    if (Number(open[0].count) > 0) {
      throw err(409, "open_bookings", "The tenant still has open bookings. Cancel or complete them first.");
    }
    await rc.db.query("UPDATE tenants SET status = 'offboarded' WHERE id = $1", [id]);
    await rc.db.query("UPDATE shelves SET tenant_id = NULL WHERE tenant_id = $1", [id]);
    await rc.db.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)", [id]);
    await rc.db.audit(user.id, "offboard_tenant", "tenant", id, {});
    const detail = await loadTenantDetail(rc.db, id);
    return json(200, detailToTenantJson(detail as never));
  });

  app.route("POST", "/api/tenants/:id/inspection-link", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const id = rc.ctx.params["id"] ?? "";
    const body = await readJson(rc.ctx);
    const seconds = int(body["expires_in_seconds"]);
    if (seconds === undefined || seconds < LINK_MIN_SECONDS || seconds > LINK_MAX_SECONDS) {
      throw validation({ expires_in_seconds: "The link lasts from 1 hour to 7 days." });
    }
    const exists = await rc.db.query<{ id: string }>("SELECT id FROM tenants WHERE id = $1", [id]);
    if (exists.length === 0) {
      throw notFound();
    }
    // A new link ends any earlier link for this tenant at once.
    await rc.db.query(
      "UPDATE inspection_links SET revoked_at = now(), replaced_by = $2 WHERE tenant_id = $1 AND revoked_at IS NULL",
      [id, uuid()]
    );
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + seconds * 1000);
    await rc.db.query(
      `INSERT INTO inspection_links (id, tenant_id, token, issued_at, expires_at)
       VALUES ($1,$2,$3, now(), $4)`,
      [uuid(), id, token, expiresAt]
    );
    await rc.db.audit(user.id, "issue_inspection_link", "tenant", id, { expires_at: expiresAt.toISOString() });
    return json(201, {
      url: `/inspect/${token}`,
      expires_at: rc.db.clock.isoOf(expiresAt.getTime())
    });
  });

  app.route("GET", "/api/tenants/:id/inspection-link", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const id = rc.ctx.params["id"] ?? "";
    const rows = await liveLink(rc, id);
    if (rows === null) {
      throw notFound();
    }
    return json(200, { url: `/inspect/${rows.token}`, expires_at: rows.expiresIso });
  });

  app.route("DELETE", "/api/tenants/:id/inspection-link", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const id = rc.ctx.params["id"] ?? "";
    const rows = await liveLink(rc, id);
    if (rows === null) {
      throw notFound();
    }
    await rc.db.query("UPDATE inspection_links SET revoked_at = now() WHERE id = $1", [rows.id]);
    await rc.db.audit(user.id, "revoke_inspection_link", "tenant", id, {});
    return noContent();
  });
}

interface LiveLink {
  id: string;
  token: string;
  expiresIso: string;
}

async function liveLink(rc: RouteContext, tenantId: string): Promise<LiveLink | null> {
  const rows = await rc.db.query<{ id: string; token: string; expires_at: Date }>(
    "SELECT id, token, expires_at FROM inspection_links WHERE tenant_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY issued_at DESC LIMIT 1",
    [tenantId]
  );
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    token: rows[0].token,
    expiresIso: rc.db.clock.isoOf(rows[0].expires_at.getTime())
  };
}

export function registerInspectRoutes(app: App, storage: Storage): void {
  app.route("GET", "/api/inspect/:token", "public", async (rc) => {
    const token = rc.ctx.params["token"] ?? "";
    const link = await resolveLink(rc, token);
    const docs = await loadTenantDocuments(rc.db, link.tenantId);
    const today = rc.db.clock.today();
    const current = currentDocuments(docs, today);
    return json(200, {
      kitchen_name: rc.db.kitchenName,
      business_name: link.businessName,
      expires_at: rc.db.clock.isoOf(link.expiresAt.getTime()),
      documents: current.map((d) => ({
        id: d.id,
        kind: d.kind,
        holder_name: d.holder_name,
        expires_on: d.expires_on,
        file_url: `/api/inspect/${token}/documents/${d.id}/file`
      }))
    });
  }, true);

  app.route("GET", "/api/inspect/:token/documents/:id/file", "public", async (rc) => {
    const token = rc.ctx.params["token"] ?? "";
    const link = await resolveLink(rc, token);
    const docs = await loadTenantDocuments(rc.db, link.tenantId);
    const current = currentDocuments(docs, rc.db.clock.today());
    const doc = current.find((d) => d.id === rc.ctx.params["id"]);
    if (doc === undefined) {
      throw notFound();
    }
    const bytes = await storage.getObject(doc.storage_key);
    return { status: 200, body: bytes, contentType: doc.content_type };
  }, true);
}

interface LinkView {
  tenantId: string;
  businessName: string;
  expiresAt: Date;
}

async function resolveLink(rc: RouteContext, token: string): Promise<LinkView> {
  const rows = await rc.db.query<{
    tenant_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    business_name: string;
  }>(
    `SELECT l.tenant_id, l.expires_at, l.revoked_at, t.business_name
     FROM inspection_links l JOIN tenants t ON t.id = l.tenant_id WHERE l.token = $1`,
    [token]
  );
  if (rows.length === 0) {
    throw err(404, "not_found", "That record isn't available.");
  }
  const link = rows[0];
  if (link.revoked_at !== null || link.expires_at.getTime() <= Date.now()) {
    throw err(410, "link_expired", "This inspection link is no longer valid.");
  }
  return { tenantId: link.tenant_id, businessName: link.business_name, expiresAt: link.expires_at };
}

/**
 * The link lists only the tenant's approved, valid documents: the latest-expiring certificate
 * of insurance, the latest-expiring health permit, and the latest-expiring valid card for
 * each holder.
 */
export function currentDocuments(
  docs: Array<{
    id: string;
    kind: keyof typeof DOCUMENT_KIND_LABELS;
    holder_name: string | null;
    expires_on: string;
    status: string;
    storage_key: string;
    content_type: string;
  }>,
  today: string
) {
  const valid = docs.filter((d) => d.status === "approved" && d.expires_on >= today);
  const out: typeof valid = [];
  const coi = valid.filter((d) => d.kind === "certificate_of_insurance");
  if (coi.length > 0) {
    out.push(coi.reduce((a, b) => (b.expires_on > a.expires_on ? b : a)));
  }
  const permit = valid.filter((d) => d.kind === "health_permit");
  if (permit.length > 0) {
    out.push(permit.reduce((a, b) => (b.expires_on > a.expires_on ? b : a)));
  }
  const cards = valid.filter((d) => d.kind === "food_handler_card");
  const byHolder = new Map<string, (typeof cards)[number]>();
  for (const card of cards) {
    const holder = card.holder_name ?? "";
    const existing = byHolder.get(holder);
    if (existing === undefined || card.expires_on > existing.expires_on) {
      byHolder.set(holder, card);
    }
  }
  out.push(...byHolder.values());
  return out;
}

export function registerShelfRoutes(app: App): void {
  app.route("GET", "/api/shelves", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    let where = "TRUE";
    const params: unknown[] = [];
    if (user.tenant_id !== null) {
      params.push(user.tenant_id);
      where = `sh.tenant_id = $${params.length}`;
    }
    const rows = await rc.db.query<{ id: string; name: string; monthly_rate_cents: number; tenant_id: string | null; tenant_name: string | null }>(
      `SELECT sh.id, sh.name, sh.monthly_rate_cents, sh.tenant_id, t.business_name AS tenant_name
       FROM shelves sh LEFT JOIN tenants t ON t.id = sh.tenant_id WHERE ${where} ORDER BY sh.id`,
      params
    );
    return json(200, { shelves: rows });
  });

  app.route("PUT", "/api/shelves/:id", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const id = rc.ctx.params["id"] ?? "";
    const body = await readJson(rc.ctx);
    const shelfRows = await rc.db.query<{ id: string; name: string }>(
      "SELECT id, name FROM shelves WHERE id = $1",
      [id]
    );
    if (shelfRows.length === 0) {
      throw notFound();
    }
    if (!("tenant_id" in body)) {
      throw validation({ tenant_id: "Choose a tenant or Unassigned." });
    }
    const tenantId = body["tenant_id"] === null ? null : typeof body["tenant_id"] === "string" ? body["tenant_id"] : undefined;
    if (tenantId === undefined) {
      throw validation({ tenant_id: "Choose a tenant or Unassigned." });
    }
    if (tenantId !== null) {
      const rows = await rc.db.query<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [tenantId]);
      if (rows.length === 0) {
        throw notFound();
      }
      if (rows[0].status !== "active") {
        throw err(409, "tenant_not_active", "Only active tenants can rent a shelf.");
      }
    }
    await rc.db.query("UPDATE shelves SET tenant_id = $1 WHERE id = $2", [tenantId, id]);
    await rc.db.audit(user.id, "assign_shelf", "shelf", id, { tenant_id: tenantId });
    const rows = await rc.db.query<{ id: string; name: string; monthly_rate_cents: number; tenant_id: string | null; tenant_name: string | null }>(
      `SELECT sh.id, sh.name, sh.monthly_rate_cents, sh.tenant_id, t.business_name AS tenant_name
       FROM shelves sh LEFT JOIN tenants t ON t.id = sh.tenant_id WHERE sh.id = $1`,
      [id]
    );
    return json(200, rows[0]);
  });
}
