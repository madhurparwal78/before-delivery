/**
 * Server-side rendering of the three published pages. The HTML carries the
 * starting state, and the client script takes every visitor-caused change from
 * there. No credential, service address or object-store address reaches here.
 */
import {
  ABOUT_FIGURES,
  BUDGETS,
  CASE_STUDY_SECTIONS,
  DISCIPLINES,
  EXPERTISE,
  FIGURE_LABEL,
  MILESTONES,
  MILESTONE_LABEL,
  NUMBERS_FIGURES,
  PROJECTS,
  PROJECTS_BY_SLUG,
  PROJECT_TYPE_OPTIONS,
  REVIEWS,
  REVIEW_NOTE,
  ROLES_SUMMARY,
  SECTION_IDS,
  SERVICES,
  SITE,
  SKILL_GROUPS,
  SKILL_LABEL,
  SOCIAL_LINKS,
  WORKING_PRINCIPLES,
  USED_IN_NONE,
  coverKey,
  frameKey,
  neighbours,
  parseCategory,
  projectDisciplineNames,
  usedIn,
  type Figure,
  type Project,
} from "../shared/domain.js";

const SOCIAL_NOTICE = " (opens in a new tab)";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function glyph(ch: string): string {
  return `<span aria-hidden="true" class="glyph">${ch}</span>`;
}

function newTabAttrs(href: string, label: string): string {
  return `href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}"`;
}

function socialLink(label: string, href: string): string {
  return `<a class="social-link" ${newTabAttrs(href, label + SOCIAL_NOTICE)}>${esc(label)}${glyph("↗")}</a>`;
}

