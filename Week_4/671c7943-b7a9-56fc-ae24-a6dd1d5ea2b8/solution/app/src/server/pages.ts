import {
  ABOUT, BACK_TO_SITE, BRIEF_COPY, BUDGETS, CATEGORY_NAMES, CONTACT_COPY, filterAnnouncement, FOOTER_COPY, FORM_COPY, INTRO,
  NAV_LABELS, NAV_SECTIONS, NOT_FOUND_COPY, PHASES, PHILOSOPHY, PRIVACY_COPY, PROJECT_TYPES, SERVICES, SERVICES_COPY, SITE_NAME,
  TITLES, WORK_COPY,
} from "../shared/copy.js";
import { formatNumber, sequenceOf } from "../shared/rules.js";
import type { CategoryId, Content, Project, ProjectTypeId, Statistic } from "../shared/types.js";
import { config } from "./config.js";
import { escapeHtml as e, figures } from "./html.js";
import { emptyStatePlate, introPlate, portraitPlate, projectPlate } from "./plates.js";

interface HomeQuery {
  category: CategoryId | null;
  service: CategoryId | null;
  type: ProjectTypeId | null;
}

const CHEVRON =
  '<svg class="chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>';
const CLOSE =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const ARROW_LEFT =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M19 12H5m6-6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const ARROW_RIGHT =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 12h14m-6-6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

function link(href: string, label: string, attributes = ""): string {
  return `<a href="${e(href)}"${attributes ? ` ${attributes}` : ""}>${e(label)}</a>`;
}

