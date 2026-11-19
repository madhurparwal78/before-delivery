import {
  ABOUT_COUNTERS, AREAS_OF_EXPERTISE, DISCIPLINES, MILESTONES, NUMBERS_COUNTERS, PROJECTS, REVIEWS, ROLES, ROLES_SUMMARY,
  SERVICES, SERVICE_PARAM, SKILL_GROUPS, STUDIO_EMAIL, SOCIAL_LINKS, WORKING_PRINCIPLES, disciplineName,
  type Counter, type DisciplineValue, type Milestone, type Project, type Service,
} from "../../shared/catalog.js";
import { BUDGET_BANDS, PROJECT_TYPES } from "../../shared/enquiry.js";
import { caseStudyHref, galleryColumn, isPressed, resultsText, visibleProjects } from "../../shared/filter.js";
import { reviewPosition, reviewSlideLabel } from "../../shared/announcements.js";
import { COVER_SIZE, coverKey, frameStatus, mediaPath } from "../../shared/media-manifest.js";
import { renderFrameSlot } from "./frame-slot.js";
import { flag, html, type Markup } from "./html.js";
import { ICONS } from "./icons.js";
import { externalLink, glyph, renderDocument, type PageFrame } from "./layout.js";
import { serviceVisual } from "./service-visuals.js";

/** The home page: the hero, about, work, services, skills, reviews, numbers and contact sections. The state an address
 * asks for (`category`, `service`) is rendered into the markup so the page is right before any script runs. */

interface HomeState {
  readonly categories: readonly DisciplineValue[];
  readonly service: Service | undefined;
  readonly introDone: boolean;
}

function sculpture(): Markup {
  const layers = Array.from({ length: 9 }, (_, index) =>
    html`<text class="sculpture-layer" style="--layer: ${index}" x="280" y="392" text-anchor="middle" transform="translate(${index * -7} ${index * -6})">OR</text>`);
  return html`<svg class="sculpture" viewBox="0 0 560 560" focusable="false">${layers}</svg>`;
}

function hero(introDone: boolean): Markup {
  const headline = "I build websites that move with you.".split(" ");
  const roleButtons = html`<div class="role-controls intro-late">
    <button type="button" class="icon-button" data-role-previous aria-label="Previous role">${ICONS.previous}</button>
    <button type="button" class="icon-button" data-role-next aria-label="Next role">${ICONS.next}</button>
    <button type="button" class="icon-button" data-role-toggle aria-label="Pause roles"><span data-toggle-pause>${ICONS.pause}</span><span data-toggle-play hidden>${ICONS.play}</span></button>
  </div>`;
  return html`<section class="hero" id="intro" data-section="intro" data-intro="${introDone ? "done" : "playing"}" aria-labelledby="page-title">
    <div class="sheet hero-grid">
      <div class="hero-copy" data-hero-copy>
        <p class="hero-greeting" data-greeting>Hello, I'm Ottoline.</p>
        <h1 id="page-title" tabindex="-1">${headline.map((word, index) => html`<span class="headline-word" data-headline-word style="--i: ${index}">${word}</span>${index < headline.length - 1 ? " " : ""}`)}</h1>
        <p class="role-line intro-late" data-role-line aria-hidden="true">I'm a <span class="role-window"><span class="role-text" data-role data-role-index="1">${ROLES[0] ?? ""}</span></span>.</p>
        <p class="sr-only" data-roles-summary>${ROLES_SUMMARY}</p>
        ${roleButtons}
        <p class="hero-lede intro-paragraph">Independent developer and digital creator. I design, animate and build full-stack products, from the first sketch to the cloud.</p>
        <div class="hero-actions intro-late">
          <a class="button button-solid" href="/#work">Explore projects ${glyph("→")}</a>
          <a class="button button-outline" href="/#contact">Start a project</a>
        </div>
      </div>
      <div class="hero-visual" data-hero-visual aria-hidden="true">${sculpture()}</div>
    </div>
  </section>`;
}

