import { randomBytes } from "node:crypto";
import { requireActor, requireRole, type Actor } from "../auth.js";
import { liveClaims } from "../claims.js";
import { config } from "../config.js";
import { all, newId, one, pool } from "../db.js";
import { checkedDocuments, coverage, type CheckedDocument, type Coverage } from "../documents.js";
import { ApiError, field, invalid, invalidTransition, json, route, type Reply } from "../http.js";
import { binderPage, deadLinkPage } from "../pages.js";
import { renderPdf } from "../pdf.js";
import { binderKey, getObject, putObject } from "../s3.js";
import { renterById, siteById, siteInScope, stationById, type RenterRow, type SiteRow } from "../scope.js";
import { datesTouched, daysBetween, isLocalDate, localDay, localStamp } from "../time.js";

interface LinkRow { id: string; site_id: string; from_date: string; to_date: string; token: string; expires_at: Date; revoked: boolean; created_at: Date; generated_at: Date }

const linkJson = (link: LinkRow) => ({
  id: link.id, site_id: link.site_id, from: link.from_date, to: link.to_date, url: `/binder/${link.token}`,
  expires_at: link.expires_at.toISOString(), revoked: link.revoked, created_at: link.created_at.toISOString(),
});

export type BinderRow = {
  date: string; renter_name: string; business: string; station: string; local_start: string; local_end: string;
  liability: Coverage; food_handler: Coverage;
};

export interface Binder { site: SiteRow; from: string; to: string; generatedAt: Date; rows: BinderRow[] }

