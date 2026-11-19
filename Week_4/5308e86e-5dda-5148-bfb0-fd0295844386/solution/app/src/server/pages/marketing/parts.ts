/** Building blocks shared by the marketing pages: hero, sections, tiles, tables and FAQs. */
import { esc } from "../layout.js";
import { icon, type IconName } from "./icons.js";

interface HeroOptions {
  id: string;
  title: string;
  lede?: string;
  /** Extra markup under the lede: a form, buttons or a note. */
  actions?: string;
  className?: string;
}

export function hero(options: HeroOptions): string {
  const lede = options.lede ? `<p class="hero-lede">${esc(options.lede)}</p>` : "";
  return `<section class="hero ${options.className ?? ""}" aria-labelledby="${options.id}">
    <div class="container hero-inner">
      <h1 class="display" id="${options.id}">${esc(options.title)}</h1>
      ${lede}
      ${options.actions ?? ""}
    </div>
  </section>`;
}

/** The email field with its "Open account" pill; submitting opens sign-up carrying the email. */
export function emailCapture(): string {
  return `<form class="email-capture" action="/signup" method="get" novalidate data-email-capture>
        <label class="sr-only" for="capture-email">Enter your email</label>
        <input class="input" id="capture-email" name="email" type="email" autocomplete="email" placeholder="you@company.com">
        <button class="btn btn-primary" type="submit">Open account</button>
      </form>`;
}

export function linkButton(href: string, label: string, kind: "primary" | "quiet" | "text" = "primary", glyph?: IconName): string {
  const mark = glyph ? icon(glyph) : "";
  return `<a class="btn btn-${kind}" href="${esc(href)}">${mark}${esc(label)}</a>`;
}

interface BandOptions {
  id: string;
  title: string;
  lede?: string;
  body: string;
  className?: string;
  /** Extra markup beside the heading, e.g. a link. */
  aside?: string;
}

export function band(options: BandOptions): string {
  const lede = options.lede ? `<p class="band-lede">${esc(options.lede)}</p>` : "";
  return `<section class="band ${options.className ?? ""}" aria-labelledby="${options.id}">
    <div class="container">
      <div class="band-head">
        <h2 class="display section-title" id="${options.id}">${esc(options.title)}</h2>
        ${lede}
        ${options.aside ?? ""}
      </div>
      ${options.body}
    </div>
  </section>`;
}

/** One shared noise filter (declared in the chrome) drawn over a panel as fine grain. */
function grainOverlay(): string {
  return `<svg class="grain" aria-hidden="true" focusable="false"><rect width="100%" height="100%" filter="url(#grain-noise)"/></svg>`;
}

interface FeaturePanelOptions {
  id: string;
  title: string;
  body: string;
  className?: string;
}

/** A near-black to deep-violet panel with a fine grain overlay. */
export function featurePanel(options: FeaturePanelOptions): string {
  return `<section class="band" aria-labelledby="${options.id}">
    <div class="container">
      <div class="feature-panel on-dark ${options.className ?? ""}">
        ${grainOverlay()}
        <h2 class="display section-title" id="${options.id}">${esc(options.title)}</h2>
        ${options.body}
      </div>
    </div>
  </section>`;
}

interface Tile {
  glyph: IconName;
  title: string;
  body?: string;
}

export function tileGrid(tiles: Tile[], className = ""): string {
  const items = tiles
    .map(
      (tile) => `<li class="tile">
        <span class="tile-icon">${icon(tile.glyph)}</span>
        <h3>${esc(tile.title)}</h3>
        ${tile.body ? `<p>${esc(tile.body)}</p>` : ""}
      </li>`,
    )
    .join("");
  return `<ul class="tile-grid ${className}">${items}</ul>`;
}

interface SplitRow {
  title: string;
  body: string;
  art: string;
}

/** Two-column feature rows; every second row mirrors the first. */
export function splitRows(rows: SplitRow[]): string {
  return rows
    .map(
      (row) => `<article class="split">
        <div class="split-copy"><h3>${esc(row.title)}</h3><p>${esc(row.body)}</p></div>
        <div class="split-art" aria-hidden="true">${row.art}</div>
      </article>`,
    )
    .join("");
}

interface FaqEntry {
  question: string;
  answer: string;
}

export function faq(id: string, title: string, entries: FaqEntry[]): string {
  const items = entries
    .map(
      (entry) => `<details class="faq-item">
        <summary>${esc(entry.question)}${icon("chevronDown", "icon icon-chevron")}</summary>
        <p>${esc(entry.answer)}</p>
      </details>`,
    )
    .join("");
  return band({ id, title, className: "band-faq", body: `<div class="faq">${items}</div>` });
}

export function checkList(items: string[], className = ""): string {
  const rows = items.map((item) => `<li>${icon("check", "icon icon-check")}<span>${esc(item)}</span></li>`).join("");
  return `<ul class="check-list ${className}">${rows}</ul>`;
}

interface TableOptions {
  label: string;
  caption: string;
  head: string[];
  rows: string[][];
  /** Zero-based columns set in the monospace figure face. */
  figureColumns?: number[];
}

/** A table inside its own scrolling, keyboard-reachable frame so a narrow window never widens the page. */
export function dataTable(options: TableOptions): string {
  const figures = new Set(options.figureColumns ?? []);
  const head = options.head.map((cell) => `<th scope="col">${esc(cell)}</th>`).join("");
  const rows = options.rows
    .map((row) => {
      const [first, ...rest] = row;
      const cells = rest
        .map((cell, index) => `<td${figures.has(index + 1) ? ' class="mono"' : ""}>${esc(cell)}</td>`)
        .join("");
      return `<tr><th scope="row">${esc(first ?? "")}</th>${cells}</tr>`;
    })
    .join("");
  return `<div class="table-frame" role="region" aria-label="${esc(options.label)}" tabindex="0">
      <table class="data-table"><caption>${esc(options.caption)}</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

export function pageTitle(name: string): string {
  return `${name} | Tallwind`;
}
