import { CASE_STUDY_SECTIONS, PROCESS_STEPS, serviceName } from '../content/copy.js';
import type { CategoryId, Project } from '../shared/types.js';
import { escapeHtml } from './html.js';
import { coverPlate, screenPlate } from './plates.js';
import { renderPage } from './layout.js';

export interface CaseStudyView {
  project: Project;
  index: number;
  previous: Project | null;
  next: Project | null;
  category: CategoryId | null;
}

const sectionHeading = (id: string, text: string): string =>
  `<h2 class="case__heading" id="${id}-heading" tabindex="-1" data-section-heading>${escapeHtml(
    text,
  )}</h2>`;

const workHref = (slug: string, category: CategoryId | null): string =>
  category === null ? `/work/${slug}` : `/work/${slug}?category=${category}`;

const overview = (project: Project): string => {
  const rows: [string, string][] = [
    ['Client', project.client],
    ['Year', String(project.year)],
    ['Service', serviceName(project.category)],
    ['Role', project.role],
    ['Duration', project.duration],
  ];
  return `<section class="case__section" id="overview">
  ${sectionHeading('overview', 'Overview')}
  <dl class="case__facts rules">
    ${rows
      .map(
        ([label, value]) =>
          `<div class="case__fact"><dt>${escapeHtml(label)}</dt> <dd class="figures">${escapeHtml(
            value,
          )}</dd></div>`,
      )
      .join('\n    ')}
  </dl>
  <p class="case__prose">${escapeHtml(project.overview)}</p>
</section>`;
};

const objectives = (project: Project): string => `<section class="case__section" id="objectives">
  ${sectionHeading('objectives', 'Objectives')}
  <ol class="case__objectives rules">
    ${project.objectives.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n    ')}
  </ol>
</section>`;

const visualSystem = (project: Project): string => `<section class="case__section" id="visual-system">
  ${sectionHeading('visual-system', 'Visual system')}
  <ul class="swatches">
    ${project.palette
      .map(
        (colour) =>
          `<li class="swatch"><span class="swatch__block" style="background-color:${escapeHtml(
            colour.hex,
          )}"></span><span class="swatch__name">${escapeHtml(colour.name)}</span> <span class="swatch__hex figures">${escapeHtml(
            colour.hex,
          )}</span></li>`,
      )
      .join('\n    ')}
  </ul>
</section>`;

const showcase = (project: Project): string => `<section class="case__section" id="showcase">
  ${sectionHeading('showcase', 'Showcase')}
  <div class="showcase" role="region" aria-label="Showcase" data-showcase data-screen="1">
    <div class="showcase__row" data-showcase-row>
      ${project.screens
        .map(
          (screen, index) =>
            `<figure class="showcase__screen" data-showcase-screen="${index + 1}">
        <div class="showcase__plate plate-frame">${screenPlate(project, index)}</div>
        <figcaption>${escapeHtml(screen.caption)}</figcaption>
      </figure>`,
        )
        .join('\n      ')}
    </div>
    <div class="showcase__controls">
      <button class="button button--quiet" type="button" data-showcase-previous disabled>Previous screen</button>
      <span class="showcase__counter figures" data-showcase-counter>${escapeHtml(
        `1 / ${project.screens.length}`,
      )}</span>
      <button class="button button--quiet" type="button" data-showcase-next${
        project.screens.length > 1 ? '' : ' disabled'
      }>Next screen</button>
    </div>
  </div>
</section>`;

const process = (project: Project): string => `<section class="case__section" id="process">
  ${sectionHeading('process', 'Process')}
  <ul class="case__process rules">
    ${project.process
      .map((weeks, index) => {
        const step = PROCESS_STEPS[index]!;
        return `<li class="figures">${escapeHtml(
          `${step.name} · ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`,
        )}</li>`;
      })
      .join('\n    ')}
  </ul>
</section>`;

const results = (project: Project): string => `<section class="case__section" id="results">
  ${sectionHeading('results', 'Results')}
  <ul class="case__results">
    ${project.results
      .map(
        (result) =>
          `<li><span class="case__result-value figures">${escapeHtml(
            result.value,
          )}</span> <span class="case__result-label">${escapeHtml(result.label)}</span></li>`,
      )
      .join('\n    ')}
  </ul>
</section>`;

const moreWork = (view: CaseStudyView): string => {
  const links: string[] = [];
  if (view.previous) {
    links.push(
      `<a class="link-underline" href="${escapeHtml(
        workHref(view.previous.slug, view.category),
      )}" data-neighbour="previous">${escapeHtml(`Previous project: ${view.previous.title}`)}</a>`,
    );
  }
  if (view.next) {
    links.push(
      `<a class="link-underline" href="${escapeHtml(
        workHref(view.next.slug, view.category),
      )}" data-neighbour="next">${escapeHtml(`Next project: ${view.next.title}`)}</a>`,
    );
  }
  links.push(
    `<a class="link-underline" href="${
      view.category === null ? '/#work' : `/?category=${view.category}#work`
    }" data-all-work>All work</a>`,
  );
  return `<nav class="case__more" aria-label="More work">
  ${links.join('\n  ')}
</nav>`;
};

export function caseStudyMain(view: CaseStudyView): string {
  const project = view.project;
  return `<article class="case" data-case="${escapeHtml(project.slug)}">
  <header class="case__header">
    <p class="case__eyebrow figures" data-title-line="1">${escapeHtml(
      `${serviceName(project.category)} · ${project.year}`,
    )}</p>
    <span class="case__index figures" aria-hidden="true">${String(view.index + 1).padStart(2, '0')}</span>
    <h1 class="case__title" id="case-heading" tabindex="-1" data-title-line="2">${escapeHtml(
      project.title,
    )}</h1>
    <p class="case__standfirst" data-title-line="3">${escapeHtml(project.standfirst)}</p>
  </header>
  <div class="case__hero plate-frame" data-hero role="img" aria-label="${escapeHtml(
    `${project.title} cover`,
  )}">${coverPlate(project)}</div>
  <div class="case__body">
    <nav class="case__toc" aria-label="On this page">
      ${CASE_STUDY_SECTIONS.map(
        (entry) =>
          `<a href="#${entry.id}" data-toc="${entry.id}">${escapeHtml(entry.heading)}</a>`,
      ).join('\n      ')}
    </nav>
    <div class="case__sections">
      ${overview(project)}
      ${objectives(project)}
      ${visualSystem(project)}
      ${showcase(project)}
      ${process(project)}
      ${results(project)}
      ${moreWork(view)}
    </div>
  </div>
</article>`;
}

export function renderCaseStudy(view: CaseStudyView): string {
  return renderPage({
    title: `${view.project.title} | Sollis Studio`,
    headingId: 'case-heading',
    main: caseStudyMain(view),
  });
}
