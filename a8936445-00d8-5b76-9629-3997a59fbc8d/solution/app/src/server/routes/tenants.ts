// Tenants, their lifecycle and inspection links (brief: Tenants and inspection links, Tenant lifecycle,
// Inspection links).
import { randomBytes } from "node:crypto";
import type { InspectionView } from "../../shared/api";
import { KITCHEN_NAME } from "../../shared/kitchen";
import { kitchenIso } from "../../shared/time";
import { audit, one, pool, rows, transaction } from "../db";
import { ApiError, invalidTransition, notFound, validation } from "../errors";
import { disposition, route, type Ctx } from "../http";
import { occupying } from "../occupancy";
import { kitchenToday, loadTenant, tenantDocuments, tenantRows, tenantStanding, tenantView, type DocumentRow, type TenantRow } from "../records";
import { currentDocuments, missingKinds } from "../rules";
import { documentFile } from "../documentFiles";

const LINK_MIN_SECONDS = 10;
const LINK_MAX_SECONDS = 604_800;

interface LinkRow {
  token: string;
  tenant_id: string;
  expires_at: Date;
  ended_at: Date | null;
}

const linkIsLive = (link: LinkRow, nowMs: number): boolean => link.ended_at === null && nowMs < link.expires_at.getTime();
const linkView = (link: LinkRow) => ({ url: `/inspect/${link.token}`, expires_at: kitchenIso(link.expires_at.getTime()) });

async function liveLink(tenantId: string, nowMs: number): Promise<LinkRow | undefined> {
  const links = await rows<LinkRow>(pool, "SELECT * FROM inspection_links WHERE tenant_id = $1 ORDER BY created_at DESC", [tenantId]);
  return links.find((link) => linkIsLive(link, nowMs));
}

const loadOwnTenant = (ctx: Ctx<undefined>): Promise<TenantRow> => loadTenant(pool, ctx.user, ctx.params.id);

/** The link's tenant and its current documents, or 404 unknown / 410 dead. */
async function openLink(ctx: Ctx<undefined>): Promise<{ tenant: TenantRow; link: LinkRow; documents: DocumentRow[] }> {
  const link = await one<LinkRow>(pool, "SELECT * FROM inspection_links WHERE token = $1", [ctx.params.token]);
  if (!link) throw notFound();
  if (!linkIsLive(link, ctx.nowMs)) throw new ApiError(410, "link_expired", "This inspection link is no longer valid.");
  const [tenant] = await tenantRows(pool, link.tenant_id);
  return { tenant, link, documents: currentDocuments(await tenantDocuments(pool, tenant.id), kitchenToday(ctx.nowMs)) };
}

type Opened = Awaited<ReturnType<typeof openLink>>;

