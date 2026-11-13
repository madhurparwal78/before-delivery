import { el, type Child } from "./app.js";
import type { TournamentFormat } from "../shared/types.js";

interface FormatSpec {
  name: string;
  fill: string;
  fact: string;
  alt: string;
}

export const FORMATS: Record<TournamentFormat, FormatSpec> = {
  single_elimination: {
    name: "Single elimination",
    fill: "lilac",
    fact: "One loss and you're out. The fastest cup to run in an evening.",
    alt: "Single elimination cup",
  },
  double_elimination: {
    name: "Double elimination",
    fill: "lemon",
    fact: "Everyone gets a second life in the losers bracket.",
    alt: "Double elimination loving cup",
  },
  round_robin: {
    name: "Round robin",
    fill: "mint",
    fact: "Every entrant plays every other entrant exactly once.",
    alt: "Round robin medal",
  },
  swiss: {
    name: "Swiss",
    fill: "lilac",
    fact: "No one is eliminated; every round pairs like with like.",
    alt: "Swiss counters",
  },
};

/** One procedural object per format, drawn as inline SVG. */
export function formatObject(format: TournamentFormat, scale = 1): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 200 260");
  svg.setAttribute("role", "img");
  svg.style.width = `${scale * 100}%`;
  svg.style.height = `${scale * 100}%`;
  const ink = "#241b12";
  if (format === "single_elimination") {
    svg.setAttribute("aria-label", FORMATS.single_elimination.alt);
    svg.innerHTML = `
      <g fill="${ink}">
        <path d="M40 30 h120 a12 12 0 0 1 12 12 v6 a12 12 0 0 0 0 24 v6 a12 12 0 0 1 -12 12 h-14 l-40 120 h-12 l40 -120 h-82 a12 12 0 0 1 -12 -12 v-6 a12 12 0 0 0 0 -24 v-6 a12 12 0 0 1 12 -12 z"/>
        <rect x="52" y="118" width="34" height="10" rx="4"/>
      </g>`;
  } else if (format === "double_elimination") {
    svg.setAttribute("aria-label", FORMATS.double_elimination.alt);
    svg.innerHTML = `
      <g fill="${ink}">
        <path d="M30 30 h60 a16 16 0 0 1 16 16 v2 a16 16 0 0 0 0 32 v2 a16 16 0 0 1 -16 16 h-16 l-30 100 h-14 l30 -100 h-30 a16 16 0 0 1 -16 -16 v-2 a16 16 0 0 0 0 -32 v-2 a16 16 0 0 1 16 -16 z"/>
        <path d="M110 30 h60 a16 16 0 0 1 16 16 v2 a16 16 0 0 0 0 32 v2 a16 16 0 0 1 -16 16 h-16 l-30 100 h-14 l30 -100 h-30 a16 16 0 0 1 -16 -16 v-2 a16 16 0 0 0 0 -32 v-2 a16 16 0 0 1 16 -16 z"/>
        <rect x="86" y="46" width="28" height="10" rx="4"/>
        <rect x="86" y="96" width="28" height="10" rx="4"/>
        <rect x="20" y="216" width="160" height="14" rx="6"/>
      </g>`;
  } else if (format === "round_robin") {
    svg.setAttribute("aria-label", FORMATS.round_robin.alt);
    svg.innerHTML = `
      <g fill="${ink}">
        <circle cx="100" cy="130" r="88" fill="none" stroke="${ink}" stroke-width="14"/>
        <path d="M100 42 a44 44 0 0 1 44 44 h-88 a44 44 0 0 1 44 -44 z"/>
        <rect x="86" y="196" width="28" height="120" rx="6"/>
        <g stroke="${ink}" stroke-width="9">
          <path d="M100 240 v90"/><path d="M100 240 l-30 22"/><path d="M100 240 l30 22"/>
        </g>
      </g>`;
  } else {
    svg.setAttribute("aria-label", FORMATS.swiss.alt);
    svg.innerHTML = `
      <g fill="${ink}">
        <circle cx="100" cy="52" r="34"/>
        <circle cx="66" cy="146" r="34"/>
        <circle cx="134" cy="146" r="34"/>
        <circle cx="100" cy="146" r="34" fill="#f4ecdf"/>
        <circle cx="100" cy="240" r="34"/>
      </g>`;
  }
  return svg;
}

/** The small object shown in an empty-state corner. */
export function smallObject(format: TournamentFormat): SVGSVGElement {
  const o = formatObject(format);
  o.style.width = "72px";
  o.style.height = "72px";
  return o;
}

export function emptyState(format: TournamentFormat, sentence: string): HTMLElement {
  return el("div", { class: "card stack", attrs: { style: "position:relative;overflow:hidden" } }, [
    el("div", { attrs: { style: "position:absolute;top:8px;right:8px;opacity:0.7" } }, [smallObject(format)]),
    el("p", { class: "muted" }, [sentence]),
  ]);
}

export function fillTile(format: TournamentFormat): HTMLElement {
  const spec = FORMATS[format];
  return el("div", { class: `tile tile--${spec.fill}` }, [formatObject(format)]);
}

export function logoImg(name: string, url: string, class_ = ""): HTMLImageElement {
  const img = el("img", { class: class_, attrs: { src: url, alt: `${name} logo` } }) as HTMLImageElement;
  return img;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const VOID: Child[] = [];
