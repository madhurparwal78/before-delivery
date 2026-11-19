import type { Content, Project } from "../../domain/model.js";
import { CATEGORY_NAMES, BUDGET_OPTIONS, PROJECT_TYPES, type CategoryId } from "../../domain/model.js";
import {
  INTRO_LINES, INTRO_TEXT, ABOUT, SERVICES, SERVICES_INTRO, PRINCIPLES, PROCESS_STEPS,
  CONTACT_INTRO, STUDIO_ADDRESS, STUDIO_PHONE, STUDIO_PHONE_HREF,
  STUDIO_EMAIL, FOOTER,
} from "../../domain/seed.js";
import { escapeHtml } from "../html.js";
import { introPlateSvg, portraitPlateSvg, projectPlateSvg } from "../plates.js";

export type HomeQuery = { category: CategoryId | null; service: string | null; type: string | null };

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function attr(value: string): string {
  return escapeHtml(value);
}

function head(link: { name: string; href: string }): string {
  return `<a class="header-link" href="${attr(link.href)}">${escapeHtml(link.name)}</a>`;
}

export function headerHtml(): string {
  const links = [
    { name: "About", href: "/#about" },
    { name: "Services", href: "/#services" },
    { name: "Work", href: "/#work" },
    { name: "Philosophy", href: "/#philosophy" },
    { name: "Contact", href: "/#contact" },
  ];
  return `<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="header-inner">
    <a class="home-link" href="/">Sollis Studio home</a>
    <nav class="main-nav" aria-label="Main">
      ${links.map(head).join("")}
    </nav>
    <button class="menu-button" type="button" aria-haspopup="dialog" aria-expanded="false">Menu</button>
  </div>
</header>
<div class="menu-dialog" hidden>
  <div class="menu-panel">
    <button class="menu-close" type="button">Close menu</button>
    <nav aria-label="Menu sections">
      ${links.map(head).join("")}
    </nav>
  </div>
</div>`;
}