/** Every booking in an active status at the site within the range, one row per booking and date touched. */
async function buildBinder(site: SiteRow, from: string, to: string): Promise<Binder> {
  const now = new Date();
  const zone = site.time_zone;
  const bookings = (await liveClaims(pool, { siteId: site.id }, localDay(zone, from).start, localDay(zone, to).end, now)).filter((claim) => claim.kind === "booking");
  const documents = new Map<string, { liability: CheckedDocument[]; food: CheckedDocument[]; renter: RenterRow }>();
  const rows: BinderRow[] = [];
  for (const booking of bookings) {
    const docs = documents.get(booking.renter_id) ?? {
      renter: await renterById(pool, booking.renter_id),
      liability: await checkedDocuments(pool, booking.renter_id, "liability"),
      food: await checkedDocuments(pool, booking.renter_id, "food_handler"),
    };
    documents.set(booking.renter_id, docs);
    const station = await stationById(pool, booking.station_id);
    for (const date of datesTouched(zone, booking.start_at, booking.end_at).filter((day) => day >= from && day <= to)) {
      rows.push({
        date, renter_name: docs.renter.name, business: docs.renter.business, station: station.name,
        local_start: localStamp(zone, booking.start_at), local_end: localStamp(zone, booking.end_at),
        liability: coverage(docs.liability, date), food_handler: coverage(docs.food, date),
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.local_start.localeCompare(b.local_start) || a.business.localeCompare(b.business));
  return { site, from, to, generatedAt: now, rows };
}

const coverageText = (cell: Coverage): string =>
  cell.status === "current" ? `Current until ${cell.expires_on}` : cell.status === "expired" ? `Expired ${cell.expires_on}` : "Missing";

function binderPdf(binder: Binder): Buffer {
  const zone = binder.site.time_zone;
  return renderPdf([
    { text: "Compliance binder", size: 20, bold: true },
    { text: binder.site.name, size: 13, bold: true, gap: 4 },
    { text: `${binder.from} to ${binder.to} · generated ${localStamp(zone, binder.generatedAt)}`, size: 10 },
    { text: "Date · Renter · Business · Station and time · Liability certificate · Food handler card", size: 9, bold: true, gap: 12 },
    ...(binder.rows.length === 0 ? [{ text: "No bookings on the schedule in this range.", size: 10 }] : binder.rows.map((row) => ({
      text: `${row.date} · ${row.renter_name} · ${row.business} · ${row.station} ${row.local_start.slice(11)} to ${row.local_end.slice(11)} · ${coverageText(row.liability)} · ${coverageText(row.food_handler)}`,
      size: 9,
    }))),
  ]);
}

async function storePdf(link: LinkRow): Promise<void> {
  const site = await siteById(pool, link.site_id);
  await putObject(binderKey(site.id, link.id), binderPdf(await buildBinder(site, link.from_date, link.to_date)), "application/pdf");
}

async function linkInScope(actor: Actor, id: string): Promise<LinkRow> {
  const link = await one<LinkRow>(pool, "SELECT * FROM binder_links WHERE id = $1", [id]);
  if (!link) throw new ApiError(404, "not_found");
  await siteInScope(pool, actor, link.site_id);
  return link;
}

route("GET", "/api/sites/:id/binder-links", async (request) => {
  const actor = await requireActor(request);
  const site = await siteInScope(pool, actor, request.params.id ?? "");
  requireRole(actor, "manager");
  const links = await all<LinkRow>(pool, "SELECT * FROM binder_links WHERE site_id = $1 ORDER BY created_at DESC, id", [site.id]);
  return json(200, { links: links.map(linkJson) });
});

route("POST", "/api/sites/:id/binder-links", async (request) => {
  const actor = await requireActor(request);
  const site = await siteInScope(pool, actor, request.params.id ?? "");
  requireRole(actor, "manager");
  const from = field(request.body, "from");
  const to = field(request.body, "to");
  const fields: Record<string, string> = {};
  if (!isLocalDate(from)) fields.from = "Use a date in the form YYYY-MM-DD.";
  if (!isLocalDate(to)) fields.to = "Use a date in the form YYYY-MM-DD.";
  else if (isLocalDate(from) && to < from) fields.to = "The range must end on or after its first day.";
  else if (isLocalDate(from) && daysBetween(from, to) > 30) fields.to = "A binder covers at most 31 days.";
  if (Object.keys(fields).length > 0 || !isLocalDate(from) || !isLocalDate(to)) throw invalid(fields);
  const now = new Date();
  const link: LinkRow = {
    id: newId("bl"), site_id: site.id, from_date: from, to_date: to, token: randomBytes(24).toString("base64url"),
    expires_at: new Date(now.getTime() + config.binderLinkTtlSeconds * 1000), revoked: false, created_at: now, generated_at: now,
  };
  await storePdf(link);
  await pool.query(
    "INSERT INTO binder_links (id, site_id, from_date, to_date, token, expires_at, revoked, created_at, generated_at) VALUES ($1,$2,$3,$4,$5,$6,false,$7,$7)",
    [link.id, site.id, from, to, link.token, link.expires_at, now]);
  return json(201, { link: linkJson(link) });
});

route("POST", "/api/binder-links/:id/regenerate", async (request) => {
  const actor = await requireActor(request);
  const link = await linkInScope(actor, request.params.id ?? "");
  requireRole(actor, "manager");
  if (link.revoked) throw invalidTransition("revoked", "regenerate");
  const now = new Date();
  const fresh: LinkRow = { ...link, token: randomBytes(24).toString("base64url"), expires_at: new Date(now.getTime() + config.binderLinkTtlSeconds * 1000), generated_at: now };
  await pool.query("UPDATE binder_links SET token = $2, expires_at = $3, generated_at = $4 WHERE id = $1", [link.id, fresh.token, fresh.expires_at, now]);
  await storePdf(fresh);
  return json(200, { link: linkJson(fresh) });
});

route("DELETE", "/api/binder-links/:id", async (request) => {
  const actor = await requireActor(request);
  const link = await linkInScope(actor, request.params.id ?? "");
  requireRole(actor, "manager");
  await pool.query("UPDATE binder_links SET revoked = true WHERE id = $1", [link.id]);
  return { status: 204 };
});

/** A link works while it is not revoked and server time is strictly before expires_at. */
async function liveLink(token: string): Promise<LinkRow | null> {
  return one<LinkRow>(pool, "SELECT * FROM binder_links WHERE token = $1 AND NOT revoked AND expires_at > $2", [token, new Date()]);
}

async function binderFor(token: string): Promise<{ link: LinkRow; binder: Binder } | null> {
  const link = await liveLink(token);
  if (!link) return null;
  return { link, binder: await buildBinder(await siteById(pool, link.site_id), link.from_date, link.to_date) };
}

route("GET", "/api/binder/:token", async (request) => {
  const found = await binderFor(request.params.token ?? "");
  if (!found) throw new ApiError(404, "link_not_found");
  const { binder } = found;
  return json(200, {
    site_name: binder.site.name, from: binder.from, to: binder.to, generated_at: binder.generatedAt.toISOString(),
    rows: binder.rows,
  });
});

route("GET", "/binder/:token", async (request): Promise<Reply> => {
  const token = request.params.token ?? "";
  const found = await binderFor(token);
  const html = found ? binderPage(found.binder, `/binder/${token}/binder.pdf`, coverageText) : deadLinkPage();
  return { status: found ? 200 : 404, raw: { data: html, type: "text/html; charset=utf-8", headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } } };
});

route("GET", "/binder/:token/binder.pdf", async (request) => {
  const link = await liveLink(request.params.token ?? "");
  const stored = link ? await getObject(binderKey(link.site_id, link.id)) : null;
  if (!link || !stored) throw new ApiError(404, "link_not_found");
  return {
    status: 200,
    raw: { data: stored.body, type: "application/pdf", headers: { "Content-Disposition": `attachment; filename="binder-${link.site_id}-${link.from_date}-${link.to_date}.pdf"`, "Cache-Control": "no-store" } },
  };
});