function counterMarkup(counter: Counter): Markup {
  return html`<div class="figure">
    <dt class="figure-label">${counter.label}</dt>
    <dd class="figure-value"><span class="sr-only">${counter.target}${counter.suffix}</span><span class="figure-visible" aria-hidden="true"><span class="mono-figure" data-counter="${counter.key}" data-target="${counter.target}">0</span>${counter.suffix === "" ? "" : html`<span class="figure-suffix">${counter.suffix}</span>`}</span></dd>
  </div>`;
}

function counterBlock(key: "about" | "numbers", counters: readonly Counter[]): Markup {
  return html`<div class="stats" data-stats="${key}" data-state="idle">
    <p class="label">Illustrative figures</p>
    <dl class="figures">${counters.map(counterMarkup)}</dl>
  </div>`;
}

function milestoneMarkup(milestone: Milestone, index: number): Markup {
  return html`<li class="milestone" data-milestone data-reached="false">
    <button type="button" class="milestone-button" aria-expanded="false" aria-controls="milestone-${index}"><span class="milestone-year">${milestone.year}:</span> <span class="milestone-title">${milestone.title}</span></button>
    <p class="milestone-detail" id="milestone-${index}" hidden>${milestone.detail}</p>
  </li>`;
}

function about(): Markup {
  return html`<section class="section about" id="about" data-section="about" aria-labelledby="about-title">
    <div class="sheet">
      <h2 class="section-title" id="about-title" tabindex="-1">About</h2>
      <div class="about-copy">
        <p class="about-intro">I'm Ottoline Rask, an independent developer and digital creator working as Quillfern Works. I take a build from the first sketch to the cloud, and I like being the person who knows how every moving part behaves.</p>
        <p class="about-philosophy">I treat motion as explanation, not decoration, and I check every screen by keyboard, on a phone and with reduced motion before I call it done. Each case study here says which parts were mine.</p>
      </div>
      <div class="about-lists">
        <div class="list-block"><h3 class="list-title" id="principles-title">Working principles</h3><ul class="plain-list" aria-labelledby="principles-title">${WORKING_PRINCIPLES.map((line) => html`<li>${line}</li>`)}</ul></div>
        <div class="list-block"><h3 class="list-title" id="expertise-title">Areas of expertise</h3><ul class="plain-list" aria-labelledby="expertise-title">${AREAS_OF_EXPERTISE.map((line) => html`<li>${line}</li>`)}</ul></div>
      </div>
      <div class="about-stats">${counterBlock("about", ABOUT_COUNTERS)}</div>
      <div class="journey-block">
        <p class="label">Illustrative career timeline</p>
        <ol class="journey" aria-label="Career journey" data-journey-progress data-value="0">${MILESTONES.map(milestoneMarkup)}</ol>
      </div>
    </div>
  </section>`;
}

function mediaSlot(key: string, alt: string, kind: "cover" | "frame"): Markup {
  return html`<div class="media-slot" data-media-slot="${kind}" data-media-key="${key}" data-state="loading"><img src="${mediaPath(key)}" alt="${alt}" width="${COVER_SIZE.width}" height="${COVER_SIZE.height}" decoding="async"></div>`;
}

function card(project: Project, shownIndex: number, categories: readonly DisciplineValue[]): Markup {
  const shown = shownIndex >= 0;
  const names = project.disciplines.map(disciplineName).join(", ");
  return html`<article class="card" data-project="${project.slug}" data-categories="${project.disciplines.join(" ")}" data-revealed="false" data-col="${shown ? galleryColumn(shownIndex) : 0}"${flag(!shown, "hidden")}>
    <div class="card-cover">${mediaSlot(coverKey(project.slug), `${project.title} cover`, "cover")}</div>
    <div class="card-body">
      <p class="card-kind">${project.kind}</p>
      <h3 class="card-title"><a href="${caseStudyHref(project.slug, categories)}" data-card-link>${project.title}</a></h3>
      <p class="card-facts"><span class="mono">${project.year}</span><span class="card-disciplines">${names}</span></p>
      <button type="button" class="preview-button" data-preview-open="${project.slug}" aria-label="Preview ${project.title}" aria-haspopup="dialog">${ICONS.eye}<span>Preview</span></button>
    </div>
  </article>`;
}

