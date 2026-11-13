import { first, pool, rows } from "../db/pool";
import { isUnlocked } from "../domain/unlock";
import { publicReview, type ReviewRow } from "../domain/anonymity";
import { refuse } from "../http/fail";
import { defineRoute, type Handler } from "../http/route";
import { companyBySlug, companyView, type CompanyRecord } from "../services/companyView";
import { filterClause, search, SearchUnavailable } from "../services/search";
import { config } from "../config";
import { CITIES, type CityId } from "../../shared/reference";
import type { CompanyHit, CompanySearch } from "../../shared/api";
import type { Document } from "../services/search";
import { companyDocuments } from "../services/searchDocs";

const options = defineRoute({
  method: "GET",
  path: "/api/companies/options",
  auth: "public",
  async run(ctx) {
    const text = ctx.url.searchParams.get("q") ?? "";
    const found = await rows<{ id: string; name: string; city: CityId }>(
      `SELECT id, name, city FROM companies WHERE position(lower($1) in lower(name)) > 0 ORDER BY name LIMIT 8`,
      [text],
    );
    return { status: 200, body: { options: found } };
  },
});

export function toHit(document: Document): CompanyHit {
  return {
    slug: String(document["slug"]),
    name: String(document["name"]),
    city: document["city"] as CityId,
    city_name: String(document["city_name"]),
    size: String(document["size"]),
    verified: document["verified"] === true,
    rating: typeof document["rating"] === "number" ? document["rating"] : null,
    review_count: Number(document["review_count"]),
    pay_report_count: Number(document["pay_report_count"]),
  };
}

async function searchCompanies(text: string, cities: string[], page: number): Promise<CompanySearch> {
  try {
    const result = await search("companies", {
      q: text,
      filter: cities.length > 0 ? [filterClause("city", cities)] : [],
      facets: ["city"],
      page,
      hitsPerPage: config.limits.searchPageSize,
    });
    return {
      total: result.totalHits,
      page,
      page_size: config.limits.searchPageSize,
      hits: result.hits.map(toHit),
      facets: { city: result.facetDistribution["city"] ?? {} },
    };
  } catch (error) {
    if (!(error instanceof SearchUnavailable)) throw error;
    return byCity();
  }
}

/** Every company by city (cities in alphabetical order, companies by name), built from PostgreSQL. */
async function byCity(): Promise<CompanySearch> {
  const hits = (await companyDocuments()).map(toHit);
  const cities = CITIES.map((city) => ({
    city: city.id,
    city_name: city.name,
    companies: hits.filter((hit) => hit.city === city.id).sort((a, b) => a.name.localeCompare(b.name)),
  }))
    .filter((entry) => entry.companies.length > 0)
    .sort((a, b) => a.city_name.localeCompare(b.city_name))
    .map((entry) => ({ ...entry, total: entry.companies.length }));
  return { fallback: "by_city", cities };
}

const searchRoute = defineRoute({
  method: "GET",
  path: "/api/companies/search",
  auth: "public",
  async run(ctx) {
    const params = ctx.url.searchParams;
    const page = Math.max(1, Number(params.get("page")) || 1);
    return { status: 200, body: await searchCompanies(params.get("q") ?? "", params.getAll("city"), page) };
  },
});

const page = defineRoute<CompanyRecord>({
  method: "GET",
  path: "/api/companies/:slug",
  auth: "public",
  async load(ctx) {
    const company = await companyBySlug(pool, ctx.params["slug"] ?? "");
    if (!company) throw refuse("not_found");
    return company;
  },
  async run(ctx, company) {
    const unlocked = isUnlocked(ctx.viewer);
    const view = await companyView(pool, company, unlocked);
    return { status: 200, body: view };
  },
});

const reviewPage = defineRoute<ReviewRow>({
  method: "GET",
  path: "/api/companies/:slug/reviews/:id",
  auth: "public",
  async load(ctx) {
    const review = await first<ReviewRow>(
      `SELECT p.id, p.title, p.overall, p.work_life, p.pay, p.management, p.pros, p.cons, p.created_at,
              r.body AS reply_body, r.created_at AS reply_at, c.name AS company_name
         FROM posts p JOIN companies c ON c.id = p.company_id LEFT JOIN replies r ON r.review_id = p.id
        WHERE p.id = $1 AND c.slug = $2 AND p.kind = 'review' AND p.state = 'approved' AND p.deleted_at IS NULL`,
      [ctx.params["id"], ctx.params["slug"]],
    );
    if (!review) throw refuse("not_found");
    return review;
  },
  async run(ctx, review) {
    return { status: 200, body: publicReview(review, isUnlocked(ctx.viewer)) };
  },
});

export const companyRoutes: Handler[] = [options, searchRoute, page, reviewPage];
