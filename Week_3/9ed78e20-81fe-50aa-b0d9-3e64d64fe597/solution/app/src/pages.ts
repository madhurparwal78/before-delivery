import type { IncomingMessage } from "node:http";
import {
  layout,
  esc,
  publication,
  date,
  formatTime,
  status,
  input,
  select,
  dialog,
  sectionNav,
  emptyDrawing,
  icon,
  asOfBanner,
} from "./html.js";
import {
  homeData,
  modelsData,
  modelData,
  newsroomData,
  newsData,
  rolesData,
  roleData,
  benefitsData,
  parseAsOf,
} from "./public.js";
import { searchData } from "./search.js";
import { listJobs, listAudit } from "./governance.js";
import { config } from "./config.js";
import {
  subjects,
  offices,
  regions,
  sections,
  stageLabels,
  activeStage,
  claimNumbers,
} from "./domain.js";
import { sessionStaff, requireRole, signIn, sessionCookie } from "./auth.js";
import { pool, all, one } from "./db.js";
import {
  ApiError,
  publicNotFound,
  notFound,
  forbidden,
  str,
} from "./errors.js";
import {
  tracking,
  submitApplication,
  resendLinks,
  type Multipart,
} from "./careers.js";
import { type ApiResult } from "./content.js";
import { grantShape } from "./governance.js";
import type {
  Content,
  Staff,
  ReleaseRecord,
  BenchmarkRow,
  PublicBenchmarkRow,
  Requisition,
  Application,
  Benefits,
  Grant,
  ModelRoute,
  PublicClaim,
  Stage,
} from "./types.js";
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; font-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
async function html(
  title: string,
  main: string,
  options: Parameters<typeof layout>[2] = {},
  code = 200,
): Promise<ApiResult> {
  return {
    status: code,
    data: await layout(title, main, options),
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
    },
  };
}
const button = (label: string, action: string, extra = ""): string =>
  `<button type="button" data-action="${esc(action)}"${extra}>${esc(label)}</button>`;
const form = (
  name: string,
  endpoint: string,
  body: string,
  options: { method?: string; success?: string; mode?: string } = {},
): string =>
  `<form aria-label="${esc(name)}" data-endpoint="${esc(endpoint)}" data-method="${options.method || "POST"}"${options.success ? ` data-success="${esc(options.success)}"` : ""}${options.mode ? ` data-mode="${options.mode}"` : ""} method="post" novalidate>${body}</form>`;
const resendForm = (message = "", error = ""): string =>
  `<section class="resend"><h2>Resend my tracking links</h2><p>Enter the email address you used to apply.</p>${form("Resend my tracking links", "/api/careers/tracking-links", input("Email", "email", "", { type: "email", error }) + '<input type="hidden" name="_intent" value="resend">' + '<button type="submit">Resend links</button>' + status("Resend status", message), { mode: "resend" })}</section>`;
const disciplineLabel = (value: string): string =>
  value[0].toUpperCase() + value.slice(1);
function renderBody(
  body: string,
  claims: PublicClaim[] = [],
  rows: PublicBenchmarkRow[] = [],
): string {
  const renderClaim = (claim: PublicClaim): string => {
    const comparator = rows.find((row) => row.id === claim.comparator_row_id);
    let linked = "",
      cursor = 0;
    for (const { value, index } of claimNumbers(claim.text, [
      claim.benchmark,
      ...rows.map((row) => row.subject_name),
    ])) {
      const rowId =
        comparator && Number(value) === Number(comparator.score)
          ? claim.comparator_row_id
          : claim.model_row_id;
      // A number keeps its trailing punctuation on its line.
      const after = /^[,.;:]?/.exec(claim.text.slice(index + value.length))![0];
      linked += `${esc(claim.text.slice(cursor, index))}<span class="nowrap"><a class="claim-number" href="#row-${esc(rowId)}">${esc(value)}</a>${after}</span>`;
      cursor = index + value.length + after.length;
    }
    linked += esc(claim.text.slice(cursor));
    return `<span class="claim-text">${linked}</span><button type="button" class="claim-marker" aria-label="Claim ${claim.number}" aria-pressed="false" data-claim="${esc(claim.id)}">${claim.number}</button>`;
  };
  const renderParagraph = (text: string): string => {
    let rendered = "",
      cursor = 0;
    for (const marker of text.matchAll(/\[claim:(c\d+)\]/g)) {
      rendered += esc(text.slice(cursor, marker.index));
      const claim = claims.find((item) => item.id === marker[1]);
      rendered += claim ? renderClaim(claim) : esc(marker[0]);
      cursor = marker.index! + marker[0].length;
    }
    return `<p>${rendered + esc(text.slice(cursor))}</p>`;
  };
  const blocks: { heading: string | null; paragraphs: string[] }[] = [];
  let current = { heading: null as string | null, paragraphs: [] as string[] };
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length) {
      current.paragraphs.push(paragraph.join("\n"));
      paragraph = [];
    }
  };
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      flush();
      if (current.heading || current.paragraphs.length) blocks.push(current);
      current = { heading: line.slice(3), paragraphs: [] };
    } else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  if (current.heading || current.paragraphs.length) blocks.push(current);
  let number = 0;
  return blocks
    .map(
      (block) =>
        `<section class="prose-section" data-reveal="pending">${block.heading ? `<h2 id="section-${++number}">${esc(block.heading)}</h2>` : ""}${block.paragraphs.map(renderParagraph).join("")}</section>`,
    )
    .join("");
}

