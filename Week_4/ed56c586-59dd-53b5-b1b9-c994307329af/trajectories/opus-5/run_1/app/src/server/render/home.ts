/** The home page: intro, about, work, services, skills, reviews, numbers, contact. */

import {
  BUDGET_OPTIONS,
  PROJECT_TYPE_OPTIONS,
  PROJECT_TYPE_PLACEHOLDER,
} from '../../shared/enquiry.js';
import { coverKey, mediaHref } from '../../shared/media.js';
import {
  filterProjects,
  projectHref,
  resultLineText,
  projectsUsing,
  NO_USAGE_TEXT,
} from '../../shared/rules.js';
import {
  ABOUT,
  ABOUT_FIGURES,
  CONTACT,
  DISCIPLINES,
  HERO,
  MILESTONES,
  NUMBERS_FIGURES,
  PROJECTS,
  REVIEWS,
  REVIEWS_NOTICE,
  ROLES,
  ROLES_SUMMARY,
  SERVICES,
  SKILL_GROUPS,
  disciplineName,
  type DisciplineId,
  type Figure,
  type Project,
} from '../../shared/seed.js';
import { coverAltText } from '../../shared/text.js';
import { heroSculpture, serviceVisual } from './art.js';
import { attrs, escapeHtml, glyph, listItems, visuallyHidden } from './html.js';
import { SOCIAL_LINKS, newTabLink } from './layout.js';

export const HOME_HEADING_ID = 'hero-headline';

const introSection = (startDone: boolean): string => {
  const words = HERO.headline.split(' ');
  const firstRole = ROLES[0] ?? '';
  return (
    `<section${attrs({
      id: 'intro',
      class: 'intro',
      'data-section': 'intro',
      'aria-labelledby': HOME_HEADING_ID,
      'data-intro': startDone ? 'done' : 'playing',
    })}>` +
    '<div class="intro-inner">' +
    '<div class="hero-copy" data-hero-copy>' +
    `<p class="hero-greeting" data-greeting>${escapeHtml(HERO.greeting)}</p>` +
    `<h1 class="hero-headline" id="${HOME_HEADING_ID}" tabindex="-1">` +
    words
      .map(
        (word, index) =>
          `<span class="headline-word" data-headline-word style="--word-index:${index}">${escapeHtml(word)}</span>`,
      )
      .join(' ') +
    '</h1>' +
    '<div class="hero-roles">' +
    '<p class="role-line" data-role-line aria-hidden="true">' +
    `I'm a <span class="role" data-role data-role-index="1">${escapeHtml(firstRole)}</span>.</p>` +
    `<p class="visually-hidden" data-roles-summary>${escapeHtml(ROLES_SUMMARY)}</p>` +
    '<div class="role-buttons">' +
    '<button type="button" class="role-button" data-role-previous>Previous role</button>' +
    '<button type="button" class="role-button" data-role-next>Next role</button>' +
    '<button type="button" class="role-button" data-role-toggle>Pause roles</button>' +
    '</div></div>' +
    `<p class="hero-paragraph">${escapeHtml(HERO.paragraph)}</p>` +
    '<div class="hero-links">' +
    `<a class="button-link" href="/#work">Explore projects${glyph('\u2192')}</a>` +
    '<a class="button-link ghost" href="/#contact">Start a project</a>' +
    '</div></div>' +
    `<div class="hero-visual" data-hero-visual data-tilt-x="0" data-tilt-y="0" aria-hidden="true">${heroSculpture()}</div>` +
    '</div></section>'
  );
};

const figureBlock = (block: 'about' | 'numbers', figures: readonly Figure[]): string =>
  `<div${attrs({ class: 'figures', 'data-stats': block, 'data-state': 'idle' })}>` +
  '<p class="illustrative-label">Illustrative figures</p>' +
  '<div class="figures-row">' +
  figures
    .map(
      (figure) =>
        '<div class="figure">' +
        visuallyHidden(`${figure.label}: ${figure.target}${figure.suffix}`) +
        `<p class="figure-value mono" aria-hidden="true"><span${attrs({
          'data-counter': figure.key,
          'data-target': figure.target,
        })}>0</span>${escapeHtml(figure.suffix)}</p>` +
        `<p class="figure-label" aria-hidden="true">${escapeHtml(figure.label)}</p>` +
        '</div>',
    )
    .join('') +
  '</div></div>';