function work(categories: readonly DisciplineValue[]): Markup {
  const shown = visibleProjects(categories);
  const filterButtons = [
    html`<button type="button" class="filter-button" data-filter="all" aria-pressed="${String(isPressed(categories, "all"))}">All</button>`,
    ...DISCIPLINES.map((discipline) => html`<button type="button" class="filter-button" data-filter="${discipline.value}" aria-pressed="${String(isPressed(categories, discipline.value))}">${discipline.name}</button>`),
  ];
  return html`<section class="section work" id="work" data-section="work" aria-labelledby="work-title">
    <div class="sheet">
      <h2 class="section-title" id="work-title" tabindex="-1">Selected work</h2>
      <div class="filter-bar">
        <div class="filter-group" role="group" aria-label="Filter projects by discipline">${filterButtons}</div>
        <p class="results" data-results>${resultsText(shown.length)}</p>
      </div>
      <div class="gallery" data-gallery>${PROJECTS.map((project) => card(project, shown.indexOf(project), categories))}</div>
    </div>
  </section>`;
}

function servicePanel(service: Service): Markup {
  return html`<article class="service" data-service="${service.value}" data-open="false">
    <h3 class="service-heading"><button type="button" class="service-button" aria-expanded="false" aria-controls="service-panel-${service.value}"><span class="service-name">${service.name}</span><span class="service-toggle" aria-hidden="true"></span></button></h3>
    <p class="service-description">${service.description}</p>
    <div class="service-panel" id="service-panel-${service.value}" data-service-panel hidden inert aria-hidden="true">
      <div class="service-panel-inner">
        <div class="service-visual" data-service-visual aria-hidden="true">${serviceVisual(service)}</div>
        <div class="service-body">
          <h4 class="list-title" id="deliverables-${service.value}">Deliverables</h4>
          <ul class="plain-list" aria-labelledby="deliverables-${service.value}">${service.deliverables.map((deliverable) => html`<li>${deliverable}</li>`)}</ul>
          <h4 class="list-title" id="technology-${service.value}">Technology</h4>
          <ul class="plain-list tag-list" aria-labelledby="technology-${service.value}">${service.technology.map((technology) => html`<li>${technology}</li>`)}</ul>
          <a class="button button-solid" href="/?${SERVICE_PARAM}=${service.value}#contact" data-enquire="${service.value}">Enquire about ${service.name} ${glyph("→")}</a>
        </div>
      </div>
    </div>
  </article>`;
}

function services(): Markup {
  return html`<section class="section services" id="services" data-section="services" aria-labelledby="services-title">
    <div class="sheet">
      <h2 class="section-title" id="services-title" tabindex="-1">Services</h2>
      <div class="service-list">${SERVICES.map(servicePanel)}</div>
    </div>
  </section>`;
}

function skillCard(technology: string, level: number, index: number, key: string): Markup {
  const usedIn = PROJECTS.filter((project) => project.stack.includes(technology));
  const detail = usedIn.length === 0
    ? html`<p>Used in client work not shown here.</p>`
    : html`<p><span class="used-in-label">Used in:</span> ${usedIn.map((project, at) => html`${at > 0 ? ", " : ""}<a href="/work/${project.slug}">${project.title}</a>`)}</p>`;
  return html`<li class="skill-card" data-skill style="--i: ${index}">
    <button type="button" class="skill-button" aria-expanded="false" aria-controls="skill-detail-${key}-${index}">${technology}</button>
    <div class="skill-meter" role="meter" aria-label="${technology} fluency" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${level}" aria-valuetext="${level} out of 100"><span class="bar"><span class="bar-fill" style="--level: ${level}"></span></span><span class="mono-figure skill-level">${level}</span></div>
    <div class="skill-detail" id="skill-detail-${key}-${index}" hidden>${detail}</div>
  </li>`;
}

