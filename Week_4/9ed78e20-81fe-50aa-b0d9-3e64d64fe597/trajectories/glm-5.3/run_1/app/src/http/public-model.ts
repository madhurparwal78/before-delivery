import type { RequestCtx } from './dispatch.js';
import { errors, ApiError } from '../platform/errors.js';
import { sendJson, sendHtml, sendBytes } from './plumbing.js';
import { escapeHtml } from '../domain/text.js';
import { formatLondon, parseStrictInstant } from '../domain/time.js';
import { config } from '../config.js';
import { htmlPageHeaders, pageHtml, publicationTimesHtml, readTimeHtml, asOfBanner, notFoundPage, gonePage, resendFormHtml } from '../html/shell.js';
import { chartGroupsFor, getContentById, claimViewsFor, type ContentRow } from './content.js';
import type { ClaimView, RowView } from '../domain/lifecycles.js';
import { getObject, storageStatus } from '../platform/storage.js';
import { jsonMaxBytes } from './dispatch.js';

export async function modelRoute(
  ctx: RequestCtx,
  slug: string,
  asOf: Date | null,
  isApi: boolean,
): Promise<void> {
  const content = await findPublishedContent(ctx, slug, 'model', asOf);
  if (!content) {
    if (asOf) {
      throw errors.notFoundPublic();
    }
    const rows = await ctx.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM content_items c
       JOIN publication_history ph ON ph.content_id = c.id
       WHERE c.slug = $1 AND c.kind = 'model' AND ph.published_at IS NOT NULL`,
      [slug],
    );
    if ((rows.rows[0]?.n ?? 0) > 0) {
      if (isApi) throw new ApiError(410, 'gone', 'This item has been withdrawn.');
      sendHtml(ctx.res, 410, gonePage('model'), htmlPageHeaders(ctx.rateHeaders));
      return;
    }
    if (isApi) throw errors.notFoundPublic();
    sendHtml(ctx.res, 404, notFoundPage('generic'), htmlPageHeaders(ctx.rateHeaders));
    return;
  }
  const groups = await chartGroupsFor(ctx.client, content.id ? content.slug : slug);
  const rows: RowView[] = groups.flatMap((g) => g.rows);
  const claims = claimViewsFor(content, rows);
  const storageOk = storageStatus();
  const sampleRows = storageOk
    ? await ctx.client.query<{ sample_id: string; kind: string; title: string; files: string[] }>(
        `SELECT sample_id, kind, title, files FROM samples WHERE model_slug = $1 ORDER BY sample_id`,
        [content.slug],
      )
    : { rows: [] as Array<{ sample_id: string; kind: string; title: string; files: string[] }> };
  const samples = sampleRows.rows.map((s) => ({
    id: s.sample_id,
    kind: s.kind as 'audio' | 'image_sequence',
    title: s.title,
    urls: (Array.isArray(s.files) ? s.files : []).map(
      (f) => `/media/samples/${content.slug}/${s.sample_id}/${f}`,
    ),
  }));
  let linkedNews: { slug: string; title: string } | null = null;
  if (content.linked_news_slug) {
    const linked = await findPublishedContent(ctx, content.linked_news_slug, 'news', asOf);
    if (linked) linkedNews = { slug: linked.slug, title: linked.title };
  }
  if (isApi) {
    const payload: Record<string, unknown> = {
      slug: content.slug,
      title: content.title,
      summary: content.summary,
      published_at: content.published_at ? new Date(content.published_at).toISOString() : null,
      read_time_minutes: content.read_time_minutes,
      organisation: 'Aldermoor Labs',
      sections: parseSections(content.body).map((s) => ({ id: s.id, heading: s.heading })),
      body: content.body,
      claims,
      rows: rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        subject_name: r.subject_name,
        organisation: r.organisation,
        benchmark: r.benchmark,
        eval_date: r.eval_date,
        score: r.score,
      })),
      samples,
      linked_news: linkedNews,
    };
    if (!storageOk) {
      payload.samples = [];
      payload.samples_available = false;
    }
    if (asOf) payload.as_of = asOf.toISOString();
    sendJson(ctx.res, 200, payload, ctx.rateHeaders);
    return;
  }
  sendHtml(ctx.res, 200, modelRouteHtml(content, groups, claims, samples, linkedNews, storageOk, asOf), ctx.rateHeaders);
}

function parseSections(body: string): Array<{ id: string; heading: string }> {
  const out: Array<{ id: string; heading: string }> = [];
  for (const line of body.split('\n')) {
    const m = /^## (.+)$/.exec(line);
    if (m) {
      out.push({ id: slugifyHeading(m[1]), heading: m[1] });
    }
  }
  return out;
}

function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderBody(body: string, claims: ClaimView[]): string {
  const paragraphs = body.split(/\n\s*\n/);
  const out: string[] = [];
  let currentSection: { id: string; heading: string } | null = null;
  let open = false;
  const claimIndexById = new Map(claims.map((c) => [c.id, c]));
  for (const paragraph of paragraphs) {
    const headingMatch = /^## (.+)$/.exec(paragraph.trim());
    if (headingMatch) {
      if (open) out.push('</section>');
      currentSection = { id: slugifyHeading(headingMatch[1]), heading: headingMatch[1] };
      out.push(`<section class="article-section" id="section-${currentSection.id}" data-reveal="pending">`);
      out.push(`<h2 class="section-heading">${escapeHtml(currentSection.heading)}</h2>`);
      open = true;
      continue;
    }
    const html = renderParagraph(paragraph, claimIndexById);
    if (html) out.push(html);
  }
  if (open) out.push('</section>');
  return out.join('\n');
}

function renderParagraph(text: string, claims: Map<string, ClaimView>): string {
  const markerRe = /\[claim:([^\]]+)\]/g;
  let html = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text)) !== null) {
    const claim = claims.get(m[1]);
    html += escapeHtml(text.slice(last, m.index));
    if (claim) {
      html += ` <span class="claim-text">${escapeHtml(claim.text)}</span> <button type="button" class="claim-marker" id="claim-${escapeHtml(claim.id)}" data-claim-id="${escapeHtml(claim.id)}" data-claim-number="${claim.number}" aria-pressed="false" aria-label="Claim ${claim.number}">Claim ${claim.number}</button>`;
    }
    last = m.index + m[0].length;
  }
  html += escapeHtml(text.slice(last));
  const trimmed = html.trim();
  return trimmed ? `<p class="article-para">${trimmed}</p>` : '';
}

function modelRouteHtml(
  content: ContentRow,
  groups: Array<{ benchmark: string; eval_date: string; rows: RowView[] }>,
  claims: ClaimView[],
  samples: Array<{ id: string; kind: string; title: string; urls: string[] }>,
  linkedNews: { slug: string; title: string } | null,
  storageOk: boolean,
  asOf: Date | null,
): string {
  const banner = asOf ? asOfBanner(asOf, `/models/${content.slug}`) : '';
  const sections = parseSections(content.body);
  const rail = sections
    .map((s) => `<a class="section-rail-link" href="#section-${s.id}">${escapeHtml(s.heading)}</a>`)
    .join('\n');
  const chartGroupsHtml = groups
    .map((group) => {
      const bars = group.rows
        .map((row) => {
          const width = Math.max(2, Math.round(Number.parseFloat(row.score)));
          return `<div class="bar-row" data-row-id="${row.id}" data-cited="true">
            <span class="bar-label">${escapeHtml(row.subject_name)} <span class="mono score">${escapeHtml(row.score)}</span></span>
            <span class="bar-track"><span class="bar-fill" style="width: ${width}%"></span></span>
            <a class="bar-link mono" href="#row-${row.id}" aria-label="Row for ${escapeHtml(row.subject_name)}">${escapeHtml(row.benchmark)}</a>
          </div>`;
        })
        .join('\n');
      return `<div class="chart-group">
        <h3 class="chart-group-heading">${escapeHtml(group.benchmark)} <span class="mono">${escapeHtml(group.eval_date)}</span></h3>
        ${bars}
      </div>`;
    })
    .join('\n');
  const deltaLabel = `<span class="tether-delta mono" data-tether-delta="true" id="tether-delta"></span>`;
  const rowsHtml = groups
    .flatMap((g) => g.rows)
    .map(
      (row) => `<tr id="row-${row.id}">
        <th scope="row">${escapeHtml(row.subject_name)}</th>
        <td>${escapeHtml(row.organisation)}</td>
        <td><a class="row-link" href="#row-${row.id}">${escapeHtml(row.benchmark)}</a></td>
        <td class="mono">${escapeHtml(row.eval_date)}</td>
        <td class="mono"><a href="#row-${row.id}">${escapeHtml(row.score)}</a></td>
      </tr>`,
    )
    .join('\n');
  const samplesHtml = storageOk
    ? samples.length === 0
      ? `<p class="muted">No samples recorded for this model.</p>`
      : samples
          .map((sample) => {
            if (sample.kind === 'audio') {
              return `<div class="sample" data-sample-id="${escapeHtml(sample.id)}">
                <h3 class="sample-title">${escapeHtml(sample.title)}</h3>
                <audio preload="none" src="${sample.urls[0]}"></audio>
                <button type="button" class="sample-button" data-audio="${escapeHtml(sample.id)}" data-action="play">Play ${escapeHtml(sample.title)}</button>
                <button type="button" class="sample-button" data-audio="${escapeHtml(sample.id)}" data-action="pause" hidden>Pause ${escapeHtml(sample.title)}</button>
              </div>`;
            }
            return `<div class="sample" data-sample-id="${escapeHtml(sample.id)}" data-model-slug="${escapeHtml(content.slug)}" data-frame-urls="${escapeHtml(sample.urls.join(' '))}">
              <h3 class="sample-title">${escapeHtml(sample.title)}</h3>
              <img class="sample-frame" src="${sample.urls[0]}" alt="${escapeHtml(sample.title)} frame 1" data-frame-index="0" tabindex="0">
              <div class="sample-controls">
                <button type="button" class="sample-button" data-sequence="${escapeHtml(sample.id)}" data-action="prev">Previous frame</button>
                <button type="button" class="sample-button" data-sequence="${escapeHtml(sample.id)}" data-action="next">Next frame</button>
              </div>
              <p class="status frame-status" role="status" data-frame-status>Frame 1 of ${sample.urls.length}</p>
            </div>`;
          })
          .join('\n')
    : `<p class="muted">Samples are unavailable right now. The recorded benchmarks above are unaffected.</p>`;
  const body = `${banner}<div class="long-form model-route">
    <div class="sheet">
      <aside class="section-rail" aria-label="Sections">
        <nav class="section-rail-nav" aria-label="Sections">
          <h2 class="rail-heading">Sections</h2>
          ${rail}
          <a class="section-rail-link" href="#recorded-rows">How we evaluated it</a>
          <a class="section-rail-link" href="#samples">Samples</a>
        </nav>
      </aside>
      <article class="article-body">
        <header class="article-head">
          <h1 class="display" id="page-heading" data-title="${escapeHtml(content.title)}">${escapeHtml(content.title)}</h1>
          <p class="article-summary">${escapeHtml(content.summary)}</p>
          <p class="article-meta">${readTimeHtml(content.read_time_minutes)} · ${publicationTimesHtml(content.published_at as Date)}</p>
        </header>
        ${renderBody(content.body, claims)}
        <figure class="benchmark-chart" id="benchmark-results" data-entered="false">
          <figcaption class="chart-caption">Benchmark results</figcaption>
          <div class="chart-canvas">
            ${chartGroupsHtml}
            ${deltaLabel}
          </div>
          <span class="tether-line" id="tether-line" data-tether-line="" aria-hidden="true" hidden></span>
          <span class="tether-bracket" id="tether-bracket" data-tether-line="" aria-hidden="true" hidden>Claim</span>
        </figure>
        <section class="eval-rows" id="recorded-rows">
          <h2 class="section-heading">Recorded evaluation rows</h2>
          <div class="table-wrap">
            <table class="rows-table">
              <caption class="visually-hidden">Recorded evaluation rows</caption>
              <thead><tr><th scope="col">Model</th><th scope="col">Organisation</th><th scope="col">Benchmark</th><th scope="col">Evaluation date</th><th scope="col">Score</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </section>
        <section class="samples" id="samples" aria-label="Samples">
          <h2 class="section-heading">Samples</h2>
          ${samplesHtml}
        </section>
        ${linkedNews ? `<p class="linked-news">Announcement: <a href="/news/${escapeHtml(linkedNews.slug)}">${escapeHtml(linkedNews.title)}</a></p>` : ''}
        <p class="status tether-status" id="claim-tether-status" role="status" aria-live="polite" aria-label="Claim tether"></p>
      </article>
    </div>
  </div>`;
  return pageHtml({
    title: `${content.title} — Aldermoor Open Record`,
    description: content.summary,
    body,
    bodyClass: 'public model-route',
    inlineData: JSON.stringify({ claims, rows: groups.flatMap((g) => g.rows) }),
  });
}

async function findPublishedContent(
  ctx: RequestCtx,
  slug: string,
  kind: 'model' | 'news',
  asOf: Date | null,
): Promise<ContentRow | null> {
  if (asOf) {
    // Reading as of an instant never shows a withdrawn item.
    const rows = await ctx.client.query<ContentRow & { tags: unknown; claims: unknown }>(
      `SELECT c.* FROM content_items c
       JOIN publication_history ph ON ph.content_id = c.id
       WHERE c.slug = $1 AND c.kind = $2
         AND ph.published_at IS NOT NULL AND ph.published_at <= $3
         AND ph.withdrawn_at IS NULL`,
      [slug, kind, asOf.toISOString()],
    );
    const row = rows.rows[0];
    if (!row) return null;
    return normalizeContentRow(row);
  }
  const rows = await ctx.client.query<ContentRow & { tags: unknown; claims: unknown; withdrawn_at: Date | null; published_at2: Date | null }>(
    `SELECT c.*, ph.withdrawn_at FROM content_items c
     LEFT JOIN publication_history ph ON ph.content_id = c.id
     WHERE c.slug = $1 AND c.kind = $2`,
    [slug, kind],
  );
  const row = rows.rows[0];
  if (!row) return null;
  if (!row.published_at) return null;
  if (row.withdrawn_at) return null;
  return normalizeContentRow(row);
}

function normalizeContentRow(row: ContentRow & { tags: unknown; claims: unknown }): ContentRow {
  return {
    ...row,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
    claims: Array.isArray(row.claims) ? (row.claims as ContentRow['claims']) : null,
  };
}

export async function newsPostRoute(
  ctx: RequestCtx,
  slug: string,
  asOf: Date | null,
  isApi: boolean,
): Promise<void> {
  const content = await findPublishedContent(ctx, slug, 'news', asOf);
  if (!content) {
    if (asOf) {
      throw errors.notFoundPublic();
    }
    const rows = await ctx.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM content_items c
       JOIN publication_history ph ON ph.content_id = c.id
       WHERE c.slug = $1 AND c.kind = 'news' AND ph.published_at IS NOT NULL`,
      [slug],
    );
    if ((rows.rows[0]?.n ?? 0) > 0) {
      if (isApi) throw new ApiError(410, 'gone', 'This item has been withdrawn.');
      sendHtml(ctx.res, 410, gonePage('post'), htmlPageHeaders(ctx.rateHeaders));
      return;
    }
    if (isApi) throw errors.notFoundPublic();
    sendHtml(ctx.res, 404, notFoundPage('generic'), htmlPageHeaders(ctx.rateHeaders));
    return;
  }
  let linkedModel: { slug: string; title: string } | null = null;
  const modelRows = await ctx.client.query<{ slug: string; title: string }>(
    `SELECT slug, title FROM content_items WHERE kind = 'model' AND linked_news_slug = $1 AND status = 'published'`,
    [content.slug],
  );
  if (modelRows.rows.length > 0) {
    linkedModel = { slug: modelRows.rows[0].slug, title: modelRows.rows[0].title };
  }
  if (isApi) {
    const payload: Record<string, unknown> = {
      slug: content.slug,
      title: content.title,
      summary: content.summary,
      subject: content.subject,
      tags: content.tags ?? [],
      published_at: content.published_at ? new Date(content.published_at).toISOString() : null,
      read_time_minutes: content.read_time_minutes,
      body: content.body,
      linked_model: linkedModel,
    };
    if (asOf) payload.as_of = asOf.toISOString();
    sendJson(ctx.res, 200, payload, ctx.rateHeaders);
    return;
  }
  const banner = asOf ? asOfBanner(asOf, `/news/${content.slug}`) : '';
  const body = `${banner}<div class="long-form news-post">
    <div class="sheet">
      <article class="article-body">
        <header class="article-head">
          <h1 class="display" id="page-heading" data-title="${escapeHtml(content.title)}">${escapeHtml(content.title)}</h1>
          <p class="article-summary">${escapeHtml(content.summary)}</p>
          <p class="article-meta">${escapeHtml((content.subject ?? '').replace(/^\w/, (c) => c.toUpperCase()))}${(content.tags ?? []).length > 0 ? ` · ${(content.tags ?? []).map(escapeHtml).join(', ')}` : ''} · ${readTimeHtml(content.read_time_minutes)} · ${publicationTimesHtml(content.published_at as Date)}</p>
        </header>
        ${renderBody(content.body, [])}
        ${linkedModel ? `<p class="linked-model">Model route: <a href="/models/${escapeHtml(linkedModel.slug)}">${escapeHtml(linkedModel.title)}</a></p>` : ''}
      </article>
    </div>
  </div>`;
  sendHtml(ctx.res, 200, pageHtml({
    title: `${content.title} — Aldermoor Open Record`,
    description: content.summary,
    body,
    bodyClass: 'public news-post',
  }), htmlPageHeaders(ctx.rateHeaders));
}

