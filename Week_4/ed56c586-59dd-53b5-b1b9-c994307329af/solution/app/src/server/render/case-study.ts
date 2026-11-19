import { CASE_STUDY_SECTIONS, FRAMES_PER_PROJECT, disciplineName, type DisciplineValue, type Project } from "../../shared/catalog.js";
import { galleryHref, caseStudyHref } from "../../shared/filter.js";
import { NO_CALLOUT_READOUT, calloutButtonLabel, calloutRange } from "../../shared/callout.js";
import { frameKey, frameLabel } from "../../shared/media-manifest.js";
import { neighbours } from "../../shared/neighbours.js";
import { html, type Markup } from "./html.js";
import { renderFrameSlot } from "./frame-slot.js";
import { renderDocument } from "./layout.js";

/** A case study: the project's facts, its preview with the Callout Thread, and the five written sections. */

function preview(project: Project): Markup {
  const frames = Array.from({ length: FRAMES_PER_PROJECT }, (_, index) =>
    renderFrameSlot({ key: frameKey(project.slug, index + 1), label: frameLabel(project.title, index + 1), frame: index + 1, hidden: index > 0 }));
  const callouts = project.callouts.map((callout, index) => html`<li><button type="button" class="callout-button" data-callout-button="${index + 1}" aria-pressed="false" aria-label="${calloutButtonLabel(index + 1, callout)}" data-range="frames ${calloutRange(callout)}"><span class="callout-label">${callout.label}</span></button></li>`);
  return html`<figure class="case-preview" data-preview tabindex="-1">
    <div class="preview-frame" data-preview-frame data-frame="1">${frames}<div class="callout-region" data-callout-region hidden></div></div>
    <figcaption class="preview-caption">
      <p class="readout" data-readout>${NO_CALLOUT_READOUT}</p>
      <ul class="callouts" aria-label="Callouts">${callouts}</ul>
    </figcaption>
  </figure>`;
}

function sections(project: Project): Markup {
  const prose: Readonly<Record<string, string>> = {
    overview: project.overview,
    challenge: project.challenge,
    solution: project.solution,
    decisions: project.decisions,
  };
  return html`${CASE_STUDY_SECTIONS.map((section) => html`<section class="case-section" id="${section.id}" data-case-section="${section.id}" aria-labelledby="${section.id}-title">
    <h2 class="case-heading" id="${section.id}-title" tabindex="-1">${section.label}</h2>
    ${section.id === "stack" ? html`<ul class="stack-list">${project.stack.map((technology) => html`<li>${technology}</li>`)}</ul>` : html`<p>${prose[section.id] ?? ""}</p>`}
  </section>`)}`;
}

function moreProjects(project: Project, categories: readonly DisciplineValue[]): Markup {
  const { previous, next } = neighbours(project, categories);
  return html`<nav class="more-projects" aria-label="More projects">
    ${previous === undefined ? "" : html`<a class="neighbour neighbour-previous" href="${caseStudyHref(previous.slug, categories)}"><span class="neighbour-label">Previous project:</span> <span class="neighbour-title">${previous.title}</span></a>`}
    ${next === undefined ? "" : html`<a class="neighbour neighbour-next" href="${caseStudyHref(next.slug, categories)}"><span class="neighbour-label">Next project:</span> <span class="neighbour-title">${next.title}</span></a>`}
  </nav>`;
}

export function caseStudyPage(project: Project, categories: readonly DisciplineValue[]): string {
  const disciplines = project.disciplines.map(disciplineName).join(", ");
  const main = html`<article class="case-study" data-case-study="${project.slug}">
    <div class="sheet case-grid">
      <div class="case-head">
        <h1 class="case-title" id="page-title" tabindex="-1">${project.title}</h1>
        <p class="case-kind">${project.kind}</p>
        <dl class="case-facts">
          <div><dt>Client</dt><dd>${project.client} (illustrative)</dd></div>
          <div><dt>Year</dt><dd class="mono">${project.year}</dd></div>
          <div><dt>Role</dt><dd>${project.role}</dd></div>
          <div><dt>Disciplines</dt><dd>${disciplines}</dd></div>
        </dl>
        <a class="back-link" href="${galleryHref(categories)}" data-back-to-work="${project.slug}">Back to work</a>
      </div>
      <nav class="case-toc" aria-label="On this page"><ul>${CASE_STUDY_SECTIONS.map((section) => html`<li><a href="#${section.id}" data-toc-link="${section.id}">${section.label}</a></li>`)}</ul></nav>
      ${preview(project)}
      <div class="case-prose">${sections(project)}</div>
      ${moreProjects(project, categories)}
    </div>
  </article>`;
  return renderDocument({ kind: "case-study", title: `${project.title} | Ottoline Rask`, main });
}
