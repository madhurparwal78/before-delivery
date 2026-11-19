import { CASES, findCase, KIND_LABELS, type CaseKind, type FinishedCase } from "../domain/cases.ts";
import { asImage, chairSvg, type DrawingOptions, glyph, grainSvg } from "../../web/shared/dots.ts";
import { html, route } from "../http/router.ts";
import { document, escapeHtml } from "./document.ts";
import { notFoundPage } from "./notFound.ts";

const drawing = (seed: string, options?: DrawingOptions): string => asImage(chairSvg(seed, options));

const HOME_LINE = "A conservator's desk in Turin, re-covering twentieth-century design chairs for Turin, London, New York, Kyoto and Dubai.";

const KINDS: readonly { label: string; value: CaseKind | "" }[] = [
  { label: "All", value: "" },
  { label: "Leather", value: "leather" },
  { label: "Fabric", value: "fabric" },
  { label: "Frame only", value: "frame-only" },
];

function panelTile(found: FinishedCase): string {
  return `<li><a class="panel-tile" href="/work/${found.slug}" data-preview="${found.slug}"><span>${escapeHtml(found.title)}</span></a></li>`;
}

export function siteHeader(): string {
  return `<header class="site-header">
<div class="site-bar">
<a class="brand" href="/" aria-label="Bottega Semenza"><span class="brand-full">Bottega Semenza</span><svg class="brand-short" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="5" cy="12" r="3.5"/><circle cx="12" cy="12" r="3.5"/><circle cx="19" cy="12" r="3.5"/></svg></a>
<div class="site-links">
<button class="site-link" type="button" id="work-button" aria-expanded="false">Work</button>
<nav class="work-panel" id="work-panel" aria-label="Work" hidden>
<div class="work-panel-inner">
<ul class="work-tiles">${CASES.map(panelTile).join("")}</ul>
<div class="work-preview" id="work-preview" role="img" aria-label="Preview of ${escapeHtml((CASES[0] as FinishedCase).title)}"></div>
</div>
</nav>
<a class="site-link" href="/enquire">Enquire</a>
<a class="site-link" href="/sign-in">Sign in</a>
</div>
</div>
</header>`;
}

function shell(main: string): string {
  return `${siteHeader()}${main}`;
}

function page(title: string, main: string): string {
  return document({ title, script: "public", body: shell(main), fonts: true });
}

function home(): string {
  const bentwood = findCase("bentwood-armchair") as FinishedCase;
  return page(
    "Bottega Semenza",
    `<main id="main" class="page home" data-page="home">
<div class="home-lead">
<h1 tabindex="-1"><span>ONE CHAIR</span> <span>AT A TIME.</span></h1>
<p class="home-line">${escapeHtml(HOME_LINE)}</p>
<p><a class="button button--primary" href="/enquire">Send an enquiry</a></p>
</div>
<div class="bento home-tiles">
<section class="tile tile--mint t-wide home-figure" aria-label="${escapeHtml(bentwood.title)}">
<span class="mint-label">${escapeHtml(bentwood.title)}, hide laid</span>
<span class="mint-figure">${bentwood.figure}</span>
<div class="home-figure-drawing">${drawing(bentwood.slug)}</div>
</section>
<section class="tile t-small home-drawing" aria-label="Tubular lounge">
<div class="home-drawing-art">${drawing("tubular-lounge")}</div>
<p>Every chair here is a drawing made of dots, so the work is what you read.</p>
<a class="link-row" href="/work">See the finished work</a>
</section>
<section class="tile t-small home-pins" aria-label="A piece of a condition map">
<div class="pin-fragment">
${drawing("lounge-map", { tone: "muted" })}
<span class="home-pin pin-mark" style="left:20%;top:30%" aria-hidden="true">1</span>
<span class="home-pin pin-mark" style="left:80%;top:30%" aria-hidden="true">3</span>
<span class="home-pin pin-mark" style="left:50%;top:60%" aria-hidden="true">2</span>
</div>
<p><strong>Pin 1: Tear</strong><br>Tear along the front seam</p>
</section>
</div>
</main>
${siteFooter()}`,
  );
}

