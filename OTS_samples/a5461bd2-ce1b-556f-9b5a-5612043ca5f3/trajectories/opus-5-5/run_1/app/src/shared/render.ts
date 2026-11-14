import {
  budgets,
  characterCount,
  DESCRIPTION_MAX,
  galleryCounts,
  groupDigits,
  industryName,
  matchPrices,
  matchProjects,
  priceCounts,
  serviceNames,
  worldsOf,
  type EnquiryErrors,
  type PriceFilter,
} from "./rules.js";
import type { GalleryState, NavSection, Route } from "./routes.js";
import type { Colours, Content, PriceItem, Project, Service } from "./types.js";

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const navLinks: ReadonlyArray<{ section: Exclude<NavSection, null>; label: string; href: string }> = [
  { section: "work", label: "Work", href: "/work" },
  { section: "services", label: "Services", href: "/services" },
  { section: "studio", label: "Studio", href: "/studio" },
  { section: "pricing", label: "Pricing", href: "/pricing" },
  { section: "contact", label: "Contact", href: "/contact" },
];

function navList(current: NavSection): string {
  return `<ul>${navLinks
    .map(
      (l) =>
        `<li><a href="${l.href}" data-nav="${l.section}"${l.section === current ? ' aria-current="page"' : ""}>${l.label}</a></li>`,
    )
    .join("")}</ul>`;
}

export function renderHeader(current: NavSection): string {
  return `<a class="skip-link" href="#content">Skip to content</a>
<header class="site-header">
  <a class="brand" href="/" aria-label="Vellum Orbit Studio home">Vellum Orbit <span>Studio</span></a>
  <nav class="main-nav" aria-label="Main">${navList(current)}</nav>
  <button type="button" class="button quiet menu-button" aria-expanded="false" aria-controls="menu-dialog">Menu</button>
</header>
<div class="menu-backdrop" hidden></div>
<div class="menu" id="menu-dialog" role="dialog" aria-modal="true" aria-label="Menu" aria-hidden="true" inert>
  <button type="button" class="button quiet menu-close">Close menu</button>
  <nav aria-label="Menu sections">${navList(current)}</nav>
</div>`;
}

export function renderFooter(): string {
  return `<footer class="site-footer">
  <div class="footer-grid">
    <p class="footer-notice">Vellum Orbit Studio is a fictional studio. Every client, person, price and contact detail on this site is illustrative.</p>
    <nav aria-label="Footer"><ul>
      <li><a href="/work">Work</a></li>
      <li><a href="/services">Services</a></li>
      <li><a href="/studio">Studio</a></li>
      <li><a href="/pricing">Pricing</a></li>
      <li><a href="/faq">Questions</a></li>
      <li><a href="/contact">Contact</a></li>
    </ul></nav>
    <div class="footer-contact">
      <h2>Illustrative contact</h2>
      <ul>
        <li><a href="mailto:hello@vellumorbit.example">hello@vellumorbit.example</a></li>
        <li><a href="tel:+914845550142">+91 484 555 0142</a></li>
        <li>Kochi, Kerala</li>
      </ul>
    </div>
    <nav aria-label="Social (illustrative)"><ul>
      <li><a href="https://instagram.example/vellumorbit" target="_blank" rel="noopener noreferrer">Instagram<span class="visually-hidden"> (opens in a new tab)</span></a></li>
      <li><a href="https://behance.example/vellumorbit" target="_blank" rel="noopener noreferrer">Behance<span class="visually-hidden"> (opens in a new tab)</span></a></li>
      <li><a href="https://linkedin.example/company/vellumorbit" target="_blank" rel="noopener noreferrer">LinkedIn<span class="visually-hidden"> (opens in a new tab)</span></a></li>
    </ul></nav>
  </div>
  <p class="footer-copy">© 2026 Vellum Orbit Studio</p>
</footer>`;
}