const aboutSection = (): string =>
  '<section id="about" class="about" data-section="about" aria-labelledby="about-heading">' +
  '<h2 id="about-heading" class="section-heading" tabindex="-1">About</h2>' +
  '<div class="about-grid">' +
  '<div class="about-prose">' +
  `<p class="lead">${escapeHtml(ABOUT.introduction)}</p>` +
  `<p>${escapeHtml(ABOUT.philosophy)}</p>` +
  '</div>' +
  '<div class="about-lists">' +
  '<h3 id="principles-heading">Working principles</h3>' +
  `<ul class="rule-list" aria-labelledby="principles-heading">${listItems(ABOUT.principles)}</ul>` +
  '<h3 id="expertise-heading">Areas of expertise</h3>' +
  `<ul class="rule-list" aria-labelledby="expertise-heading">${listItems(ABOUT.expertise)}</ul>` +
  '</div></div>' +
  figureBlock('about', ABOUT_FIGURES) +
  '<div class="journey">' +
  '<h3 id="journey-heading">Career journey</h3>' +
  '<p class="illustrative-label">Illustrative career timeline</p>' +
  '<ol class="journey-list" aria-labelledby="journey-heading">' +
  MILESTONES.map((milestone, index) => {
    const detailId = `milestone-${index + 1}-detail`;
    return (
      `<li class="milestone"${attrs({ 'data-milestone': index + 1, 'data-reached': 'false' })}>` +
      `<button type="button" class="milestone-button"${attrs({
        'aria-expanded': 'false',
        'aria-controls': detailId,
      })}><span class="mono milestone-year">${escapeHtml(milestone.year)}</span>: ${escapeHtml(milestone.title)}</button>` +
      `<p class="milestone-detail" id="${detailId}" hidden>${escapeHtml(milestone.detail)}</p>` +
      '</li>'
    );
  }).join('') +
  '</ol>' +
  '<div class="journey-progress" data-journey-progress data-value="0" aria-hidden="true">' +
  '<span class="journey-progress-line"></span></div>' +
  '</div></section>';

const projectCard = (project: Project, pressed: readonly DisciplineId[], shown: boolean, column: number): string => {
  const names = project.disciplines.map(disciplineName).join(', ');
  return (
    `<article${attrs({
      class: 'card',
      'data-project': project.slug,
      'data-categories': project.disciplines.join(' '),
      'data-revealed': 'false',
      'data-col': shown ? column : null,
      style: `--card-tint:${project.tint}`,
      hidden: !shown,
    })}>` +
    `<div class="card-cover media-slot"${attrs({
      'data-media-slot': true,
      'data-media-key': coverKey(project.slug),
      'data-media-kind': 'cover',
      'data-media-title': project.title,
    })}>` +
    `<img class="media-image" data-media-image${attrs({
      src: mediaHref(coverKey(project.slug)),
      alt: coverAltText(project.title),
    })}>` +
    '</div>' +
    '<div class="card-body">' +
    `<h3 class="card-title"><a${attrs({
      href: projectHref(project.slug, pressed),
      'data-card-link': project.slug,
    })}>${escapeHtml(project.title)}</a></h3>` +
    `<p class="card-kind">${escapeHtml(project.kind)}</p>` +
    `<p class="card-meta"><span class="mono">${project.year}</span> <span class="card-disciplines">${escapeHtml(names)}</span></p>` +
    `<button type="button" class="card-preview"${attrs({ 'data-preview-open': project.slug })}>Preview ${escapeHtml(project.title)}</button>` +
    '</div></article>'
  );
};

const workSection = (pressed: readonly DisciplineId[]): string => {
  const shown = filterProjects(pressed);
  const shownSlugs = shown.map((project) => project.slug);
  return (
    '<section id="work" class="work" data-section="work" aria-labelledby="work-heading">' +
    '<h2 id="work-heading" class="section-heading" tabindex="-1">Selected work</h2>' +
    '<div class="filters" role="group" aria-label="Filter projects by discipline">' +
    `<button type="button" class="filter" data-filter="all"${attrs({
      'aria-pressed': pressed.length === 0 ? 'true' : 'false',
    })}>All</button>` +
    DISCIPLINES.map(
      (discipline) =>
        `<button type="button" class="filter"${attrs({
          'data-filter': discipline.id,
          'aria-pressed': pressed.includes(discipline.id) ? 'true' : 'false',
        })}>${escapeHtml(discipline.name)}</button>`,
    ).join('') +
    '</div>' +
    `<p class="results mono" data-results>${escapeHtml(resultLineText(shown.length))}</p>` +
    '<div class="gallery" data-gallery>' +
    PROJECTS.map((project) => {
      const index = shownSlugs.indexOf(project.slug);
      return projectCard(project, pressed, index !== -1, (index % 3) + 1);
    }).join('') +
    '</div></section>'
  );
};