function skills(): Markup {
  const keyOf = (name: string): string => name.toLowerCase();
  return html`<section class="section skills" id="skills" data-section="skills" aria-labelledby="skills-title">
    <div class="sheet">
      <h2 class="section-title" id="skills-title" tabindex="-1">Skills and tools</h2>
      <div class="tabs" role="tablist" aria-label="Skill groups">${SKILL_GROUPS.map((group, index) => html`<button type="button" class="tab" role="tab" id="tab-${keyOf(group.name)}" aria-selected="${index === 0 ? "true" : "false"}" aria-controls="panel-${keyOf(group.name)}" tabindex="${index === 0 ? "0" : "-1"}" data-tab="${index}">${group.name}</button>`)}</div>
      ${SKILL_GROUPS.map((group, index) => html`<div class="tabpanel" role="tabpanel" id="panel-${keyOf(group.name)}" aria-labelledby="tab-${keyOf(group.name)}" data-tabpanel="${index}" data-bars="${index === 0 ? "idle" : "off"}"${flag(index !== 0, "hidden")}>
        <p class="label">Illustrative fluency scores</p>
        <ul class="skill-cards">${group.cards.map((entry, at) => skillCard(entry.technology, entry.level, at, keyOf(group.name)))}</ul>
      </div>`)}
    </div>
  </section>`;
}

function reviews(): Markup {
  const slides = REVIEWS.map((review, index) => html`<div class="review-slide" role="group" aria-roledescription="slide" aria-label="${reviewSlideLabel(index + 1)}" data-review-slide${flag(index !== 0, "inert")}${flag(index !== 0, "aria-hidden", "true")}>
    <blockquote class="review-quote"><p>${review.quote}</p></blockquote>
    <p class="review-author"><span class="review-name">${review.name}</span><span class="review-role">${review.role}, ${review.company} (illustrative)</span></p>
  </div>`);
  return html`<section class="section reviews" id="reviews" data-section="reviews" aria-labelledby="reviews-title">
    <div class="sheet">
      <h2 class="section-title" id="reviews-title" tabindex="-1">Client reviews</h2>
      <p class="illustrative-note">Illustrative reviews: the clients, quotes and companies are fictional samples.</p>
      <div class="carousel" role="group" aria-roledescription="carousel" aria-label="Reviews" data-carousel>
        <div class="carousel-track" data-review-track><div class="carousel-strip" data-review-strip>${slides}</div></div>
        <div class="carousel-controls">
          <button type="button" class="icon-button" data-review-previous aria-label="Previous review" disabled>${ICONS.previous}</button>
          <p class="mono-figure review-position" data-review-position>${reviewPosition(1)}</p>
          <button type="button" class="icon-button" data-review-next aria-label="Next review">${ICONS.next}</button>
        </div>
      </div>
    </div>
  </section>`;
}

function numbers(): Markup {
  return html`<section class="section numbers" id="numbers" data-section="numbers" aria-labelledby="numbers-title">
    <div class="sheet">
      <h2 class="section-title" id="numbers-title" tabindex="-1">By the numbers</h2>
      ${counterBlock("numbers", NUMBERS_COUNTERS)}
    </div>
  </section>`;
}

function field(id: string, label: string, control: Markup): Markup {
  return html`<div class="field" data-field="${id}"><label class="field-label" for="enquiry-${id}">${label}</label>${control}<p class="field-message" id="enquiry-${id}-message" data-message="${id}"></p></div>`;
}