export function numeral(n: number): string {
  return String(n).padStart(2, "0");
}

function projectBySlug(content: Content, slug: string): Project {
  const project = content.projects.find((p) => p.slug === slug);
  if (project === undefined) throw new Error(`Unknown project ${slug}`);
  return project;
}

function metaLine(content: Content, project: Project): string {
  return `${industryName(content, project.industry_id)} · ${serviceNames(content, project.services).join(", ")}`;
}

function brandStyle(colours: Colours, displayFace: string): string {
  return `--ground:${colours.ground};--ink:${colours.ink};--accent:${colours.accent};--display:'${displayFace}'`;
}

function relativeLuminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function swatches(colours: Colours): string {
  const swatch = (label: string, hex: string): string => {
    const text = relativeLuminance(hex) > 0.18 ? "#000000" : "#FFFFFF";
    return `<li class="swatch" style="background-color:${hex};color:${text}">${label} ${hex}</li>`;
  };
  return `<ul class="swatches">${swatch("Ground", colours.ground)}${swatch("Ink", colours.ink)}${swatch("Accent", colours.accent)}</ul>`;
}

export function renderPlate(colours: Colours, variant: number): string {
  return `<div class="plate plate-${variant % 4}" style="background-color:${colours.ground}" aria-hidden="true"><span style="background-color:${colours.accent}"></span><i style="border-color:${colours.ink}"></i></div>`;
}

function renderHome(): string {
  return `<section data-section="intro" class="intro">
  <div class="intro-inner">
    <h1 class="intro-title" tabindex="-1"><span>Eight brands.</span> <span>Eight worlds.</span> <span>One small studio.</span></h1>
    <p class="intro-line">Vellum Orbit is a two-founder branding and digital design studio in Kochi. Step inside the work.</p>
    <button type="button" class="button primary enter-worlds">Enter the worlds</button>
  </div>
</section>
<section data-section="worlds" class="worlds-section" aria-label="Worlds"><div class="stage-slot"></div></section>
<section data-section="studio-in-brief" class="studio-brief page-width">
  <h2>The studio in brief</h2>
  <p>We design identities, websites, stores, packaging, applications and content for founders who want their business to look like itself.</p>
  <ul class="link-row">
    <li><a href="/services">Our services</a></li>
    <li><a href="/pricing">See the price list</a></li>
    <li><a href="/faq">Questions and answers</a></li>
    <li><a class="button primary" href="/contact">Start a project</a></li>
  </ul>
</section>`;
}

function renderWorld(content: Content, slug: string): string {
  const worlds = worldsOf(content);
  const position = worlds.findIndex((w) => w.slug === slug);
  const world = worlds[position];
  const copy = world.world;
  if (copy === null) throw new Error(`${slug} is not a world`);
  const previous = worlds[position - 1];
  const next = worlds[position + 1];
  return `<div class="stage-band"><div class="stage-slot"></div></div>
<article data-world="${world.slug}" data-section="world" class="branded world-article" style="${brandStyle(world.colours, world.display_face)}">
  <div class="branded-inner">
    <h1 class="display" tabindex="-1">${esc(world.name)}</h1>
    <p class="meta">${esc(metaLine(content, world))}</p>
    <h2>Overview</h2>
    <p>${esc(copy.overview)}</p>
    <h2>Visual identity</h2>
    ${swatches(world.colours)}
    <p>Display face: ${esc(world.display_face)}</p>
    <h2>Design decisions</h2>
    <ol class="decisions">${copy.decisions
      .map((d) => `<li><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p></li>`)
      .join("")}</ol>
    <h2>Deliverables</h2>
    <ul class="plain-list">${world.deliverables.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
    <p><a class="branded-link" href="/work/${world.slug}">Read the full case study</a></p>
    <ul class="pager">
      ${previous ? `<li><a class="branded-link" href="/worlds/${previous.slug}">Previous world: ${esc(previous.name)}</a></li>` : ""}
      ${next ? `<li><a class="branded-link" href="/worlds/${next.slug}">Next world: ${esc(next.name)}</a></li>` : ""}
    </ul>
    <button type="button" class="button branded-button back-to-worlds">Back to all worlds</button>
  </div>
</article>`;
}

