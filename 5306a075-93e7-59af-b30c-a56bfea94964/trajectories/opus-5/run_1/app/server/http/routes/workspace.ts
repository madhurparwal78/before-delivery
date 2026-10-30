import type { Importance } from '../../../shared/types';
import { withTransaction } from '../../db';
import { NO_SUCH_RECORD, notFound } from '../../errors';
import { writeCsv } from '../../domain/csv';
import { formatTwoDecimals, IMPORTANCE_POINTS } from '../../domain/priority';
import {
  SEARCH_GROUP_LIMIT,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  buildSnippet,
  literalLikePattern,
} from '../../domain/search';
import { findCompany, listCompanies, loadCompanyRequests } from '../../repo/companies';
import { loadFeatureWorld, rankedFeatures } from '../../repo/features';
import { recordAudit } from '../../repo/session';
import { Router, requirePrincipal, type RequestContext } from '../kernel';
import { failField } from '../validate';

async function resolveCompany(ctx: RequestContext) {
  const principal = requirePrincipal(ctx);
  const company = await findCompany(ctx.db, principal.workspaceId, ctx.params.id);
  if (!company) throw notFound();
  return { principal, company };
}

export function registerWorkspaceRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/companies',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      return { status: 200, json: { companies: await listCompanies(ctx.db, principal.workspaceId) } };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/companies/:id',
    access: 'member',
    resolve: resolveCompany,
    handle: async (ctx, { company }) => ({
      status: 200,
      json: { company: { ...company, requests: await loadCompanyRequests(ctx.db, company.id) } },
    }),
  });

  router.add({
    method: 'POST',
    pattern: '/api/companies/:id/merge',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveCompany,
    handle: async (ctx, { principal, company }) => {
      const into = ctx.body.intoCompanyId;
      if (typeof into !== 'string' || into === '') failField('intoCompanyId', NO_SUCH_RECORD);
      if (into === company.id) failField('intoCompanyId', 'A company cannot merge into itself.');
      const target = await findCompany(ctx.db, principal.workspaceId, into);
      if (!target) failField('intoCompanyId', NO_SUCH_RECORD);

      await withTransaction(async (client) => {
        await client.query('UPDATE contacts SET company_id = $1 WHERE company_id = $2', [into, company.id]);
        await client.query('UPDATE company_domains SET company_id = $1 WHERE company_id = $2', [
          into,
          company.id,
        ]);
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'company.merge',
          'company',
          company.id,
          { intoCompanyId: into },
        );
        await client.query('DELETE FROM companies WHERE id = $1', [company.id]);
      });
      const merged = await findCompany(ctx.db, principal.workspaceId, into);
      return { status: 200, json: { company: merged } };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/search',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const query = (ctx.url.searchParams.get('q') ?? '').trim();
      if (query.length < SEARCH_MIN_LENGTH || query.length > SEARCH_MAX_LENGTH) {
        failField('q', `Search for ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`);
      }
      const pattern = literalLikePattern(query);

      const { rows: noteRows } = await ctx.db.query<{ id: string; title: string; text: string }>(
        `SELECT id, title, text FROM notes
          WHERE workspace_id = $1 AND (title ILIKE $2 ESCAPE '\\' OR text ILIKE $2 ESCAPE '\\')
          ORDER BY created_at DESC, id COLLATE "C" DESC
          LIMIT $3`,
        [principal.workspaceId, pattern, SEARCH_GROUP_LIMIT],
      );
      const { rows: companyRows } = await ctx.db.query<{ id: string; name: string; domains: string[] }>(
        `SELECT companies.id, companies.name,
                ARRAY(SELECT domain FROM company_domains
                        WHERE company_domains.company_id = companies.id ORDER BY domain) AS domains
           FROM companies
          WHERE companies.workspace_id = $1
            AND (companies.name ILIKE $2 ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM company_domains
                             WHERE company_domains.company_id = companies.id
                               AND company_domains.domain ILIKE $2 ESCAPE '\\'))
          ORDER BY lower(companies.name), companies.id
          LIMIT $3`,
        [principal.workspaceId, pattern, SEARCH_GROUP_LIMIT],
      );

      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      const needle = query.toLowerCase();
      const features = rankedFeatures(world)
        .filter(
          (feature) =>
            feature.name.toLowerCase().includes(needle) ||
            feature.publicDescription.toLowerCase().includes(needle),
        )
        .slice(0, SEARCH_GROUP_LIMIT)
        .map((feature) => ({
          id: feature.id,
          name: feature.name,
          insightCount: feature.insightCount,
          companyCount: feature.companyCount,
        }));

      return {
        status: 200,
        json: {
          notes: noteRows.map((row) => ({
            id: row.id,
            title: row.title,
            snippet: buildSnippet(row.text, query, !row.text.toLowerCase().includes(needle)),
          })),
          companies: companyRows.map((row) => ({ id: row.id, name: row.name, domains: row.domains ?? [] })),
          features,
        },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/exports/features.csv',
    access: 'member',
    roles: ['head_of_product'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      const { rows: placeRows } = await ctx.db.query<{
        feature_id: string;
        product_name: string;
        component_name: string;
        release_name: string | null;
        target_date: string | null;
      }>(
        `SELECT features.id AS feature_id, products.name AS product_name,
                components.name AS component_name, releases.name AS release_name, releases.target_date
           FROM features
           JOIN components ON components.id = features.component_id
           JOIN products ON products.id = components.product_id
           LEFT JOIN releases ON releases.id = features.release_id
          WHERE features.workspace_id = $1`,
        [principal.workspaceId],
      );
      const places = new Map(placeRows.map((row) => [row.feature_id, row]));

      const { rows: quoteRows } = await ctx.db.query<{
        feature_id: string;
        quote: string;
        importance: Importance;
      }>(
        `SELECT feature_id, quote, importance FROM insights
          WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC`,
        [principal.workspaceId],
      );
      const quoteRanks = new Map<string, { quote: string; points: number; order: number }[]>();
      quoteRows.forEach((row, index) => {
        const list = quoteRanks.get(row.feature_id) ?? [];
        list.push({ quote: row.quote, points: IMPORTANCE_POINTS[row.importance], order: index });
        quoteRanks.set(row.feature_id, list);
      });

      const header = [
        'rank',
        'feature',
        'product',
        'component',
        'status',
        'release',
        'target_month',
        'insight_count',
        'company_count',
        'impact',
        'effort',
        'confidence',
        'objective_fit',
        'priority',
        'top_quote_1',
        'top_quote_2',
        'top_quote_3',
      ];
      const rows = [header];
      for (const feature of rankedFeatures(world)) {
        const place = places.get(feature.id);
        const top = (quoteRanks.get(feature.id) ?? [])
          .sort((a, b) => b.points - a.points || a.order - b.order)
          .slice(0, 3)
          .map((entry) => entry.quote);
        rows.push([
          String(feature.rank ?? ''),
          feature.name,
          place?.product_name ?? '',
          place?.component_name ?? '',
          feature.status,
          place?.release_name ?? '',
          place?.target_date ? place.target_date.slice(0, 7) : '',
          String(feature.insightCount),
          String(feature.companyCount),
          String(feature.impact),
          String(feature.effort),
          String(feature.confidence),
          formatTwoDecimals(feature.objectiveFit),
          formatTwoDecimals(feature.priority),
          top[0] ?? '',
          top[1] ?? '',
          top[2] ?? '',
        ]);
      }

      return {
        status: 200,
        bytes: Buffer.from(writeCsv(rows), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': 'attachment; filename="evidence-desk-features.csv"' },
      };
    },
  });
}