export function siteFooter(): string {
  return `<footer class="page site-footer" data-print="no"><p class="muted">Bottega Semenza, Turin</p></footer>`;
}

function caseTile(found: FinishedCase, hidden: boolean): string {
  return `<li class="case-item" data-kind="${found.kind}"${hidden ? " hidden" : ""}>
<div class="case-tile tile">
<a class="case-link" href="/work/${found.slug}" data-case-link="${found.slug}">
<div class="case-drawing" data-part="case-drawing" data-case="${found.slug}">${drawing(found.slug)}</div>
<span class="case-name">${escapeHtml(found.title)}</span>
</a>
<span class="case-facts muted">${KIND_LABELS[found.kind]}, ${found.figure}</span>
</div>
</li>`;
}

function work(kind: string): string {
  const shown = KINDS.some((option) => option.value === kind && kind !== "") ? kind : "";
  const radios = KINDS.map(
    (option) => `<label class="kind-option"><input type="radio" name="kind" value="${option.value}"${option.value === shown ? " checked" : ""}><span>${option.label}</span></label>`,
  ).join("");
  return page(
    "Work — Bottega Semenza",
    `<main id="main" class="page work" data-page="work">
<div class="bento work-head">
<div class="tile t-nine work-title"><h1 tabindex="-1">Work</h1>
<div class="kind-filter" role="radiogroup" aria-label="Kind">${radios}</div></div>
<div class="tile tile--mint t-small"><span class="mint-label">Finished cases</span><span class="mint-figure">${CASES.length}</span></div>
</div>
<ul class="bento case-grid" id="case-grid">${CASES.map((found) => caseTile(found, shown !== "" && found.kind !== shown)).join("")}</ul>
</main>
${siteFooter()}`,
  );
}

function section(found: FinishedCase, index: number): string {
  const part = found.sections[index] as FinishedCase["sections"][number];
  const art =
    part.hash === "the-cover" && found.kind !== "frame-only"
      ? `<div class="case-grain">${asImage(grainSvg(found.slug, found.kind === "leather" ? "Pull-up" : "Linen"))}</div>`
      : part.hash === "as-it-came"
        ? `<div class="case-sketch">${drawing(`${found.slug}`, { tone: "muted" })}</div>`
        : "";
  return `<section class="tile case-section">
<h2 id="${part.hash}" tabindex="-1">${part.heading}</h2>
<div class="case-copy">${part.text.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
${art}
</section>`;
}

function rail(found: FinishedCase): string {
  const links = found.sections
    .map((part, index) => {
      const [number, ...words] = part.heading.split(" ");
      return `<li><a href="#${part.hash}" aria-label="${part.heading}"${index === 0 ? ' aria-current="true"' : ""}><span class="rail-number">${number}</span> <span class="rail-words">${words.join(" ")}</span></a></li>`;
    })
    .join("");
  return `<div class="rail-frame" id="rail-frame" role="region" aria-label="Section numbers" tabindex="0" data-print="no">
<nav aria-label="Sections"><span class="rail-marker" aria-hidden="true"></span><ol>${links}</ol></nav>
</div>`;
}

function casePage(found: FinishedCase): string {
  return page(
    `${found.title} — Bottega Semenza`,
    `<main id="main" class="page case" data-page="case">
<div class="bento case-top">
<div class="tile t-nine case-hero">
<h1 tabindex="-1">${escapeHtml(found.title)}</h1>
<p>${escapeHtml(found.summary)}</p>
<div class="case-drawing" data-part="case-drawing" data-case="${found.slug}" data-hero="true" role="img" aria-label="Drawing of ${escapeHtml(found.title)}">${drawing(found.slug)}</div>
</div>
<div class="tile tile--mint t-small case-figure"><span class="mint-label">${escapeHtml(found.figureLabel)}</span><span class="mint-figure">${found.figure}</span></div>
</div>
<div class="case-body">
${rail(found)}
<div class="case-sections">${found.sections.map((_, index) => section(found, index)).join("")}</div>
</div>
</main>
${siteFooter()}`,
  );
}

interface FormField {
  id: string;
  name: string;
  label: string;
  type?: string;
  autocomplete?: string;
  multiline?: boolean;
}