function chart(m: ModelRoute): string {
  let previous = "";
  return `<section class="breakout evidence" id="benchmarks"><div class="breakout-heading"><div><p class="quiet">Evaluation record</p><h2>Evidence, in context.</h2></div><p>Same harness. Same day.<br>Every score links to its recorded row.</p></div><figure aria-label="Benchmark results" class="benchmark-chart" data-entered="false"><div class="chart-axis"><span>Recorded score</span><div class="chart-ticks"><span>0</span><span>50</span><span>100</span></div><span aria-hidden="true"></span></div>${m.rows
    .map((r) => {
      const group = r.benchmark + " " + r.eval_date;
      const heading =
        previous !== group
          ? `<div class="chart-group-heading"><h3>${esc(r.benchmark)}</h3><a href="#row-${esc(r.id)}">${esc(r.eval_date)}</a></div>`
          : "";
      previous = group;
      return `${heading}<div class="bar-row" data-subject-model="${r.subject === m.slug}" data-row-id="${esc(r.id)}" data-cited="true"><a class="bar-name" href="#row-${esc(r.id)}">${esc(r.subject_name)}<small>${esc(r.organisation)}</small></a><div class="bar-track"><div class="bar" style="--score:${Number(r.score)}%"></div></div><a class="bar-score" href="#row-${esc(r.id)}">${esc(r.score)}</a></div>`;
    })
    .join(
      "",
    )}<div class="delta-line"><a data-tether-delta></a></div><div class="tether-bracket" hidden aria-hidden="true"></div></figure><svg class="tether-svg" aria-hidden="true"><path hidden data-tether-line="" d="M 0 0 L 1 1"/></svg></section><section class="breakout evaluation-table" id="recorded-rows"><h2>Recorded evaluation rows</h2><div class="table-frame" tabindex="0"><table aria-label="Recorded evaluation rows"><thead><tr><th scope="col">Model</th><th scope="col">Organisation</th><th scope="col">Benchmark</th><th scope="col">Evaluation date</th><th scope="col">Score</th></tr></thead><tbody>${m.rows.map((r) => `<tr id="row-${esc(r.id)}"><td data-label="Model">${esc(r.subject_name)}</td><td data-label="Organisation">${esc(r.organisation)}</td><td data-label="Benchmark">${esc(r.benchmark)}</td><td data-label="Evaluation date"><a href="#row-${esc(r.id)}">${esc(r.eval_date)}</a></td><td data-label="Score"><a href="#row-${esc(r.id)}">${esc(r.score)}</a></td></tr>`).join("")}</tbody></table></div></section>`;
}
function gallery(m: ModelRoute): string {
  return `<section class="breakout samples" id="samples" aria-label="Samples"><div class="breakout-heading"><div><p class="quiet">Generated studies</p><h2>Samples from the model.</h2></div><p>Listen closely. Look frame by frame.</p></div>${
    m.samples_available === false
      ? '<p class="notice">Samples are unavailable right now. The recorded benchmarks above are unaffected.</p>'
      : !m.samples.length
        ? "<p>No samples recorded for this model.</p>"
        : `<div class="sample-grid">${m.samples
            .map((s) =>
              s.kind === "audio"
                ? `<article class="audio-sample"><h3>${esc(s.title)}</h3><svg class="waveform" aria-hidden="true" viewBox="0 0 400 60">${Array.from(
                    { length: 65 },
                    (_, i) => {
                      const h =
                        4 +
                        Math.abs(
                          Math.sin(i * 0.39 + s.id.length) *
                            Math.sin(i * (0.11 + s.id.length / 200)),
                        ) *
                          48;
                      return `<path d="M${i * 6 + 5} ${30 - h / 2}v${h}"/>`;
                    },
                  ).join(
                    "",
                  )}</svg><audio preload="none" src="${esc(s.urls[0])}" data-audio="${s.id}"></audio><div class="sample-controls"><button type="button" data-play="${s.id}">${icon("play")} Play ${esc(s.title)}</button><button type="button" data-pause="${s.id}">${icon("pause")} Pause ${esc(s.title)}</button></div></article>`
                : `<article class="image-sample" data-sequence="${esc(JSON.stringify(s.urls))}"><div><h3>${esc(s.title)}</h3><p>A gradual recovery of structure.</p></div><div class="frame-view" tabindex="0" aria-label="${esc(s.title)}"><img src="${esc(s.urls[0])}" width="640" height="360" alt="${esc(s.title)}, frame 1"></div><div class="sample-controls"><button type="button" data-frame="previous">Previous frame</button><span role="status" aria-label="Frame position">Frame 1 of ${s.urls.length}</span><button type="button" data-frame="next">Next frame</button></div></article>`,
            )
            .join("")}</div>`
  }</section>`;
}
async function homePage(): Promise<ApiResult> {
  const data = await homeData();
  return html(
    "The open record of Aldermoor Labs",
    `<div class="home-sheet"><div class="home-intro"><p class="intro-note">Research that can be read, questioned and traced.</p><h1>The open record of Aldermoor Labs</h1><p class="standfirst">What we build. How we know.<br>And the decisions we put our names to.</p></div><ol class="theses" aria-label="Theses" data-thesis-progress="0.00">${data.theses.map((t, i) => `<li class="thesis" data-reveal="pending"${i === 0 ? ' data-current="true"' : ""}><span class="thesis-number" aria-hidden="true">${String(t.number).padStart(2, "0")}</span><div><h2><span class="sr-only">Thesis ${t.number}. </span>${esc(t.heading)}</h2><p>${esc(t.body)}</p></div></li>`).join("")}</ol><aside class="latest" aria-label="Latest from the record"><h2>Latest from <br>the record</h2><ol>${data.rail.map((r) => `<li><span class="kind">${r.kind === "model" ? "Model" : "News"}</span><a href="${r.url}">${esc(r.title)}</a>${publication(r.published_at)}</li>`).join("")}</ol></aside></div>`,
    { active: "thesis" },
  );
}
const withAsOf = (path: string, asOf: string | null): string =>
  asOf ? `${path}?as_of=${encodeURIComponent(asOf)}` : path;