const servicesSection = (): string =>
  '<section id="services" class="services" data-section="services" aria-labelledby="services-heading">' +
  '<h2 id="services-heading" class="section-heading" tabindex="-1">Services</h2>' +
  '<ul class="services-list">' +
  SERVICES.map((service) => {
    const panelId = `service-${service.id}-panel`;
    return (
      `<li class="service"${attrs({ 'data-service': service.id })}>` +
      '<h3 class="service-heading">' +
      `<button type="button" class="service-button"${attrs({
        'aria-expanded': 'false',
        'aria-controls': panelId,
      })}>${escapeHtml(service.name)}</button></h3>` +
      `<p class="service-description">${escapeHtml(service.description)}</p>` +
      `<div class="service-panel"${attrs({ id: panelId, 'data-service-panel': service.id, hidden: true })}>` +
      `<div class="service-visual" data-service-visual aria-hidden="true">${serviceVisual(service.id)}</div>` +
      '<div class="service-panel-body">' +
      '<div class="service-panel-group">' +
      `<h4 id="service-${service.id}-deliverables">Deliverables</h4>` +
      `<ul class="rule-list" aria-labelledby="service-${service.id}-deliverables">${listItems(service.deliverables)}</ul>` +
      '</div><div class="service-panel-group">' +
      `<h4 id="service-${service.id}-technology">Technology</h4>` +
      `<ul class="rule-list" aria-labelledby="service-${service.id}-technology">${listItems(service.technology)}</ul>` +
      '</div>' +
      `<a class="button-link" href="/?service=${service.id}#contact"${attrs({
        'data-enquire': service.id,
      })}>Enquire about ${escapeHtml(service.name)}</a>` +
      '</div></div></li>'
    );
  }).join('') +
  '</ul></section>';

const usedInDetail = (technology: string): string => {
  const projects = projectsUsing(technology);
  if (projects.length === 0) return `<p>${escapeHtml(NO_USAGE_TEXT)}</p>`;
  return (
    '<p>Used in: ' +
    projects
      .map((project) => `<a href="/work/${project.slug}">${escapeHtml(project.title)}</a>`)
      .join(', ') +
    '</p>'
  );
};

const skillsSection = (): string =>
  '<section id="skills" class="skills" data-section="skills" aria-labelledby="skills-heading">' +
  '<h2 id="skills-heading" class="section-heading" tabindex="-1">Skills and tools</h2>' +
  '<div class="tablist" role="tablist" aria-label="Skill groups">' +
  SKILL_GROUPS.map((group, index) => {
    const selected = index === 0;
    return `<button type="button" class="tab" role="tab"${attrs({
      id: `tab-${group.id}`,
      'aria-selected': selected ? 'true' : 'false',
      'aria-controls': `panel-${group.id}`,
      tabindex: selected ? 0 : -1,
      'data-tab': group.id,
    })}>${escapeHtml(group.name)}</button>`;
  }).join('') +
  '</div>' +
  SKILL_GROUPS.map((group, groupIndex) => {
    const selected = groupIndex === 0;
    return (
      `<div class="tabpanel" role="tabpanel"${attrs({
        id: `panel-${group.id}`,
        'aria-labelledby': `tab-${group.id}`,
        'data-skill-panel': group.id,
        hidden: !selected,
      })}>` +
      '<p class="illustrative-label">Illustrative fluency scores</p>' +
      '<div class="skill-cards">' +
      group.cards
        .map((card, cardIndex) => {
          const detailId = `skill-${group.id}-${cardIndex}-detail`;
          return (
            `<div class="skill-card" data-skill${attrs({ 'data-skill-index': cardIndex })}>` +
            '<h3 class="skill-name">' +
            `<button type="button" class="skill-button"${attrs({
              'aria-expanded': 'false',
              'aria-controls': detailId,
            })}>${escapeHtml(card.technology)}</button></h3>` +
            '<div class="skill-meter">' +
            `<div class="meter" role="meter"${attrs({
              'aria-label': `${card.technology} fluency`,
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': card.level,
              'aria-valuetext': `${card.level} out of 100`,
            })}><span class="meter-bar" data-meter-bar${attrs({ style: `--level:${card.level}%` })}></span></div>` +
            `<p class="meter-figure mono" aria-hidden="true">${card.level}</p>` +
            '</div>' +
            `<div class="skill-detail"${attrs({ id: detailId, hidden: true })}>${usedInDetail(card.technology)}</div>` +
            '</div>'
          );
        })
        .join('') +
      '</div></div>'
    );
  }).join('') +
  '</section>';

