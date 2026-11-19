/** A case study page: title, description list, preview with callouts, prose and stack. */

import { frameKey, mediaHref } from '../../shared/media.js';
import {
  NO_CALLOUT_READOUT,
  backToWorkHref,
  calloutReadout,
  neighbourProjects,
  projectHref,
} from '../../shared/rules.js';
import {
  CASE_STUDY_SECTIONS,
  disciplineName,
  type DisciplineId,
  type Project,
} from '../../shared/seed.js';
import { frameAltText } from '../../shared/text.js';
import { attrs, escapeHtml, listItems } from './html.js';

export const CASE_STUDY_HEADING_ID = 'case-study-title';

const prose = (project: Project, id: string): string => {
  switch (id) {
    case 'overview':
      return `<p>${escapeHtml(project.overview)}</p>`;
    case 'challenge':
      return `<p>${escapeHtml(project.challenge)}</p>`;
    case 'solution':
      return `<p>${escapeHtml(project.solution)}</p>`;
    case 'decisions':
      return `<p>${escapeHtml(project.decisions)}</p>`;
    default:
      return `<ul class="rule-list stack-list">${listItems(project.stack)}</ul>`;
  }
};

const previewFigure = (project: Project, callout: number | null): string => {
  const selected = project.callouts.find((item) => item.n === callout) ?? null;
  const frame = selected === null ? 1 : selected.to;
  return (
    `<figure class="preview"${attrs({
      'data-preview': true,
      'data-callout': selected === null ? null : selected.n,
      tabindex: -1,
    })}>` +
    `<div class="preview-stage media-slot"${attrs({
      'data-preview-frame': true,
      'data-frame': frame,
      'data-media-slot': true,
      'data-media-key': frameKey(project.slug, frame),
      'data-media-kind': 'frame',
      'data-media-title': project.title,
    })}>` +
    `<img class="media-image" data-media-image${attrs({
      src: mediaHref(frameKey(project.slug, frame)),
      alt: frameAltText(project.title, frame),
    })}>` +
    `<span class="callout-region"${attrs({
      'data-callout-region': true,
      hidden: selected === null,
      style:
        selected === null
          ? null
          : `--region-left:${selected.region.left}%;--region-top:${selected.region.top}%;` +
            `--region-width:${selected.region.width}%;--region-height:${selected.region.height}%`,
    })}></span>` +
    '</div>' +
    `<figcaption class="preview-readout mono" data-readout>${escapeHtml(
      selected === null ? NO_CALLOUT_READOUT : calloutReadout(selected),
    )}</figcaption>` +
    '<p class="callouts-heading" id="callouts-heading">Callouts</p>' +
    '<ol class="callouts" aria-labelledby="callouts-heading">' +
    project.callouts
      .map(
        (item) =>
          '<li class="callout">' +
          `<button type="button" class="callout-button"${attrs({
            'data-callout-button': item.n,
            'aria-pressed': item.n === callout ? 'true' : 'false',
          })}><span class="callout-number mono" aria-hidden="true">${item.n}</span>` +
          `Callout ${item.n}: ${escapeHtml(item.label)}</button></li>`,
      )
      .join('') +
    '</ol></figure>'
  );
};

export interface CaseStudyOptions {
  readonly project: Project;
  readonly pressed: readonly DisciplineId[];
  readonly callout: number | null;
}

export const renderCaseStudyMain = (options: CaseStudyOptions): string => {
  const { project, pressed } = options;
  const neighbours = neighbourProjects(project, pressed);
  const disciplines = project.disciplines.map(disciplineName).join(', ');
  return (
    '<article class="case-study">' +
    `<h1 class="case-title" id="${CASE_STUDY_HEADING_ID}" tabindex="-1">${escapeHtml(project.title)}</h1>` +
    `<p class="case-kind">${escapeHtml(project.kind)}</p>` +
    '<dl class="case-facts">' +
    `<dt>Client</dt><dd>${escapeHtml(`${project.client} (illustrative)`)}</dd>` +
    `<dt>Year</dt><dd class="mono">${project.year}</dd>` +
    `<dt>Role</dt><dd>${escapeHtml(project.role)}</dd>` +
    `<dt>Disciplines</dt><dd>${escapeHtml(disciplines)}</dd>` +
    '</dl>' +
    `<a class="back-link" href="${escapeHtml(backToWorkHref(pressed))}" data-back-to-work>Back to work</a>` +
    '<nav class="on-this-page" aria-label="On this page">' +
    CASE_STUDY_SECTIONS.map(
      (section) =>
        `<a${attrs({ href: `#${section.id}`, 'data-toc-link': section.id })}>${escapeHtml(section.heading)}</a>`,
    ).join('') +
    '</nav>' +
    '<div class="case-body">' +
    previewFigure(project, options.callout) +
    '<div class="case-sections">' +
    CASE_STUDY_SECTIONS.map(
      (section) =>
        `<section${attrs({ id: section.id, 'data-case-section': section.id })}>` +
        `<h2 class="section-heading" id="${section.id}-heading" tabindex="-1">${escapeHtml(section.heading)}</h2>` +
        prose(project, section.id) +
        '</section>',
    ).join('') +
    '</div></div>' +
    '<nav class="more-projects" aria-label="More projects">' +
    (neighbours.previous === null
      ? ''
      : `<a${attrs({ href: projectHref(neighbours.previous.slug, pressed) })}>Previous project: ${escapeHtml(neighbours.previous.title)}</a>`) +
    (neighbours.next === null
      ? ''
      : `<a${attrs({ href: projectHref(neighbours.next.slug, pressed) })}>Next project: ${escapeHtml(neighbours.next.title)}</a>`) +
    '</nav>' +
    '</article>'
  );
};