function shell(title: string, view: string, main: string, attributes = ""): string {
  const navLinks = NAV_SECTIONS.map((id) => `<li>${link(`/#${id}`, NAV_LABELS[id], `data-section-link="${id}"`)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<link rel="icon" href="data:,">
<link rel="preload" href="/assets/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/instrument-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/instrument-sans-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/instrument-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
<script>document.documentElement.classList.add("js");</script>
</head>
<body>
<a class="skip-link" href="#main" data-skip>Skip to content</a>
<header class="site-header">
<a class="brand" href="/">${e(SITE_NAME)}<span class="sr-only"> home</span></a>
<nav class="main-nav" aria-label="Main"><ul>${navLinks}</ul></nav>
<button type="button" class="menu-button" id="menu-button" aria-haspopup="dialog" aria-controls="menu-sheet" aria-expanded="false">Menu</button>
</header>
<dialog class="menu-sheet" id="menu-sheet" aria-label="Menu">
<div class="menu-sheet__bar"><span class="brand-mark" aria-hidden="true">${e(SITE_NAME)}</span><button type="button" class="menu-close" data-menu-close>${CLOSE}<span>Close menu</span></button></div>
<nav aria-label="Menu sections"><ul>${NAV_SECTIONS.map((id) => `<li>${`<a href="/#${id}" data-section-link="${id}">${e(NAV_LABELS[id])}</a>`}</li>`).join("")}</ul></nav>
</dialog>
<main id="main" data-view="${view}"${attributes}>
${main}
</main>
<footer class="site-footer">
<div class="wrap footer-grid">
<p class="footer-name">${e(FOOTER_COPY.name)}</p>
<p class="footer-note">${e(FOOTER_COPY.fiction)}</p>
<nav aria-label="Footer"><ul>${NAV_SECTIONS.map((id) => `<li>${link(`/#${id}`, NAV_LABELS[id])}</li>`).join("")}<li>${link("/privacy", "Privacy")}</li></ul></nav>
<nav aria-label="Social"><ul>${FOOTER_COPY.social.map((item) => `<li><a href="${e(item.href)}" target="_blank" rel="noopener noreferrer">${e(item.name)}<span class="sr-only"> (opens in a new tab)</span></a></li>`).join("")}</ul></nav>
<p class="footer-mail"><a href="mailto:${e(config.studioEmail)}">${e(config.studioEmail)}</a></p>
<p class="footer-copy">${e(FOOTER_COPY.copyright)}</p>
</div>
</footer>
<div class="sr-only" id="site-status" role="status" aria-label="Site updates" aria-live="polite" aria-atomic="true"></div>
<script type="module" src="/assets/js/client/main.js"></script>
</body>
</html>`;
}

function sectionTitle(id: string, text: string): string {
  return `<h2 class="section-title reveal-heading" id="${id}-title" tabindex="-1">${e(text)}</h2>`;
}

function statisticsHtml(stats: readonly Statistic[]): string {
  const tabs = stats
    .map((stat, index) => {
      return `<button type="button" role="tab" id="stat-tab-${e(stat.id)}" aria-controls="stat-panel-${e(stat.id)}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-stat="${index}">
<span class="stat-number" data-count="${stat.value}" aria-hidden="true">${figures(formatNumber(stat.value))}</span><span class="sr-only">${formatNumber(stat.value)}</span> <span class="stat-label">${e(stat.label)}</span></button>`;
    })
    .join("");
  const panels = stats
    .map((stat, index) => {
      const segments = stat.parts.map((part) => `<span data-part="${e(part.label)}" style="flex-grow:${part.value}"></span>`).join("");
      const parts = stat.parts.map((part) => `<li><span class="part-key" aria-hidden="true"></span>${e(part.label)}: ${formatNumber(part.value)}</li>`).join("");
      return `<div role="tabpanel" id="stat-panel-${e(stat.id)}" aria-labelledby="stat-tab-${e(stat.id)}"${index === 0 ? "" : " hidden"}>
<p class="stat-note">${e(stat.note)}</p><div class="bar" aria-hidden="true">${segments}</div><ul class="parts">${parts}</ul></div>`;
    })
    .join("");
  return `<div class="stats"><div class="stats-tabs" role="tablist" aria-label="Statistics">${tabs}</div><div class="stats-panels">${panels}</div></div>`;
}

function servicesHtml(open: CategoryId | null): string {
  return SERVICES.map((service, index) => {
    const expanded = service.id === open;
    return `<div class="service" data-service="${service.id}" data-open="${expanded}">
<h3 class="service-head"><button type="button" id="service-button-${service.id}" aria-expanded="${expanded}" aria-controls="service-panel-${service.id}"><span class="service-index" aria-hidden="true">0${index + 1}</span><span class="service-name">${e(service.name)}</span>${CHEVRON}</button></h3>
<div class="panel" id="service-panel-${service.id}"><div class="panel-inner"><div class="panel-body">
<p class="panel-summary">${e(service.summary)}</p>
<div class="panel-columns">
<div><h4>Capabilities</h4><ul>${service.capabilities.map((item) => `<li>${e(item)}</li>`).join("")}</ul></div>
<div><h4>Deliverables</h4><ul>${service.deliverables.map((item) => `<li>${e(item)}</li>`).join("")}</ul></div>
</div>
<p class="panel-weeks">Typical engagement: ${e(service.weeks)}</p>
<p class="panel-links">${link(`/?category=${service.id}#work`, `See ${service.name} work`, 'class="text-link"')}${link(`/?type=${service.id}#contact`, `Start a ${service.name} project`, 'class="text-link"')}</p>
</div></div></div></div>`;
  }).join("");
}

function workItemHtml(project: Project, index: number, category: CategoryId | null, shown: boolean): string {
  const href = category === null ? `/work/${project.slug}` : `/work/${project.slug}?category=${category}`;
  return `<li class="work-item" data-project="${e(project.slug)}" data-category="${project.category}"${shown ? "" : " hidden"}>
<div class="work-item-cover" data-cover aria-hidden="true">${projectPlate(project.hue, project.motif, project.slug)}</div>
<div class="work-item-meta"><span class="work-item-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
<h3 class="work-item-title hang"><a href="${e(href)}">${e(project.title)}</a></h3>
<p class="work-item-client">${e(project.client)}</p><p class="work-item-category">${e(CATEGORY_NAMES[project.category])}</p><p class="work-item-year">${e(String(project.year))}</p></div>
<p class="work-item-caption" aria-hidden="true">${e(WORK_COPY.caption)}</p></li>`;
}

function workHtml(content: Content, category: CategoryId | null): string {
  const count = (id: CategoryId | null): number => sequenceOf(content.projects, id).length;
  const radio = (id: CategoryId | null, label: string): string =>
    `<label class="filter-option"><input type="radio" name="category" value="${id ?? ""}"${id === category ? " checked" : ""}><span>${e(label)} (${count(id)})</span></label>`;
  const options = [radio(null, "All"), ...SERVICES.map((service) => radio(service.id, service.name))].join("");
  const shown = new Set(sequenceOf(content.projects, category));
  const emptySentence = category !== null && shown.size === 0 ? filterAnnouncement(CATEGORY_NAMES[category], 0) : "";
  return `<div class="filter" role="radiogroup" aria-label="Filter work by service">${options}</div>
<div class="work-empty" data-empty${emptySentence === "" ? " hidden" : ""}><div class="work-empty-plate" aria-hidden="true">${emptyStatePlate()}</div><p>${e(emptySentence)}</p></div>
<ul class="gallery" role="list" aria-label="Projects">${content.projects.map((project, index) => workItemHtml(project, index, category, shown.has(project))).join("")}</ul>`;
}

function formHtml(type: ProjectTypeId | null): string {
  const radios = PROJECT_TYPES.map(
    (item) => `<label class="choice"><input type="radio" name="project_type" value="${item.id}"${item.id === type ? " checked" : ""}><span>${e(item.name)}</span></label>`,
  ).join("");
  const budgets = BUDGETS.map((item) => `<option value="${item.id}">${e(item.name)}</option>`).join("");
  return `<div class="enquiry" data-enquiry data-studio-email="${e(config.studioEmail)}">
<div data-alerts></div>
<form aria-label="${FORM_COPY.label}" id="enquiry-form" novalidate>
<div class="field"><label for="field-name">${FORM_COPY.name}</label><input id="field-name" name="name" type="text" autocomplete="name" aria-describedby="field-name-error"><p class="field-error" id="field-name-error" hidden></p></div>
<div class="field"><label for="field-email">${FORM_COPY.email}</label><input id="field-email" name="email" type="email" autocomplete="email" aria-describedby="field-email-error"><p class="field-error" id="field-email-error" hidden></p></div>
<fieldset class="field" role="radiogroup" aria-labelledby="field-type-legend" aria-describedby="field-project_type-error"><legend id="field-type-legend">${FORM_COPY.type}</legend><div class="choices">${radios}</div><p class="field-error" id="field-project_type-error" hidden></p></fieldset>
<div class="field"><label for="field-budget">${FORM_COPY.budget}</label><select id="field-budget" name="budget" aria-describedby="field-budget-error"><option value="">${FORM_COPY.budgetPlaceholder}</option>${budgets}</select><p class="field-error" id="field-budget-error" hidden></p></div>
<div class="field"><label for="field-description">${FORM_COPY.description}</label><textarea id="field-description" name="description" rows="7" aria-describedby="field-description-count field-description-error"></textarea><p class="field-count" id="field-description-count">${FORM_COPY.counter("0")}</p><p class="field-error" id="field-description-error" hidden></p></div>
<button type="submit" class="button-primary" data-send>${FORM_COPY.send}</button>
</form></div>`;
}

export function homePage(content: Content, query: HomeQuery): string {
  const steps = PHILOSOPHY.steps;
  const principles = PHILOSOPHY.principles.map((item) => `<li><h4>${e(item.title)}</h4><p>${e(item.text)}</p></li>`).join("");
  const processTabs = steps.map((step, index) => `<button type="button" role="tab" id="process-tab-${index}" aria-controls="process-panel-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${e(step.name)}</button>`).join("");
  const processPanels = steps
    .map((step, index) => `<div role="tabpanel" id="process-panel-${index}" aria-labelledby="process-tab-${index}"${index === 0 ? "" : " hidden"}><p class="process-step">Step ${index + 1} of ${steps.length}</p><h4>${e(step.name)}</h4><p class="process-weeks">${e(step.weeks)}</p><p>${e(step.text)}</p></div>`)
    .join("");
  const background = ABOUT.background.map((line) => {
    const [when = "", ...rest] = line.split(" · ");
    return `<li><span class="when">${e(when)}</span><span class="sep"> · </span><span class="what">${e(rest.join(" · "))}</span></li>`;
  }).join("");
  const main = `<section class="intro" id="intro" aria-labelledby="intro-title"><div class="wrap intro-grid">
<div class="intro-copy"><h1 id="intro-title" tabindex="-1">${INTRO.lines.map((line, index) => `<span class="intro-line" data-line="${index + 1}"><span>${e(line)}</span></span>`).join(" ")}</h1>
<p class="intro-text">${e(INTRO.text)}</p>
<p class="intro-links">${link("/#contact", INTRO.start, 'class="button-primary"')}${link("/#work", INTRO.work, 'class="text-link"')}</p></div>
<div class="intro-plate" data-parallax aria-hidden="true">${introPlate()}</div></div></section>
<section class="about" id="about" aria-labelledby="about-title"><div class="wrap">
${sectionTitle("about", ABOUT.heading)}
<div class="about-grid"><div class="about-text">${ABOUT.paragraphs.map((text) => `<p>${e(text)}</p>`).join("")}</div>
<div class="about-portrait" role="img" aria-label="${e(ABOUT.portrait)}">${portraitPlate()}</div></div>
<h3 class="about-background">${ABOUT.backgroundHeading}</h3><ul class="background">${background}</ul>
${statisticsHtml(content.stats)}</div></section>
<section class="services" id="services" aria-labelledby="services-title"><div class="wrap">
${sectionTitle("services", SERVICES_COPY.heading)}<p class="lede">${e(SERVICES_COPY.line)}</p>
<div class="service-list">${servicesHtml(query.service)}</div></div></section>
<section class="work" id="work" aria-labelledby="work-title"><div class="wrap">
${sectionTitle("work", WORK_COPY.heading)}
${workHtml(content, query.category)}</div></section>
<section class="philosophy" id="philosophy" aria-labelledby="philosophy-title"><div class="wrap">
${sectionTitle("philosophy", PHILOSOPHY.heading)}
<div class="philosophy-grid"><div><h3>${PHILOSOPHY.principlesHeading}</h3><ol class="principles">${principles}</ol></div>
<div><h3>${PHILOSOPHY.processHeading}</h3><div class="process"><div class="process-tabs" role="tablist" aria-label="Process">${processTabs}</div><div class="process-panels">${processPanels}</div></div></div></div></div></section>
<section class="contact" id="contact" aria-labelledby="contact-title"><div class="wrap">
${sectionTitle("contact", CONTACT_COPY.heading)}<p class="lede">${e(CONTACT_COPY.line)}</p>
<div class="contact-grid"><dl class="details"><div><dt>Email</dt><dd>${link(`mailto:${config.studioEmail}`, config.studioEmail)}</dd></div>
<div><dt>Phone</dt><dd>${link(CONTACT_COPY.phoneHref, CONTACT_COPY.phone)}</dd></div>
<div><dt>Studio</dt><dd>${e(CONTACT_COPY.studio)}</dd></div></dl>
${formHtml(query.type)}</div></div></section>`;
  return shell(TITLES.home, "home", main);
}

function swatchesHtml(project: Project): string {
  return project.palette.map((colour) => `<li class="swatch"><span class="swatch-block" style="background-color:${e(colour.hex)}" aria-hidden="true"></span><span class="swatch-name">${e(colour.name)}</span><span class="swatch-hex">${e(colour.hex)}</span></li>`).join("");
}

export function casePage(project: Project, content: Content, category: CategoryId | null): string {
  const sequence = sequenceOf(content.projects, category);
  const index = sequence.findIndex((item) => item.slug === project.slug);
  const previous = index > 0 ? sequence[index - 1] : undefined;
  const next = index >= 0 ? sequence[index + 1] : undefined;
  const query = category === null ? "" : `?category=${category}`;
  const sections = ["Overview", "Objectives", "Visual system", "Showcase", "Process", "Results"];
  const slugOf = (title: string): string => title.toLowerCase().replace(" ", "-");
  const heading = (title: string): string => `<h2 class="case-title" id="${slugOf(title)}-title" tabindex="-1">${title}</h2>`;
  const toc = sections.map((title) => `<li><a href="#${slugOf(title)}">${title}</a></li>`).join("");
  const [discover, define, design, deliver] = project.process;
  const weeksOf = { Discover: discover, Define: define, Design: design, Deliver: deliver };
  const phases = PHASES.map((phase) => {
    const weeks = weeksOf[phase];
    return `<li><span class="phase">${phase}</span> · <span class="phase-weeks">${figures(String(weeks))} week${weeks === 1 ? "" : "s"}</span></li>`;
  }).join("");
  const screens = project.screens.map((screen, position) => `<figure><div class="screen-plate">${projectPlate(project.hue, project.motif, project.slug, position + 1)}</div><figcaption>${e(screen.caption)}</figcaption></figure>`).join("");
  const moreLink = (target: Project | undefined, label: string): string =>
    target ? `<a class="more-link" href="/work/${e(target.slug)}${query}" data-case-link data-direction="${label.toLowerCase()}"><span class="more-label">${label} project:</span> <span class="more-title">${e(target.title)}</span></a>` : "";
  const main = `<article class="case wrap" data-slug="${e(project.slug)}">
<div class="case-head"><p class="eyebrow" data-title-line>${e(CATEGORY_NAMES[project.category])} · ${e(String(project.year))}</p>
<h1 class="case-name hang" id="case-name" tabindex="-1" data-title-line>${e(project.title)}</h1>
<p class="standfirst" data-title-line>${e(project.standfirst)}</p></div>
<div class="case-hero" data-hero role="img" aria-label="${e(project.title)} cover">${projectPlate(project.hue, project.motif, project.slug)}</div>
<nav class="toc" aria-label="On this page"><ul>${toc}</ul></nav>
<div class="case-sections">
<section id="overview" aria-labelledby="overview-title">${heading("Overview")}<dl class="facts"><div><dt>Client</dt><dd>${e(project.client)}</dd></div><div><dt>Year</dt><dd>${e(String(project.year))}</dd></div><div><dt>Service</dt><dd>${e(CATEGORY_NAMES[project.category])}</dd></div><div><dt>Role</dt><dd>${e(project.role)}</dd></div><div><dt>Duration</dt><dd>${e(project.duration)}</dd></div></dl><p class="overview">${e(project.overview)}</p></section>
<section id="objectives" aria-labelledby="objectives-title">${heading("Objectives")}<ol class="objectives">${project.objectives.map((item) => `<li>${e(item)}</li>`).join("")}</ol></section>
<section id="visual-system" aria-labelledby="visual-system-title">${heading("Visual system")}<ul class="swatches" role="list">${swatchesHtml(project)}</ul></section>
<section id="showcase" class="showcase" aria-labelledby="showcase-title" data-screen="1" data-total="${project.screens.length}">${heading("Showcase")}<div class="showcase-row"><div class="showcase-track" data-track>${screens}</div></div>
<div class="showcase-controls"><button type="button" data-step="-1" aria-label="Previous screen" disabled>${ARROW_LEFT}</button><p class="showcase-count" data-count-label>1 / ${project.screens.length}</p><button type="button" data-step="1" aria-label="Next screen"${project.screens.length === 1 ? " disabled" : ""}>${ARROW_RIGHT}</button></div></section>
<section id="process" aria-labelledby="process-title">${heading("Process")}<ol class="phases">${phases}</ol></section>
<section id="results" aria-labelledby="results-title">${heading("Results")}<ul class="results" role="list">${project.results.map((result) => `<li><span class="result-value">${figures(result.value)}</span><span class="result-label">${e(result.label)}</span></li>`).join("")}</ul></section>
</div>
<nav class="more" aria-label="More work">${moreLink(previous, "Previous")}${moreLink(next, "Next")}<a class="more-all" href="${category === null ? "/#work" : `/?category=${category}#work`}" data-case-link>All work</a></nav>
</article>`;
  return shell(TITLES.case(project.title), "case", main);
}

export function privacyPage(): string {
  const main = `<div class="wrap prose-page"><h1 id="page-title" tabindex="-1">${e(PRIVACY_COPY.heading)}</h1>${PRIVACY_COPY.paragraphs.map((text) => `<p>${e(text)}</p>`).join("")}<p>${link("/", BACK_TO_SITE, 'class="text-link"')}</p></div>`;
  return shell(TITLES.privacy, "page", main);
}

export function notFoundPage(kind: "project" | "page"): string {
  const copy = NOT_FOUND_COPY[kind];
  const main = `<div class="wrap prose-page"><h1 id="page-title" tabindex="-1">${e(copy.heading)}</h1><p>${link(copy.href, copy.link, 'class="text-link"')}</p></div>`;
  return shell(TITLES.notFound, "page", main);
}

export function briefUnavailablePage(reference: string): string {
  const main = `<div class="wrap prose-page"><h1 id="page-title" tabindex="-1">${e(BRIEF_COPY.unavailableHeading)}</h1><p>${e(BRIEF_COPY.unavailableLine(reference))}</p></div>`;
  return shell(TITLES.briefUnavailable, "page", main);
}