/** The document shell shared by every page. */
function shell(options: {
  title: string;
  body: string;
  footer: string;
  pageClass: string;
}): string {
  const nav = SECTION_IDS.map(
    (id) =>
      `<a class="header-link" data-header-link="${id}" href="/#${id}">${id === "contact" ? "Contact" : id[0].toUpperCase() + id.slice(1)}</a>`
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<link rel="stylesheet" href="/assets/site.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
</head>
<body class="${options.pageClass}">
<div class="cursor" data-cursor data-visible="false" data-cursor-state="default" aria-hidden="true"><span data-cursor-text></span></div>
<a class="skip-link" href="#main" data-skip-link>Skip to content</a>
<header class="header" role="banner">
  <div class="header-inner">
    <a class="logo" href="/" data-home-link>Ottoline Rask home</a>
    <nav class="header-nav" aria-label="Sections" data-header-nav>${nav}</nav>
    <button class="menu-button" type="button" aria-expanded="false" aria-controls="menu-dialog" data-menu-button>Menu</button>
  </div>
</header>
<div class="menu-backdrop" data-menu-backdrop hidden></div>
<div class="menu-dialog" id="menu-dialog" role="dialog" aria-modal="true" aria-label="Menu" data-menu-dialog hidden>
  <button class="menu-close" type="button" data-menu-close>Close menu</button>
  <nav class="menu-nav" aria-label="Menu sections" data-menu-nav>
    ${SECTION_IDS.map(
      (id) =>
        `<a class="menu-link" data-header-link="${id}" href="/#${id}">${id === "contact" ? "Contact" : id[0].toUpperCase() + id.slice(1)}</a>`
    ).join("")}
  </nav>
</div>
<main id="main" tabindex="-1">
<div class="status-media" role="status" aria-label="Media notice" data-media-notice hidden></div>
${options.body}
</main>
${options.footer}
<div class="status-updates" role="status" aria-live="polite" data-updates></div>
<script src="/assets/site.js" type="module"></script>
</body>
</html>`;
}

function figureBlock(stats: string, figures: Figure[], columns: number): string {
  return `<div class="stats" data-stats="${stats}" data-columns="${columns}" data-label="${FIGURE_LABEL}">
${figures
  .map(
    (figure) => `<div class="counter" data-counter="${figure.key}" data-state="idle" data-target="${figure.target}" data-suffix="${figure.suffix ?? ""}">
    <p class="counter-figure"><span class="counter-value" aria-hidden="true">0${esc(figure.suffix ?? "")}</span><span class="visually-hidden">${esc(figure.label)}: ${figure.target}${esc(figure.suffix ?? "")}</span></p>
    <p class="counter-label">${esc(figure.label)}</p>
  </div>`
  )
  .join("")}
</div>`;
}

function projectCard(project: Project, category: string): string {
  const names = projectDisciplineNames(project.disciplines);
  const href = category ? `/work/${project.slug}?category=${category}` : `/work/${project.slug}`;
  return `<article class="card" data-project="${project.slug}" data-categories="${project.disciplines.join(" ")}" data-revealed="false">
  <div class="card-field" data-card-field>
    <div class="card-cover" data-media-slot="${coverKey(project.slug)}" data-media-name="${esc(project.title)} cover" data-media-kind="cover">
      <img data-media-img src="/media/${coverKey(project.slug)}" alt="${esc(project.title)} cover" data-state="loading">
    </div>
  </div>
  <div class="card-body">
    <h3 class="card-title"><a class="card-link" href="${esc(href)}" data-card-link>${esc(project.title)}</a></h3>
    <p class="card-kind">${esc(project.kind)}</p>
    <p class="card-meta"><span class="card-year">${project.year}</span><span class="card-dot" aria-hidden="true">·</span>${names.map(esc).join(", ")}</p>
    <button class="card-preview" type="button" data-preview-open data-slug="${project.slug}" aria-haspopup="dialog">Preview ${esc(project.title)}</button>
  </div>
</article>`;
}

function serviceItem(index: number, service: (typeof SERVICES)[number]): string {
  return `<div class="service" data-service="${service.value}">
  <h3 class="service-name">
    <button class="service-toggle" type="button" id="service-toggle-${service.value}" aria-expanded="false" aria-controls="service-panel-${service.value}">
      ${esc(service.name)}
    </button>
  </h3>
  <p class="service-description">${esc(service.description)}</p>
  <div class="service-panel" id="service-panel-${service.value}" data-service-panel hidden>
    <div class="service-panel-inner">
      <h4 class="service-list-heading">Deliverables</h4>
      <ul class="service-list">${service.deliverables.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
      <h4 class="service-list-heading">Technology</h4>
      <ul class="service-list">${service.technology.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      <a class="service-enquire" href="/?service=${service.value}#contact" data-enquire-link data-service-value="${service.value}">Enquire about ${esc(service.name)}</a>
    </div>
  </div>
  <div class="service-visual" data-service-visual aria-hidden="true" data-shape="${index}"></div>
</div>`;
}

function skillPanel(index: number, group: (typeof SKILL_GROUPS)[number]): string {
  const id = `skill-panel-${index}`;
  return `<div class="skill-panel" role="tabpanel" id="${id}" aria-labelledby="skill-tab-${index}" data-skill-panel index="${index}"${index === 0 ? "" : " hidden"}>
${group.cards
  .map(
    (card) => `<div class="skill-card" data-skill>
    <h3 class="skill-name"><button class="skill-toggle" type="button" aria-expanded="false" aria-controls="${id}-${card.technology.replace(/[^a-z0-9]/gi, "")}-detail">${esc(card.technology)}</button></h3>
    <p class="skill-level"><meter min="0" max="100" value="${card.level}" aria-label="${esc(card.technology)} fluency" aria-valuetext="${card.level} out of 100" data-meter data-level="${card.level}"></meter><span class="skill-level-figure">${card.level}</span></p>
    <div class="skill-detail" id="${id}-${card.technology.replace(/[^a-z0-9]/gi, "")}-detail" data-skill-detail hidden>
      <p class="skill-detail-heading">Used in:</p>
      <ul class="skill-detail-list">${
        usedIn(card.technology).length > 0
          ? usedIn(card.technology)
              .map(
                (project) =>
                  `<li><a class="skill-detail-link" href="/work/${project.slug}">${esc(project.title)}</a></li>`
              )
              .join("")
          : `<li>${esc(USED_IN_NONE)}</li>`
      }</ul>
    </div>
  </div>`
  )
  .join("")}
</div>`;
}

function enquiryForm(): string {
  const field = (
    id: string,
    label: string,
    control: string,
    describedBy: string
  ) => `<div class="field" data-field="${id}">
    <label class="field-label" for="${id}">${esc(label)}</label>
    ${control}
    <p class="field-message" id="${id}-message" hidden></p>
    ${describedBy}
  </div>`;
  const name = field(
    "enquiry-name",
    "Your name",
    `<input class="field-control" id="enquiry-name" name="name" type="text" autocomplete="name">`,
    `<span class="visually-hidden" id="enquiry-name-hint"></span>`
  );
  const email = field(
    "enquiry-email",
    "Email address",
    `<input class="field-control" id="enquiry-email" name="email" type="text" inputmode="email" autocomplete="email">`,
    `<span class="visually-hidden" id="enquiry-email-hint"></span>`
  );
  const projectType = field(
    "enquiry-project-type",
    "Project type",
    `<select class="field-control" id="enquiry-project-type" name="projectType">
      <option value="" selected>Choose a project type</option>
      ${PROJECT_TYPE_OPTIONS.map(
        (option) => `<option value="${option.value}">${esc(option.label)}</option>`
      ).join("")}
    </select>`,
    `<span class="visually-hidden" id="enquiry-project-type-hint"></span>`
  );
  const budget = `<div class="field" data-field="budget">
    <p class="field-label" id="budget-label">Budget</p>
    <div class="budget-group" role="radiogroup" aria-labelledby="budget-label" data-budget-group>
      ${BUDGETS.map(
        (band, index) => `<div class="budget-option">
        <input class="budget-input" type="radio" id="budget-${index}" name="budget" value="${band.value}">
        <label class="budget-label" for="budget-${index}">${esc(band.label)}</label>
      </div>`
      ).join("")}
    </div>
    <p class="field-message" id="budget-message" hidden></p>
    <span class="visually-hidden" id="budget-hint"></span>
  </div>`;
  const message = field(
    "enquiry-message",
    "Tell me about your project",
    `<textarea class="field-control" id="enquiry-message" name="message" rows="6"></textarea>`,
    `<span class="visually-hidden" id="enquiry-message-hint"></span>`
  );
  return `<form class="enquiry" data-enquiry aria-label="Project enquiry" novalidate>
  ${name}
  ${email}
  ${projectType}
  ${budget}
  ${message}
  <button class="send" type="submit" data-send>Send message</button>
</form>
<div class="form-status" role="status" aria-label="Form status" data-form-status></div>
<div class="sent-panel" data-sent-panel hidden>
  <h3 class="sent-heading" tabindex="-1">Message received.</h3>
  <p class="sent-copy" data-sent-copy></p>
  <button class="send-another" type="button" data-send-another>Send another message</button>
</div>`;
}

function contactDetails(): string {
  return `<div class="contact-details">
  <h3 class="contact-heading">Studio</h3>
  <p class="contact-line"><a class="contact-email" href="mailto:${SITE.email}">Email Ottoline</a></p>
  <p class="contact-line" data-email>${SITE.email}</p>
  <ul class="contact-social">
    <li>${socialLink("Ottoline Rask on GitHub", SOCIAL_LINKS[0].href)}</li>
    <li>${socialLink("Ottoline Rask on LinkedIn", SOCIAL_LINKS[1].href)}</li>
    <li>${socialLink("Ottoline Rask on Dribbble", SOCIAL_LINKS[2].href)}</li>
  </ul>
  <p class="contact-availability"><span class="availability-label">${esc("Illustrative availability")}</span> Taking on new projects from January 2027.</p>
</div>`;
}

function footer(): string {
  const links = SECTION_IDS.map(
    (id) =>
      `<a class="footer-link" href="/#${id}">${id === "contact" ? "Contact" : id[0].toUpperCase() + id.slice(1)}</a>`
  ).join("");
  const letters = [..."Ottoline Rask"]
    .map(
      (letter, index) =>
        `<span class="footer-letter${letter === " " ? " footer-letter-space" : ""}" data-footer-letter style="--letter-index:${index}">${letter === " " ? "&nbsp;" : letter}</span>`
    )
    .join("");
  return `<footer class="footer" role="contentinfo">
  <div class="footer-inner">
    <p class="footer-mark" data-footer-mark>${letters}</p>
    <nav class="footer-nav" aria-label="Footer">${links}</nav>
    <ul class="footer-social">
      <li>${socialLink("Ottoline Rask on GitHub", SOCIAL_LINKS[0].href)}</li>
      <li>${socialLink("Ottoline Rask on LinkedIn", SOCIAL_LINKS[1].href)}</li>
      <li>${socialLink("Ottoline Rask on Dribbble", SOCIAL_LINKS[2].href)}</li>
    </ul>
    <button class="back-to-top" type="button" data-back-to-top>Back to top</button>
    <p class="footer-copy">© 2026 Quillfern Works.</p>
    <p class="footer-notice">Ottoline Rask and Quillfern Works are fictional. Projects, clients, reviews, figures and the career timeline on this site are illustrative.</p>
  </div>
</footer>`;
}

function quickLookDialog(): string {
  return `<div class="dialog-backdrop" data-preview-backdrop hidden></div>
<div class="dialog" role="dialog" aria-modal="true" data-quick-look hidden>
  <h2 class="dialog-title" data-quick-look-title></h2>
  <div class="dialog-frame" data-quick-look-frame-slot data-media-slot="" data-media-kind="frame"></div>
  <p class="dialog-status" role="status" data-quick-look-status>Frame 1 of 6</p>
  <div class="dialog-controls">
    <button class="frame-prev" type="button" data-frame-prev>Previous frame</button>
    <button class="frame-next" type="button" data-frame-next>Next frame</button>
    <button class="dialog-close" type="button" data-quick-look-close>Close preview</button>
    <a class="dialog-open" data-quick-look-open href="/">Open case study</a>
  </div>
</div>`;
}

/** The home page. */
export function renderHome(): string {
  const words = "I build websites that move with you.".split(" ");
  const headline = words
    .map(
      (word, index) =>
        `<span class="headline-word" data-headline-word style="--word-index:${index}">${esc(word)}</span>`
    )
    .join(" ");
  const milestones = MILESTONES.map((milestone, index) => {
    const year = milestone.button.split(":")[0];
    const title = milestone.button.slice(year.length + 1).trim();
    return `<li class="milestone" data-milestone data-reached="false">
      <h3 class="milestone-heading">
        <button class="milestone-toggle" type="button" aria-expanded="false" aria-controls="milestone-detail-${index}">
          <span class="milestone-year">${esc(year)}:</span> ${esc(title)}
        </button>
      </h3>
      <div class="milestone-detail" id="milestone-detail-${index}" hidden>
        <p>${esc(milestone.detail)}</p>
      </div>
    </li>`;
  }).join("");
  const cards = PROJECTS.map((project) => projectCard(project, "")).join("");
  const filters = DISCIPLINES.map(
    (discipline) =>
      `<button class="filter-toggle" type="button" aria-pressed="false" data-filter-value="${discipline.value}">${esc(discipline.name)}</button>`
  ).join("");
  const services = SERVICES.map((service, index) => serviceItem(index, service)).join("");
  const tabs = SKILL_GROUPS.map(
    (group, index) =>
      `<button class="skill-tab" type="button" role="tab" id="skill-tab-${index}" aria-selected="${index === 0}" aria-controls="skill-panel-${index}" tabindex="${index === 0 ? "0" : "-1"}" data-skill-tab data-tab-index="${index}">${esc(group.tab)}</button>`
  ).join("");
  const panels = SKILL_GROUPS.map((group, index) => skillPanel(index, group)).join("");
  const reviews = REVIEWS.map((review, index) => {
    return `<div class="review-slide" role="group" aria-roledescription="slide" aria-label="Review ${index + 1} of 5" data-review-slide data-review-index="${index + 1}"${index === 0 ? "" : " hidden"}>
      <blockquote class="review-quote">${esc(review.quote)}</blockquote>
      <p class="review-name">${esc(review.name)}</p>
      <p class="review-role">${esc(review.role)}, ${esc(review.company)} (illustrative)</p>
    </div>`;
  }).join("");
  const body = `<section class="intro" id="intro" data-section="intro" data-intro="playing" aria-labelledby="intro-heading">
  <div class="hero">
    <div class="hero-copy" data-hero-copy>
      <p class="greeting" data-greeting>Hello, I'm Ottoline.</p>
      <h1 class="headline" id="intro-heading" tabindex="-1">${headline}</h1>
      <p class="role-line" data-role-line aria-hidden="true">I'm a <span class="role-current" data-role data-role-index="1">full-stack developer</span>.</p>
      <p class="visually-hidden" data-roles-summary>${esc(ROLES_SUMMARY)}</p>
      <div class="role-controls" role="group" aria-label="Role line controls">
        <button class="role-button" type="button" data-role-prev>Previous role</button>
        <button class="role-button" type="button" data-role-next>Next role</button>
        <button class="role-button" type="button" aria-pressed="false" data-role-pause>Pause roles</button>
      </div>
      <p class="intro-paragraph">Independent developer and digital creator. I design, animate and build full-stack products, from the first sketch to the cloud.</p>
      <div class="intro-actions" role="group" aria-label="Hero actions">
        <a class="hero-link" href="/#work" data-section-jump="work">Explore projects${glyph("→")}</a>
        <a class="hero-link" href="/#contact" data-section-jump="contact">Start a project</a>
      </div>
    </div>
    <div class="hero-visual" data-hero-visual aria-hidden="true" data-tilt-x="0" data-tilt-y="0">
      <div class="monogram" data-monogram>
        <svg class="monogram-svg" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet">
          <g class="monogram-layer" data-layer="1">
            <circle cx="200" cy="200" r="150" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M140 260 A 70 70 0 1 1 260 260" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round"/>
          </g>
          <g class="monogram-layer" data-layer="2" transform="rotate(18 200 200)">
            <rect x="150" y="130" width="26" height="140" rx="13" fill="none" stroke="currentColor" stroke-width="18"/>
            <rect x="150" y="130" width="100" height="26" rx="13" fill="none" stroke="currentColor" stroke-width="18"/>
            <rect x="224" y="130" width="26" height="72" rx="13" fill="none" stroke="currentColor" stroke-width="18"/>
          </g>
          <g class="monogram-layer" data-layer="3" transform="rotate(-12 200 200)">
            <path d="M120 320 L 200 90 L 280 320" fill="none" stroke="currentColor" stroke-width="4"/>
            <path d="M150 250 L 250 250" fill="none" stroke="currentColor" stroke-width="4"/>
          </g>
        </svg>
      </div>
    </div>
  </div>
</section>
<section class="about section" id="about" data-section="about" aria-labelledby="about-heading">
  <div class="section-inner">
    <h2 class="section-heading" id="about-heading" tabindex="-1">About</h2>
    <div class="about-grid">
      <div class="about-copy">
        <p class="about-intro">I'm Ottoline Rask, an independent developer and digital creator working as Quillfern Works. I take a build from the first sketch to the cloud, and I like being the person who knows how every moving part behaves.</p>
        <p class="about-philosophy">I treat motion as explanation, not decoration, and I check every screen by keyboard, on a phone and with reduced motion before I call it done. Each case study here says which parts were mine.</p>
      </div>
      <div class="about-lists">
        <div class="about-list">
          <h3 class="about-list-heading">Working principles</h3>
          <ul class="about-list-items">${WORKING_PRINCIPLES.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        </div>
        <div class="about-list">
          <h3 class="about-list-heading">Areas of expertise</h3>
          <ul class="about-list-items">${EXPERTISE.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        </div>
      </div>
    </div>
    ${figureBlock("about", ABOUT_FIGURES, 2)}
    <div class="journey" data-journey>
      <h3 class="journey-heading">Career journey</h3>
      <p class="journey-label">${esc(MILESTONE_LABEL)}</p>
      <div class="journey-track" data-journey-track>
        <div class="journey-progress" data-journey-progress data-value="0"><span class="journey-line" data-journey-line></span></div>
        <ol class="journey-list">${milestones}</ol>
      </div>
    </div>
  </div>
</section>
<section class="work section" id="work" data-section="work" aria-labelledby="work-heading">
  <div class="section-inner">
    <h2 class="section-heading" id="work-heading" tabindex="-1">Selected work</h2>
    <div class="filter-group" role="group" aria-label="Filter projects by discipline">
      <button class="filter-toggle" type="button" aria-pressed="true" data-filter-all>All</button>
      ${filters}
    </div>
    <p class="results" data-results aria-live="off">Showing 6 of 6 projects.</p>
    <div class="gallery" data-gallery>${cards}</div>
  </div>
</section>
<section class="services section" id="services" data-section="services" aria-labelledby="services-heading">
  <div class="section-inner">
    <h2 class="section-heading" id="services-heading" tabindex="-1">Services</h2>
    <div class="services-list">${services}</div>
  </div>
</section>
<section class="skills section" id="skills" data-section="skills" aria-labelledby="skills-heading">
  <div class="section-inner">
    <h2 class="section-heading" id="skills-heading" tabindex="-1">Skills and tools</h2>
    <p class="skills-label">${esc(SKILL_LABEL)}</p>
    <div class="skill-tabs" role="tablist" aria-label="Skill groups" data-skill-tabs>${tabs}</div>
    <div class="skill-panels" data-skill-panels>${panels}</div>
  </div>
</section>
<section class="reviews section" id="reviews" data-section="reviews" aria-labelledby="reviews-heading">
  <div class="section-inner">
    <h2 class="section-heading" id="reviews-heading" tabindex="-1">Client reviews</h2>
    <p class="reviews-note">${esc(REVIEW_NOTE)}</p>
    <div class="reviews-carousel" aria-roledescription="carousel" data-reviews-carousel aria-label="Reviews">
      <div class="reviews-viewport" data-reviews-viewport>
        <div class="review-track" data-review-track>${reviews}</div>
      </div>
      <div class="reviews-controls">
        <button class="review-prev" type="button" data-review-prev>Previous review</button>
        <button class="review-next" type="button" data-review-next>Next review</button>
      </div>
      <p class="review-position" data-review-position>1 / 5</p>
    </div>
  </div>
</section>
<section class="numbers section" id="numbers" data-section="numbers" aria-labelledby="numbers-heading">
  <div class="section-inner">
    <h2 class="section-heading" id="numbers-heading" tabindex="-1">By the numbers</h2>
    ${figureBlock("numbers", NUMBERS_FIGURES, 4)}
  </div>
</section>
<section class="contact section" id="contact" data-section="contact" aria-labelledby="contact-heading">
  <div class="section-inner">
    <h2 class="section-heading" id="contact-heading" tabindex="-1">Start a project</h2>
    <p class="contact-lede">Tell me what you are building. I read every message myself.</p>
    <div class="contact-grid">
      <div class="contact-form">
        ${enquiryForm()}
      </div>
      ${contactDetails()}
    </div>
  </div>
</section>
${quickLookDialog()}`;
  return shell({ title: SITE.title, body, footer: footer(), pageClass: "page-home" });
}

/** A case study page. */
export function renderCaseStudy(slug: string, categoryParam: string | null): string {
  const project = PROJECTS_BY_SLUG.get(slug);
  if (!project) return renderNotFound();
  const category = parseCategory(categoryParam);
  const backToWorkHref = category.length > 0 ? `/?category=${category.join(",")}#work` : "/#work";
  const names = projectDisciplineNames(project.disciplines).join(", ");
  const body = `<div class="case-top">
  <h1 class="case-title" tabindex="-1">${esc(project.title)}</h1>
  <p class="case-kind">${esc(project.kind)}</p>
  <dl class="case-meta">
    <div class="case-meta-row"><dt>Client</dt><dd>${esc(project.client)} (illustrative)</dd></div>
    <div class="case-meta-row"><dt>Year</dt><dd>${project.year}</dd></div>
    <div class="case-meta-row"><dt>Role</dt><dd>${esc(project.role)}</dd></div>
    <div class="case-meta-row"><dt>Disciplines</dt><dd>${esc(names)}</dd></div>
  </dl>
  <p class="case-back"><a class="back-to-work" href="${backToWorkHref}" data-back-to-work>Back to work</a></p>
</div>
<div class="case-layout">
  <aside class="case-preview-aside">
    <figure class="case-preview" data-preview tabindex="-1" data-callout-slot>
      <div class="case-frame" data-case-frame data-media-slot="${frameKey(project.slug, 1)}" data-media-name="${esc(project.title)}, frame 1 of 6" data-media-kind="frame">
        <img data-media-img data-case-frame-img src="/media/${frameKey(project.slug, 1)}" alt="${esc(project.title)}, frame 1 of 6" data-frame="1">
        <div class="callout-region" data-callout-region hidden></div>
      </div>
      <figcaption class="case-preview-caption">
        <div class="case-callouts">
          <h2 class="callouts-heading">Callouts</h2>
          <ul class="callout-list" data-callout-list>
            ${project.callouts
              .map(
                (callout, index) => `<li class="callout-item">
              <button class="callout-button" type="button" aria-pressed="false" data-callout-button data-callout-index="${index + 1}">
                <span class="callout-number">${index + 1}</span> Callout ${index + 1}: ${esc(callout.label)}
              </button>
            </li>`
              )
              .join("")}
          </ul>
        </div>
        <p class="case-readout" data-readout>No callout selected</p>
      </figcaption>
    </figure>
  </aside>
  <div class="case-body">
    <nav class="on-this-page" aria-label="On this page" data-on-this-page>
      <h2 class="on-this-page-heading">On this page</h2>
      <ul class="on-this-page-list">
        ${CASE_STUDY_SECTIONS.map(
          (section) =>
            `<li><a class="on-this-page-link" data-on-this-page-link="${section.id}" href="#${section.id}">${esc(section.label)}</a></li>`
        ).join("")}
      </ul>
    </nav>
    <section class="case-section" id="overview" data-case-section="overview" aria-labelledby="overview-heading">
      <h2 class="case-section-heading" id="overview-heading" tabindex="-1">Overview</h2>
      <p>${esc(project.prose.overview)}</p>
    </section>
    <section class="case-section" id="challenge" data-case-section="challenge" aria-labelledby="challenge-heading">
      <h2 class="case-section-heading" id="challenge-heading" tabindex="-1">The challenge</h2>
      <p>${esc(project.prose.challenge)}</p>
    </section>
    <section class="case-section" id="solution" data-case-section="solution" aria-labelledby="solution-heading">
      <h2 class="case-section-heading" id="solution-heading" tabindex="-1">The solution</h2>
      <p>${esc(project.prose.solution)}</p>
    </section>
    <section class="case-section" id="decisions" data-case-section="decisions" aria-labelledby="decisions-heading">
      <h2 class="case-section-heading" id="decisions-heading" tabindex="-1">Design decisions</h2>
      <p>${esc(project.prose.decisions)}</p>
    </section>
    <section class="case-section" id="stack" data-case-section="stack" aria-labelledby="stack-heading">
      <h2 class="case-section-heading" id="stack-heading" tabindex="-1">Technology stack</h2>
      <ul class="case-stack">${project.stack.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    </section>
    <nav class="more-projects" aria-label="More projects" data-more-projects>
      <h2 class="more-projects-heading">More projects</h2>
      <ul class="more-projects-list">
        <li><a class="more-projects-link" data-neighbour="previous" href="#">Previous project</a></li>
        <li><a class="more-projects-link" data-neighbour="next" href="#">Next project</a></li>
      </ul>
    </nav>
  </div>
</div>`;
  return shell({
    title: `${project.title} | Ottoline Rask`,
    body,
    footer: footer(),
    pageClass: "page-case",
  });
}

/** The 404 page. */
export function renderNotFound(): string {
  const body = `<div class="not-found">
  <h1 class="not-found-heading" tabindex="-1">This page took a wrong turn.</h1>
  <p class="not-found-copy">The address may be mistyped, or the page may have moved.</p>
  <p><a class="not-found-link" href="/">Back to the homepage</a></p>
</div>`;
  return shell({ title: "Not found | Ottoline Rask", body, footer: footer(), pageClass: "page-not-found" });
}

/** Neighbour links for a case study, decided by the single neighbour rule. */
export function neighbourLinks(slug: string, categoryParam: string | null): {
  previous: { title: string; href: string } | null;
  next: { title: string; href: string } | null;
} {
  if (!PROJECTS_BY_SLUG.has(slug)) return { previous: null, next: null };
  const category = parseCategory(categoryParam);
  const { previous, next } = neighbours(slug, category);
  const query = category.length > 0 ? `?category=${category.join(",")}` : "";
  return {
    previous: previous ? { title: previous.title, href: `/work/${previous.slug}${query}` } : null,
    next: next ? { title: next.title, href: `/work/${next.slug}${query}` } : null,
  };
}