function renderTile(content: Content, project: Project, index: number): string {
  return `<li class="tile">
  ${renderPlate(project.colours, index)}
  <h2 class="tile-title"><a href="/work/${project.slug}" data-project="${project.slug}">${esc(project.name)}</a></h2>
  <p class="secondary">${esc(industryName(content, project.industry_id))}</p>
  <p class="secondary">${esc(serviceNames(content, project.services).join(", "))}</p>
</li>`;
}

export function renderTiles(content: Content, projects: readonly Project[], startIndex: number): string {
  return projects.map((p, i) => renderTile(content, p, startIndex + i)).join("");
}

function renderWorkControls(content: Content, state: GalleryState): string {
  const counts = galleryCounts(content, state);
  const active = state.services.length > 0 || state.industry !== null;
  return `<div role="group" aria-label="Filter by service" class="filter-services">${content.services
    .map(
      (s) =>
        `<button type="button" class="chip" data-service="${s.id}" aria-pressed="${state.services.includes(s.id)}">${esc(s.name)} <span class="num">(${counts.services[s.id]})</span></button>`,
    )
    .join("")}</div>
<div class="filter-row">
  <div class="field inline-field">
    <label for="f-industry">Industry</label>
    <select id="f-industry" class="select">
      <option value=""${state.industry === null ? " selected" : ""}>All industries (${counts.allIndustries})</option>
      ${content.industries
        .map(
          (i) =>
            `<option value="${i.id}"${state.industry === i.id ? " selected" : ""}>${esc(i.name)} (${counts.industries[i.id]})</option>`,
        )
        .join("")}
    </select>
  </div>
  ${active ? `<button type="button" class="button quiet clear-filters">Clear filters</button>` : ""}
</div>`;
}

export function renderWorkResults(content: Content, state: GalleryState, pageSize: number): string {
  const matches = matchProjects(content, state);
  const shown = matches.slice(0, state.pages * pageSize);
  return `<ul class="tiles" aria-label="Projects">${renderTiles(content, shown, 0)}</ul>
<div class="work-more">${
    matches.length === 0
      ? `<button type="button" class="button show-all-projects">Show all projects</button>`
      : `<p class="num showing">Showing ${shown.length} of ${matches.length}</p>${
          shown.length < matches.length ? `<button type="button" class="button show-more">Show more work</button>` : ""
        }`
  }</div>`;
}

function renderWork(content: Content, state: GalleryState, pageSize: number): string {
  return `<div class="page-width" data-section="work">
  <h1 tabindex="-1">Selected work</h1>
  <div class="work-controls">${renderWorkControls(content, state)}</div>
  <div role="status" aria-label="Results" class="results-status"></div>
  <div class="work-results">${renderWorkResults(content, state, pageSize)}</div>
</div>`;
}

