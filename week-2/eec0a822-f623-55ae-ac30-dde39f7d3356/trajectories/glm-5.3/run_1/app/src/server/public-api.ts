import type { App } from './api.js';
import type { Ctx } from './http.js';
import { fieldErrors, notFound, yachtWithdrawn } from './errors.js';
import { isRecord, str, whole } from './validate.js';
import * as base from '../shared/bases.js';
import { weeksWindow } from './holds.js';
import { seasonOf, rateFor, crewFor, yachtProfile, type YachtDb } from './endpoints-holds.js';
import type { Season } from './types.js';

export async function publicFleet(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  const wsRows = await app.pool.query('SELECT slug, name FROM workspaces WHERE slug = $1', [ws]);
  const workspace = wsRows.rows[0];
  if (!workspace) throw notFound();
  const baseFilter = ctx.query.get('base') ?? '';
  const cabins = ctx.query.get('cabins') ?? '';
  const season = ctx.query.get('season') ?? '';
  const week = ctx.query.get('week') ?? '';
  const q = ctx.query.get('q') ?? '';
  const errors: Record<string, string> = {};
  if (baseFilter && !['split', 'lavrio'].includes(baseFilter)) errors.base = 'Choose one of the listed options.';
  if (cabins && !['3', '4', '5', '6'].includes(cabins)) errors.cabins = 'Choose one of the listed options.';
  if (season && !['low', 'shoulder', 'high'].includes(season)) errors.season = 'Choose one of the listed options.';
  if (week && !base.parseYmd(week)) errors.week = 'Enter a date as YYYY-MM-DD.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const rows = await app.pool.query<YachtDb>("SELECT * FROM yachts WHERE workspace_slug = $1 AND status = 'on_sale' ORDER BY name", [ws]);
  const splitToday = base.localDate('split', { ms: Date.now() });
  const weeks = weeksWindow('split', splitToday);
  const out = [];
  for (const y of rows.rows) {
    if (baseFilter && y.base !== baseFilter) continue;
    const cabinMin = cabins === '6' ? 6 : cabins ? Number(cabins) : 0;
    if (cabins && y.cabins < cabinMin) continue;
    if (season) {
      // A season filter keeps yachts that have a week of that season in the window.
      if (!weeks.some((w) => seasonOf(w) === season)) continue;
    }
    if (week) {
      // A week filter keeps yachts whose chosen week is free.
      const weekStatus = await weekStatusFor(app, y, week);
      if (weekStatus !== 'free') continue;
    }
    if (q && !y.name.toLowerCase().includes(q.toLowerCase())) continue;
    out.push({
      slug: y.slug,
      name: y.name,
      base: y.base,
      cabins: y.cabins,
      lengthM: Number(y.length_m),
      beamM: Number(y.beam_m),
      draftM: Number(y.draft_m),
      rates: { lowMinor: Number(y.low_minor), shoulderMinor: Number(y.shoulder_minor), highMinor: Number(y.high_minor) },
      currency: 'EUR',
    });
  }
  return { workspace: { slug: workspace.slug, name: workspace.name }, yachts: out };
}

async function weekStatusFor(app: App, yacht: YachtDb, weekStart: string): Promise<'free' | 'held' | 'booked' | null> {
  if (!base.isSaturday('split', weekStart)) return null;
  const charter = await app.pool.query('SELECT 1 FROM charters WHERE yacht_slug = $1 AND week_start = $2', [yacht.slug, weekStart]);
  if (charter.rowCount && charter.rowCount > 0) return 'booked';
  const hold = await app.pool.query("SELECT 1 FROM holds WHERE yacht_slug = $1 AND week_start = $2 AND status IN ('live','waiting')", [yacht.slug, weekStart]);
  if (hold.rowCount && hold.rowCount > 0) return 'held';
  return 'free';
}

export async function publicYacht(app: App, ctx: Ctx, ws: string, slug: string): Promise<unknown> {
  const wsRows = await app.pool.query('SELECT slug, name FROM workspaces WHERE slug = $1', [ws]);
  const workspace = wsRows.rows[0];
  if (!workspace) throw notFound();
  const rows = await app.pool.query<YachtDb>('SELECT * FROM yachts WHERE slug = $1 AND workspace_slug = $2', [slug, ws]);
  const yacht = rows.rows[0];
  if (!yacht) throw notFound();
  if (yacht.status === 'withdrawn') throw yachtWithdrawn();
  const splitToday = base.localDate('split', { ms: Date.now() });
  const weeks = weeksWindow('split', splitToday);
  const weeksOut = [];
  for (const w of weeks) {
    const season = seasonOf(w);
    weeksOut.push({
      weekStart: w,
      weekEnd: base.addDays(w, 7),
      status: await weekStatusFor(app, yacht, w),
      season,
      weeklyRateMinor: Number(rateFor(yacht, season)),
      currency: 'EUR',
    });
  }
  return {
    slug: yacht.slug,
    name: yacht.name,
    base: yacht.base,
    cabins: yacht.cabins,
    lengthM: Number(yacht.length_m),
    beamM: Number(yacht.beam_m),
    draftM: Number(yacht.draft_m),
    rates: { lowMinor: Number(yacht.low_minor), shoulderMinor: Number(yacht.shoulder_minor), highMinor: Number(yacht.high_minor) },
    currency: 'EUR',
    weeks: weeksOut,
  };
}

export async function sitemap(app: App, ctx: Ctx): Promise<unknown> {
  const wsRows = await app.pool.query('SELECT slug FROM workspaces ORDER BY slug');
  const urls: string[] = [];
  for (const w of wsRows.rows) {
    urls.push(`/fleet/${w.slug}`);
    const yachtRows = await app.pool.query("SELECT slug FROM yachts WHERE workspace_slug = $1 AND status = 'on_sale' ORDER BY slug", [w.slug]);
    for (const y of yachtRows.rows) urls.push(`/fleet/${w.slug}/${y.slug}`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  ctx.res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  ctx.res.end(xml);
  return undefined;
}
