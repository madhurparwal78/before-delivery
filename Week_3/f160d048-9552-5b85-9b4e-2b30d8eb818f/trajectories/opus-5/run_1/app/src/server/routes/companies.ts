import { CITIES, cityName, type CityId } from '../../shared/reference';
import { config } from '../config';
import { db } from '../db/pool';
import {
  approvedReviews,
  companyHit,
  findCompanyBySlug,
  projectCompany,
  projectReview,
  viewerUnlocked,
  type CompanyHit,
  type CompanyRow,
} from '../domain/projection';
import { ApiError } from '../errors';
import type { Context } from '../http/context';
import type { Router } from '../http/router';
import { runSearch, type CompanyDocument } from '../services/search';

function toHit(document: CompanyDocument): CompanyHit {
  return {
    slug: document.slug,
    name: document.name,
    city: document.city,
    city_name: document.city_name,
    size: document.size,
    verified: document.verified,
    rating: document.rating,
    review_count: document.review_count,
    pay_report_count: document.pay_report_count,
  };
}

async function allCompanyRows(): Promise<CompanyRow[]> {
  return db.query<CompanyRow>(
    'SELECT id, slug, name, city, size, verified, email_domain, mark_file_id FROM companies ORDER BY name',
  );
}

async function byCityFallback(): Promise<unknown> {
  const rows = await allCompanyRows();
  const hits = new Map<string, CompanyHit[]>();
  for (const row of rows) {
    const list = hits.get(row.city) ?? [];
    list.push(await companyHit(row));
    hits.set(row.city, list);
  }
  const cities = [...CITIES]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((city) => (hits.get(city.id) ?? []).length > 0)
    .map((city) => {
      const companies = (hits.get(city.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      return { city: city.id, city_name: city.name, total: companies.length, companies };
    });
  return { fallback: 'by_city', cities };
}

async function requireCompany(slug: string): Promise<CompanyRow> {
  const company = await findCompanyBySlug(slug);
  if (!company) throw new ApiError('not_found');
  return company;
}

export function registerCompanyRoutes(router: Router): void {
  router.get('/api/companies/options', async (ctx: Context) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    const rows = await db.query<{ id: string; name: string; city: CityId }>(
      `SELECT id, name, city FROM companies WHERE name ILIKE $1 ORDER BY name LIMIT 8`,
      [`%${q}%`],
    );
    return { options: rows.map((row) => ({ id: row.id, name: row.name, city: cityName(row.city) })) };
  });

  router.get('/api/companies/search', async (ctx: Context) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    const cities = ctx.url.searchParams.getAll('city');
    const page = Math.max(1, Number(ctx.url.searchParams.get('page') ?? '1') || 1);
    try {
      const outcome = await runSearch<CompanyDocument>('companies', {
        q,
        filters: [cities.map((city) => `city = "${city}"`)],
        facets: ['city'],
        page,
        pageSize: config.searchPageSize,
      });
      return {
        total: outcome.total,
        page,
        page_size: config.searchPageSize,
        hits: outcome.hits.map(toHit),
        facets: { city: outcome.facets['city'] ?? {} },
      };
    } catch {
      return byCityFallback();
    }
  });

  router.get('/api/companies/:slug', async (ctx: Context) => {
    const company = await requireCompany(ctx.param('slug'));
    return projectCompany(company, ctx.user);
  });

  router.get('/api/companies/:slug/reviews/:id', async (ctx: Context) => {
    const company = await requireCompany(ctx.param('slug'));
    const reviews = await approvedReviews(company.id);
    const review = reviews.find((row) => row.id === ctx.param('id'));
    if (!review) throw new ApiError('not_found');
    return projectReview(review, company.name, viewerUnlocked(ctx.user));
  });
}
