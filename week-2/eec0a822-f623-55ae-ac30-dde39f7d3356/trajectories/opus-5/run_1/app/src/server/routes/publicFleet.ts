import { config } from '../config.js';
import { query } from '../db.js';
import { notFound, validation, yachtWithdrawn } from '../http/errors.js';
import type { Ctx, Reply, Router } from '../http/router.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { findWorkspace, publicYachtJson, type YachtRow } from '../records.js';
import { availabilityWindow, type Season } from '../domain/weeks.js';
import { weekSummaries } from '../domain/holds.js';
import { weeklyRateMinor } from '../domain/pricing.js';
import { yachtRates } from '../records.js';
import { json, today } from './helpers.js';

async function health(): Promise<Reply> {
  return json(200, { status: 'ok' });
}

interface FleetFilters {
  readonly base: 'split' | 'lavrio' | null;
  readonly cabins: number | null;
  readonly season: Season | null;
  readonly week: string | null;
  readonly search: string;
}

function readFilters(ctx: Ctx, weeks: readonly string[]): FleetFilters {
  const errors: Record<string, string> = {};
  const raw = (name: string): string => (ctx.query.get(name) ?? '').trim();

  const baseValue = raw('base');
  let base: 'split' | 'lavrio' | null = null;
  if (baseValue !== '') {
    if (baseValue === 'split' || baseValue === 'lavrio') base = baseValue;
    else errors.base = FIELD_ERRORS.options;
  }

  const cabinsValue = raw('cabins');
  let cabins: number | null = null;
  if (cabinsValue !== '') {
    const parsed = Number.parseInt(cabinsValue, 10);
    if (['3', '4', '5', '6'].includes(cabinsValue)) cabins = parsed;
    else errors.cabins = FIELD_ERRORS.options;
  }

  const seasonValue = raw('season');
  let season: Season | null = null;
  if (seasonValue !== '') {
    if (seasonValue === 'low' || seasonValue === 'shoulder' || seasonValue === 'high') {
      season = seasonValue;
    } else errors.season = FIELD_ERRORS.options;
  }

  const weekValue = raw('week');
  let week: string | null = null;
  if (weekValue !== '') {
    if (weeks.includes(weekValue)) week = weekValue;
    else errors.week = FIELD_ERRORS.options;
  }

  const search = raw('q');
  if ([...search].length > 60) errors.q = FIELD_ERRORS.maxLength(60);

  if (Object.keys(errors).length > 0) throw validation(errors);
  return { base, cabins, season, week, search };
}

async function fleet(ctx: Ctx): Promise<Reply> {
  const workspace = await findWorkspace(ctx.params.ws);
  if (workspace === null) throw notFound();
  const weeks = availabilityWindow(today(ctx.now));
  const filters = readFilters(ctx, weeks);
  const yachts = await query<YachtRow>(
    `SELECT * FROM yachts WHERE workspace_id = $1 AND status = 'on_sale' ORDER BY name`,
    [workspace.id],
  );
  const needle = filters.search.toLowerCase();
  const matching: YachtRow[] = [];
  for (const yacht of yachts) {
    if (filters.base !== null && yacht.base !== filters.base) continue;
    if (filters.cabins !== null && yacht.cabins < filters.cabins) continue;
    if (needle !== '' && !yacht.name.toLowerCase().includes(needle)) continue;
    if (filters.week !== null) {
      const summaries = await weekSummaries(
        yacht.id,
        [filters.week],
        (season) => weeklyRateMinor(yachtRates(yacht), season as Season),
        yacht.currency,
        ctx.now,
      );
      if (summaries[0].status !== 'free') continue;
    }
    matching.push(yacht);
  }
  return json(200, {
    workspace: { slug: workspace.slug, name: workspace.name },
    yachts: matching.map(publicYachtJson),
  });
}

async function publicYacht(ctx: Ctx): Promise<Reply> {
  const workspace = await findWorkspace(ctx.params.ws);
  if (workspace === null) throw notFound();
  const yachts = await query<YachtRow>(
    'SELECT * FROM yachts WHERE workspace_id = $1 AND slug = $2',
    [workspace.id, ctx.params.yachtSlug],
  );
  if (yachts.length === 0) throw notFound();
  const yacht = yachts[0];
  if (yacht.status === 'withdrawn') throw yachtWithdrawn();
  const weeks = await weekSummaries(
    yacht.id,
    availabilityWindow(today(ctx.now)),
    (season) => weeklyRateMinor(yachtRates(yacht), season as Season),
    yacht.currency,
    ctx.now,
  );
  return json(200, {
    ...publicYachtJson(yacht),
    weeks: weeks.map((week) => ({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      status: week.status,
      season: week.season,
      weeklyRateMinor: week.weeklyRateMinor,
      currency: week.currency,
    })),
  });
}

async function sitemap(): Promise<Reply> {
  const workspaces = await query<{ slug: string }>('SELECT slug FROM workspaces ORDER BY slug');
  const yachts = await query<{ slug: string; workspace_slug: string }>(
    `SELECT y.slug, w.slug AS workspace_slug FROM yachts y JOIN workspaces w ON w.id = y.workspace_id
      WHERE y.status = 'on_sale' ORDER BY w.slug, y.slug`,
  );
  const locations = [
    ...workspaces.map((workspace) => `/fleet/${workspace.slug}`),
    ...yachts.map((yacht) => `/fleet/${yacht.workspace_slug}/${yacht.slug}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locations.map((location) => `  <url><loc>${config.appPublicUrl}${location}</loc></url>`).join('\n')}
</urlset>
`;
  return { status: 200, body, contentType: 'application/xml; charset=utf-8' };
}

export function registerPublicRoutes(router: Router): void {
  router.add('/api/health', { GET: health });
  router.add('/api/public/fleets/:ws', { GET: fleet });
  router.add('/api/public/fleets/:ws/yachts/:yachtSlug', { GET: publicYacht });
  router.add('/sitemap.xml', { GET: sitemap });
}