function renderProject(content: Content, slug: string): string {
  const project = projectBySlug(content, slug);
  const index = content.projects.indexOf(project);
  const count = content.projects.length;
  const previous = content.projects[(index - 1 + count) % count];
  const next = content.projects[(index + 1) % count];
  const s = project.sections;
  return `<article data-section="project" class="branded project-article" style="${brandStyle(project.colours, project.display_face)}">
  <div class="branded-inner">
    <h1 class="display" tabindex="-1">${esc(project.name)}</h1>
    <p class="meta">${esc(metaLine(content, project))}</p>
    <h2>The brief</h2><p>${esc(s.brief)}</p>
    <h2>Brand strategy</h2><p>${esc(s.strategy)}</p>
    <h2>Identity</h2><p>${esc(s.identity)}</p>
    <h2>Typography</h2><p>Display face: ${esc(project.display_face)}</p><p>Body face: ${esc(project.body_face)}</p>
    <h2>Colour</h2>${swatches(project.colours)}
    <h2>Digital design</h2><p>${esc(s.digital_design)}</p>
    <h2>Implementation</h2><p>${esc(s.implementation)}</p>
    <h2>Gallery</h2>
    <ul class="thumbs">${project.captions
      .map(
        (caption, i) =>
          `<li><button type="button" class="thumb" data-image="${i + 1}" aria-label="Open image ${i + 1} of 4: ${esc(caption)}"><span class="media-frame">${mediaImage(project, i + 1, caption, "")}</span></button></li>`,
      )
      .join("")}</ul>
    <h2>Deliverables</h2>
    <ul class="plain-list">${project.deliverables.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
    ${project.world !== null ? `<p><a class="branded-link" href="/worlds/${project.slug}">Visit the world</a></p>` : ""}
    <ul class="pager">
      <li><a class="branded-link" href="/work/${previous.slug}">Previous project: ${esc(previous.name)}</a></li>
      <li><a class="branded-link" href="/work/${next.slug}">Next project: ${esc(next.name)}</a></li>
    </ul>
    <p><a class="branded-link all-work" href="/work">All work</a></p>
  </div>
</article>`;
}

export function mediaImage(project: Project, n: number, caption: string, alt: string): string {
  return `<img class="media-img" src="/media/${project.slug}/${n}.svg" alt="${esc(alt)}" width="1200" height="800"><span class="media-plate" style="background-color:${project.colours.ground};color:${project.colours.ink}"><span>${esc(caption)}</span><span>Image unavailable</span></span>`;
}

function renderServicePanel(content: Content, service: Service): string {
  const examples = content.projects.filter((p) => p.services.includes(service.id));
  return `<div role="tabpanel" id="panel-${service.id}" aria-labelledby="tab-${service.id}" class="service-panel" tabindex="0">
  <h2>${esc(service.name)}</h2>
  <p class="lede">${esc(service.purpose)}</p>
  <h3>Deliverables</h3>
  <ul class="plain-list">${service.deliverables.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
  <h3>Process</h3>
  <ol class="process">${service.steps
    .map(
      (step, i) =>
        `<li><button type="button" class="disclosure" aria-expanded="false" aria-controls="step-${service.id}-${i + 1}"><span class="num">${i + 1}.</span> ${esc(step.name)}</button><p id="step-${service.id}-${i + 1}" hidden>${esc(step.text)}</p></li>`,
    )
    .join("")}</ol>
  <h3>Examples</h3>
  <ul class="plain-list">${examples.map((p) => `<li><a href="/work/${p.slug}">${esc(p.name)}</a></li>`).join("")}</ul>
  <ul class="link-row">
    <li><a href="/work?service=${service.id}">See all ${esc(service.name)} work</a></li>
    <li><a href="/pricing?category=${service.id}">See ${esc(service.name)} prices</a></li>
    <li><a class="button primary" href="/contact?service=${service.id}">Enquire about ${esc(service.name)}</a></li>
  </ul>
</div>`;
}

export function renderServiceTabs(content: Content, selected: string): string {
  const service = content.services.find((s) => s.id === selected) ?? content.services[0];
  return `<div role="tablist" aria-label="Services" class="tabs">${content.services
    .map(
      (s) =>
        `<button type="button" role="tab" id="tab-${s.id}" data-service="${s.id}" aria-controls="panel-${s.id}" aria-selected="${s.id === service.id}" tabindex="${s.id === service.id ? 0 : -1}">${esc(s.name)}</button>`,
    )
    .join("")}</div>
${renderServicePanel(content, service)}`;
}

function renderServices(content: Content, selected: string): string {
  return `<div class="page-width" data-section="services">
  <h1 tabindex="-1">Services</h1>
  <div class="services-body">${renderServiceTabs(content, selected)}</div>
</div>`;
}

