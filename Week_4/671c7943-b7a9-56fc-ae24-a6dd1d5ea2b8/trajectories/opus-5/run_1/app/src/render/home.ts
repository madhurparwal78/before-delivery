import {
  ABOUT,
  CONTACT,
  INTRO,
  PRINCIPLES,
  PROCESS_STEPS,
  SECTIONS,
  SERVICES,
  SERVICES_INTRO,
  serviceName,
} from '../content/copy.js';
import {
  BUDGETS,
  BUDGET_PLACEHOLDER,
  ENQUIRY_COPY,
  PROJECT_TYPES,
  STUDIO_EMAIL_ADDRESS,
  descriptionCounter,
  emptyCategoryNotice,
  formatFigure,
} from '../shared/copy.js';
import { countIn, projectsIn } from '../content/selection.js';
import type { CategoryId, Content, Project, ProjectTypeId, Statistic } from '../shared/types.js';
import { escapeHtml } from './html.js';
import { coverPlate, introPlate, portraitPlate } from './plates.js';
import { renderPage } from './layout.js';

export interface HomeView {
  content: Content;
  category: CategoryId | null;
  service: CategoryId | null;
  projectType: ProjectTypeId | null;
}

const heading = (id: string, text: string): string =>
  `<h2 class="section__heading" id="${id}-heading" tabindex="-1" data-section-heading>${escapeHtml(
    text,
  )}</h2>`;

const sectionHeading = (id: 'about' | 'services' | 'work' | 'philosophy' | 'contact'): string =>
  heading(id, SECTIONS.find((section) => section.id === id)!.heading);

const section = (id: string, body: string): string =>
  `<section class="section section--${id}" id="${id}" role="region" aria-labelledby="${id}-heading">
  <div class="section__inner">
${body}
  </div>
</section>`;

const intro = (): string => `<section class="section section--intro" id="intro" role="region" aria-labelledby="intro-heading">
  <div class="section__inner intro__inner">
    <div class="intro__text">
      <h1 class="intro__heading" id="intro-heading" tabindex="-1">${INTRO.lines
        .map(
          (line, index) =>
            `<span class="line-clip"><span class="line" data-line="${index + 1}">${escapeHtml(
              line,
            )}</span></span>`,
        )
        .join('\n        ')}</h1>
      <p class="intro__line">${escapeHtml(INTRO.line)}</p>
      <p class="intro__links">${INTRO.links
        .map(
          (link) =>
            `<a class="link-underline" href="/#${link.target}">${escapeHtml(
              link.name,
            )}</a>`,
        )
        .join('\n        ')}</p>
    </div>
    <div class="intro__plate" data-parallax aria-hidden="true">${introPlate()}</div>
  </div>
</section>`;

const statisticTab = (statistic: Statistic, index: number): string => `<button
        class="stats__tab"
        type="button"
        role="tab"
        id="stat-tab-${escapeHtml(statistic.id)}"
        aria-controls="stat-panel-${escapeHtml(statistic.id)}"
        aria-selected="${index === 0 ? 'true' : 'false'}"
        tabindex="${index === 0 ? '0' : '-1'}"
        data-stat-tab="${escapeHtml(statistic.id)}"
      ><span class="stats__value figures" data-count="${statistic.value}" aria-hidden="true">${escapeHtml(
        formatFigure(statistic.value),
      )}</span><span class="sr-only">${escapeHtml(formatFigure(statistic.value))}</span> <span class="stats__label">${escapeHtml(
        statistic.label,
      )}</span></button>`;

