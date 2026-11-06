import { newToken, requireRole, tokenHash, type Member } from "../auth.js";
import { config } from "../config.js";
import { one, pool, rows, tx, type Db } from "../db.js";
import { CASE_STUDY_COLUMNS, CASE_STUDY_FROM, directorActions, livePreview, nextState, PUBLISHED, type CaseStudyAction, type CaseStudyRow }
  from "../domain/casestudies.js";
import { conflict, notFound } from "../http/errors.js";
import type { PageRule } from "../http/pages.js";
import { noContent, ok, type Ctx, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { knownId } from "../scope.js";
import { coverSvg } from "../services/covers.js";
import { queueMail } from "../services/mail.js";
import { formatTime } from "../../shared/format.js";

const SECTORS = ["retail", "workplace", "food_beverage"] as const;
const SECTOR_LABEL: Record<(typeof SECTORS)[number], string> = { retail: "Retail", workplace: "Workplace", food_beverage: "Food & beverage" };
const SLUG = /^[a-z0-9-]{3,80}$/;

const coverUrl = (slug: string): string => `/media/covers/${slug}.svg`;

const publicJson = (row: CaseStudyRow) => ({
  slug: row.slug, title: row.title, sector: row.sector, location: row.location, summary: row.summary, coverUrl: coverUrl(row.slug),
});

async function officeJson(db: Db, row: CaseStudyRow) {
  const links = await rows<{ id: string; expires_at: Date }>(db,
    "SELECT id, expires_at FROM preview_links WHERE case_study_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at",
    [row.id]);
  return {
    id: row.id, title: row.title, slug: row.slug, sector: row.sector, brand: { id: row.brand_id, name: row.brand_name },
    location: row.location, summary: row.summary, body: row.body, featured: row.featured, state: row.state,
    publishedAt: row.published_at && new Date(row.published_at).toISOString(), coverUrl: coverUrl(row.slug),
    previewLinks: links.map((link) => ({ id: link.id, expiresAt: link.expires_at.toISOString() })),
    actions: directorActions(row.state),
  };
}

/** Studio roles see every case study, a client approver only their brand's; anyone else none (404). */
async function visibleCaseStudy(db: Db, member: Member, id: string, lock = false): Promise<CaseStudyRow> {
  const row = await one<CaseStudyRow>(db,
    `SELECT ${CASE_STUDY_COLUMNS} FROM ${CASE_STUDY_FROM} WHERE cs.id = $1 ${lock ? "FOR UPDATE OF cs" : ""}`, [knownId(id)]);
  const visible = row && (member.role === "client_approver" ? row.brand_id === member.brandId : member.role !== "contractor");
  if (!row || !visible) throw notFound();
  return row;
}

/** A transition by the director or the brand's approver, recorded under the row lock. */
function transitionRoute(action: Exclude<CaseStudyAction, "send_preview">): Route {
  return {
    method: "POST", path: `/api/case-studies/:id/${action}`, auth: "member",
    handler: async (ctx: Ctx) => tx(async (client) => {
      const member = ctx.me;
      const row = await visibleCaseStudy(client, member, ctx.params.id, true);
      if (action === "approve") requireRole(member, "client_approver");
      else requireRole(member, "director");
      const state = nextState(row.state, action);
      await client.query(
        `UPDATE case_studies SET state = $2, published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END WHERE id = $1`,
        [row.id, state]);
      return ok({ caseStudy: await officeJson(client, { ...row, state, published_at: state === "published" ? new Date().toISOString() : row.published_at }) });
    }),
  };
}

export const routes: Route[] = [
  {
    method: "GET", path: "/api/case-studies", auth: "member",
    handler: async (ctx) => {
      requireRole(ctx.me, "director");
      const list = await rows<CaseStudyRow>(pool, `SELECT ${CASE_STUDY_COLUMNS} FROM ${CASE_STUDY_FROM} ORDER BY cs.created_at DESC, cs.title`);
      return ok({ caseStudies: await Promise.all(list.map((row) => officeJson(pool, row))) });
    },
  },
  {
    method: "POST", path: "/api/case-studies", auth: "member",
    handler: async (ctx) => {
      requireRole(ctx.me, "director");
      const body = record(ctx.json());
      if (typeof body.slug === "string" && (await one(pool, "SELECT 1 FROM case_studies WHERE slug = $1", [body.slug]))) {
        throw conflict("slug_exists");
      }
      const fields = new Fields(body);
      const title = fields.text("title", "Title", { max: 120, oneLine: true });
      const slug = typeof body.slug === "string" ? body.slug : "";
      if (!slug) fields.fail("slug", "Slug is required.");
      else if (!SLUG.test(slug)) fields.fail("slug", "Slug must be 3 to 80 lowercase letters, digits and hyphens.");
      const sector = fields.oneOf("sector", "Sector", SECTORS);
      const brandId = typeof body.brandId === "string" ? body.brandId : "";
      const brand = /^[0-9a-f-]{36}$/i.test(brandId) ? await one(pool, "SELECT id FROM brands WHERE id = $1", [brandId]) : undefined;
      if (!brand) fields.fail("brandId", "Brand is required.");
      const location = fields.text("location", "Location", { max: 120, oneLine: true });
      const summary = fields.text("summary", "Summary", { max: 400 });
      const text = fields.text("body", "Body", { max: 8000 });
      const featured = body.featured === true;
      fields.done();
      const created = await tx(async (client) => {
        await client.query("LOCK TABLE case_studies IN SHARE ROW EXCLUSIVE MODE");
        const order = featured ? Number((await one<{ n: number }>(client, "SELECT coalesce(max(featured_order), 0) + 1 AS n FROM case_studies"))?.n) : null;
        const inserted = await one<{ id: string }>(client,
          `INSERT INTO case_studies (title, slug, sector, brand_id, location, summary, body, featured, featured_order, state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft') ON CONFLICT (slug) DO NOTHING RETURNING id`,
          [title, slug, sector, brandId, location, summary, text, featured, order]);
        if (!inserted) throw conflict("slug_exists");
        return visibleCaseStudy(client, ctx.me, inserted.id);
      });
      return ok({ caseStudy: await officeJson(pool, created) }, 201);
    },
  },
  {
    method: "POST", path: "/api/case-studies/:id/preview-links", auth: "member",
    handler: async (ctx) => tx(async (client) => {
      const member = ctx.me;
      const row = await visibleCaseStudy(client, member, ctx.params.id, true);
      requireRole(member, "director");
      const state = nextState(row.state, "send_preview");
      const body = record(ctx.json());
      const fields = new Fields(body);
      const raw = body.expiresAt;
      const expires = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw) : null;
      if (raw === undefined || raw === null || raw === "") fields.fail("expiresAt", "Link expires at is required.");
      else if (!expires || Number.isNaN(expires.getTime())) fields.fail("expiresAt", "Link expires at must be a date and time like 2026-11-03T14:00.");
      else if (expires.getTime() <= Date.now()) fields.fail("expiresAt", "Choose an expiry after now.");
      fields.done();
      const expiresAt = (expires as Date).toISOString();
      const token = newToken();
      await client.query("UPDATE preview_links SET revoked_at = now() WHERE case_study_id = $1 AND revoked_at IS NULL", [row.id]);
      const link = await one<{ id: string }>(client,
        "INSERT INTO preview_links (case_study_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id", [row.id, tokenHash(token), expiresAt]);
      await client.query("UPDATE case_studies SET state = $2 WHERE id = $1", [row.id, state]);
      const url = `${config.baseUrl}/preview/${token}`;
      const approvers = await rows<{ email: string; name: string }>(client,
        "SELECT email, name FROM members WHERE role = 'client_approver' AND brand_id = $1 AND status = 'active' ORDER BY name", [row.brand_id]);
      for (const approver of approvers) {
        await queueMail(client, {
          to: approver.email,
          subject: `Case study preview: ${row.title}`,
          text: `Hello ${approver.name},\n\nMarrow Hall Interiors would like your approval to publish the case study "${row.title}" ` +
            `(${row.location}).\n\nPreview it here:\n${url}\n\nThe link works until ${formatTime(expiresAt)}. It only shows the case study; ` +
            `to approve it, sign in to Plumbline from the preview page.\n\nPlumbline, Marrow Hall Interiors`,
        });
      }
      return ok({ previewLink: { id: link?.id, url, expiresAt }, approvers: approvers.length }, 201);
    }),
  },
  {
    method: "DELETE", path: "/api/preview-links/:id", auth: "member",
    handler: async (ctx) => {
      const link = await one<{ case_study_id: string }>(pool, "SELECT case_study_id FROM preview_links WHERE id = $1", [knownId(ctx.params.id)]);
      if (!link) throw notFound();
      await visibleCaseStudy(pool, ctx.me, link.case_study_id);
      requireRole(ctx.me, "director");
      await pool.query("UPDATE preview_links SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1", [ctx.params.id]);
      return noContent();
    },
  },
  {
    method: "GET", path: "/api/preview/:token", auth: "optional",
    handler: async (ctx) => {
      const row = await livePreview(pool, ctx.params.token);
      if (!row) throw notFound();
      const member = ctx.member;
      return ok({
        caseStudy: { id: row.id, title: row.title, sector: row.sector, location: row.location, summary: row.summary, body: row.body,
          coverUrl: `${coverUrl(row.slug)}?preview=${encodeURIComponent(ctx.params.token)}` },
        canApprove: !!member && member.role === "client_approver" && member.brandId === row.brand_id && row.state === "preview_sent",
      });
    },
  },
  transitionRoute("approve"),
  transitionRoute("publish"),
  transitionRoute("withdraw"),
  {
    method: "GET", path: "/api/public/case-studies", auth: "public",
    handler: async (ctx) => {
      const sector = ctx.query.get("sector");
      const filtered = sector && (SECTORS as readonly string[]).includes(sector);
      const list = await rows<CaseStudyRow>(pool,
        `SELECT ${CASE_STUDY_COLUMNS} FROM ${CASE_STUDY_FROM} WHERE ${PUBLISHED} ${filtered ? "AND cs.sector = $1" : ""}
         ORDER BY cs.published_at DESC`, filtered ? [sector] : []);
      return ok({ caseStudies: list.map(publicJson) });
    },
  },
  {
    method: "GET", path: "/api/public/case-studies/:slug", auth: "public",
    handler: async (ctx) => {
      const row = await one<CaseStudyRow>(pool, `SELECT ${CASE_STUDY_COLUMNS} FROM ${CASE_STUDY_FROM} WHERE ${PUBLISHED} AND cs.slug = $1`,
        [ctx.params.slug]);
      if (!row) throw notFound();
      return ok({ caseStudy: { ...publicJson(row), body: row.body, publishedAt: new Date(row.published_at ?? 0).toISOString() } });
    },
  },
  {
    method: "GET", path: "/api/public/sectors", auth: "public",
    handler: async () => {
      const counts = await rows<{ sector: string; n: number }>(pool,
        `SELECT cs.sector, count(*)::int AS n FROM case_studies cs WHERE ${PUBLISHED} GROUP BY cs.sector`);
      const sectors = SECTORS.map((key) => ({ key, label: SECTOR_LABEL[key], count: counts.find((c) => c.sector === key)?.n ?? 0 }));
      return ok({ total: sectors.reduce((sum, s) => sum + s.count, 0), sectors });
    },
  },
  {
    method: "GET", path: "/api/public/featured", auth: "public",
    handler: async () => {
      const list = await rows<CaseStudyRow>(pool,
        `SELECT ${CASE_STUDY_COLUMNS} FROM ${CASE_STUDY_FROM} WHERE ${PUBLISHED} AND cs.featured ORDER BY cs.featured_order`);
      return ok({ caseStudies: list.map(publicJson) });
    },
  },
  {
    method: "GET", path: "/media/covers/:slug.svg", auth: "public",
    handler: async (ctx) => {
      const row = await one<CaseStudyRow>(pool, `SELECT ${CASE_STUDY_COLUMNS} FROM ${CASE_STUDY_FROM} WHERE cs.slug = $1`, [ctx.params.slug]);
      const token = ctx.query.get("preview");
      const previewed = token ? (await livePreview(pool, token))?.id === row?.id : false;
      if (!row || (row.state !== "published" && !previewed)) throw notFound();
      return { status: 200, body: coverSvg(row.slug, row.sector), headers: { "Content-Type": "image/svg+xml; charset=utf-8" } };
    },
  },
];

export const pages: PageRule[] = [
  { path: "/work/:slug", exists: async ({ slug }) => !!(await one(pool, `SELECT 1 FROM case_studies cs WHERE ${PUBLISHED} AND cs.slug = $1`, [slug])) },
  { path: "/preview/:token", exists: async ({ token }) => !!(await livePreview(pool, token)) },
];