const principles: ReadonlyArray<[string, string]> = [
  ["Proportion", "We measure before we decorate. Good proportion is the reason a page feels calm before anyone reads it."],
  ["Patience", "We take six projects a season so each one gets time to settle. The second idea is usually better than the first."],
  ["Craft", "We check the printer's proof, the phone screen and the invoice template with the same care as the logo."],
  [
    "Distinction",
    "Every brand we make should look like its business and no one else's, which is why our eight worlds look nothing alike.",
  ],
];

const people: ReadonlyArray<[string, string, string]> = [
  ["Meera Varghese", "Co-founder, creative director", "Leads identity and art direction, and still draws every first sketch by hand."],
  ["Arjun Pillai", "Co-founder, digital lead", "Leads websites, stores and applications, from first flow to launch."],
  ["Tara Menon", "Packaging and print designer", "Takes packs from concept to the printer's proof."],
  ["Kabir Rao", "Content and motion designer", "Designs monthly content and the motion in our brand worlds."],
];

const stages: ReadonlyArray<[string, string]> = [
  ["Listen", "A first call and a short questionnaire about your business."],
  ["Map", "We agree on scope, price, timeline and revision rounds in writing."],
  ["Make", "We design in short rounds and share progress every week."],
  ["Refine", "We apply your feedback in the agreed revision rounds."],
  ["Hand over", "You receive every final file and a walkthrough of how to use them."],
];

function renderStudio(): string {
  return `<div class="page-width" data-section="studio">
  <h1 tabindex="-1">The studio</h1>
  <p class="lede">Two founders, two designers, one room in Kochi. We take on six projects a season so each one gets our full attention.</p>
  <h2>What we care about</h2>
  <ul class="principles">${principles.map(([t, p]) => `<li><h3>${t}</h3><p>${p}</p></li>`).join("")}</ul>
  <h2>The people</h2>
  <ul class="people">${people
    .map(([n, r, l]) => `<li><p class="person-name">${n}</p><p class="secondary">${r}</p><p>${l}</p></li>`)
    .join("")}</ul>
  <h2>How a project runs</h2>
  <ol class="stages">${stages
    .map(([n, l], i) => `<li><span class="num stage-num" aria-hidden="true">${numeral(i + 1)}</span><div><p class="stage-name">${n}</p><p>${l}</p></div></li>`)
    .join("")}</ol>
  <ul class="link-row">
    <li><a href="/pricing">See the price list</a></li>
    <li><a class="button primary" href="/contact">Start a project</a></li>
  </ul>
</div>`;
}

function renderPriceFilters(content: Content, filter: PriceFilter): string {
  const counts = priceCounts(content, filter);
  const radio = (name: string, value: string, label: string, count: number, checked: boolean): string =>
    `<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""}><span>${esc(label)} <span class="num">(${count})</span></span></label>`;
  return `<div class="price-filters">
  <div role="radiogroup" aria-labelledby="f-category-label" class="radio-group" data-group="category">
    <p class="group-label" id="f-category-label">Category</p>
    ${radio("category", "", "All", counts.allCategories, filter.category === null)}
    ${content.services.map((s) => radio("category", s.id, s.name, counts.categories[s.id], filter.category === s.id)).join("")}
  </div>
  <div role="radiogroup" aria-labelledby="f-type-label" class="radio-group" data-group="type">
    <p class="group-label" id="f-type-label">Price type</p>
    ${radio("type", "", "All types", counts.allTypes, filter.type === null)}
    ${radio("type", "fixed", "Fixed price", counts.types.fixed, filter.type === "fixed")}
    ${radio("type", "custom", "Custom quote", counts.types.custom, filter.type === "custom")}
  </div>
</div>`;
}

