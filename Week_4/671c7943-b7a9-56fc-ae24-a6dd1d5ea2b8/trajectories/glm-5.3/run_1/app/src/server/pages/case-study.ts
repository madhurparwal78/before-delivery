import type { Project } from "../../domain/model.js";
import { CATEGORY_NAMES, type CategoryId } from "../../domain/model.js";
import { escapeHtml } from "../html.js";
import { projectPlateSvg, screenPlateSvg } from "../plates.js";
import { headerHtml, footerHtml } from "./home.js";
import { NOT_FOUND, PRIVACY, BRIEF_UNAVAILABLE } from "../../domain/seed.js";

const CASE_SECTIONS = [
  { id: "overview", name: "Overview" },
  { id: "objectives", name: "Objectives" },
  { id: "visual-system", name: "Visual system" },
  { id: "showcase", name: "Showcase" },
  { id: "process", name: "Process" },
  { id: "results", name: "Results" },
] as const;

function weeksLine(weeks: number): string {
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

function pageShell(title: string, body: string, extraClass = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/css/site.css">
</head>
<body class="${extraClass}">
${headerHtml()}
<main id="main">
${body}
</main>
${footerHtml()}
<div class="status" role="status" aria-label="Site updates"></div>
<script src="/js/site.js" type="module"></script>
</body>
</html>`;
}

export function caseStudyHtml(project: Project, sequence: { prev: Project | null; next: Project | null; category: CategoryId | null }): string {
  const eyebrow = `${CATEGORY_NAMES[project.category]} · ${project.year}`;
  const screens = project.screens
    .map(
      (screen, index) => `<figure class="showcase-screen" data-screen-index="${index + 1}">
      ${screenPlateSvg(project, index, 1280, 800)}
      <figcaption>${escapeHtml(screen.caption)}</figcaption>
    </figure>`
    )
    .join("");
  const navLinks = CASE_SECTIONS.map((section) => `<a class="on-this-page-link" href="#${section.id}" data-section-link="${section.id}">${section.name}</a>`).join("");
  const prev = sequence.prev
    ? `<a class="more-link prev" href="/work/${sequence.prev.slug}${sequence.category ? `?category=${sequence.category}` : ""}" data-prev-project>Previous project: ${escapeHtml(sequence.prev.title)}</a>`
    : "";
  const next = sequence.next
    ? `<a class="more-link next" href="/work/${sequence.next.slug}${sequence.category ? `?category=${sequence.category}` : ""}" data-next-project>Next project: ${escapeHtml(sequence.next.title)}</a>`
    : "";
  const allWorkHref = sequence.category ? `/?category=${sequence.category}#work` : "/#work";
  const body = `<article class="case-study" data-slug="${project.slug}">
  <header class="case-header" data-title-lines>
    <p class="case-eyebrow" data-title-line="eyebrow">${escapeHtml(eyebrow)}</p>
    <h1 class="case-title" id="case-title" tabindex="-1" data-title-line="title">${escapeHtml(project.title)}</h1>
    <p class="case-standfirst" data-title-line="standfirst">${escapeHtml(project.standfirst)}</p>
  </header>
  <div class="case-hero" data-hero role="img" aria-label="${escapeHtml(project.title)} cover">${projectPlateSvg(project, { width: 1600, height: 900, hidden: true })}</div>
  <div class="case-body">
    <nav class="on-this-page" aria-label="On this page">${navLinks}</nav>
    <div class="case-sections">
      <section class="case-section" id="overview" aria-labelledby="overview-heading">
        <h2 id="overview-heading" class="section-heading reveal-heading" tabindex="-1">Overview</h2>
        <dl class="case-details">
          <div><dt>Client</dt><dd>${escapeHtml(project.client)}</dd></div>
          <div><dt>Year</dt><dd>${project.year}</dd></div>
          <div><dt>Service</dt><dd>${escapeHtml(CATEGORY_NAMES[project.category])}</dd></div>
          <div><dt>Role</dt><dd>${escapeHtml(project.role)}</dd></div>
          <div><dt>Duration</dt><dd>${escapeHtml(project.duration)}</dd></div>
        </dl>
        <p>${escapeHtml(project.overview)}</p>
      </section>
      <section class="case-section" id="objectives" aria-labelledby="objectives-heading">
        <h2 id="objectives-heading" class="section-heading reveal-heading" tabindex="-1">Objectives</h2>
        <ol class="objectives">
          ${project.objectives.map((objective) => `<li>${escapeHtml(objective)}</li>`).join("")}
        </ol>
      </section>
      <section class="case-section" id="visual-system" aria-labelledby="visual-system-heading">
        <h2 id="visual-system-heading" class="section-heading reveal-heading" tabindex="-1">Visual system</h2>
        <ul class="swatches">
          ${project.palette.map((colour) => `<li class="swatch"><span class="swatch-block" style="background:${colour.hex}"></span><span class="swatch-name">${escapeHtml(colour.name)}</span><span class="swatch-hex">${escapeHtml(colour.hex)}</span></li>`).join("")}
        </ul>
      </section>
      <section class="case-section" id="showcase" aria-labelledby="showcase-heading">
        <h2 id="showcase-heading" class="section-heading reveal-heading" tabindex="-1">Showcase</h2>
        <div class="showcase region" role="region" aria-label="Showcase" data-screen="1">
          <div class="showcase-track">${screens}</div>
          <div class="showcase-controls">
            <button class="showcase-button" type="button" data-showcase-prev disabled>Previous screen</button>
            <span class="showcase-counter" data-showcase-counter>1 / ${project.screens.length}</span>
            <button class="showcase-button" type="button" data-showcase-next${project.screens.length === 1 ? " disabled" : ""}>Next screen</button>
          </div>
        </div>
      </section>
      <section class="case-section" id="process" aria-labelledby="process-heading">
        <h2 id="process-heading" class="section-heading reveal-heading" tabindex="-1">Process</h2>
        <ul class="case-process">
          ${project.process.map((weeks, index) => `<li>${["Discover", "Define", "Design", "Deliver"][index]} · ${weeksLine(weeks)}</li>`).join("")}
        </ul>
      </section>
      <section class="case-section" id="results" aria-labelledby="results-heading">
        <h2 id="results-heading" class="section-heading reveal-heading" tabindex="-1">Results</h2>
        <ul class="results">
          ${project.results.map((result) => `<li class="result"><span class="result-value">${escapeHtml(result.value)}</span><span class="result-label">${escapeHtml(result.label)}</span></li>`).join("")}
        </ul>
      </section>
      <nav class="more-work" aria-label="More work">
        ${prev}
        ${next}
        <a class="more-link" href="${allWorkHref}" data-all-work>All work</a>
      </nav>
    </div>
  </div>
</article>`;
  return pageShell(`${project.title} | Sollis Studio`, body, "page-case");
}

export function privacyHtml(): string {
  const body = `<div class="simple-page" id="privacy">
  <h1 id="page-title" tabindex="-1">Privacy</h1>
  ${PRIVACY.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
  <p><a href="/">Back to Sollis Studio</a></p>
</div>`;
  return pageShell("Privacy | Sollis Studio", body, "page-privacy");
}

export function notFoundHtml(kind: "project" | "page"): string {
  const copy = kind === "project" ? NOT_FOUND.project : NOT_FOUND.page;
  const body = `<div class="simple-page" id="not-found">
  <h1 id="page-title" tabindex="-1">${escapeHtml(copy.heading)}</h1>
  <p><a href="${kind === "project" ? "/#work" : "/"}">${escapeHtml(copy.link)}</a></p>
</div>`;
  return pageShell("Not found | Sollis Studio", body, "page-not-found");
}

export function briefUnavailableHtml(reference: string): string {
  const body = `<div class="simple-page" id="brief-unavailable">
  <h1 id="page-title" tabindex="-1">${escapeHtml(BRIEF_UNAVAILABLE.heading)}</h1>
  <p>${escapeHtml(BRIEF_UNAVAILABLE.line(reference))}</p>
</div>`;
  return pageShell("Brief unavailable | Sollis Studio", body, "page-brief-unavailable");
}
