// The public directory (no session): stats, jurisdictions, listed exchanges, the sitemap, and the listing switch.
import { allow, staff } from "../auth.js";
import { config } from "../config.js";
import { one, pool, rows } from "../db.js";
import { refuse } from "../errors.js";
import { objectBody, type Router } from "../http.js";
import { normaliseName } from "../names.js";
import { businessDate } from "../../shared/format.js";

const REGIONS = ["europe", "asia_pacific", "middle_east", "americas", "africa"] as const;
const RULE_STATUSES = ["in_force", "announced", "no_rule"] as const;

interface JurisdictionRow {
  code: string;
  name: string;
  region: string;
  currency: string;
  threshold_cents: bigint | null;
  in_force_since: string | null;
  announced_threshold_cents: bigint | null;
  announced_on: string | null;
}

/** The reference table as of today: an announced change whose date has come is the rule in force. */
function jurisdictionBody(j: JurisdictionRow, today: string) {
  const changeArrived = j.announced_on !== null && j.announced_on <= today;
  const thresholdCents = changeArrived ? j.announced_threshold_cents : j.threshold_cents;
  const inForceSince = changeArrived ? j.announced_on : j.in_force_since;
  const status = thresholdCents !== null ? "in_force" : j.announced_on !== null ? "announced" : "no_rule";
  return {
    code: j.code,
    name: j.name,
    region: j.region,
    currency: j.currency,
    status,
    thresholdCents: status === "in_force" ? thresholdCents : null,
    inForceSince: status === "in_force" ? inForceSince : null,
    announcedChange: j.announced_on !== null && !changeArrived
      ? { thresholdCents: j.announced_threshold_cents, takesEffectOn: j.announced_on }
      : null,
  };
}

type Jurisdiction = ReturnType<typeof jurisdictionBody>;

async function jurisdictions(): Promise<Jurisdiction[]> {
  const today = businessDate("UTC", Date.now());
  return (await rows<JurisdictionRow>(pool, "SELECT * FROM jurisdictions ORDER BY position")).map((j) => jurisdictionBody(j, today));
}

interface ListingRow {
  slug: string;
  name: string;
  jurisdiction_code: string;
  on_network: boolean;
  listed: boolean;
}

async function listedExchanges(all: Jurisdiction[]) {
  const byCode = new Map(all.map((j) => [j.code, j]));
  return (await rows<ListingRow>(pool, "SELECT * FROM listings WHERE listed ORDER BY position")).map((l) => {
    const j = byCode.get(l.jurisdiction_code)!;
    return { slug: l.slug, name: l.name, jurisdictionCode: l.jurisdiction_code, region: j.region, status: j.status,
      onNetwork: l.on_network };
  });
}

function filters(query: URLSearchParams): { region: string; status: string } {
  const region = query.get("region") ?? "";
  const status = query.get("status") ?? "";
  const fields: Record<string, string> = {};
  if (region && !(REGIONS as readonly string[]).includes(region)) fields.region = "Choose a published region.";
  if (status && !(RULE_STATUSES as readonly string[]).includes(status)) fields.status = "Choose a published rule status.";
  if (Object.keys(fields).length) throw refuse.invalid(fields);
  return { region, status };
}

const withdrawn = () => refuse.gone("listing_withdrawn", "This exchange has withdrawn its listing.");

export function registerPublic(router: Router): void {
  router.add("GET", "/api/public/stats", async () => {
    const all = await jurisdictions();
    const listed = await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM listings WHERE listed");
    return {
      status: 200,
      json: { jurisdictions: all.length, rulesInForce: all.filter((j) => j.status === "in_force").length, listedExchanges: listed!.n },
    };
  });

  router.add("GET", "/api/public/jurisdictions", async (ctx) => {
    const { region, status } = filters(ctx.query);
    const found = (await jurisdictions()).filter((j) => (!region || j.region === region) && (!status || j.status === status));
    return { status: 200, json: { jurisdictions: found } };
  });

  router.add("GET", "/api/public/jurisdictions/:code", async (ctx) => {
    const all = await jurisdictions();
    const jurisdiction = all.find((j) => j.code === ctx.params.code);
    if (!jurisdiction) throw refuse.notFound();
    const exchanges = (await listedExchanges(all)).filter((e) => e.jurisdictionCode === jurisdiction.code);
    return { status: 200, json: { jurisdiction, exchanges } };
  });

  router.add("GET", "/api/public/exchanges", async (ctx) => {
    const { region, status } = filters(ctx.query);
    const q = normaliseName(ctx.query.get("q") ?? "");
    const found = (await listedExchanges(await jurisdictions())).filter((e) =>
      (!region || e.region === region) && (!status || e.status === status) && normaliseName(e.name).includes(q));
    return { status: 200, json: { exchanges: found } };
  });

  router.add("GET", "/api/public/exchanges/:listingSlug", async (ctx) => {
    const listing = await one<ListingRow>(pool, "SELECT * FROM listings WHERE slug = $1", [ctx.params.listingSlug]);
    if (!listing) throw refuse.notFound();
    if (!listing.listed) throw withdrawn();
    const exchange = (await listedExchanges(await jurisdictions())).find((e) => e.slug === listing.slug);
    return { status: 200, json: { exchange } };
  });

  router.add("GET", "/api/w/:slug/listing", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer");
    const listing = await one<ListingRow>(pool, "SELECT * FROM listings WHERE workspace_slug = $1", [who.workspace.slug]);
    return { status: 200, json: { listing: { slug: listing!.slug, listed: listing!.listed } } };
  });

  router.add("PUT", "/api/w/:slug/listing", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer");
    const body = objectBody(ctx.json());
    if (typeof body.listed !== "boolean") throw refuse.invalid({ listed: "Send listed as true or false." });
    const listing = await one<ListingRow>(pool, "UPDATE listings SET listed = $2 WHERE workspace_slug = $1 RETURNING *",
      [who.workspace.slug, body.listed]);
    return { status: 200, json: { listing: { slug: listing!.slug, listed: listing!.listed } } };
  });
}

/** `/sitemap.xml` on the public URL: the home page, every jurisdiction and every listed exchange. */
export async function sitemap(): Promise<string> {
  const all = await jurisdictions();
  const exchanges = await listedExchanges(all);
  const paths = ["/", ...all.map((j) => `/jurisdictions/${j.code}`), ...exchanges.map((e) => `/exchanges/${e.slug}`)];
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    paths.map((p) => `  <url><loc>${escape(config.publicUrl + p)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

/** The HTTP status a public page route answers with, before the screen renders. */
export async function publicPageStatus(path: string): Promise<number> {
  const exchange = /^\/exchanges\/([^/]+)$/.exec(path);
  if (exchange) {
    const listing = await one<ListingRow>(pool, "SELECT * FROM listings WHERE slug = $1", [decodeURIComponent(exchange[1])]);
    return !listing ? 404 : listing.listed ? 200 : 410;
  }
  const jurisdiction = /^\/jurisdictions\/([^/]+)$/.exec(path);
  if (jurisdiction) {
    return (await one(pool, "SELECT 1 FROM jurisdictions WHERE code = $1", [decodeURIComponent(jurisdiction[1])])) ? 200 : 404;
  }
  return 0;
}