function contact(service: Service | undefined): Markup {
  const options = PROJECT_TYPES.map((type) => html`<option value="${type.value}"${flag(service?.value === type.value, "selected")}>${type.label}</option>`);
  return html`<section class="section contact" id="contact" data-section="contact" aria-labelledby="contact-title">
    <div class="sheet contact-grid">
      <div class="contact-head">
        <h2 class="section-title" id="contact-title" tabindex="-1">Start a project</h2>
        <p class="contact-lede">Tell me what you are building. I read every message myself.</p>
      </div>
      <div class="contact-form">
        <form class="enquiry" aria-label="Project enquiry" novalidate data-enquiry aria-busy="false">
          ${field("name", "Your name", html`<input class="input" id="enquiry-name" name="name" type="text" autocomplete="name" aria-describedby="enquiry-name-message">`)}
          ${field("email", "Email address", html`<input class="input" id="enquiry-email" name="email" type="email" autocomplete="email" aria-describedby="enquiry-email-message">`)}
          ${field("projectType", "Project type", html`<select class="input" id="enquiry-projectType" name="projectType" aria-describedby="enquiry-projectType-message"><option value="">Choose a project type</option>${options}</select>`)}
          <div class="field" data-field="budget">
            <div class="radio-group" role="radiogroup" aria-labelledby="enquiry-budget-label" id="enquiry-budget" aria-describedby="enquiry-budget-message">
              <span class="field-label" id="enquiry-budget-label">Budget</span>
              <div class="radio-options">${BUDGET_BANDS.map((band) => html`<label class="radio"><input type="radio" name="budget" value="${band.value}"><span>${band.label}</span></label>`)}</div>
            </div>
            <p class="field-message" id="enquiry-budget-message" data-message="budget"></p>
          </div>
          ${field("message", "Tell me about your project", html`<textarea class="input" id="enquiry-message" name="message" rows="6" aria-describedby="enquiry-message-message"></textarea>`)}
          <button type="submit" class="button button-solid" data-send>Send message</button>
          <p class="form-status" role="status" aria-label="Form status" data-form-status></p>
        </form>
        <div class="sent-panel" data-sent-panel hidden>
          <h3 class="sent-title" tabindex="-1" data-sent-title>Message received.</h3>
          <p data-sent-copy></p>
          <button type="button" class="button button-outline" data-send-another>Send another message</button>
        </div>
      </div>
      <aside class="contact-details">
        <p class="label">Illustrative availability</p>
        <p class="availability">Taking on new projects from January 2027.</p>
        <p><a class="email-link" href="mailto:${STUDIO_EMAIL}">Email Ottoline</a></p>
        <p class="mono" data-email>${STUDIO_EMAIL}</p>
        <ul class="social-list">${SOCIAL_LINKS.map((link) => html`<li>${externalLink(link.name, link.href)}</li>`)}</ul>
      </aside>
    </div>
  </section>`;
}

function quickLook(): Markup {
  return html`<div class="modal-layer quick-look-layer" data-modal-layer="quick-look" hidden>
    <div class="quick-look" role="dialog" aria-modal="true" aria-label="Preview" data-dialog="quick-look">
      <div class="quick-look-frame" data-preview-frame data-frame="1" tabindex="-1"></div>
      <template data-frame-slot-template>${renderFrameSlot({ key: "", label: "", frame: 0, hidden: true })}</template>
      <div class="quick-look-bar">
        <button type="button" class="icon-button" data-frame-previous aria-label="Previous frame">${ICONS.previous}</button>
        <p class="mono-figure" role="status" data-frame-status>${frameStatus(1)}</p>
        <button type="button" class="icon-button" data-frame-next aria-label="Next frame">${ICONS.next}</button>
        <a class="button button-outline" href="/" data-open-case-study>Open case study ${glyph("→")}</a>
        <button type="button" class="icon-button" data-modal-close aria-label="Close preview">${ICONS.close}</button>
      </div>
    </div>
  </div>`;
}

export function homePage(state: HomeState): string {
  const frame: PageFrame = {
    kind: "home",
    title: "Ottoline Rask | Developer and digital creator",
    main: html`${hero(state.introDone)}${about()}${work(state.categories)}${services()}${skills()}${reviews()}${numbers()}${contact(state.service)}`,
    dialogs: quickLook(),
  };
  return renderDocument(frame);
}