export async function feedRoute(ctx: RequestCtx): Promise<void> {
  const rows = await ctx.client.query<{ slug: string; title: string; summary: string; published_at: Date }>(
    `SELECT slug, title, summary, published_at FROM content_items
     WHERE kind = 'news' AND status = 'published' ORDER BY published_at DESC`,
  );
  const updated = rows.rows.length > 0 ? new Date(rows.rows[0].published_at).toISOString() : '2026-01-01T00:00:00Z';
  const entries = rows.rows
    .map(
      (r) => `<entry>
  <id>${config.publicBaseUrl}/news/${escapeHtml(r.slug)}</id>
  <title>${escapeHtml(r.title)}</title>
  <link href="${config.publicBaseUrl}/news/${escapeHtml(r.slug)}"/>
  <updated>${new Date(r.published_at).toISOString()}</updated>
  <summary>${escapeHtml(r.summary)}</summary>
</entry>`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Aldermoor Labs Open Record</title>
  <link href="${config.publicBaseUrl}/"/>
  <id>${config.publicBaseUrl}/</id>
  <updated>${updated}</updated>
${entries}
</feed>`;
  sendBytes(ctx.res, 200, Buffer.from(xml, 'utf8'), 'application/atom+xml; charset=utf-8', ctx.rateHeaders);
}

export async function sitemapRoute(ctx: RequestCtx): Promise<void> {
  const models = await ctx.client.query<{ slug: string }>(
    `SELECT slug FROM content_items WHERE kind = 'model' AND status = 'published'`,
  );
  const news = await ctx.client.query<{ slug: string }>(
    `SELECT slug FROM content_items WHERE kind = 'news' AND status = 'published'`,
  );
  const roles = await ctx.client.query<{ slug: string }>(
    `SELECT slug FROM requisitions WHERE status = 'open'`,
  );
  const locs = [
    '/',
    '/models',
    '/news',
    '/search',
    '/careers',
    ...models.rows.map((r) => `/models/${r.slug}`),
    ...news.rows.map((r) => `/news/${r.slug}`),
    ...roles.rows.map((r) => `/careers/${r.slug}`),
  ];
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `  <url><loc>${config.publicBaseUrl}${loc}</loc></url>`).join('\n')}
</urlset>`;
  sendBytes(ctx.res, 200, Buffer.from(xml, 'utf8'), 'application/xml; charset=utf-8', ctx.rateHeaders);
}

export async function mediaRoute(ctx: RequestCtx, key: string): Promise<void> {
  const result = await getObject(`samples/${key}`);
  if (!result.ok) {
    if (result.notFound) throw errors.notFoundPublic();
    throw new ApiError(503, 'storage_unavailable', 'Samples are unavailable right now.');
  }
  sendBytes(ctx.res, 200, result.body, result.contentType, ctx.rateHeaders);
}
