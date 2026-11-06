import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, type Ctx } from './http.js';
import { config } from '../config.js';
import { normaliseName } from '../domain/names.js';

const REGIONS = ['europe', 'asia_pacific', 'middle_east', 'americas', 'africa'];
const STATUSES = ['in_force', 'announced', 'no_rule'];

export async function stats(): Promise<Response> {
  const jurisdictions = await query<{ n: string }>('SELECT count(*) AS n FROM jurisdictions');
  const rules = await query<{ n: string }>('SELECT count(*) AS n FROM jurisdiction_rules WHERE threshold_cents IS NOT NULL AND in_force_since IS NOT NULL');
  const exchanges = await query<{ n: string }>('SELECT count(*) AS n FROM listings WHERE listed = true');
  return jsonOk({ jurisdictions: Number(jurisdictions.rows[0].n), rulesInForce: Number(rules.rows[0].n), listedExchanges: Number(exchanges.rows[0].n) });
}

async function jurisdictionRows(): Promise<Record<string, unknown>[]> {
  const r = await query(`SELECT j.code, j.name, j.region, j.currency, r.threshold_cents,
      to_char(r.in_force_since, 'YYYY-MM-DD') AS in_force_since,
      r.change_threshold_cents, to_char(r.change_takes_effect_on, 'YYYY-MM-DD') AS change_takes_effect_on
      FROM jurisdictions j JOIN jurisdiction_rules r ON r.code = j.code ORDER BY j.code`);
  return r.rows.map((row) => ({
    code: row.code,
    name: row.name,
    region: row.region,
    currency: row.currency,
    status: row.threshold_cents === null || row.in_force_since === null ? (row.change_threshold_cents !== null ? 'announced' : 'no_rule') : 'in_force',
    thresholdCents: row.threshold_cents === null ? null : Number(row.threshold_cents),
    inForceSince: row.in_force_since === null ? null : row.in_force_since,
    announcedChange: row.change_threshold_cents !== null ? { thresholdCents: Number(row.change_threshold_cents), takesEffectOn: row.change_takes_effect_on } : null,
  }));
}

export async function jurisdictions(ctx: Ctx): Promise<Response> {
  const region = ctx.query.get('region') ?? '';
  const status = ctx.query.get('status') ?? '';
  if (region !== '' && !REGIONS.includes(region)) throw errors.invalid({ region: 'Choose a region.' });
  if (status !== '' && !STATUSES.includes(status)) throw errors.invalid({ status: 'Choose a status.' });
  const all = await jurisdictionRows();
  const filtered = all.filter((j) => (region === '' || j.region === region) && (status === '' || j.status === status));
  return jsonOk({ jurisdictions: filtered });
}

export async function jurisdiction(ctx: Ctx): Promise<Response> {
  const all = await jurisdictionRows();
  const found = all.find((j) => j.code === ctx.params.code);
  if (found === undefined) throw errors.notFound();
  const exchanges = await query<{ slug: string; name: string; jurisdiction_code: string; on_network: boolean }>('SELECT slug, name, jurisdiction_code, on_network FROM listings WHERE jurisdiction_code = $1 AND listed = true ORDER BY name', [ctx.params.code]);
  const region = (found as { region: string }).region;
  return jsonOk({
    jurisdiction: found,
    exchanges: exchanges.rows.map((x) => ({ slug: x.slug, name: x.name, jurisdictionCode: x.jurisdiction_code, region, status: found.status, onNetwork: x.on_network })),
  });
}

export async function exchanges(ctx: Ctx): Promise<Response> {
  const q = ctx.query.get('q') ?? '';
  const region = ctx.query.get('region') ?? '';
  const status = ctx.query.get('status') ?? '';
  if (region !== '' && !REGIONS.includes(region)) throw errors.invalid({ region: 'Choose a region.' });
  if (status !== '' && !STATUSES.includes(status)) throw errors.invalid({ status: 'Choose a status.' });
  const jByCode = new Map<string, Record<string, unknown>>();
  for (const j of await jurisdictionRows()) jByCode.set(j.code as string, j);
  const rows = await query<{ slug: string; name: string; jurisdiction_code: string; on_network: boolean }>('SELECT slug, name, jurisdiction_code, on_network FROM listings WHERE listed = true ORDER BY name');
  const filtered = rows.rows.filter((row) => {
    const j = jByCode.get(row.jurisdiction_code);
    if (j === undefined) return false;
    if (region !== '' && j.region !== region) return false;
    if (status !== '' && j.status !== status) return false;
    if (q !== '' && !normaliseName(row.name).includes(normaliseName(q))) return false;
    return true;
  });
  return jsonOk({
    exchanges: filtered.map((row) => ({
      slug: row.slug,
      name: row.name,
      jurisdictionCode: row.jurisdiction_code,
      region: jByCode.get(row.jurisdiction_code)?.region,
      status: jByCode.get(row.jurisdiction_code)?.status,
      onNetwork: row.on_network,
    })),
  });
}

export async function exchange(ctx: Ctx): Promise<Response> {
  const row = await query<{ slug: string; name: string; jurisdiction_code: string; on_network: boolean; listed: boolean }>('SELECT slug, name, jurisdiction_code, on_network, listed FROM listings WHERE slug = $1', [ctx.params.slug]);
  if (row.rows.length === 0) throw errors.notFound();
  const listing = row.rows[0];
  if (!listing.listed) throw errors.listingWithdrawn();
  const all = await jurisdictionRows();
  const j = all.find((x) => x.code === listing.jurisdiction_code);
  return jsonOk({ exchange: { slug: listing.slug, name: listing.name, jurisdictionCode: listing.jurisdiction_code, region: j?.region, status: j?.status, onNetwork: listing.on_network } });
}

export async function sitemap(): Promise<Response> {
  const pages: string[] = [`${config.publicUrl}/`];
  for (const j of await jurisdictionRows()) pages.push(`${config.publicUrl}/jurisdictions/${j.code}`);
  const listings = await query('SELECT slug FROM listings WHERE listed = true ORDER BY slug');
  for (const l of listings.rows) pages.push(`${config.publicUrl}/exchanges/${l.slug}`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${p}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
