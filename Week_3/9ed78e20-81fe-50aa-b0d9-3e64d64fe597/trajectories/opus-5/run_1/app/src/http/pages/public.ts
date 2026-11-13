import { pool } from '../../db/pool.js';
import { parseBody } from '../../domain/bodytext.js';
import { tokenDigest } from '../../domain/candidate.js';
import { DISCIPLINES, OFFICES, REGIONS } from '../../domain/careers.js';
import { NEWS_SUBJECTS } from '../../domain/content.js';
import { formatLondonDateTime } from '../../domain/london.js';
import { STAGE_LABELS, STAGE_PROGRESS, type ApplicationStage } from '../../domain/lifecycle.js';
import { SEARCH_PAGE_SIZE } from '../../domain/search.js';
import { ESSAY_TITLE } from '../../domain/theses.js';
import type { ModelRouteData } from '../api/publicdata.js';
import {
  benefitsData,
  homeData,
  modelRouteData,
  modelsData,
  newsData,
  newsPostData,
  parseAsOf,
  parseNewsPage,
  roleData,
  rolesData,
  searchData,
} from '../api/publicdata.js';
import { errors } from '../errors.js';
import { html, raw, type Html } from '../html.js';
import { htmlReply } from '../reply.js';
import { route, type Ctx } from '../server.js';
import { icon } from './icons.js';
import { navModels, page, publishedLine, readTimeLine } from './layout.js';
import {
  benchmarkChart,
  evaluationTable,
  renderProse,
  sampleGallery,
  sectionsNav,
} from './parts.js';

/** Each claim with the row each of its numbers came from. */
function claimViews(route: ModelRouteData): {
  id: string;
  number: number;
  text: string;
  evidence: { value: string; rowId: string }[];
}[] {
  const scoreOf = (id: string): string =>
    route.rows.find((row) => row.id === id)?.score ?? '';
  return route.claims.map((claim) => ({
    id: claim.id,
    number: claim.number,
    text: claim.text,
    evidence: [
      { value: scoreOf(claim.model_row_id), rowId: claim.model_row_id },
      { value: scoreOf(claim.comparator_row_id), rowId: claim.comparator_row_id },
      { value: claim.delta.replace(/^[+-]/, ''), rowId: claim.model_row_id },
    ],
  }));
}

function asOfBanner(asOf: Date | null): Html {
  if (asOf === null) return html``;
  return html`
    <aside class="as-of" role="region" aria-label="Record as of">
      <p>You are reading the record as it stood at
      <span class="mono">${formatLondonDateTime(asOf)}</span> London.</p>
      <p><a href="?">Read the current record</a></p>
    </aside>
  `;
}