export const tenantRoutes = [
  route({
    method: "GET",
    path: "/api/tenants",
    roles: ["operator", "owner", "cook"],
    async handle(ctx) {
      const found = ctx.user.role === "operator" ? await tenantRows(pool) : await tenantRows(pool, ctx.user.tenant_id as string);
      return { status: 200, json: { tenants: await Promise.all(found.map((t) => tenantView(pool, t, ctx.nowMs))) } };
    },
  }),
  route<TenantRow>({
    method: "GET",
    path: "/api/tenants/:id",
    roles: ["operator", "owner", "cook"],
    load: loadOwnTenant,
    async handle(ctx) {
      return { status: 200, json: await tenantView(pool, ctx.loaded, ctx.nowMs) };
    },
  }),
  route<TenantRow>({
    method: "POST",
    path: "/api/tenants/:id/activate",
    roles: ["operator"],
    body: "json",
    load: loadOwnTenant,
    async handle(ctx) {
      await transaction(async (db) => {
        await db.query("SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE", [ctx.loaded.id]);
        const [tenant] = await tenantRows(db, ctx.loaded.id);
        if (tenant.lifecycle !== "documents_review") throw invalidTransition();
        const missing = missingKinds((await tenantStanding(db, tenant, ctx.nowMs)).required);
        if (missing.length > 0) throw new ApiError(409, "documents_incomplete", "Some required documents are missing or not valid.", { missing });
        await db.query("UPDATE tenants SET lifecycle = 'active' WHERE id = $1", [tenant.id]);
        await audit(db, ctx.user.id, "tenant", tenant.id, "activated");
      });
      return { status: 200, json: await tenantView(pool, (await tenantRows(pool, ctx.loaded.id))[0], ctx.nowMs) };
    },
  }),
  route<TenantRow>({
    method: "POST",
    path: "/api/tenants/:id/offboard",
    roles: ["operator"],
    body: "json",
    load: loadOwnTenant,
    async handle(ctx) {
      await transaction(async (db) => {
        await db.query("SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE", [ctx.loaded.id]);
        const [tenant] = await tenantRows(db, ctx.loaded.id);
        if (tenant.lifecycle !== "active") throw invalidTransition();
        const open = await rows<{ date: string }>(db, "SELECT DISTINCT date::text AS date FROM bookings WHERE tenant_id = $1 AND status IN ('held', 'confirmed', 'checked_in')", [tenant.id]);
        const live = (await occupying(db, open.map((o) => o.date), ctx.nowMs)).filter(
          (b) => b.tenant_id === tenant.id && b.status !== "completed",
        );
        if (live.length > 0) throw new ApiError(409, "open_bookings", "This tenant still has open bookings.");
        await db.query("UPDATE tenants SET lifecycle = 'offboarded' WHERE id = $1", [tenant.id]);
        await audit(db, ctx.user.id, "tenant", tenant.id, "offboarded");
      });
      return { status: 200, json: await tenantView(pool, (await tenantRows(pool, ctx.loaded.id))[0], ctx.nowMs) };
    },
  }),
  route<TenantRow>({
    method: "POST",
    path: "/api/tenants/:id/inspection-link",
    roles: ["operator"],
    body: "json",
    load: loadOwnTenant,
    async handle(ctx) {
      const seconds = ctx.json.expires_in_seconds;
      if (!Number.isInteger(seconds) || (seconds as number) < LINK_MIN_SECONDS || (seconds as number) > LINK_MAX_SECONDS) {
        throw validation({ expires_in_seconds: `A link lasts from ${LINK_MIN_SECONDS} to ${LINK_MAX_SECONDS} seconds.` });
      }
      const link = await transaction(async (db) => {
        await db.query("SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE", [ctx.loaded.id]);
        const issuedAt = new Date(ctx.nowMs);
        // Issuing a new link ends the earlier one at once.
        await db.query("UPDATE inspection_links SET ended_at = $2 WHERE tenant_id = $1 AND ended_at IS NULL", [ctx.loaded.id, issuedAt]);
        const issued = (await one<LinkRow>(
          db,
          "INSERT INTO inspection_links (token, tenant_id, created_at, expires_at) VALUES ($1, $2, $3, $4) RETURNING *",
          [randomBytes(32).toString("base64url"), ctx.loaded.id, issuedAt, new Date(Math.floor(ctx.nowMs / 1000) * 1000 + (seconds as number) * 1000)],
        )) as LinkRow;
        await audit(db, ctx.user.id, "inspection_link", ctx.loaded.id, "issued", { expires_at: issued.expires_at });
        return issued;
      });
      return { status: 201, json: linkView(link) };
    },
  }),
  route<TenantRow>({
    method: "GET",
    path: "/api/tenants/:id/inspection-link",
    roles: ["operator"],
    load: loadOwnTenant,
    async handle(ctx) {
      const link = await liveLink(ctx.loaded.id, ctx.nowMs);
      if (!link) throw notFound();
      return { status: 200, json: linkView(link) };
    },
  }),
  route<TenantRow>({
    method: "DELETE",
    path: "/api/tenants/:id/inspection-link",
    roles: ["operator"],
    load: loadOwnTenant,
    async handle(ctx) {
      const link = await liveLink(ctx.loaded.id, ctx.nowMs);
      if (!link) throw notFound();
      await transaction(async (db) => {
        await db.query("UPDATE inspection_links SET ended_at = $2 WHERE token = $1", [link.token, new Date(ctx.nowMs)]);
        await audit(db, ctx.user.id, "inspection_link", ctx.loaded.id, "revoked");
      });
      return { status: 204 };
    },
  }),
  route<Opened>({
    method: "GET",
    path: "/api/inspect/:token",
    roles: "public",
    load: openLink,
    async handle(ctx) {
      const { tenant, link, documents } = ctx.loaded;
      const view: InspectionView = {
        kitchen_name: KITCHEN_NAME,
        business_name: tenant.business_name,
        expires_at: kitchenIso(link.expires_at.getTime()),
        documents: documents.map((d) => ({
          id: d.id,
          kind: d.kind,
          holder_name: d.holder_name,
          expires_on: d.expires_on,
          file_url: `/api/inspect/${link.token}/documents/${d.id}/file`,
        })),
      };
      return { status: 200, json: view };
    },
  }),
  route<Opened>({
    method: "GET",
    path: "/api/inspect/:token/documents/:id/file",
    roles: "public",
    load: async (ctx) => {
      const opened = await openLink(ctx);
      if (!opened.documents.some((d) => d.id === ctx.params.id)) throw notFound();
      return opened;
    },
    async handle(ctx) {
      const doc = ctx.loaded.documents.find((d) => d.id === ctx.params.id) as DocumentRow;
      const data = await documentFile(pool, doc);
      if (!data) throw notFound();
      return { status: 200, file: { body: data, contentType: doc.content_type, disposition: disposition("inline", doc.file_name) } };
    },
  }),
];