const statisticPanel = (statistic: Statistic, index: number): string => {
  const total = statistic.value;
  return `<div
        class="stats__panel"
        role="tabpanel"
        id="stat-panel-${escapeHtml(statistic.id)}"
        aria-labelledby="stat-tab-${escapeHtml(statistic.id)}"
        data-stat-panel="${escapeHtml(statistic.id)}"
        ${index === 0 ? '' : 'hidden'}
      >
        <p class="stats__note">${escapeHtml(statistic.note)}</p>
        <div class="stats__bar">${statistic.parts
          .map(
            (part) =>
              `<span class="stats__segment" data-part="${escapeHtml(part.label)}" style="width:${(
                (part.value / total) *
                100
              ).toFixed(4)}%"></span>`,
          )
          .join('')}</div>
        <ul class="stats__parts">${statistic.parts
          .map(
            (part) =>
              `<li class="figures">${escapeHtml(`${part.label}: ${formatFigure(part.value)}`)}</li>`,
          )
          .join('')}</ul>
      </div>`;
};

const about = (stats: Statistic[]): string =>
  section(
    'about',
    `    ${sectionHeading('about')}
    <div class="about__grid">
      <div class="about__text">
        ${ABOUT.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('\n        ')}
      </div>
      <div class="about__portrait plate-frame" role="img" aria-label="${escapeHtml(
        ABOUT.portraitName,
      )}">${portraitPlate()}</div>
    </div>
    <h3 class="about__background-heading">${escapeHtml(ABOUT.backgroundHeading)}</h3>
    <ul class="about__background rules">
      ${ABOUT.background.map((item) => `<li class="figures">${escapeHtml(item)}</li>`).join('\n      ')}
    </ul>
    <div class="stats" data-stats>
      <div class="stats__tabs" role="tablist" aria-label="${escapeHtml(ABOUT.statisticsLabel)}">
      ${stats.map(statisticTab).join('\n      ')}
      </div>
      ${stats.map(statisticPanel).join('\n      ')}
    </div>`,
  );

const services = (open: CategoryId | null): string =>
  section(
    'services',
    `    ${sectionHeading('services')}
    <p class="section__line">${escapeHtml(SERVICES_INTRO)}</p>
    <div class="services rules">
      ${SERVICES.map((service, index) => {
        const isOpen = open === service.id;
        return `<div class="service" data-service="${service.id}">
        <h3 class="service__heading">
          <button class="service__button" type="button" id="service-button-${service.id}" aria-expanded="${
            isOpen ? 'true' : 'false'
          }" aria-controls="service-panel-${service.id}" data-service-button="${service.id}">
            <span class="service__index figures" aria-hidden="true">${String(index + 1).padStart(
              2,
              '0',
            )}</span>
            <span class="service__name">${escapeHtml(service.name)}</span>
            <span class="service__chevron" aria-hidden="true" data-chevron><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M4 8 L12 16 L20 8" fill="none" stroke="currentColor" stroke-width="2"/></svg></span>
          </button>
        </h3>
        <div class="service__panel" id="service-panel-${service.id}" data-service-panel="${
          service.id
        }"${isOpen ? '' : ' hidden'}>
          <div class="service__panel-inner">
            <p class="service__summary">${escapeHtml(service.summary)}</p>
            <div class="service__lists">
              <div class="service__list">
                <h4>Capabilities</h4>
                <ul>${service.capabilities.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
              </div>
              <div class="service__list">
                <h4>Deliverables</h4>
                <ul>${service.deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
              </div>
            </div>
            <p class="service__weeks">${escapeHtml(`Typical engagement: ${service.weeks}`)}</p>
            <p class="service__links">
              <a class="link-underline" href="/?category=${service.id}#work" data-service-work="${
                service.id
              }">${escapeHtml(`See ${service.name} work`)}</a>
              <a class="link-underline" href="/?type=${service.id}#contact" data-service-start="${
                service.id
              }">${escapeHtml(`Start a ${service.name} project`)}</a>
            </p>
          </div>
        </div>
      </div>`;
      }).join('\n      ')}
    </div>`,
  );

const workItem = (project: Project, index: number, hidden: boolean, category: CategoryId | null): string => {
  const href = category === null ? `/work/${project.slug}` : `/work/${project.slug}?category=${category}`;
  return `<li class="work-item" data-project="${escapeHtml(project.slug)}" data-category="${
    project.category
  }"${hidden ? ' hidden' : ''}>
        <div class="work-item__frame plate-frame" data-cover aria-hidden="true">${coverPlate(project)}</div>
        <span class="work-item__index figures" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        <p class="work-item__title"><a class="work-item__link" href="${escapeHtml(
          href,
        )}" data-work-link="${escapeHtml(project.slug)}">${escapeHtml(project.title)}</a></p>
        <p class="work-item__meta"><span>${escapeHtml(project.client)}</span><span>${escapeHtml(
          serviceName(project.category),
        )}</span><span class="figures">${project.year}</span></p>
        <span class="work-item__caption" aria-hidden="true" data-caption>View case study</span>
      </li>`;
};

const work = (projects: Project[], category: CategoryId | null): string => {
  const shown = projectsIn(projects, category);
  const radios = [
    { name: `All (${countIn(projects, null)})`, value: 'all', checked: category === null },
    ...SERVICES.map((service) => ({
      name: `${service.name} (${countIn(projects, service.id)})`,
      value: service.id,
      checked: category === service.id,
    })),
  ];
  return section(
    'work',
    `    ${sectionHeading('work')}
    <div class="filters" role="radiogroup" aria-label="Filter work by service">
      ${radios
        .map(
          (radio) =>
            `<label class="filter"><input class="filter__input" type="radio" name="work-filter" value="${
              radio.value
            }" data-filter="${radio.value}"${radio.checked ? ' checked' : ''}><span class="filter__name figures">${escapeHtml(
              radio.name,
            )}</span></label>`,
        )
        .join('\n      ')}
    </div>
    <p class="work__empty" data-work-empty${shown.length === 0 ? '' : ' hidden'}>${
      category === null ? '' : escapeHtml(emptyCategoryNotice(serviceName(category)))
    }</p>
    <ul class="gallery" aria-label="Projects" data-gallery${shown.length === 0 ? ' hidden' : ''}>
      ${projects
        .map((project, index) =>
          workItem(project, index, category !== null && project.category !== category, category),
        )
        .join('\n      ')}
    </ul>`,
  );
};

const philosophy = (): string =>
  section(
    'philosophy',
    `    ${sectionHeading('philosophy')}
    <h3 class="philosophy__sub">Principles</h3>
    <ol class="principles rules">
      ${PRINCIPLES.map(
        (principle) =>
          `<li><h4>${escapeHtml(principle.heading)}</h4><p>${escapeHtml(principle.text)}</p></li>`,
      ).join('\n      ')}
    </ol>
    <h3 class="philosophy__sub">Process</h3>
    <div class="process" data-process>
      <div class="process__tabs" role="tablist" aria-label="Process">
        ${PROCESS_STEPS.map(
          (step, index) =>
            `<button class="process__tab" type="button" role="tab" id="process-tab-${index}" aria-controls="process-panel-${index}" aria-selected="${
              index === 0 ? 'true' : 'false'
            }" tabindex="${index === 0 ? '0' : '-1'}" data-process-tab="${index}">${escapeHtml(
              step.name,
            )}</button>`,
        ).join('\n        ')}
      </div>
      ${PROCESS_STEPS.map(
        (step, index) =>
          `<div class="process__panel" role="tabpanel" id="process-panel-${index}" aria-labelledby="process-tab-${index}" data-process-panel="${index}"${
            index === 0 ? '' : ' hidden'
          }>
        <div class="process__panel-inner">
          <p class="process__step figures">${escapeHtml(`Step ${index + 1} of ${PROCESS_STEPS.length}`)}</p>
          <h4>${escapeHtml(step.name)}</h4>
          <p class="process__weeks figures">${escapeHtml(step.weeks)}</p>
          <p class="process__text">${escapeHtml(step.text)}</p>
        </div>
      </div>`,
      ).join('\n      ')}
    </div>`,
  );

const enquiryForm = (projectType: ProjectTypeId | null): string => `<div class="form-region" data-form-region>
        <div class="error-box" data-error-box tabindex="-1" hidden>
          <h3 class="error-box__heading">${escapeHtml(ENQUIRY_COPY.errorHeading)}</h3>
          <ul class="error-box__list" data-error-list></ul>
        </div>
        <div data-alert-slot></div>
        <form class="form" aria-label="Project enquiry" data-enquiry-form novalidate>
          <div class="field">
            <label class="field__label" for="enquiry-name">Name</label>
            <input class="field__control" id="enquiry-name" name="name" type="text" autocomplete="name" data-field="name">
            <p class="field__message" id="enquiry-name-message" data-message="name" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="enquiry-email">Email</label>
            <input class="field__control" id="enquiry-email" name="email" type="email" autocomplete="email" data-field="email">
            <p class="field__message" id="enquiry-email-message" data-message="email" hidden></p>
          </div>
          <div class="field">
            <span class="field__label" id="enquiry-type-label">Project type</span>
            <div class="radios" role="radiogroup" aria-labelledby="enquiry-type-label" data-field="project_type">
              ${PROJECT_TYPES.map(
                (option) =>
                  `<label class="radio"><input class="radio__input" type="radio" name="project_type" value="${
                    option.id
                  }"${option.id === projectType ? ' checked' : ''}><span class="radio__name">${escapeHtml(
                    option.name,
                  )}</span></label>`,
              ).join('\n              ')}
            </div>
            <p class="field__message" id="enquiry-project_type-message" data-message="project_type" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="enquiry-budget">Budget range</label>
            <select class="field__control" id="enquiry-budget" name="budget" data-field="budget">
              <option value="">${escapeHtml(BUDGET_PLACEHOLDER)}</option>
              ${BUDGETS.map(
                (option) => `<option value="${option.id}">${escapeHtml(option.name)}</option>`,
              ).join('\n              ')}
            </select>
            <p class="field__message" id="enquiry-budget-message" data-message="budget" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="enquiry-description">Project description</label>
            <textarea class="field__control field__control--area" id="enquiry-description" name="description" rows="6" aria-describedby="enquiry-description-counter" data-field="description"></textarea>
            <p class="field__counter figures" id="enquiry-description-counter" data-counter>${escapeHtml(
              descriptionCounter(0),
            )}</p>
            <p class="field__message" id="enquiry-description-message" data-message="description" hidden></p>
          </div>
          <button class="button" type="submit" data-submit>Send enquiry</button>
        </form>
      </div>`;

const contact = (projectType: ProjectTypeId | null): string =>
  section(
    'contact',
    `    ${sectionHeading('contact')}
    <p class="section__line">${escapeHtml(CONTACT.line)}</p>
    <div class="contact__grid">
      <dl class="contact__details rules">
        <div class="contact__row"><dt>Email</dt><dd><a class="link-underline" href="mailto:${STUDIO_EMAIL_ADDRESS}">${escapeHtml(
          STUDIO_EMAIL_ADDRESS,
        )}</a></dd></div>
        <div class="contact__row"><dt>Phone</dt><dd><a class="link-underline figures" href="${
          CONTACT.phoneHref
        }">${escapeHtml(CONTACT.phone)}</a></dd></div>
        <div class="contact__row"><dt>Studio</dt><dd>${escapeHtml(CONTACT.studio)}</dd></div>
      </dl>
      ${enquiryForm(projectType)}
    </div>`,
  );

export function renderHome(view: HomeView): string {
  const main = [
    intro(),
    about(view.content.stats),
    services(view.service),
    work(view.content.projects, view.category),
    philosophy(),
    contact(view.projectType),
  ].join('\n');
  return renderPage({
    title: 'Sollis Studio | Independent designer',
    headingId: 'intro-heading',
    main,
  });
}