const reviewsSection = (): string =>
  '<section id="reviews" class="reviews" data-section="reviews" aria-labelledby="reviews-heading">' +
  '<h2 id="reviews-heading" class="section-heading" tabindex="-1">Client reviews</h2>' +
  `<p class="illustrative-label">${escapeHtml(REVIEWS_NOTICE)}</p>` +
  '<div class="carousel" role="group" aria-roledescription="carousel" aria-label="Reviews" data-carousel>' +
  '<div class="review-viewport">' +
  '<div class="review-track" data-review-track style="--review-index:0">' +
  REVIEWS.map((review, index) => {
    const shown = index === 0;
    return (
      `<div class="review-slide" role="group" aria-roledescription="slide"${attrs({
        'aria-label': `Review ${index + 1} of 5`,
        'data-review': index + 1,
        'data-shown': shown ? 'true' : 'false',
        'aria-hidden': shown ? null : 'true',
        inert: !shown,
      })}>` +
      `<blockquote class="review-quote"><p>${escapeHtml(review.quote)}</p></blockquote>` +
      `<p class="review-name">${escapeHtml(review.name)}</p>` +
      `<p class="review-role">${escapeHtml(`${review.role}, ${review.company} (illustrative)`)}</p>` +
      '</div>'
    );
  }).join('') +
  '</div></div>' +
  '<div class="review-controls">' +
  '<button type="button" data-review-previous disabled>Previous review</button>' +
  '<p class="mono review-position" data-review-position>1 / 5</p>' +
  '<button type="button" data-review-next>Next review</button>' +
  '</div></div></section>';

const numbersSection = (): string =>
  '<section id="numbers" class="numbers" data-section="numbers" aria-labelledby="numbers-heading">' +
  '<h2 id="numbers-heading" class="section-heading" tabindex="-1">By the numbers</h2>' +
  figureBlock('numbers', NUMBERS_FIGURES) +
  '</section>';

const field = (id: string, label: string, control: string): string =>
  '<p class="field">' +
  `<label class="field-label" for="${id}">${escapeHtml(label)}</label>` +
  control +
  `<span class="field-error" id="${id}-error" data-field-error hidden></span>` +
  '</p>';

const contactSection = (selectedService: string | null): string =>
  '<section id="contact" class="contact" data-section="contact" aria-labelledby="contact-heading">' +
  '<h2 id="contact-heading" class="section-heading" tabindex="-1">Start a project</h2>' +
  '<p class="lead">Tell me what you are building. I read every message myself.</p>' +
  '<div class="contact-grid">' +
  '<form class="enquiry-form" aria-label="Project enquiry" data-enquiry-form novalidate>' +
  field(
    'enquiry-name',
    'Your name',
    '<input class="field-input" id="enquiry-name" name="name" type="text" autocomplete="name" data-field="name">',
  ) +
  field(
    'enquiry-email',
    'Email address',
    '<input class="field-input" id="enquiry-email" name="email" type="text" autocomplete="email" data-field="email">',
  ) +
  field(
    'enquiry-project-type',
    'Project type',
    '<select class="field-input" id="enquiry-project-type" name="projectType" data-field="projectType">' +
      `<option value="">${escapeHtml(PROJECT_TYPE_PLACEHOLDER)}</option>` +
      PROJECT_TYPE_OPTIONS.map(
        (option) =>
          `<option${attrs({
            value: option.value,
            selected: option.value === selectedService,
          })}>${escapeHtml(option.label)}</option>`,
      ).join('') +
      '</select>',
  ) +
  '<div class="field">' +
  '<p class="field-label" id="budget-label">Budget</p>' +
  '<div class="budget-options" role="radiogroup" aria-labelledby="budget-label" data-budget-group>' +
  BUDGET_OPTIONS.map(
    (option, index) =>
      '<label class="budget-option">' +
      `<input type="radio" name="budget"${attrs({
        value: option.value,
        'data-budget-radio': index,
      })}> <span>${escapeHtml(option.label)}</span></label>`,
  ).join('') +
  '</div>' +
  '<span class="field-error" id="enquiry-budget-error" data-field-error hidden></span>' +
  '</div>' +
  field(
    'enquiry-message',
    'Tell me about your project',
    '<textarea class="field-input" id="enquiry-message" name="message" rows="6" data-field="message"></textarea>',
  ) +
  '<p class="form-status" role="status" aria-label="Form status" data-form-status></p>' +
  '<button type="submit" class="submit" data-submit>Send message</button>' +
  '</form>' +
  '<div class="contact-details">' +
  `<a class="contact-email" href="mailto:${CONTACT.email}">Email Ottoline</a>` +
  `<p class="mono" data-email>${escapeHtml(CONTACT.email)}</p>` +
  `<div class="contact-social">${SOCIAL_LINKS.map((link) => newTabLink(link, 'contact-social-link')).join('')}</div>` +
  '<p class="illustrative-label">Illustrative availability</p>' +
  `<p class="availability">${escapeHtml(CONTACT.availability)}</p>` +
  '</div></div></section>';

export interface HomeOptions {
  readonly pressed: readonly DisciplineId[];
  readonly selectedService: string | null;
  readonly introStartsDone: boolean;
}

export const renderHomeMain = (options: HomeOptions): string =>
  introSection(options.introStartsDone) +
  aboutSection() +
  workSection(options.pressed) +
  servicesSection() +
  skillsSection() +
  reviewsSection() +
  numbersSection() +
  contactSection(options.selectedService);