function renderPriceItem(item: PriceItem, visible: boolean): string {
  return `<article class="price-item" data-item="${item.id}"${visible ? "" : " hidden"}>
  <h2>${esc(item.name)}</h2>
  <p class="badge">${item.type === "fixed" ? "Fixed price" : "Custom quote"}</p>
  <p class="price num">${esc(item.price_text)}</p>
  <p class="secondary">Delivery: ${esc(item.delivery)}</p>
  <p class="secondary">Revisions: ${esc(item.revisions)}</p>
  <button type="button" class="disclosure" aria-expanded="false" aria-controls="details-${item.id}">Details for ${esc(item.name)}</button>
  <div id="details-${item.id}" class="price-details" hidden>
    <ul class="plain-list">${item.inclusions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
    <p>${item.type === "fixed" ? "Payment: half to start, half on handover." : "Quoted after a 30-minute call."}</p>
    <a href="/contact?service=${item.category}&amp;item=${item.id}">Enquire about ${esc(item.name)}</a>
  </div>
</article>`;
}

function renderPricing(content: Content, filter: PriceFilter): string {
  const matching = new Set(matchPrices(content, filter).map((i) => i.id));
  return `<div class="page-width" data-section="pricing">
  <h1 tabindex="-1">Price list</h1>
  <p class="lede">Illustrative prices in Indian rupees for a fictional studio. They are not a quote and not any real studio's published prices.</p>
  <div class="price-filter-slot">${renderPriceFilters(content, filter)}</div>
  <div role="status" aria-label="Price results" class="price-status"></div>
  <div class="price-empty"${matching.size === 0 ? "" : " hidden"}><button type="button" class="button show-all-items">Show all items</button></div>
  <div class="price-items">${content.prices.map((i) => renderPriceItem(i, matching.has(i.id))).join("")}</div>
</div>`;
}

function renderFaq(content: Content, open: string | null): string {
  return `<div class="page-width narrow" data-section="faq">
  <h1 tabindex="-1">Questions and answers</h1>
  <div class="accordion">${content.questions
    .map(
      (q) => `<h2 class="question"><button type="button" class="disclosure" id="q-${q.id}" data-question="${q.id}" aria-expanded="${q.id === open}" aria-controls="a-${q.id}">${esc(q.question)}</button></h2>
<div role="region" id="a-${q.id}" aria-labelledby="q-${q.id}" class="answer"${q.id === open ? "" : " hidden"}>${q.answer
        .map((p) => `<p>${esc(p)}</p>`)
        .join("")}</div>`,
    )
    .join("")}</div>
</div>`;
}

export interface EnquiryAnswers {
  name: string;
  email: string;
  business_name: string;
  service: string | null;
  description: string;
  budget: string | null;
  item: string | null;
}

export type EnquiryStep = 1 | 2 | 3 | 4;

const stepNames = ["About you", "Your project", "Budget", "Review"] as const;

export function emptyAnswers(): EnquiryAnswers {
  return { name: "", email: "", business_name: "", service: null, description: "", budget: null, item: null };
}

function errorAttrs(id: string, errors: EnquiryErrors, field: keyof EnquiryErrors, extraDescribedBy = ""): string {
  const message = errors[field];
  const describedBy = [extraDescribedBy, message !== undefined ? `${id}-error` : ""].filter((s) => s !== "").join(" ");
  return `${message !== undefined ? ' aria-invalid="true"' : ""}${describedBy !== "" ? ` aria-describedby="${describedBy}"` : ""}`;
}

function errorMessage(id: string, errors: EnquiryErrors, field: keyof EnquiryErrors): string {
  const message = errors[field];
  return message !== undefined ? `<p class="field-error" id="${id}-error">${esc(message)}</p>` : "";
}