function withAsOf(path: string, params: URLSearchParams, asOf: Date | null): string {
  const next = new URLSearchParams(params);
  if (asOf !== null) next.set('as_of', asOf.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const query = next.toString();
  return query === '' ? path : `${path}?${query}`;
}

async function renderPage(
  ctx: Ctx,
  title: string,
  body: Html,
  dynamicCss: string[] = [],
): Promise<ReturnType<typeof htmlReply>> {
  return htmlReply(
    200,
    page({
      title,
      nonce: ctx.nonce,
      body,
      dynamicCss,
      models: await navModels(),
    }),
  );
}

function homeBody(data: Awaited<ReturnType<typeof homeData>>): Html {
  return html`
    <article class="essay">
      <h1 class="display">${ESSAY_TITLE}</h1>
      <p class="standfirst">Aldermoor Labs publishes its models, its measurements and its
      decisions in one place. These are the five claims the record is built on.</p>
      <div class="essay-grid">
        <div class="thesis-progress" aria-hidden="true"><span data-progress-fill></span></div>
        <ol class="theses" aria-label="Theses" data-theses data-thesis-progress="0.00">
          ${data.theses.map(
            (thesis) => html`
              <li class="thesis" data-reveal="pending" data-thesis="${thesis.number}">
                <h2>
                  <span class="visually-hidden">Thesis </span>
                  <span class="thesis-numeral mono" aria-hidden="true">${thesis.number}</span>
                  <span class="visually-hidden">${thesis.number}. </span>
                  <span class="thesis-heading">${thesis.heading}</span>
                </h2>
                <p>${thesis.body}</p>
              </li>
            `,
          )}
        </ol>
        <aside class="rail" role="complementary" aria-label="Latest from the record">
          <h2>Latest from the record</h2>
          <ul>
            ${data.rail.map(
              (item) => html`
                <li>
                  <span class="rail-kind">${item.kind === 'model' ? 'Model' : 'News'}</span>
                  <a href="${item.url}" data-continuity-title>${item.title}</a>
                  ${publishedLine(new Date(item.published_at))}
                </li>
              `,
            )}
          </ul>
        </aside>
      </div>
    </article>
  `;
}

export function registerPublicPages(): void {
  route(
    'GET',
    '/',
    'public',
    async (ctx) => renderPage(ctx, 'The open record', homeBody(await homeData())),
    { page: true },
  );

  route(
    'GET',
    '/models',
    'public',
    async (ctx) => {
      const asOf = parseAsOf(ctx.url);
      const data = await modelsData(asOf);
      return renderPage(
        ctx,
        'Model catalogue',
        html`
          ${asOfBanner(asOf)}
          <h1 class="display">Model routes</h1>
          <p class="standfirst">Every published route, newest first, with the summary and the
          moment it was published.</p>
          ${data.items.length === 0
            ? html`<p class="notice">No model routes are published yet.</p>`
            : html`
                <ul class="catalogue">
                  ${data.items.map(
                    (model) => html`
                      <li class="catalogue-card">
                        <h2><a href="${withAsOf(`/models/${model.slug}`, new URLSearchParams(), asOf)}"
                          data-continuity-title>${model.title}</a></h2>
                        <p>${model.summary}</p>
                        ${publishedLine(new Date(model.published_at))}
                      </li>
                    `,
                  )}
                </ul>
              `}
        `,
      );
    },
    { page: true },
  );

  route(
    'GET',
    '/models/:slug',
    'public',
    async (ctx) => {
      const asOf = parseAsOf(ctx.url);
      const data = await modelRouteData(ctx.params.slug as string, asOf);
      const dynamicCss: string[] = [];
      const chart = benchmarkChart(data.rows, dynamicCss);
      return renderPage(
        ctx,
        data.title,
        html`
          ${asOfBanner(asOf)}
          <article class="long-form" data-model-route="${data.slug}"
            data-claims="${JSON.stringify(
              data.claims.map((claim) => ({
                id: claim.id,
                number: claim.number,
                benchmark: claim.benchmark,
                eval_date: claim.eval_date,
                model_row_id: claim.model_row_id,
                comparator_row_id: claim.comparator_row_id,
                delta: claim.delta,
              })),
            )}">
            <header class="long-form-header">
              <h1 class="display" data-continuity-heading>${data.title}</h1>
              <p class="standfirst">${data.summary}</p>
              <p class="meta">${readTimeLine(data.read_time_minutes)} ·
              ${publishedLine(new Date(data.published_at))} · ${data.organisation}</p>
            </header>
            <div class="long-form-grid">
              ${sectionsNav(data.sections)}
              <div class="prose">${renderProse(data.body, claimViews(data))}</div>
            </div>
            <div class="breakout">${chart}</div>
            <div class="breakout">${evaluationTable(data.rows)}</div>
            <div class="breakout">${sampleGallery(data)}</div>
            ${data.linked_news === null
              ? html``
              : html`<p class="linked"><a href="/news/${data.linked_news.slug}"
                  >${icon('file-text')}Announcement: ${data.linked_news.title}</a></p>`}
          </article>
        `,
        dynamicCss,
      );
    },
    { page: true },
  );

  route(
    'GET',
    '/news',
    'public',
    async (ctx) => {
      const asOf = parseAsOf(ctx.url);
      const subject = ctx.url.searchParams.get('subject');
      const tag = ctx.url.searchParams.get('tag');
      const pageNumber = parseNewsPage(ctx.url);
      const data = await newsData({ subject, tag, page: pageNumber, asOf });

      const facetHref = (next: { subject?: string | null; tag?: string | null }): string => {
        const params = new URLSearchParams();
        const nextSubject = next.subject === undefined ? subject : next.subject;
        const nextTag = next.tag === undefined ? tag : next.tag;
        if (nextSubject !== null && nextSubject !== '') params.set('subject', nextSubject);
        if (nextTag !== null && nextTag !== '') params.set('tag', nextTag);
        return withAsOf('/news', params, asOf);
      };
      const pageHref = (target: number): string => {
        const params = new URLSearchParams();
        if (subject !== null && subject !== '') params.set('subject', subject);
        if (tag !== null && tag !== '') params.set('tag', tag);
        params.set('page', String(target));
        return withAsOf('/news', params, asOf);
      };
      const filtered = (subject !== null && subject !== '') || (tag !== null && tag !== '');

      return renderPage(
        ctx,
        'Newsroom',
        html`
          ${asOfBanner(asOf)}
          <h1 class="display">Newsroom</h1>
          <div class="newsroom-grid">
            <div class="facets">
              <nav aria-label="Subjects">
                <h2>Subjects</h2>
                <ul>
                  <li><a href="${facetHref({ subject: null })}"
                    ${raw(subject === null || subject === '' ? 'aria-current="true"' : '')}
                    >All subjects</a></li>
                  ${NEWS_SUBJECTS.map((entry) => {
                    const count =
                      data.facets.subjects.find((facet) => facet.value === entry.value)?.count ?? 0;
                    return html`<li><a href="${facetHref({ subject: entry.value })}"
                      ${raw(subject === entry.value ? 'aria-current="true"' : '')}
                      >${entry.label} (<span class="mono">${count}</span>)</a></li>`;
                  })}
                </ul>
              </nav>
              <nav aria-label="Tags">
                <h2>Tags</h2>
                <ul>
                  <li><a href="${facetHref({ tag: null })}"
                    ${raw(tag === null || tag === '' ? 'aria-current="true"' : '')}>All tags</a></li>
                  ${data.facets.tags.map(
                    (facet) => html`<li><a href="${facetHref({ tag: facet.value })}"
                      ${raw(tag === facet.value ? 'aria-current="true"' : '')}
                      >${facet.value} (<span class="mono">${facet.count}</span>)</a></li>`,
                  )}
                </ul>
              </nav>
              ${filtered
                ? html`<p><a href="${withAsOf('/news', new URLSearchParams(), asOf)}"
                    >Clear filters</a></p>`
                : html``}
            </div>
            <div class="post-list">
              <p class="meta"><span class="mono">${data.total}</span> posts ·
              page <span class="mono">${data.page}</span> of <span class="mono">${data.pages}</span></p>
              ${data.items.length === 0
                ? html`
                    <p class="notice">No posts match these filters.</p>
                    <p><a href="${withAsOf('/news', new URLSearchParams(), asOf)}">Clear filters</a></p>
                  `
                : html`
                    <ul>
                      ${data.items.map(
                        (post) => html`
                          <li class="post-item">
                            <h2><a href="${withAsOf(`/news/${post.slug}`, new URLSearchParams(), asOf)}"
                              data-continuity-title>${post.title}</a></h2>
                            <p>${post.summary}</p>
                            <p class="meta">${post.subject} ·
                            ${publishedLine(new Date(post.published_at))} ·
                            ${readTimeLine(post.read_time_minutes)}</p>
                          </li>
                        `,
                      )}
                    </ul>
                  `}
              ${data.pages > 1
                ? html`
                    <nav aria-label="Pages" class="pages">
                      ${data.page > 1
                        ? html`<a href="${pageHref(data.page - 1)}">${icon('chevron-left')}Previous page</a>`
                        : html``}
                      ${data.page < data.pages
                        ? html`<a href="${pageHref(data.page + 1)}">Next page${icon('chevron-right')}</a>`
                        : html``}
                    </nav>
                  `
                : html``}
            </div>
          </div>
        `,
      );
    },
    { page: true },
  );

  route(
    'GET',
    '/news/:slug',
    'public',
    async (ctx) => {
      const asOf = parseAsOf(ctx.url);
      const post = await newsPostData(ctx.params.slug as string, asOf);
      const sections = parseBody(post.body).sections;
      return renderPage(
        ctx,
        post.title,
        html`
          ${asOfBanner(asOf)}
          <article class="long-form">
            <header class="long-form-header">
              <h1 class="display" data-continuity-heading>${post.title}</h1>
              <p class="standfirst">${post.summary}</p>
              <p class="meta">${post.subject} · ${readTimeLine(post.read_time_minutes)} ·
              ${publishedLine(new Date(post.published_at))}</p>
              <ul class="tags">${post.tags.map((tag) => html`<li>${tag}</li>`)}</ul>
            </header>
            <div class="long-form-grid">
              ${sectionsNav(sections.map((section) => ({ id: section.id, heading: section.heading })))}
              <div class="prose">${renderProse(post.body, [])}</div>
            </div>
            ${post.linked_model === null
              ? html``
              : html`<p class="linked"><a href="/models/${post.linked_model.slug}"
                  >${icon('file-text')}Model route: ${post.linked_model.title}</a></p>`}
          </article>
        `,
      );
    },
    { page: true },
  );

  route(
    'GET',
    '/search',
    'public',
    async (ctx) => {
      const q = (ctx.url.searchParams.get('q') ?? '').trim();
      const rawKind = ctx.url.searchParams.get('kind') ?? '';
      const kindHref = (kind: string): string => {
        const params = new URLSearchParams();
        if (q !== '') params.set('q', q);
        if (kind !== '') params.set('kind', kind);
        return `/search?${params.toString()}`;
      };
      const results =
        q === '' ? null : await searchData(ctx.url, SEARCH_PAGE_SIZE);
      const moreHref = (): string => {
        const params = new URLSearchParams();
        params.set('q', q);
        if (rawKind !== '') params.set('kind', rawKind);
        params.set('cursor', results?.next_cursor ?? '');
        return `/search?${params.toString()}`;
      };

      return renderPage(
        ctx,
        'Search the record',
        html`
          <h1 class="display">Search the record</h1>
          <div class="search-grid">
            <div class="search-filters">
              <nav aria-label="Kinds">
                <h2>Kinds</h2>
                <ul>
                  <li><a href="${kindHref('')}" ${raw(rawKind === '' ? 'aria-current="true"' : '')}
                    >All kinds</a></li>
                  <li><a href="${kindHref('model')}"
                    ${raw(rawKind === 'model' ? 'aria-current="true"' : '')}>Models</a></li>
                  <li><a href="${kindHref('news')}"
                    ${raw(rawKind === 'news' ? 'aria-current="true"' : '')}>News</a></li>
                  <li><a href="${kindHref('role')}"
                    ${raw(rawKind === 'role' ? 'aria-current="true"' : '')}>Roles</a></li>
                </ul>
              </nav>
            </div>
            <div class="search-main">
              <form role="search" aria-label="Search the record" method="get" action="/search"
                class="search-form">
                <label for="search-terms">Search terms</label>
                <input id="search-terms" type="search" name="q" value="${q}"
                  aria-label="Search terms" data-search-box>
                ${rawKind === '' ? html`` : html`<input type="hidden" name="kind" value="${rawKind}">`}
                <button type="submit">${icon('search')}Search</button>
              </form>
              <p class="status-line" role="status" aria-live="polite" aria-label="Search status"
                data-search-status></p>
              ${results === null
                ? html`<p class="notice">Enter a word or two to search the published record.</p>`
                : results.items.length === 0
                  ? html`<p class="notice">Nothing in the published record matches “${q}”.</p>`
                  : html`
                      <ul class="results" aria-label="Search results">
                        ${results.items.map(
                          (item) => html`
                            <li class="result">
                              <span class="result-kind">${item.kind === 'model'
                                ? 'Model'
                                : item.kind === 'news'
                                  ? 'News'
                                  : 'Role'}</span>
                              <h2><a href="${item.url}">${item.title}</a></h2>
                              <p class="highlight">${raw(item.highlight)}</p>
                              <p class="meta">${publishedLine(new Date(item.published_at))}</p>
                            </li>
                          `,
                        )}
                      </ul>
                      ${results.next_cursor === null
                        ? html``
                        : html`<p><a href="${moreHref()}" data-more-results>More results</a></p>`}
                    `}
            </div>
          </div>
        `,
      );
    },
    { page: true },
  );

  route(
    'GET',
    '/careers',
    'public',
    async (ctx) => {
      const discipline = ctx.url.searchParams.get('discipline') ?? '';
      const office = ctx.url.searchParams.get('office') ?? '';
      const region = ctx.url.searchParams.get('region') ?? '';
      const roles = await rolesData({
        discipline: discipline === '' ? null : discipline,
        office: office === '' ? null : office,
        region: region === '' ? null : region,
      });
      const benefits = await benefitsData();

      return renderPage(
        ctx,
        'Careers',
        html`
          <h1 class="display">Open roles</h1>
          <form aria-label="Filter roles" method="get" action="/careers" class="filter-form"
            data-careers-filters>
            <p class="field">
              <label for="filter-discipline">Discipline</label>
              <select id="filter-discipline" name="discipline" aria-label="Discipline">
                <option value="">Any</option>
                ${DISCIPLINES.map(
                  (entry) => html`<option value="${entry.value}"
                    ${raw(discipline === entry.value ? 'selected' : '')}>${entry.label}</option>`,
                )}
              </select>
            </p>
            <p class="field">
              <label for="filter-office">Office</label>
              <select id="filter-office" name="office" aria-label="Office">
                <option value="">Any</option>
                ${OFFICES.map(
                  (entry) => html`<option value="${entry.value}"
                    ${raw(office === entry.value ? 'selected' : '')}>${entry.label}</option>`,
                )}
              </select>
            </p>
            <p class="field">
              <label for="filter-region">Region</label>
              <select id="filter-region" name="region" aria-label="Region">
                <option value="">Any</option>
                ${REGIONS.map(
                  (entry) => html`<option value="${entry.value}"
                    ${raw(region === entry.value ? 'selected' : '')}>${entry.label}</option>`,
                )}
              </select>
            </p>
            <button type="submit">Show roles</button>
          </form>

          ${roles.items.length === 0
            ? html`<p class="notice">No open roles match these filters.</p>`
            : html`
                <ul class="role-list">
                  ${roles.items.map(
                    (role) => html`
                      <li class="role-item">
                        <h2><a href="/careers/${role.slug}">${role.title}</a></h2>
                        <p class="meta">${role.discipline} · ${role.office_label} ·
                        ${role.region_label}</p>
                      </li>
                    `,
                  )}
                </ul>
              `}

          <section class="benefits" aria-label="Benefits by region">
            <h2>Benefits by region</h2>
            <ul>
              ${benefits.regions.map(
                (entry) => html`
                  <li>
                    <h3>${entry.label}</h3>
                    ${entry.entry === null
                      ? html`<p class="notice">No benefits entry in force yet.</p>`
                      : html`<p>${entry.entry.summary}</p>
                          <p class="meta">In force from
                          <span class="mono">${entry.entry.effective_from}</span></p>`}
                  </li>
                `,
              )}
            </ul>
          </section>

          ${resendForm()}
        `,
      );
    },
    { page: true },
  );

  route(
    'GET',
    '/careers/:slug',
    'public',
    async (ctx) => {
      const role = await roleData(ctx.params.slug as string);
      return renderPage(
        ctx,
        role.title,
        html`
          <article class="long-form">
            <header class="long-form-header">
              <h1 class="display">${role.title}</h1>
              <p class="meta">${role.discipline} · ${role.office_label} · ${role.region_label}</p>
            </header>
            <div class="long-form-grid">
              ${sectionsNav([
                { id: 'role-description', heading: 'About the role' },
                { id: 'role-benefits', heading: 'Benefits' },
                { id: 'role-apply', heading: 'Apply' },
              ])}
              <div class="prose">
                <section id="role-description" data-reveal="pending" class="prose-section">
                  <h2>About the role</h2>
                  <p>${role.description}</p>
                </section>
                <section id="role-benefits" data-reveal="pending" class="prose-section">
                  <h2>Benefits</h2>
                  ${role.benefits === null
                    ? html`<p class="notice">No benefits entry in force yet.</p>`
                    : html`<p>${role.benefits.summary}</p>
                        <p class="meta">In force from
                        <span class="mono">${role.benefits.effective_from}</span></p>`}
                </section>
                <section id="role-apply" data-reveal="pending" class="prose-section">
                  <h2>Apply</h2>
                  <form aria-label="Apply for ${role.title}" method="post"
                    action="/api/careers/roles/${role.slug}/applications"
                    enctype="multipart/form-data" data-application-form
                    data-role="${role.slug}">
                    <p class="field">
                      <label for="apply-name">Full name</label>
                      <input id="apply-name" name="name" type="text" required
                        aria-label="Full name" autocomplete="name">
                      <span class="field-error" data-field-error="name"></span>
                    </p>
                    <p class="field">
                      <label for="apply-email">Email</label>
                      <input id="apply-email" name="email" type="email" required
                        aria-label="Email" autocomplete="email">
                      <span class="field-error" data-field-error="email"></span>
                    </p>
                    <p class="field">
                      <label for="apply-resume">Résumé (PDF)</label>
                      <input id="apply-resume" name="resume" type="file" accept="application/pdf"
                        required>
                      <span class="field-error" data-field-error="resume"></span>
                    </p>
                    <p class="field field-check">
                      <input id="apply-consent" name="consent" type="checkbox" value="yes" required>
                      <label for="apply-consent">I consent to Aldermoor Labs processing my
                      application</label>
                      <span class="field-error" data-field-error="consent"></span>
                    </p>
                    <button type="submit" data-application-submit>Submit application</button>
                    <span class="status-line" role="status" aria-live="polite"
                      aria-label="Application status" data-application-status></span>
                  </form>
                </section>
              </div>
            </div>
          </article>
        `,
      );
    },
    { page: true },
  );

  route(
    'GET',
    '/track/:token',
    'public',
    async (ctx) => {
      const token = ctx.params.token as string;
      const result = await pool.query<{
        title: string;
        office: string;
        stage: ApplicationStage;
        submitted_at: Date;
        stage_changed_at: Date;
      }>(
        `SELECT r.title, r.office, a.stage, a.submitted_at, a.stage_changed_at
           FROM tracking_links t
           JOIN applications a ON a.id = t.application_id
           JOIN requisitions r ON r.id = a.requisition_id
          WHERE t.token_digest = $1 AND t.retired_at IS NULL AND a.erased_at IS NULL
            AND (r.status <> 'closed' OR r.retention_deadline IS NULL
                 OR r.retention_deadline > now())`,
        [tokenDigest(token)],
      );
      const application = result.rows[0];
      if (application === undefined) throw errors.trackingNotFound();
      const officeLabel = OFFICES.find((entry) => entry.value === application.office)?.label ??
        application.office;
      const terminal =
        application.stage === 'offer' ||
        application.stage === 'declined' ||
        application.stage === 'withdrawn';
      const reachedIndex = STAGE_PROGRESS.indexOf(application.stage);

      return htmlReply(
        200,
        page({
          title: application.title,
          nonce: ctx.nonce,
          models: await navModels(),
          body: html`
            <article class="tracking" data-token="${token}">
              <h1 class="display">${application.title}</h1>
              <p class="meta">${officeLabel}</p>
              <p class="stage-now">Stage: <strong>${STAGE_LABELS[application.stage]}</strong></p>
              <ol class="stage-progress" aria-label="Stage progress">
                ${STAGE_PROGRESS.map(
                  (stage, index) => html`
                    <li ${raw(stage === application.stage ? 'aria-current="step"' : '')}
                      data-reached="${reachedIndex >= 0 && index <= reachedIndex}">
                      <span class="mono">${index + 1}</span> ${STAGE_LABELS[stage]}
                    </li>
                  `,
                )}
                ${terminal && reachedIndex === -1
                  ? html`<li aria-current="step"><span class="mono">—</span>
                      ${STAGE_LABELS[application.stage]}</li>`
                  : html``}
              </ol>
              <p class="meta">Submitted
              <span class="mono">${formatLondonDateTime(application.submitted_at)}</span> London ·
              last changed
              <span class="mono">${formatLondonDateTime(application.stage_changed_at)}</span>
              London</p>
              ${terminal
                ? html``
                : html`
                    <button type="button" data-withdraw-open>Withdraw application</button>
                    <dialog aria-label="Withdraw application?" data-withdraw-dialog>
                      <h2>Withdraw application?</h2>
                      <p>This cannot be undone. Your application will stop progressing.</p>
                      <button type="button" data-withdraw-confirm>Withdraw</button>
                      <button type="button" data-withdraw-cancel>Keep my application</button>
                    </dialog>
                  `}
              <p class="status-line" role="status" aria-live="polite"
                aria-label="Application status" data-tracking-status></p>
            </article>
          `,
        }),
        { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      );
    },
    { page: true },
  );
}

export function resendForm(): Html {
  return html`
    <section class="resend">
      <form aria-label="Resend my tracking links" method="post"
        action="/api/careers/tracking-links" data-resend-form>
        <h2>Resend my tracking links</h2>
        <p class="field">
          <label for="resend-email">Email</label>
          <input id="resend-email" name="email" type="email" required aria-label="Email">
          <span class="field-error" data-field-error="email"></span>
        </p>
        <button type="submit">Resend links</button>
        <span class="status-line" role="status" aria-live="polite" aria-label="Resend status"
          data-resend-status></span>
      </form>
    </section>
  `;
}