async function modelsPage(asOf: string | null): Promise<ApiResult> {
  const data = await modelsData(asOf);
  return html(
    "Model routes",
    `${asOfBanner(asOf, "/models")}<div class="page-heading"><h1>Model routes</h1><p class="standfirst">A model is more than its best result.<br>Read the evidence, the limits and the release record.</p></div><div class="catalogue">${data.items.map((m) => `<article><p class="quiet">Aldermoor Labs</p><h2><a href="${esc(withAsOf(`/models/${m.slug}`, asOf))}" style="view-transition-name: t-model-${esc(m.slug)}">${esc(m.title)}</a></h2><p>${esc(m.summary)}</p>${publication(m.published_at)}<a class="text-link" href="${esc(withAsOf(`/models/${m.slug}`, asOf))}">Read the model route</a></article>`).join("")}</div>`,
  );
}
async function modelPage(
  slug: string,
  asOf: string | null,
): Promise<ApiResult> {
  const m = await modelData(slug, asOf);
  const nav = [
    ...m.sections,
    { id: "benchmarks", heading: "Benchmark results" },
    { id: "recorded-rows", heading: "Recorded evaluation rows" },
    { id: "samples", heading: "Samples" },
  ];
  return html(
    m.title,
    `${asOfBanner(asOf, `/models/${slug}`)}<article class="longform model-route" data-model="${esc(JSON.stringify(m))}"><header class="article-heading"><p class="quiet">Model route / Aldermoor Labs</p><h1 style="view-transition-name: t-model-${esc(m.slug)}">${esc(m.title)}</h1><p class="standfirst">${esc(m.summary)}</p><div class="metadata"><span>${m.read_time_minutes} min read</span>${publication(m.published_at)}</div></header><div class="longform-body">${sectionNav(nav)}<div class="article-prose">${renderBody(m.body, m.claims, m.rows)}<div class="sr-only">${status("Claim tether")}</div></div></div>${chart(m)}${gallery(m)}${m.linked_news ? `<div class="article-prose linked-record"><p>From the newsroom</p><a href="${esc(withAsOf(`/news/${m.linked_news.slug}`, asOf))}">${esc(m.linked_news.title)}</a></div>` : ""}</article>`,
  );
}
function facetUrl(query: URLSearchParams, key: string, value: string): string {
  const q = new URLSearchParams(query);
  q.delete("page");
  if (value) q.set(key, value);
  else q.delete(key);
  return "/news" + (q.size ? "?" + q.toString() : "");
}
async function newsroomPage(query: URLSearchParams): Promise<ApiResult> {
  const data = await newsroomData(query);
  const asOf = parseAsOf(query.get("as_of"));
  return html(
    "Newsroom",
    `${asOfBanner(asOf, "/news")}<div class="page-heading newsroom-heading"><h1>Newsroom</h1><p class="standfirst">Research, decisions and work in progress.<br>The published record of Aldermoor Labs.</p></div><div class="news-layout"><aside class="facets"><nav aria-label="Subjects"><h2>Subjects</h2><a href="${esc(facetUrl(query, "subject", ""))}"${!query.get("subject") ? ' aria-current="true"' : ""}>All subjects</a>${data.facets.subjects.map((s) => `<a href="${esc(facetUrl(query, "subject", s.value))}"${query.get("subject") === s.value ? ' aria-current="true"' : ""}>${s.label} (${s.count})</a>`).join("")}</nav><nav aria-label="Tags"><h2>Tags</h2><a href="${esc(facetUrl(query, "tag", ""))}"${!query.get("tag") ? ' aria-current="true"' : ""}>All tags</a>${data.facets.tags.map((t) => `<a href="${esc(facetUrl(query, "tag", t.value))}"${query.get("tag") === t.value ? ' aria-current="true"' : ""}>${esc(t.value)} (${t.count})</a>`).join("")}</nav>${query.get("subject") || query.get("tag") ? `<a href="${esc(withAsOf("/news", asOf))}">Clear filters</a>` : ""}</aside><div class="news-list">${data.items.length ? data.items.map((p) => `<article><div class="news-meta"><span>${esc(subjects[p.subject as keyof typeof subjects] || p.subject)}</span><span>${p.read_time_minutes} min read</span></div><h2><a href="${esc(withAsOf(`/news/${p.slug}`, asOf))}" style="view-transition-name: t-news-${esc(p.slug)}">${esc(p.title)}</a></h2><p>${esc(p.summary)}</p>${publication(p.published_at)}</article>`).join("") : `<div class="empty">${emptyDrawing()}<p>No posts match these filters.</p><a href="${esc(withAsOf("/news", asOf))}">Clear filters</a></div>`}${data.pages > 1 ? `<nav aria-label="Pages">${data.page > 1 ? `<a href="${esc("/news?" + new URLSearchParams({ ...Object.fromEntries(query), page: String(data.page - 1) }))}">Previous page</a>` : ""}<span>Page ${data.page} of ${data.pages}</span>${data.page < data.pages ? `<a href="${esc("/news?" + new URLSearchParams({ ...Object.fromEntries(query), page: String(data.page + 1) }))}">Next page</a>` : ""}</nav>` : ""}</div></div>`,
    { active: "news" },
  );
}
async function newsPage(slug: string, asOf: string | null): Promise<ApiResult> {
  const p = await newsData(slug, asOf);
  return html(
    p.title,
    `${asOfBanner(asOf, `/news/${slug}`)}<article class="longform"><header class="article-heading"><p class="quiet">${esc(subjects[p.subject as keyof typeof subjects])}</p><h1 style="view-transition-name: t-news-${esc(p.slug)}">${esc(p.title)}</h1><p class="standfirst">${esc(p.summary)}</p><div class="metadata"><span>${p.read_time_minutes} min read</span>${publication(p.published_at)}</div><div class="tags">${p.tags.map((t) => `<a href="/news?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div></header><div class="longform-body">${sectionNav(sections(p.body!))}<div class="article-prose">${renderBody(p.body!)}${p.linked_model ? `<div class="linked-record"><p>The evidence behind this announcement</p><a href="${esc(withAsOf(`/models/${p.linked_model.slug}`, asOf))}">${esc(p.linked_model.title)}</a></div>` : ""}</div></div></article>`,
    { active: "news" },
  );
}
const kindLabels: Record<string, string> = {
  model: "Model",
  news: "News",
  role: "Role",
};
function searchUrl(q: string, kind: string): string {
  const params = new URLSearchParams({ q });
  if (kind) params.set("kind", kind);
  return "/search?" + params.toString();
}
// A passage cut from the middle of its text reads as an excerpt: an ellipsis marks each cut end.
function passage(highlight: string): string {
  const text = highlight.replace(/<\/?mark>/g, "");
  const lead = /^[\p{Ll}\d,;:)]/u.test(text) ? "…" : "";
  const trail = /[.!?”’"')]$/u.test(text) ? "" : "…";
  return lead + highlight + trail;
}
async function searchPage(query: URLSearchParams): Promise<ApiResult> {
  const q = query.get("q"),
    kind = query.get("kind") || "";
  let results = "",
    message = "";
  if (q !== null) {
    const request = new URLSearchParams(query);
    request.set("limit", "3");
    try {
      const page = await searchData(request);
      message = `Showing ${page.items.length} results.`;
      results = page.items.length
        ? `<ol class="search-results" aria-label="Search results">${page.items.map((item) => `<li><span class="kind">${kindLabels[item.kind]}</span><h2><a href="${esc(item.url)}">${esc(item.title)}</a></h2>${publication(item.published_at)}<p class="highlight">${passage(item.highlight)}</p></li>`).join("")}</ol>${page.next_cursor ? `<a class="more-results" href="${esc(searchUrl(q, kind) + "&cursor=" + encodeURIComponent(page.next_cursor))}">More results</a>` : ""}`
        : `<ol class="search-results" aria-label="Search results"></ol><div class="empty">${emptyDrawing()}<p>Nothing in the published record matches “${esc(q)}”.</p></div>`;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 422) throw error;
      message = Object.values(error.fields || {})[0] || error.message;
    }
  }
  const kindLink = (value: string, label: string): string =>
    `<a href="${esc(q === null ? (value ? `/search?kind=${value}` : "/search") : searchUrl(q, value))}"${kind === value ? ' aria-current="true"' : ""}>${label}</a>`;
  return html(
    "Search the record",
    `<div class="search-sheet"><div class="search-heading"><h1>Search the record</h1><form role="search" aria-label="Search the record" method="get" action="/search" data-search><label class="field" for="field-search-terms"><span>Search terms</span><input type="search" id="field-search-terms" name="q" aria-label="Search terms" value="${esc(q || "")}"></label>${kind ? `<input type="hidden" name="kind" value="${esc(kind)}">` : ""}<button type="submit">Search</button></form></div><nav class="search-kinds" aria-label="Kinds"><p class="rail-label">Kinds</p>${kindLink("", "All kinds")}${kindLink("model", "Models")}${kindLink("news", "News")}${kindLink("role", "Roles")}</nav><div class="search-body">${status("Search status", message)}${results}</div></div>`,
    { active: "search" },
  );
}
async function careersPage(
  query: URLSearchParams,
  notice = "",
  error = "",
): Promise<ApiResult> {
  const roles = await rolesData(query),
    benefits = await benefitsData();
  return html(
    "Careers",
    `<div class="page-heading"><h1>Work worth standing behind.</h1><p class="standfirst">Bring careful thinking to the frontier.<br>Open roles at Aldermoor Labs.</p></div><form aria-label="Filter roles" method="get" action="/careers" class="filters" data-role-filters>${select(
      "Discipline",
      "discipline",
      ["research", "engineering", "policy", "operations"].map((v) => [
        v,
        v[0].toUpperCase() + v.slice(1),
      ]),
      query.get("discipline") || "",
      "Any",
    )}${select(
      "Office",
      "office",
      Object.entries(offices).map(([v, o]) => [v, o.label]),
      query.get("office") || "",
      "Any",
    )}${select("Region", "region", Object.entries(regions), query.get("region") || "", "Any")}<button type="submit">Show roles</button></form><section class="roles"><h2>Open roles</h2>${roles.items.length ? roles.items.map((r) => `<article class="role-row"><h3><a href="/careers/${r.slug}">${esc(r.title)}</a></h3><p>${esc(disciplineLabel(r.discipline))}<span>${esc(r.office_label)}</span><span>${esc(r.region_label)}</span></p></article>`).join("") : `<div class="empty">${emptyDrawing()}<p>No open roles match these filters.</p></div>`}</section><section class="benefits" aria-label="Benefits by region"><h2>Benefits by region</h2><div class="benefits-grid">${benefits.regions.map((r) => `<article><h3>${esc(r.label)}</h3><p>${r.entry ? esc(r.entry.summary) : "No benefits entry in force yet."}</p>${r.entry ? `<small>In force from <span class="number">${esc(r.entry.effective_from)}</span></small>` : ""}</article>`).join("")}</div></section>${resendForm(notice, error)}`,
    { active: "careers" },
  );
}
async function rolePage(
  slug: string,
  notice = "",
  errors: Record<string, string> = {},
  values: Record<string, string> = {},
): Promise<ApiResult> {
  const r = await roleData(slug);
  return html(
    r.title,
    `<article class="longform"><header class="article-heading"><p class="quiet">${esc(disciplineLabel(r.discipline))} / ${esc(r.office_label)}</p><h1>${esc(r.title)}</h1><p class="standfirst">${esc(r.office_label)}, ${esc(r.region_label)}</p></header><div class="longform-body">${sectionNav([...sections(r.description!), { id: "role-benefits", heading: "Regional benefits" }, { id: "apply", heading: "Apply for this role" }])}<div class="article-prose">${renderBody(r.description!)}<section id="role-benefits" class="prose-section" data-reveal="pending"><h2>Regional benefits</h2><p>${esc(r.benefits?.summary || "No benefits entry in force yet.")}</p></section><section id="apply" class="application-form prose-section" data-reveal="pending"><h2>Apply for this role</h2><p>Your application goes directly to the recruiters for this role. We will email a receipt and a private link to follow your progress.</p><form aria-label="Apply for ${esc(r.title)}" method="post" action="/careers/${slug}" enctype="multipart/form-data" data-mode="application" data-endpoint="/api/careers/roles/${slug}/applications" novalidate>${input("Full name", "name", values.name || "", { error: errors.name })}${input("Email", "email", values.email || "", { type: "email", error: errors.email })}<label class="field" for="field-resume"><span>Résumé (PDF)</span><input aria-label="Résumé (PDF)" type="file" id="field-resume" name="resume" accept="application/pdf"><small>PDF, up to 5,000,000 bytes.</small><span class="field-error" data-error="resume">${esc(errors.resume || "")}</span></label><label class="consent"><input type="checkbox" name="consent" value="yes"><span>I consent to Aldermoor Labs processing my application</span></label><span class="field-error" data-error="consent">${esc(errors.consent || "")}</span><button type="submit">Submit application</button>${status("Application status", notice)}</form></section></div></div></article>`,
    { active: "careers" },
  );
}
async function trackingPage(
  token: string,
  notice = "",
  showDialog = false,
): Promise<ApiResult> {
  const t = await tracking(token);
  return html(
    t.role.title,
    `<div class="tracking-page"><p class="quiet">Your Aldermoor application</p><h1>${esc(t.role.title)}</h1><p class="standfirst">${esc(t.role.office)}</p><div class="tracking-current"><span>Current stage</span><h2>${esc(t.stage_label)}</h2></div><ol class="stage-progress" aria-label="Stage progress">${(
      [
        "submitted",
        "screening",
        "interview",
        "final_review",
        "offer",
      ] as Stage[]
    )
      .concat(
        t.stage === "declined" || t.stage === "withdrawn" ? [t.stage] : [],
      )
      .map(
        (s, i) =>
          `<li${s === t.stage ? ' aria-current="step"' : ""}><span class="step-number">${i + 1}</span><span>${stageLabels[s]}${s === "submitted" ? `<small>${date(t.submitted_at)}</small>` : s === t.stage ? `<small>${date(t.stage_changed_at)}</small>` : ""}</span></li>`,
      )
      .join(
        "",
      )}</ol><dl class="dates"><div><dt>Submitted</dt><dd>${date(t.submitted_at)}</dd></div><div><dt>Last changed</dt><dd>${date(t.stage_changed_at)}</dd></div></dl>${activeStage(t.stage) ? `<button class="script-control" type="button" data-open-dialog="withdraw-application">Withdraw application</button><noscript><form method="post"><input type="hidden" name="_intent" value="withdraw-question"><button type="submit">Withdraw application</button></form></noscript>${dialog("withdraw-application", "Withdraw application?", `<p>This ends your application for this role.</p>${form("Withdraw application", `/api/track/${esc(token)}/withdraw`, '<input type="hidden" name="_intent" value="withdraw-confirm"><button type="submit">Withdraw</button>', { success: "Your application has been withdrawn.", mode: "withdraw-application" })}`, "Keep my application", `/track/${token}`).replace('<dialog id="withdraw-application"', showDialog ? '<dialog open id="withdraw-application"' : '<dialog id="withdraw-application"')}` : ""}${status("Application status", notice)}</div>`,
  );
}
function consoleStatus(query: URLSearchParams): string {
  return status("Console status", query.get("notice") || "");
}
const hasRole = (staff: Staff, role: string): boolean =>
  staff.roles.some((g) => g.role === role);