function textField(
  id: string,
  field: "name" | "email" | "business_name",
  label: string,
  type: string,
  autocomplete: string,
  answers: EnquiryAnswers,
  errors: EnquiryErrors,
): string {
  return `<div class="field">
  <label for="${id}">${label}</label>
  <input id="${id}" name="${field}" type="${type}" autocomplete="${autocomplete}" value="${esc(answers[field])}"${errorAttrs(id, errors, field)}>
  ${errorMessage(id, errors, field)}
</div>`;
}

function radioGroup(
  id: string,
  field: "service" | "budget",
  label: string,
  options: ReadonlyArray<{ id: string; label: string }>,
  selected: string | null,
  errors: EnquiryErrors,
): string {
  return `<div class="field">
  <div role="radiogroup" id="${id}" aria-labelledby="${id}-label" class="radio-group"${errorAttrs(id, errors, field)}>
    <p class="group-label" id="${id}-label">${label}</p>
    ${options
      .map(
        (o) =>
          `<label class="choice"><input type="radio" name="${field}" value="${o.id}"${o.id === selected ? " checked" : ""}><span>${esc(o.label)}</span></label>`,
      )
      .join("")}
  </div>
  ${errorMessage(id, errors, field)}
</div>`;
}

export function counterText(description: string): string {
  return `${groupDigits(characterCount(description))} / ${groupDigits(DESCRIPTION_MAX)} characters`;
}

function attachedItem(content: Content, answers: EnquiryAnswers): string {
  const item = content.prices.find((p) => p.id === answers.item);
  if (item === undefined) return "";
  return `<div class="attached-item"><p>Enquiring about: ${esc(item.name)}</p><button type="button" class="button quiet remove-item">Remove item</button></div>`;
}

function renderEnquiryStep(content: Content, step: EnquiryStep, answers: EnquiryAnswers, errors: EnquiryErrors): string {
  const heading = `<h2 class="step-heading" tabindex="-1">Step ${step} of 4: ${stepNames[step - 1]}</h2>`;
  const back = `<button type="button" class="button quiet step-back">Back</button>`;
  const next = `<button type="submit" class="button primary step-next">Next</button>`;
  switch (step) {
    case 1:
      return `<form class="enquiry-form" novalidate>${heading}
${textField("f-name", "name", "Name", "text", "name", answers, errors)}
${textField("f-email", "email", "Email", "email", "email", answers, errors)}
${textField("f-business", "business_name", "Business name", "text", "organization", answers, errors)}
<div class="actions">${next}</div></form>`;
    case 2:
      return `<form class="enquiry-form" novalidate>${heading}
${radioGroup("f-service", "service", "Service", content.services.map((s) => ({ id: s.id, label: s.name })), answers.service, errors)}
${attachedItem(content, answers)}
<div class="field">
  <label for="f-description">Project description</label>
  <textarea id="f-description" name="description" rows="7"${errorAttrs("f-description", errors, "description", "f-description-counter")}>${esc(answers.description)}</textarea>
  <p class="counter num" id="f-description-counter">${counterText(answers.description)}</p>
  ${errorMessage("f-description", errors, "description")}
</div>
<div class="actions">${back}${next}</div></form>`;
    case 3:
      return `<form class="enquiry-form" novalidate>${heading}
${radioGroup("f-budget", "budget", "Approximate budget", budgets, answers.budget, errors)}
<div class="actions">${back}${next}</div></form>`;
    case 4:
      return `<form class="enquiry-form" novalidate>${heading}
${renderReviewList(content, answers)}
<div class="actions edit-actions">
  <button type="button" class="button quiet edit-step" data-step="1">Edit about you</button>
  <button type="button" class="button quiet edit-step" data-step="2">Edit your project</button>
  <button type="button" class="button quiet edit-step" data-step="3">Edit budget</button>
</div>
<p class="secondary">This demonstration stores your enquiry and hands it to a stand-in intake service. No real business will receive it.</p>
<div class="send-feedback"></div>
<div class="actions">${back}<button type="submit" class="button primary send-enquiry">Send enquiry</button></div></form>`;
  }
}