export function footerHtml(): string {
  const links = ["About", "Services", "Work", "Philosophy", "Contact"].map(
    (name) => `<a class="footer-link" href="/#${name.toLowerCase()}">${name}</a>`
  );
  const social = [
    { name: "Instagram (opens in a new tab)", href: "https://instagram.example/sollis.studio" },
    { name: "LinkedIn (opens in a new tab)", href: "https://linkedin.example/in/maren-sollis" },
    { name: "Behance (opens in a new tab)", href: "https://behance.example/sollis" },
  ];
  return `<footer class="site-footer">
  <div class="footer-inner">
    <p class="footer-name">${FOOTER.name}</p>
    <p class="footer-fiction">${FOOTER.fiction}</p>
    <nav aria-label="Footer">${links.join("")}<a class="footer-link" href="/privacy">Privacy</a></nav>
    <nav aria-label="Social">${social.map((s) => `<a class="footer-link" href="${attr(s.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>`).join("")}</nav>
    <p class="footer-email"><a href="mailto:${STUDIO_EMAIL}">${STUDIO_EMAIL}</a></p>
    <p class="footer-copyright">${FOOTER.copyright}</p>
  </div>
</footer>`;
}

function statisticsHtml(content: Content): string {
  const tabs = content.stats
    .map(
      (stat, index) => `<button class="stat-tab" role="tab" id="stat-tab-${index}" aria-controls="stat-panel-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">
      <span class="stat-number" data-count data-value="${stat.value}" aria-hidden="true">${formatNumber(stat.value)}</span>
      <span class="stat-label">${escapeHtml(stat.label)}</span>
    </button>`
    )
    .join("");
  const panels = content.stats
    .map((stat, index) => {
      const segments = stat.parts
        .map((part) => `<span class="bar-segment" data-part="${attr(part.label)}" style="width:${((part.value / stat.value) * 100).toFixed(2)}%"></span>`)
        .join("");
      const partTexts = stat.parts
        .map((part) => `<p class="part-text"><span class="part-label">${escapeHtml(part.label)}:</span> ${formatNumber(part.value)}</p>`)
        .join("");
      return `<div class="stat-panel" role="tabpanel" id="stat-panel-${index}" aria-labelledby="stat-tab-${index}"${index === 0 ? "" : " hidden"}>
        <p class="stat-note">${escapeHtml(stat.note)}</p>
        <div class="bar-of-parts">${segments}</div>
        <div class="part-texts">${partTexts}</div>
      </div>`;
    })
    .join("");
  return `<div class="statistics">
    <div class="stat-tabs" role="tablist" aria-label="Statistics">${tabs}</div>
    <div class="stat-panels">${panels}</div>
  </div>`;
}

function servicesHtml(query: HomeQuery): string {
  const openId = query.service;
  return SERVICES.map((service, index) => {
    const open = openId === service.id;
    return `<section class="service" data-service="${service.id}">
      <h3 class="service-heading"><button class="service-button" type="button" aria-expanded="${open}" aria-controls="service-panel-${index}"${open ? " data-open-focus" : ""}>
        <span class="service-name">${escapeHtml(service.name)}</span>
        <span class="chevron" aria-hidden="true"></span>
      </button></h3>
      <div class="service-panel" id="service-panel-${index}"${open ? "" : " hidden"}>
        <p class="service-summary">${escapeHtml(service.summary)}</p>
        <div class="service-lists">
          <div class="service-list">
            <h4 class="service-subheading">Capabilities</h4>
            <ul>${service.capabilities.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
          </div>
          <div class="service-list">
            <h4 class="service-subheading">Deliverables</h4>
            <ul>${service.deliverables.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>
          </div>
        </div>
        <p class="service-engagement">Typical engagement: ${escapeHtml(service.engagement)}</p>
        <p class="service-links">
          <a href="/?category=${service.id}#work" data-category-link="${service.id}">See ${escapeHtml(service.name)} work</a>
          <a href="/?type=${service.id}#contact" data-type-link="${service.id}">Start a ${escapeHtml(service.name)} project</a>
        </p>
      </div>
    </section>`;
  }).join("");
}

function workItemsHtml(projects: Project[], category: CategoryId | null): string {
  return projects
    .map((project, index) => `<li class="work-item" data-project="${project.slug}" data-category="${project.category}">
      <a class="work-link" href="/work/${project.slug}${category ? `?category=${category}` : ""}" data-work-link aria-label="${escapeHtml(project.title)}">
        <span class="work-cover" data-cover>${projectPlateSvg(project, { width: 400, height: 500, hidden: true })}</span>
        <span class="work-caption" aria-hidden="true">View case study</span>
      </a>
      <p class="work-title">${escapeHtml(project.title)}</p>
      <p class="work-meta">${escapeHtml(project.client)} · ${escapeHtml(CATEGORY_NAMES[project.category])} · ${project.year}</p>
      <span class="work-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
    </li>`)
    .join("");
}

function processHtml(): string {
  const tabs = PROCESS_STEPS.map(
    (step, index) => `<button class="process-tab" role="tab" id="process-tab-${index}" aria-controls="process-panel-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${escapeHtml(step.name)}</button>`
  ).join("");
  const panels = PROCESS_STEPS.map(
    (step, index) => `<div class="process-panel" role="tabpanel" id="process-panel-${index}" aria-labelledby="process-tab-${index}"${index === 0 ? "" : " hidden"}>
      <p class="process-count">Step ${index + 1} of 4</p>
      <h4 class="process-name">${escapeHtml(step.name)}</h4>
      <p class="process-weeks">${escapeHtml(step.weeks)}</p>
      <p class="process-text">${escapeHtml(step.text)}</p>
    </div>`
  ).join("");
  return `<div class="process">
    <div class="process-tabs" role="tablist" aria-label="Process">${tabs}</div>
    <div class="process-panels">${panels}</div>
  </div>`;
}

function contactDetailsHtml(): string {
  return `<dl class="contact-details">
    <div><dt>Email</dt><dd><a href="mailto:${STUDIO_EMAIL}">${STUDIO_EMAIL}</a></dd></div>
    <div><dt>Phone</dt><dd><a href="${STUDIO_PHONE_HREF}">${STUDIO_PHONE}</a></dd></div>
    <div><dt>Studio</dt><dd>${STUDIO_ADDRESS}</dd></div>
  </dl>`;
}

export function enquiryFormHtml(checkedType: string | null): string {
  return `<form class="enquiry-form" aria-label="Project enquiry" novalidate>
    <div class="form-alert" role="alert" hidden></div>
    <div class="error-box" tabindex="-1" hidden>
      <h3 class="error-heading">There is a problem with your enquiry</h3>
      <ul class="error-list"></ul>
    </div>
    <p class="field">
      <label for="name">Name</label>
      <input class="control" id="name" name="name" type="text" autocomplete="name">
      <span class="field-error" data-error-for="name"></span>
    </p>
    <p class="field">
      <label for="email">Email</label>
      <input class="control" id="email" name="email" type="email" autocomplete="email">
      <span class="field-error" data-error-for="email"></span>
    </p>
    <fieldset class="field" data-fieldset="project_type">
      <legend>Project type</legend>
      ${PROJECT_TYPES.map(
        (type) => `<label class="radio-label"><input type="radio" name="project_type" value="${type.id}"${checkedType === type.id ? " checked" : ""}> <span>${escapeHtml(type.name)}</span></label>`
      ).join("")}
      <span class="field-error" data-error-for="project_type"></span>
    </fieldset>
    <p class="field">
      <label for="budget">Budget range</label>
      <select class="control" id="budget" name="budget">
        <option value="">Choose a budget range</option>
        ${BUDGET_OPTIONS.map((option) => `<option value="${option.id}">${escapeHtml(option.name)}</option>`).join("")}
      </select>
      <span class="field-error" data-error-for="budget"></span>
    </p>
    <p class="field">
      <label for="description">Project description</label>
      <textarea class="control" id="description" name="description" rows="6" maxlength="2000"></textarea>
      <span class="char-count" data-counter>0 of 2,000 characters</span>
      <span class="field-error" data-error-for="description"></span>
    </p>
    <button class="send-button" type="submit">Send enquiry</button>
  </form>`;
}

export function homePageHtml(content: Content, query: HomeQuery): string {
  const shownProjects = query.category ? content.projects.filter((p) => p.category === query.category) : content.projects;
  const introPlate = introPlateSvg();
  const portrait = portraitPlateSvg();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sollis Studio | Independent designer</title>
<link rel="stylesheet" href="/css/site.css">
</head>
<body class="page-home">
${headerHtml()}
<main id="main">
  <section class="section intro" id="intro" aria-labelledby="intro-heading">
    <div class="intro-inner">
      <h1 id="intro-heading" class="intro-heading" data-lines>
        <span class="line" data-line="1">${escapeHtml(INTRO_LINES[0])}</span>
        <span class="line" data-line="2">${escapeHtml(INTRO_LINES[1])}</span>
        <span class="line" data-line="3">${escapeHtml(INTRO_LINES[2])}</span>
      </h1>
      <p class="intro-text">${escapeHtml(INTRO_TEXT)}</p>
      <p class="intro-links">
        <a class="intro-link" href="/#contact">Start a project</a>
        <a class="intro-link" href="/#work">See selected work</a>
      </p>
    </div>
    <div class="intro-plate" data-parallax aria-hidden="true">${introPlate}</div>
  </section>
  <section class="section" id="about" aria-labelledby="about-heading">
    <h2 id="about-heading" class="section-heading reveal-heading" tabindex="-1">About Maren</h2>
    <div class="about-grid">
      <div class="about-text">
        ${ABOUT.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
        <h3 class="minor-heading">Background</h3>
        <ul class="background-list">
          ${ABOUT.background.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
      <div class="about-portrait">${portrait}</div>
    </div>
    ${statisticsHtml(content)}
  </section>
  <section class="section" id="services" aria-labelledby="services-heading">
    <h2 id="services-heading" class="section-heading reveal-heading" tabindex="-1">Services</h2>
    <p class="section-intro">${escapeHtml(SERVICES_INTRO)}</p>
    <div class="services">${servicesHtml(query)}</div>
  </section>
  <section class="section" id="work" aria-labelledby="work-heading">
    <h2 id="work-heading" class="section-heading reveal-heading" tabindex="-1">Selected work</h2>
    <fieldset class="work-filter" data-filter>
      <legend>Filter work by service</legend>
      <label class="radio-label all-radio"><input type="radio" name="category" value="all"${query.category ? "" : " checked"}> <span>All (${content.projects.length})</span></label>
      ${(["brand-identity", "website-design", "digital-product-design"] as CategoryId[])
        .map(
          (id) => `<label class="radio-label"><input type="radio" name="category" value="${id}"${query.category === id ? " checked" : ""}> <span>${escapeHtml(CATEGORY_NAMES[id])} (${content.projects.filter((p) => p.category === id).length})</span></label>`
        )
        .join("")}
    </fieldset>
    <ul class="work-list" aria-label="Projects"${shownProjects.length === 0 ? " hidden" : ""}>${workItemsHtml(shownProjects, query.category)}</ul>
    <p class="empty-notice" data-empty${shownProjects.length === 0 ? "" : " hidden"}>No projects in ${query.category ? CATEGORY_NAMES[query.category] : "this category"} yet.</p>
  </section>
  <section class="section" id="philosophy" aria-labelledby="philosophy-heading">
    <h2 id="philosophy-heading" class="section-heading reveal-heading" tabindex="-1">How I work</h2>
    <h3 class="minor-heading">Principles</h3>
    <ol class="principles">
      ${PRINCIPLES.map((p) => `<li><h4>${escapeHtml(p.heading)}</h4><p>${escapeHtml(p.text)}</p></li>`).join("")}
    </ol>
    <h3 class="minor-heading">Process</h3>
    ${processHtml()}
  </section>
  <section class="section" id="contact" aria-labelledby="contact-heading">
    <h2 id="contact-heading" class="section-heading reveal-heading" tabindex="-1">Start a project</h2>
    <p class="section-intro">${escapeHtml(CONTACT_INTRO)}</p>
    <div class="contact-grid">
      ${contactDetailsHtml()}
      <div class="contact-form" id="enquiry-container">
        ${enquiryFormHtml(query.type)}
      </div>
    </div>
  </section>
</main>
${footerHtml()}
<div class="status" role="status" aria-label="Site updates"></div>
<script src="/js/site.js" type="module"></script>
</body>
</html>`;
}