function field(form: string, spec: FormField): string {
  const id = `${form}-${spec.id}`;
  const shared = `class="input" id="${id}" name="${spec.name}" data-required${spec.autocomplete ? ` autocomplete="${spec.autocomplete}"` : ""}`;
  const control = spec.multiline ? `<textarea ${shared} rows="6"></textarea>` : `<input ${shared} type="${spec.type ?? "text"}">`;
  return `<div class="field"><label for="${id}">${spec.label}</label>${control}<p class="field-message" id="${id}-message" hidden><span class="field-glyph">${glyph("refused", 16)}</span><span></span></p></div>`;
}

function form(kind: "enquiry" | "sign-in" | "sign-up", fields: readonly FormField[], submit: string): string {
  return `<form class="site-form" data-form="${kind}" novalidate>
<div class="problems-slot"></div>
${fields.map((spec) => field(kind, spec)).join("")}
<div><button class="button button--primary" type="submit">${submit}</button></div>
</form>`;
}

function enquire(): string {
  return page(
    "Enquire — Bottega Semenza",
    `<main id="main" class="page enquire" data-page="form">
<div class="bento">
<div class="tile t-large form-tile">
<h1 tabindex="-1">Send an enquiry</h1>
${form(
  "enquiry",
  [
    { id: "name", name: "name", label: "Name", autocomplete: "name" },
    { id: "email", name: "email", label: "Email", type: "email", autocomplete: "email" },
    { id: "message", name: "message", label: "Message", multiline: true },
  ],
  "Send enquiry",
)}
</div>
<div class="tile tile--mint t-medium form-claim"><span class="mint-label">At the bench</span><span class="mint-figure">1 chair</span><div class="form-claim-drawing">${drawing("bentwood-armchair")}</div></div>
</div>
</main>
${siteFooter()}`,
  );
}

function access(title: string, heading: string, inner: string, seed: string): string {
  return page(
    title,
    `<main id="main" class="page access" data-page="access">
<div class="bento">
<div class="tile t-wide form-tile">
<h1 tabindex="-1">${heading}</h1>
${inner}
</div>
<div class="tile tile--mint t-wide form-claim"><span class="mint-label">Semenza Desk</span><span class="mint-figure">One desk</span><div class="form-claim-drawing">${drawing(seed)}</div></div>
</div>
</main>`,
  );
}

function signIn(search: string): string {
  return access(
    "Sign in — Semenza Desk",
    "Sign in",
    `${form(
      "sign-in",
      [
        { id: "email", name: "email", label: "Email", type: "email", autocomplete: "email" },
        { id: "password", name: "password", label: "Password", type: "password", autocomplete: "current-password" },
      ],
      "Sign in",
    )}
<p class="access-other"><a class="link-row" href="/sign-up${escapeHtml(search)}">Start a desk</a></p>`,
    "sign-in lounge",
  );
}

function signUp(): string {
  return access(
    "Start a desk — Semenza Desk",
    "Start a desk",
    form(
      "sign-up",
      [
        { id: "name", name: "name", label: "Your name", autocomplete: "name" },
        { id: "email", name: "email", label: "Email", type: "email", autocomplete: "email" },
        { id: "password", name: "password", label: "Password", type: "password", autocomplete: "new-password" },
      ],
      "Start a desk",
    ),
    "swivel-start",
  );
}

export function register(): void {
  const get = (pattern: string, handle: Parameters<typeof route>[0]["handle"]): void => route({ method: "GET", pattern, access: "public", handle });
  get("/", async () => html(200, home()));
  get("/work", async (ctx) => html(200, work(ctx.query.get("kind") ?? "")));
  get("/work/:slug", async (ctx) => {
    const found = findCase(ctx.params.slug as string);
    return found ? html(200, casePage(found)) : html(404, notFoundPage());
  });
  get("/enquire", async () => html(200, enquire()));
  get("/sign-in", async (ctx) => {
    const returnTo = ctx.query.get("returnTo");
    return html(200, signIn(returnTo === null ? "" : `?returnTo=${encodeURIComponent(returnTo)}`));
  });
  get("/sign-up", async () => html(200, signUp()));
}