function renderReviewList(content: Content, answers: EnquiryAnswers): string {
  const item = content.prices.find((p) => p.id === answers.item);
  const rows: Array<[string, string]> = [
    ["Name", answers.name],
    ["Email", answers.email],
    ["Business name", answers.business_name],
    ["Service", content.services.find((s) => s.id === answers.service)?.name ?? ""],
  ];
  if (item !== undefined) rows.push(["Enquiring about", item.name]);
  rows.push(["Project description", answers.description]);
  rows.push(["Approximate budget", budgets.find((b) => b.id === answers.budget)?.label ?? ""]);
  return `<dl class="review">${rows.map(([t, v]) => `<div><dt>${t}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}

export function renderEnquiryForm(content: Content, step: EnquiryStep, answers: EnquiryAnswers, errors: EnquiryErrors): string {
  return `<ol class="enquiry-steps" aria-label="Enquiry steps">${stepNames
    .map((name, i) => `<li${i + 1 === step ? ' aria-current="step"' : ""}><span class="num">${i + 1}</span> ${name}</li>`)
    .join("")}</ol>
<div class="enquiry-step">${renderEnquiryStep(content, step, answers, errors)}</div>`;
}

export function renderEnquirySent(name: string, reference: string, intakeReference: string): string {
  return `<div class="enquiry-sent">
  <h2 tabindex="-1">Enquiry received</h2>
  <p>Thank you, <span class="as-typed">${esc(name)}</span>. Your enquiry ${esc(reference)} was recorded and handed to the studio's intake service as ${esc(intakeReference)}.</p>
  <p>Vellum Orbit Studio is fictional, so no one will contact you.</p>
  <p class="link-row"><a href="/">Back to the worlds</a> <button type="button" class="button start-another">Start another enquiry</button></p>
</div>`;
}

function renderContact(content: Content, answers: EnquiryAnswers): string {
  return `<div class="page-width" data-section="contact">
  <div class="form-column">
    <h1 tabindex="-1">Start a project</h1>
    <p class="lede">Tell us about your business and the work you have in mind. Vellum Orbit is a fictional studio, so this form is a working demonstration: nothing you send reaches a real business.</p>
    <div class="enquiry-body">${renderEnquiryForm(content, 1, answers, {})}</div>
    <div role="status" aria-label="Enquiry status" class="enquiry-status"></div>
    <p class="secondary">Prefer email? hello@vellumorbit.example is an illustrative address.</p>
  </div>
</div>`;
}

function renderNotFound(heading: string, label: string, href: string): string {
  return `<div class="page-width not-found" data-section="not-found">
  <h1 tabindex="-1">${heading}</h1>
  <p><a class="button primary" href="${href}">${label}</a></p>
</div>`;
}

export interface PageState {
  gallery: GalleryState;
  workPageSize: number;
  prices: PriceFilter;
  faqOpen: string | null;
  contact: EnquiryAnswers;
}

export function renderMain(route: Route, content: Content, state: PageState): string {
  switch (route.kind) {
    case "home":
      return renderHome();
    case "world":
      return renderWorld(content, route.slug);
    case "work":
      return renderWork(content, state.gallery, state.workPageSize);
    case "project":
      return renderProject(content, route.slug);
    case "services":
      return renderServices(content, route.id);
    case "studio":
      return renderStudio();
    case "pricing":
      return renderPricing(content, state.prices);
    case "faq":
      return renderFaq(content, state.faqOpen);
    case "contact":
      return renderContact(content, state.contact);
    case "missing-world":
      return renderNotFound("This world does not exist.", "Back to the worlds", "/");
    case "missing-project":
      return renderNotFound("This project does not exist.", "All work", "/work");
    case "missing-service":
      return renderNotFound("This service does not exist.", "All services", "/services");
    case "missing-page":
      return renderNotFound("This page does not exist.", "Back to Vellum Orbit Studio", "/");
  }
}
