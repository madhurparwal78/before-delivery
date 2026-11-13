import type { RequestCtx } from './dispatch.js';
import { errors } from '../platform/errors.js';
import { sendJson, sendHtml } from './plumbing.js';
import { escapeHtml } from '../domain/text.js';
import { londonToday } from '../domain/time.js';
import { config } from '../config.js';
import { htmlPageHeaders, pageHtml, resendFormHtml } from '../html/shell.js';

export async function careersRoute(ctx: RequestCtx, isApi: boolean, asOf: Date | null): Promise<void> {
  const discipline = ctx.query.get('discipline');
  const office = ctx.query.get('office');
  const region = ctx.query.get('region');
  const rows = await ctx.client.query<{
    slug: string;
    title: string;
    discipline: string;
    office: string;
    office_label: string;
    region: string;
    region_label: string;
    opened_at: Date;
  }>(
    `SELECT r.slug, r.title, r.discipline, r.office, o.label AS office_label,
            o.region AS region, g.label AS region_label, r.opened_at
     FROM requisitions r
     JOIN offices o ON o.slug = r.office
     JOIN regions g ON g.slug = o.region
     WHERE r.status = 'open'
       AND ($1::text IS NULL OR r.discipline = $1)
       AND ($2::text IS NULL OR r.office = $2)
       AND ($3::text IS NULL OR o.region = $3)
     ORDER BY r.opened_at DESC, r.title ASC`,
    [discipline, office, region],
  );
  const items = rows.rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    discipline: r.discipline,
    office: r.office,
    office_label: r.office_label,
    region: r.region,
    region_label: r.region_label,
    opened_at: new Date(r.opened_at).toISOString(),
  }));
  if (isApi) {
    sendJson(ctx.res, 200, { items }, ctx.rateHeaders);
    return;
  }
  const benefits = await benefitsForAll(ctx);
  const hasFilters = Boolean(discipline || office || region);
  const roleItems = items
    .map(
      (r) => `<article class="role-item" data-reveal="pending">
        <h2 class="role-title"><a href="/careers/${escapeHtml(r.slug)}" data-continuity="${escapeHtml(r.title)}">${escapeHtml(r.title)}</a></h2>
        <p class="role-meta">${escapeHtml(capitalize(r.discipline))} · ${escapeHtml(r.office_label)} · ${escapeHtml(r.region_label)}</p>
      </article>`,
    )
    .join('\n');
  const disciplines = ['research', 'engineering', 'policy', 'operations'];
  const offices = await ctx.client.query<{ slug: string; label: string; region: string }>(`SELECT slug, label, region FROM offices ORDER BY label`);
  const regions = await ctx.client.query<{ slug: string; label: string }>(`SELECT slug, label FROM regions ORDER BY label`);
  const filterForm = `<form class="filter-form" id="filter-form" method="get" action="/careers" aria-label="Filter roles">
    <label for="discipline">Discipline</label>
    <select id="discipline" name="discipline">
      <option value="">Any</option>
      ${disciplines.map((d) => `<option value="${d}"${discipline === d ? ' selected' : ''}>${capitalize(d)}</option>`).join('')}
    </select>
    <label for="office">Office</label>
    <select id="office" name="office">
      <option value="">Any</option>
      ${offices.rows.map((o) => `<option value="${escapeHtml(o.slug)}"${office === o.slug ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>
    <label for="region">Region</label>
    <select id="region" name="region">
      <option value="">Any</option>
      ${regions.rows.map((r) => `<option value="${escapeHtml(r.slug)}"${region === r.slug ? ' selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}
    </select>
    <button type="submit" class="button">Show roles</button>
  </form>`;
  const benefitsHtml = benefits
    .map(
      (b) => `<div class="benefit-row">
        <h3>${escapeHtml(b.label)}</h3>
        ${b.entry ? `<p class="mono benefit-date">In force from ${escapeHtml(b.entry.effective_from)}</p><p>${escapeHtml(b.entry.summary)}</p>` : '<p class="muted">No benefits entry in force yet.</p>'}
      </div>`,
    )
    .join('\n');
  const body = `<section class="careers">
    <h1 class="display">Careers</h1>
    ${filterForm}
    <div class="careers-list">
      ${items.length === 0 ? `<p class="empty">No open roles match these filters.</p>` : `<ol class="role-list">${roleItems}</ol>`}
    </div>
    <section class="benefits" aria-label="Benefits by region">
      <h2 class="section-heading">Benefits by region</h2>
      ${benefitsHtml}
    </section>
    ${resendFormHtml('careers')}
  </section>`;
  sendHtml(ctx.res, 200, pageHtml({
    title: 'Careers — Aldermoor Open Record',
    description: 'Open roles at Aldermoor Labs.',
    body,
    bodyClass: 'public careers',
  }), htmlPageHeaders(ctx.rateHeaders));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function benefitsForAll(ctx: RequestCtx): Promise<Array<{ region: string; label: string; entry: { id: string; effective_from: string; summary: string } | null }>> {
  const regions = await ctx.client.query<{ slug: string; label: string }>(`SELECT slug, label FROM regions ORDER BY slug`);
  const today = londonToday();
  const out: Array<{ region: string; label: string; entry: { id: string; effective_from: string; summary: string } | null }> = [];
  for (const region of regions.rows) {
    const entry = await benefitsInForce(ctx.client, region.slug, today);
    out.push({ region: region.slug, label: region.label, entry });
  }
  return out;
}

async function benefitsInForce(
  client: import('../platform/db.js').DbClient,
  region: string,
  today: string,
): Promise<{ id: string; effective_from: string; summary: string } | null> {
  const rows = await client.query<{ id: string; effective_from: string; summary: string }>(
    `SELECT id, effective_from, summary FROM benefits_entries
     WHERE region = $1 AND effective_from <= $2
     ORDER BY effective_from DESC LIMIT 1`,
    [region, today],
  );
  return rows.rows[0] ?? null;
}

export async function benefitsApi(ctx: RequestCtx): Promise<void> {
  const regions = await ctx.client.query<{ slug: string; label: string }>(`SELECT slug, label FROM regions ORDER BY slug`);
  const today = londonToday();
  const out = await Promise.all(
    regions.rows.map(async (r) => ({
      region: r.slug,
      label: r.label,
      entry: await benefitsInForce(ctx.client, r.slug, today),
    })),
  );
  sendJson(ctx.res, 200, { regions: out }, ctx.rateHeaders);
}

export async function roleRoute(ctx: RequestCtx, slug: string, isApi: boolean): Promise<void> {
  const rows = await ctx.client.query<{
    slug: string;
    title: string;
    discipline: string;
    office: string;
    office_label: string;
    region: string;
    region_label: string;
    description: string;
    opened_at: Date;
    status: string;
  }>(
    `SELECT r.slug, r.title, r.discipline, r.office, o.label AS office_label,
            o.region AS region, g.label AS region_label, r.description, r.opened_at, r.status
     FROM requisitions r
     JOIN offices o ON o.slug = r.office
     JOIN regions g ON g.slug = o.region
     WHERE r.slug = $1`,
    [slug],
  );
  const role = rows.rows[0];
  if (!role || role.status === 'draft') {
    throw errors.notFoundPublic();
  }
  if (role.status === 'closed') {
    if (isApi) {
      throw new (await import('../platform/errors.js')).ApiError(410, 'gone', 'This role has closed.');
    }
    const { gonePage } = await import('../html/shell.js');
    sendHtml(ctx.res, 410, gonePage('role'));
    return;
  }
  const today = londonToday();
  const benefits = await benefitsInForce(ctx.client, role.region, today);
  if (isApi) {
    sendJson(ctx.res, 200, {
      slug: role.slug,
      title: role.title,
      discipline: role.discipline,
      office: role.office,
      office_label: role.office_label,
      region: role.region,
      region_label: role.region_label,
      description: role.description,
      opened_at: new Date(role.opened_at).toISOString(),
      benefits,
    }, ctx.rateHeaders);
    return;
  }
  const body = `<div class="long-form role-page">
    <div class="sheet">
      <article class="article-body">
        <header class="article-head">
          <h1 class="display" id="page-heading" data-title="${escapeHtml(role.title)}">${escapeHtml(role.title)}</h1>
          <p class="role-meta">${capitalize(role.discipline)} · ${escapeHtml(role.office_label)} · ${escapeHtml(role.region_label)}</p>
        </header>
        <section class="article-section" data-reveal="pending" id="section-about">
          <h2 class="section-heading">About the role</h2>
          ${role.description.split(/\n\s*\n/).map((p) => `<p class="article-para">${escapeHtml(p)}</p>`).join('\n')}
        </section>
        <section class="article-section" data-reveal="pending" id="section-benefits">
          <h2 class="section-heading">Benefits in ${escapeHtml(role.region_label)}</h2>
          ${benefits ? `<p class="mono benefit-date">In force from ${escapeHtml(benefits.effective_from)}</p><p>${escapeHtml(benefits.summary)}</p>` : '<p class="muted">No benefits entry in force yet.</p>'}
        </section>
        <section class="article-section" data-reveal="pending" id="section-apply">
          <h2 class="section-heading">Apply</h2>
          <form class="application-form" id="application-form" method="post" enctype="multipart/form-data" aria-label="Apply for ${escapeHtml(role.title)}">
            <div class="field">
              <label for="app-name">Full name</label>
              <input type="text" id="app-name" name="name" autocomplete="name" required>
              <p class="field-error" hidden></p>
            </div>
            <div class="field">
              <label for="app-email">Email</label>
              <input type="email" id="app-email" name="email" autocomplete="email" required>
              <p class="field-error" hidden></p>
            </div>
            <div class="field">
              <label for="app-resume">Résumé (PDF)</label>
              <input type="file" id="app-resume" name="resume" accept="application/pdf,.pdf" required>
              <p class="field-error" hidden></p>
            </div>
            <div class="field checkbox-field">
              <label><input type="checkbox" name="consent" value="yes" required> I consent to Aldermoor Labs processing my application</label>
              <p class="field-error" hidden></p>
            </div>
            <button type="submit" class="button" id="submit-application">Submit application</button>
            <p class="status" id="application-status" role="status" aria-live="polite"></p>
          </form>
        </section>
      </article>
    </div>
  </div>`;
  sendHtml(ctx.res, 200, pageHtml({
    title: `${role.title} — Aldermoor Open Record`,
    description: role.description.slice(0, 160),
    body,
    bodyClass: 'public role-page',
    inlineData: JSON.stringify({ slug: role.slug }),
  }), htmlPageHeaders(ctx.rateHeaders));
}