const table = (label: string, headers: string[], rows: string[][]): string =>
  `<div class="table-frame" tabindex="0"><table aria-label="${esc(label)}"><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, i) => `<td data-label="${esc(headers[i])}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const contentLink = (c: Content): string =>
  `<a href="/console/content/${esc(c.id)}">${esc(c.title)}</a>`;
async function consoleHome(
  staff: Staff,
  query: URLSearchParams,
): Promise<ApiResult> {
  const content =
    hasRole(staff, "editor") || hasRole(staff, "approver")
      ? await all<Content>(pool, "content")
      : [];
  const reqs = hasRole(staff, "recruiter")
    ? (await all<Requisition>(pool, "requisitions")).filter((r) =>
        r.recruiters.includes(staff.email),
      )
    : [];
  const items = content.filter(
    (c) => hasRole(staff, "approver") || c.author === staff.email,
  );
  return html(
    "Work queue",
    `<div class="console-heading"><div><p class="quiet">Governed console</p><h1>Work queue</h1></div>${hasRole(staff, "editor") ? '<div class="actions"><a class="button" href="/console/content/new?kind=news">Draft news post</a><a class="button" href="/console/content/new?kind=model">Draft model route</a></div>' : ""}</div>${consoleStatus(query)}<div class="console-grid"><aside class="console-list" tabindex="0"><h2>Your access</h2>${staff.roles.map((r) => `<p>${esc(r.role)}<small>Until ${date(r.expires_at)}</small></p>`).join("") || "<p>Your current roles do not allow this.</p>"}${hasRole(staff, "administrator") ? '<a href="/console/grants">Manage role grants</a><a href="/console/audit">Read the audit record</a>' : ""}${hasRole(staff, "recruiter") ? '<a href="/console/requisitions">Manage requisitions</a><a href="/console/benefits">Record regional benefits</a>' : ""}</aside><div>${[
      "draft",
      "in_review",
      "returned",
      "approved",
      "scheduled",
      "published",
      "withdrawn",
    ]
      .filter((s) => items.some((c) => c.status === s))
      .map(
        (s) =>
          `<section class="queue-group"><h2>${s.replace("_", " ")} <span class="number">(${items.filter((c) => c.status === s).length})</span></h2>${items
            .filter((c) => c.status === s)
            .map(
              (c) =>
                `<div class="queue-row">${contentLink(c)}<span>${c.kind === "model" ? "Model route" : "News post"}</span></div>`,
            )
            .join("")}</section>`,
      )
      .join(
        "",
      )}${reqs.map((r) => `<div class="queue-row"><a href="/console/requisitions/${r.id}">${esc(r.title)}</a><span>${r.status}</span></div>`).join("")}</div></div>`,
    { staff, console: true },
  );
}
async function contentPage(
  staff: Staff,
  c: Content | null,
  kind: "model" | "news",
  query: URLSearchParams,
): Promise<ApiResult> {
  requireRole(staff, "editor", "approver");
  if (!c && !hasRole(staff, "editor")) forbidden();
  const endpoint = c ? `/api/console/content/${c.id}` : "/api/console/content";
  const editable =
    !c ||
    (c.author === staff.email && ["draft", "returned"].includes(c.status));
  const record =
    c && kind === "model"
      ? await one<ReleaseRecord>(pool, "release_records", c.id)
      : null;
  const sameAuthor = c?.author === staff.email;
  const prefix = c ? `/api/console/content/${c.id}/` : "";
  const content = await all<Content>(pool, "content");
  const editorForm = `<form aria-label="Content editor" data-endpoint="${endpoint}" data-method="${c ? "PATCH" : "POST"}" data-mode="content" data-success="Draft saved." method="post"><input type="hidden" name="kind" value="${kind}"><fieldset${!editable ? " disabled" : ""}>${input("Title", "title", c?.title || "")}${input("Slug", "slug", c?.slug || "")}${input("Summary", "summary", c?.summary || "", { textarea: true })}${input("Body", "body", c?.body || "", { textarea: true, hint: kind === "model" ? "Use ## for section headings and [claim:c1] for a claim marker." : "Use ## for section headings and blank lines for paragraphs." })}${kind === "news" ? select("Subject", "subject", Object.entries(subjects), c?.subject || "research") + input("Tags", "tags", c?.tags?.join(", ") || "", { hint: "Separate tags with commas." }) : input("Claims", "claims", JSON.stringify(c?.claims || [], null, 2), { textarea: true, hint: "Each claim records id, text, benchmark, eval_date, comparator and stated_delta." }) + input("Linked announcement slug", "linked_news_slug", c?.linked_news_slug || "")}${editable ? '<button type="submit">Save draft</button>' : ""}</fieldset></form>`;
  const actions = c
    ? `<section class="editor-actions"><h2>Review and release</h2><div class="actions">${sameAuthor && hasRole(staff, "editor") && ["draft", "returned"].includes(c.status) ? button("Submit for review", prefix + "submit", ' data-success="Submitted for review."') : ""}${!sameAuthor && hasRole(staff, "approver") && c.status === "in_review" ? button("Approve", prefix + "approve", ' data-success="Approved."') + '<button type="button" data-open-dialog="return-item">Return to author</button>' : ""}${!sameAuthor && hasRole(staff, "approver") && c.status === "approved" ? '<button type="button" data-open-dialog="schedule-item">Schedule release</button>' : ""}${!sameAuthor && hasRole(staff, "approver") && c.status === "scheduled" ? button("Release now", prefix + "release", ' data-success="Released."') : ""}${hasRole(staff, "approver") && ["published", "scheduled"].includes(c.status) ? '<button type="button" data-open-dialog="withdraw-item">Withdraw</button>' : ""}</div></section>${dialog("return-item", "Return to author", form("Return to author", prefix + "return", input("Reason", "reason") + '<button type="submit">Return</button>', { success: "Returned to author." }))}${dialog("schedule-item", "Schedule release", form("Schedule release", prefix + "schedule", input("Release time (London)", "release_at_local", "", { hint: "YYYY-MM-DDTHH:mm, Europe/London" }) + '<p class="quiet" data-schedule-preview></p><button type="submit">Confirm schedule</button>', { mode: "schedule" }))}${dialog("withdraw-item", "Withdraw this item?", `<p>This item will leave every public list.</p>${form("Withdraw this item", prefix + "withdraw", '<button type="submit">Confirm withdrawal</button>', { success: "Withdrawn." })}`)}`
    : "";
  const release = record
    ? `<section class="release-record" aria-label="Release record"><div class="panel-heading"><h2>Release record</h2><span class="state">${esc(record.status.replaceAll("_", " "))}</span></div><dl><div><dt>Safety</dt><dd>${record.safety ? esc(record.safety.by) : "Awaiting sign-off"}</dd></div><div><dt>Legal</dt><dd>${record.legal ? esc(record.legal.by) : "Awaiting sign-off"}</dd></div></dl><div class="actions">${!sameAuthor && hasRole(staff, "approver") ? button("Record safety sign-off", prefix + "release-record/signoffs", ' data-body="' + esc(JSON.stringify({ kind: "safety", note: "" })) + '" data-success="Safety sign-off recorded."') + button("Record legal sign-off", prefix + "release-record/signoffs", ' data-body="' + esc(JSON.stringify({ kind: "legal", note: "" })) + '" data-success="Legal sign-off recorded."') : ""}${button("Validate claims", prefix + "release-record/validate-claims", ' data-success="Claims validated."')}${!sameAuthor && hasRole(staff, "approver") ? button("Clear release record", prefix + "release-record/clear", ' data-success="Release record cleared."') : ""}</div>${(record.last_validation || []).map((v) => `<p>${esc(v.claim)}: ${v.ok ? "Validated" : esc(v.reason)}</p>`).join("")}</section>`
    : "";
  const comments = c
    ? `<section class="comments"><h2>Comments</h2>${c.comments.map((v) => `<article><p>${esc(v.body)}</p><small>${esc(v.author)} / ${date(v.created_at)}</small></article>`).join("")}${["draft", "in_review", "returned", "approved"].includes(c.status) ? form("Add comment", prefix + "comments", input("Comment", "body", "", { textarea: true }) + '<button type="submit">Add comment</button>', { success: "Comment added." }) : "<p>Comments are closed.</p>"}</section>`
    : "";
  return html(
    c?.title || `New ${kind === "model" ? "model route" : "news post"}`,
    `<div class="console-heading"><div><p class="quiet">${kind === "model" ? "Model route" : "News post"}</p><h1>${c ? "Content record" : `New ${kind === "model" ? "model route" : "news post"}`}</h1></div>${c ? `<span class="state">${esc(c.status.replaceAll("_", " "))} / Version ${c.version}</span>` : ""}</div>${consoleStatus(query)}<div class="console-grid" data-record-version="${c?.version || ""}"><aside class="console-list" tabindex="0"><h2>Content</h2>${content.map((v) => `<div class="list-item">${contentLink(v)}<small>${v.status.replaceAll("_", " ")}</small></div>`).join("")}</aside><div class="console-detail">${editorForm}${actions}${release}${comments}</div></div>`,
    { staff, console: true },
  );
}
async function rowsPage(
  staff: Staff,
  query: URLSearchParams,
): Promise<ApiResult> {
  requireRole(staff, "editor", "approver");
  const rows = await all<BenchmarkRow>(pool, "benchmark_rows");
  return html(
    "Benchmark rows",
    `<div class="console-heading"><h1>Benchmark rows</h1><p>Recorded once. Preserved as evidence.</p></div>${consoleStatus(query)}${table(
      "Benchmark rows",
      ["Model", "Organisation", "Benchmark", "Evaluation date", "Score"],
      rows.map((r) => [
        esc(r.subject_name),
        esc(r.organisation),
        esc(r.benchmark),
        esc(r.eval_date),
        esc(r.score),
      ]),
    )}<section class="compact-form"><h2>Record a benchmark row</h2>${form("Record a benchmark row", "/api/console/benchmark-rows", input("Subject", "subject") + input("Benchmark", "benchmark") + input("Evaluation date", "eval_date", "", { type: "date" }) + input("Score", "score") + input("Source note", "source_note", "", { textarea: true }) + '<button type="submit">Record row</button>', { success: "Row recorded." })}</section>`,
    { staff, console: true },
  );
}
async function requisitionsPage(
  staff: Staff,
  query: URLSearchParams,
): Promise<ApiResult> {
  requireRole(staff, "recruiter");
  const reqs = (await all<Requisition>(pool, "requisitions")).filter((r) =>
    r.recruiters.includes(staff.email),
  );
  return html(
    "Requisitions",
    `<div class="console-heading"><h1>Requisitions</h1><p>Roles, people and accountable decisions.</p></div>${consoleStatus(query)}<div class="console-grid"><aside class="console-list" tabindex="0"><h2>Your requisitions</h2>${reqs.map((r) => `<div class="list-item"><a href="/console/requisitions/${r.id}">${esc(r.title)}</a><small>${r.status}</small></div>`).join("")}</aside><section><h2>Create a requisition</h2>${form(
      "Create a requisition",
      "/api/console/requisitions",
      input("Title", "title") +
        input("Slug", "slug") +
        select(
          "Discipline",
          "discipline",
          ["research", "engineering", "policy", "operations"].map((x) => [
            x,
            x,
          ]),
        ) +
        select(
          "Office",
          "office",
          Object.entries(offices).map(([v, o]) => [v, o.label]),
        ) +
        input("Description", "description", "", { textarea: true }) +
        input("Recruiters", "recruiters", staff.email, {
          hint: "Separate staff email addresses with commas.",
        }) +
        '<button type="submit">Create requisition</button>',
      { mode: "requisition", success: "Draft saved." },
    )}</section></div>`,
    { staff, console: true },
  );
}
async function requisitionPage(
  staff: Staff,
  rid: string,
  query: URLSearchParams,
): Promise<ApiResult> {
  const r = await one<Requisition>(pool, "requisitions", rid);
  if (!r || !r.recruiters.includes(staff.email)) notFound();
  requireRole(staff, "recruiter");
  const apps = (await all<Application>(pool, "applications")).filter(
    (a) => a.requisition_id === r.id,
  );
  return html(
    r.title,
    `<div class="console-heading"><div><p class="quiet">Requisition / ${esc(r.status)}</p><h1>${esc(r.title)}</h1></div><div class="actions">${r.status === "draft" ? button("Open requisition", `/api/console/requisitions/${r.id}/open`, ' data-success="Requisition opened."') : r.status === "open" ? '<button type="button" data-open-dialog="close-requisition">Close requisition</button>' : ""}</div></div>${consoleStatus(query)}<div class="console-grid" data-record-version="${r.version}"><aside class="console-list" tabindex="0"><h2>Role record</h2><p>${esc(r.discipline)}</p><p>${esc(offices[r.office].label)}</p><p>${esc(regions[offices[r.office].region])}</p><small>${r.recruiters.map(esc).join("<br>")}</small>${r.status === "open" ? `<a href="/careers/${r.slug}">View public role</a>` : ""}</aside><div>${Object.entries(
      stageLabels,
    )
      .map(
        ([s, label]) =>
          `<section class="queue-group"><h2>${label} <span class="number">(${apps.filter((a) => a.stage === s).length})</span></h2>${apps
            .filter((a) => a.stage === s)
            .map(
              (a) =>
                `<div class="queue-row"><a href="/console/applications/${a.id}">${esc(a.name)}</a><span>${esc(a.reference)}</span></div>`,
            )
            .join("")}</section>`,
      )
      .join(
        "",
      )}</div></div>${dialog("close-requisition", "Close requisition", `<p>Active applications will move to Not progressing with this reason.</p>${form("Close requisition", `/api/console/requisitions/${r.id}/close`, input("Reason", "reason") + '<button type="submit">Close requisition</button>', { success: "Requisition closed." })}`)}`,
    { staff, console: true },
  );
}
async function applicationPage(
  staff: Staff,
  aid: string,
  query: URLSearchParams,
): Promise<ApiResult> {
  const a = await one<Application>(pool, "applications", aid);
  if (!a) notFound();
  const r = (await one<Requisition>(pool, "requisitions", a.requisition_id))!;
  if (!r.recruiters.includes(staff.email)) notFound();
  requireRole(staff, "recruiter");
  const endpoint = `/api/console/applications/${a.id}/`;
  return html(
    a.name,
    `<div class="console-heading"><div><p class="quiet">Application ${esc(a.reference)}</p><h1>${esc(a.name)}</h1></div><span class="state">${stageLabels[a.stage]}</span></div>${consoleStatus(query)}<div class="console-grid" data-record-version="${a.version}"><aside class="console-list" tabindex="0"><h2>${esc(r.title)}</h2><p>${esc(a.email)}</p><p>Submitted ${date(a.submitted_at)}</p><a href="${endpoint}resume">Download résumé</a>${button("Reissue tracking link", endpoint + "tracking-link/reissue", ' data-success="A new tracking link is on its way to the candidate."')}<a href="/console/requisitions/${r.id}">Back to requisition</a></aside><div><section><h2>Record a decision</h2>${form("Move application", endpoint + "stage", select("Move to stage", "to", Object.entries(stageLabels)) + input("Decision rationale", "rationale", "", { textarea: true }) + '<button type="submit">Record decision</button>', { success: "Decision recorded. The candidate will be told the new stage by email." })}</section><section class="comments"><h2>Interview notes</h2>${a.notes.map((n) => `<article><p>${esc(n.body)}</p><small>${esc(n.by)} / ${date(n.at)}</small></article>`).join("")}${form("Add interview note", endpoint + "notes", input("Interview note", "body", "", { textarea: true }) + '<button type="submit">Add note</button>', { success: "Note added." })}</section><section class="comments"><h2>Stage decisions</h2>${a.decisions.map((d) => `<article><h3>${stageLabels[d.from]} to ${stageLabels[d.to]}</h3><p>${esc(d.rationale)}</p><small>${esc(d.by)} / ${date(d.at)}</small></article>`).join("") || "<p>No stage decisions recorded yet.</p>"}</section></div></div>`,
    { staff, console: true },
  );
}
async function benefitsPage(
  staff: Staff,
  query: URLSearchParams,
): Promise<ApiResult> {
  requireRole(staff, "recruiter");
  const entries = await all<Benefits>(pool, "benefits");
  return html(
    "Benefits register",
    `<div class="console-heading"><h1>Benefits register</h1><p>Regional entries, in force by their effective date.</p></div>${consoleStatus(query)}<div class="console-grid"><aside class="console-list" tabindex="0"><h2>Recorded entries</h2>${entries
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
      .map(
        (e) =>
          `<article class="list-item"><h3>${esc(regions[e.region])}</h3><p>${esc(e.summary)}</p><small>${esc(e.effective_from)}</small></article>`,
      )
      .join(
        "",
      )}</aside><section><h2>Record a benefits entry</h2>${form("Record a benefits entry", "/api/console/benefits", select("Region", "region", Object.entries(regions)) + input("Effective from", "effective_from", "", { type: "date" }) + input("Summary", "summary", "", { textarea: true }) + '<button type="submit">Record benefits entry</button>', { success: "Benefits entry recorded." })}</section></div>`,
    { staff, console: true },
  );
}
async function grantsPage(
  staff: Staff,
  query: URLSearchParams,
): Promise<ApiResult> {
  requireRole(staff, "administrator");
  const grants = (await all<Grant>(pool, "grants")).map(grantShape);
  return html(
    "Role grants",
    `<div class="console-heading"><h1>Role grants</h1><p>Access belongs to a person, a purpose and an end date.</p></div>${consoleStatus(query)}<div class="grants-form"><h2>Grant a role</h2>${form(
      "Grant a role",
      "/api/console/grants",
      input("Staff email", "staff_email", "", { type: "email" }) +
        select(
          "Role",
          "role",
          ["editor", "approver", "recruiter", "administrator"].map((v) => [
            v,
            v[0].toUpperCase() + v.slice(1),
          ]),
        ) +
        input("Expires (London)", "expires_at", "", {
          hint: "YYYY-MM-DDTHH:mm",
        }) +
        '<button type="submit">Grant role</button>',
      { success: "Role granted.", mode: "grant" },
    )}</div>${table(
      "Grants",
      ["Staff", "Role", "Expires", "Status", "Action"],
      grants.map((g) => [
        esc(g.staff_email),
        esc(g.role),
        date(g.expires_at),
        esc(g.status),
        g.status === "active"
          ? button(
              `Revoke ${g.role} for ${g.staff_email}`,
              `/api/console/grants/${g.id}/revoke`,
              ` data-success="Role revoked." data-version="${g.version}"`,
            )
          : "—",
      ]),
    )}`,
    { staff, console: true },
  );
}
async function auditPage(
  staff: Staff,
  query: URLSearchParams,
): Promise<ApiResult> {
  requireRole(staff, "administrator");
  const entries = await listAudit(query);
  const oldest = entries[entries.length - 1];
  return html(
    "Audit record",
    `<div class="console-heading"><h1>Audit record</h1><p>Every change, attributed and preserved.</p></div>${consoleStatus(query)}<div class="actions"><button type="button" data-verify-chain>Verify chain</button></div>${table(
      "Audit record",
      ["Seq", "When", "Actor", "Action", "Target", "Detail"],
      entries.map((e) => [
        `<span class="number">${e.seq}</span>`,
        esc(formatTime(e.at)),
        esc(e.actor),
        esc(e.action),
        `${esc(e.target_type)}<small>${esc(e.target_id)}</small>`,
        esc(JSON.stringify(e.detail)),
      ]),
    )}${oldest && oldest.seq > 1 ? `<a class="text-link" href="/console/audit?before_seq=${oldest.seq}">Older entries</a>` : ""}`,
    { staff, console: true },
  );
}
async function jobsPage(
  staff: Staff,
  query: URLSearchParams,
): Promise<ApiResult> {
  requireRole(staff, "administrator");
  const state = ["pending", "dead", "done"].includes(query.get("state") || "")
    ? query.get("state")!
    : "pending";
  const filter = new URLSearchParams(query);
  filter.set("state", state);
  const jobs = await listJobs(filter);
  return html(
    "Jobs",
    `<div class="console-heading"><h1>Jobs</h1><p>Mail, erasure and sample uploads, with their attempts.</p></div>${consoleStatus(query)}<nav class="job-states" aria-label="Job states">${[
      ["pending", "Pending"],
      ["dead", "Dead"],
      ["done", "Done"],
    ]
      .map(
        ([value, label]) =>
          `<a href="/console/jobs?state=${value}"${state === value ? ' aria-current="true"' : ""}>${label}</a>`,
      )
      .join("")}</nav>${
      jobs.length
        ? table(
            "Jobs",
            [
              "Kind",
              "State",
              "Attempts",
              "Last error",
              "Next attempt",
              "Action",
            ],
            jobs.map((j) => [
              esc(j.kind),
              esc(j.state),
              `<span class="number">${j.attempts}</span>`,
              esc(j.last_error || "—"),
              j.next_attempt_at && j.state !== "done"
                ? esc(formatTime(j.next_attempt_at))
                : "—",
              j.state === "dead"
                ? button(
                    `Retry job ${j.id}`,
                    `/api/console/jobs/${j.id}/retry`,
                    ' data-success="Job queued for retry." data-inline',
                  )
                : "—",
            ]),
          )
        : `<div class="empty">${emptyDrawing()}<p>No jobs in this state.</p></div>`
    }`,
    { staff, console: true },
  );
}
async function signInPage(message = ""): Promise<ApiResult> {
  return html(
    "Staff sign-in",
    `<div class="signin"><p class="quiet">Aldermoor staff</p><h1>Sign in to the console.</h1><p>The governed record starts with an accountable person.</p><form aria-label="Staff sign-in" method="post" action="/console/sign-in" data-endpoint="/api/console/session" data-mode="signin" novalidate>${input("Email", "email", "", { type: "email" })}${input("Password", "password", "", { type: "password" })}<button type="submit">Sign in</button>${status("Sign-in status", message)}</form></div>`,
  );
}
export async function errorPage(
  path: string,
  error: ApiError,
): Promise<ApiResult> {
  if (path.startsWith("/track/"))
    return html(
      "This tracking link is not valid.",
      `<div class="status-page"><h1>This tracking link is not valid.</h1>${resendForm()}</div>`,
      {},
      404,
    );
  if (error.status === 410) {
    const heading = path.startsWith("/news/")
      ? "This post has been withdrawn."
      : path.startsWith("/models/")
        ? "This model route has been withdrawn."
        : "This role has closed.";
    return html(
      heading,
      `<div class="status-page"><h1>${heading}</h1><a href="/">Return to the open record</a></div>`,
      {},
      410,
    );
  }
  if (error.status === 404)
    return html(
      "Nothing is published here",
      '<div class="status-page"><h1>Nothing is published here</h1><p>The public record is available from the home page.</p><a href="/">Return to the open record</a></div>',
      {},
      404,
    );
  const detail = Object.values(error.fields || {})[0];
  return html(
    "Request could not be completed",
    `<div class="status-page"><h1>${esc(detail || error.message)}</h1><a href="/">Return to the open record</a></div>`,
    {},
    error.status,
  );
}
export async function htmlRoute(
  req: IncomingMessage,
  url: URL,
  body: Record<string, unknown>,
  multipart?: Multipart,
): Promise<ApiResult> {
  const path = url.pathname,
    q = url.searchParams;
  const method = req.method || "GET";
  if (path === "/console/sign-in") {
    if (method === "POST") {
      try {
        const signed = await signIn(body);
        return {
          status: 303,
          data: "",
          headers: {
            Location: "/console",
            "Set-Cookie": sessionCookie(signed.token, config.sessionTtl),
          },
        };
      } catch (error) {
        return signInPage(error instanceof Error ? error.message : "");
      }
    }
    return signInPage();
  }
  if (path.startsWith("/console")) {
    const staff = await sessionStaff(req);
    if (!staff)
      return {
        status: 303,
        data: "",
        headers: { Location: "/console/sign-in" },
      };
    if (path === "/console") return consoleHome(staff, q);
    if (path === "/console/content/new")
      return contentPage(
        staff,
        null,
        q.get("kind") === "model" ? "model" : "news",
        q,
      );
    if (path.startsWith("/console/content/")) {
      const c = await one<Content>(
        pool,
        "content",
        path.slice("/console/content/".length),
      );
      if (!c) notFound();
      return contentPage(staff, c, c.kind, q);
    }
    if (path === "/console/rows") return rowsPage(staff, q);
    if (path === "/console/requisitions") return requisitionsPage(staff, q);
    if (path.startsWith("/console/requisitions/"))
      return requisitionPage(
        staff,
        path.slice("/console/requisitions/".length),
        q,
      );
    if (path.startsWith("/console/applications/"))
      return applicationPage(
        staff,
        path.slice("/console/applications/".length),
        q,
      );
    if (path === "/console/benefits") return benefitsPage(staff, q);
    if (path === "/console/grants") return grantsPage(staff, q);
    if (path === "/console/audit") return auditPage(staff, q);
    if (path === "/console/jobs") return jobsPage(staff, q);
    publicNotFound();
  }
  if (
    method === "POST" &&
    str(body._intent) === "resend" &&
    (path === "/careers" || path.startsWith("/track/"))
  ) {
    let message = "",
      error = "";
    try {
      const result = await resendLinks(str(body.email));
      message = str((result.data as { message: string }).message);
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      message = caught.fields?.email || caught.message;
      error = caught.fields?.email || "";
    }
    if (path === "/careers") return careersPage(q, message, error);
    return html(
      "This tracking link is not valid.",
      `<div class="status-page"><h1>This tracking link is not valid.</h1>${resendForm(message, error)}</div>`,
    );
  }
  if (method === "POST" && path.startsWith("/track/")) {
    const token = path.slice(7);
    if (str(body._intent) === "withdraw-question")
      return trackingPage(token, "", true);
    if (str(body._intent) === "withdraw-confirm") {
      await tracking(token, true);
      return trackingPage(token, "Your application has been withdrawn.");
    }
  }
  if (path === "/") return homePage();
  if (path === "/models") return modelsPage(parseAsOf(q.get("as_of")));
  if (path.startsWith("/models/"))
    return modelPage(
      decodeURIComponent(path.slice(8)),
      parseAsOf(q.get("as_of")),
    );
  if (path === "/news") return newsroomPage(q);
  if (path.startsWith("/news/"))
    return newsPage(
      decodeURIComponent(path.slice(6)),
      parseAsOf(q.get("as_of")),
    );
  if (path === "/search") return searchPage(q);
  if (path === "/careers") return careersPage(q);
  const application = path.match(/^\/careers\/([^/]+)$/);
  if (application && method === "POST") {
    const slug = application[1];
    try {
      await submitApplication(slug, multipart!);
      return rolePage(
        slug,
        `Application received. Your receipt and tracking link are on their way to ${multipart!.fields.email}.`,
      );
    } catch (error) {
      if (error instanceof ApiError)
        return rolePage(slug, error.message, error.fields, multipart!.fields);
      throw error;
    }
  }
  if (path.startsWith("/careers/"))
    return rolePage(decodeURIComponent(path.slice(9)));
  if (path.startsWith("/track/"))
    return trackingPage(path.slice(7), q.get("notice") || "");
  publicNotFound();
}
