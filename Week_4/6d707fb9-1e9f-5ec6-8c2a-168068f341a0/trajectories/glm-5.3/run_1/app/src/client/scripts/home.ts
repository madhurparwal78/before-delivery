// The home page: hero, Try one garment, statements with fragments, label strip, intro.

import { announce, api, el, qs } from "./api.js";
import type { RouteCtx } from "./app.js";
import { STRIP_NAMES, UI } from "./copy.js";

const GARMENTS: [string, string][] = [
  ["tshirt", "T-shirt"],
  ["shirt", "Shirt"],
  ["jeans", "Jeans"],
  ["coat", "Coat"],
];
const FIBRES: [string, string][] = [
  ["organic-cotton", "Organic cotton"],
  ["cotton", "Cotton"],
  ["polyester", "Polyester"],
  ["wool", "Wool"],
];
const COUNTRIES: [string, string][] = [
  ["PT", "Portugal"],
  ["TR", "Turkey"],
  ["VN", "Vietnam"],
  ["EG", "Egypt"],
];

interface EstimateOut {
  garment: string;
  fibre: string;
  country: string;
  climate: string;
  shown: string;
  answeredAt: string;
}

export function registerHome(ctx: RouteCtx): () => void {
  const main = ctx.main;
  const hero = el("section", { class: "hero" });
  const h1 = el("h1", {}, "Count every thread of a garment's footprint.");
  const tagline = el("p", { class: "hero-line" },
    "One desk for an independent assessor: supplier facts in, exact figures out, and a passport a shopper can read.");
  const actions = el("div", { class: "hero-actions" });
  const seeMethod = el("a", { class: "btn btn-primary", href: "/method", role: "link" }, "See the method");
  actions.append(seeMethod);
  hero.append(h1, tagline, actions);

  const stage = el("section", { class: "stage", "aria-label": "Try one garment stage" });
  const panel = el("div", { class: "estimate-panel", "data-ui": "true" });
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Try one garment");

  const params = ctx.params;
  let garment = params.get("garment") ?? "tshirt";
  let fibre = params.get("fibre") ?? "organic-cotton";
  let country = params.get("country") ?? "PT";
  if (!GARMENTS.some(([id]) => id === garment)) garment = "tshirt";
  if (!FIBRES.some(([id]) => id === fibre)) fibre = "organic-cotton";
  if (!COUNTRIES.some(([id]) => id === country)) country = "PT";

  const garmentGroup = el("fieldset");
  garmentGroup.append(el("legend", {}, "Garment"));
  const gRGroup = el("div", { role: "radiogroup", "aria-label": "Garment" });
  for (const [id, label] of GARMENTS) {
    const wrap = el("label", { class: "radio" });
    const input = el("input", { type: "radio", name: "garment", value: id });
    input.checked = id === garment;
    input.addEventListener("change", () => {
      garment = id;
      commit();
      schedule();
    });
    wrap.append(input, label);
    gRGroup.append(wrap);
  }
  garmentGroup.append(gRGroup);

  const makeSelect = (label: string, options: [string, string][], value: string, onPick: (v: string) => void) => {
    const field = el("label", { class: "field" });
    field.append(el("span", {}, label));
    const select = el("select", { "aria-label": label });
    for (const [id, name] of options) {
      const opt = el("option", { value: id }, name);
      if (id === value) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener("change", () => onPick(select.value));
    field.append(select);
    return field;
  };

  const fibreSelect = makeSelect("Main fibre", FIBRES, fibre, (v) => {
    fibre = v;
    commit();
    schedule();
  });
  const countrySelect = makeSelect("Making country", COUNTRIES, country, (v) => {
    country = v;
    commit();
    schedule();
  });

  const figure = el("p", { class: "figure", "data-part": "estimate-figure" });
  const figureRoll = el("span", { class: "figure-roll num" });
  figureRoll.textContent = "\u2014";
  figure.append("Climate: ", figureRoll);
  panel.append(el("h2", {}, "Try one garment"), garmentGroup, fibreSelect, countrySelect, figure);
  stage.append(panel);

  const statements = el("section", { class: "statements" });
  statements.append(
    statementRow("Supplier facts arrive in their own language, typed the local way.", "frag-a"),
    statementRow("Meter readings wait on the phone until the signal returns.", "frag-b"),
  );
  const pinWrap = el("div", { class: "statements pinned-section" });
  const pinnedFrag = el("div", { class: "statement-frag", "data-ui": "true", "aria-hidden": "true", "data-part": "strata" });
  pinnedFrag.innerHTML = miniStrata("climate");
  const pinTexts: [string, string][] = [
    ["One band shows which stage carries the measure.", "climate"],
    ["Water reads differently: making often leads.", "water"],
    ["Fossil energy leans on use for washed goods.", "fossilEnergy"],
  ];
  for (const [t, m] of pinTexts) {
    pinWrap.append(statementRow(t, `pin-${m}`));
  }
  pinWrap.append(pinnedFrag);
  statements.append(pinWrap);

  const stripWrap = el("div", { class: "label-strip-wrap" });
  const strip = el("div", { class: "label-strip", role: "region", "aria-label": "Labels on the desk", "data-part": "label-strip", tabindex: "0" });
  for (const name of STRIP_NAMES) strip.append(el("span", {}, name));
  for (const name of STRIP_NAMES) strip.append(el("span", { "aria-hidden": "true" }, name));
  stripWrap.append(strip);

  const bottomBar = el("div", { class: "bottom-bar" });
  const barLink = el("a", { class: "btn btn-primary", href: "/method" }, "See the method");
  bottomBar.append(barLink);

  main.append(hero, stage, statements, stripWrap, bottomBar);

  let requestToken = 0;
  let timer: number | null = null;
  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(() => {
      const token = ++requestToken;
      const query = `?garment=${garment}&fibre=${fibre}&country=${country}`;
      api<EstimateOut>(`/api/estimate${query}`)
        .then((out) => {
          if (token !== requestToken) return; // an answer to an earlier choice is ignored
          rollTo(figureRoll, out.shown);
          announce(out.shown);
        })
        .catch(() => {
          /* the figure keeps the last answer */
        });
    }, 300);
  }

  function commit(): void {
    const url = `/?garment=${garment}&fibre=${fibre}&country=${country}`;
    history.replaceState(null, "", url);
  }

  function rollTo(node: HTMLElement, value: string): void {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      node.textContent = value;
      return;
    }
    node.textContent = value;
    node.style.transform = "translateY(0.8em)";
    requestAnimationFrame(() => {
      node.style.transform = "translateY(0)";
    });
  }

  schedule();

  // The strip loops from 768 px, pauses while hovered or focused, stops under reduced motion.
  const applyStrip = (): void => {
    const wide = window.matchMedia("(min-width: 768px)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stripWrap.classList.toggle("looping", wide && !reduced && !stripHovered && !stripFocused);
    strip.style.flexWrap = wide ? "nowrap" : "wrap";
    strip.style.justifyContent = wide ? "flex-start" : "center";
  };
  let stripHovered = false;
  let stripFocused = false;
  strip.addEventListener("mouseenter", () => {
    stripHovered = true;
    applyStrip();
  });
  strip.addEventListener("mouseleave", () => {
    stripHovered = false;
    applyStrip();
  });
  strip.addEventListener("focus", () => {
    stripFocused = true;
    applyStrip();
  });
  strip.addEventListener("blur", () => {
    stripFocused = false;
    applyStrip();
  });
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", applyStrip);
  const reducedMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMq.addEventListener("change", applyStrip);
  applyStrip();

  playIntro();

  return () => {
    if (timer !== null) clearTimeout(timer);
  };
}

function statementRow(textValue: string, fragClass: string): HTMLElement {
  const row = el("div", { class: "statement-row" });
  const p = el("p", { class: "statement-text" }, textValue);
  const frag = el("div", { class: `statement-frag ${fragClass}`, "data-ui": "true", "aria-hidden": "true" });
  frag.innerHTML = fragmentArt();
  row.append(p, frag);
  return row;
}

function fragmentArt(): string {
  const weaves = [
    "repeating-linear-gradient(45deg, rgba(63,107,79,.25) 0 3px, transparent 3px 8px)",
    "repeating-linear-gradient(-45deg, rgba(122,90,58,.3) 0 3px, transparent 3px 7px)",
    "repeating-linear-gradient(90deg, rgba(74,90,106,.3) 0 3px, transparent 3px 9px)",
  ];
  const idx = Math.floor(Math.random() * weaves.length);
  return `<div style="position:absolute;inset:0;background-image:${weaves[idx]}"></div>
    <div style="position:absolute;bottom:10px;left:10px;right:10px;height:26px;background:#3f6b4f;border-radius:3px"></div>`;
}

function miniStrata(measure: string): string {
  const widths: Record<string, number[]> = {
    climate: [46, 21, 4, 29, 1],
    water: [30, 42, 8, 18, 2],
    fossilEnergy: [36, 18, 6, 38, 2],
  };
  const w = widths[measure] ?? widths.climate;
  const classes = ["weave-materials", "weave-making", "weave-transport", "weave-use", "weave-endOfLife"];
  return `<div class="strata-band" style="position:absolute;inset:auto 10px 10px 10px;height:36px">
    ${w.map((width, i) => `<div class="stratum ${classes[i]}" style="flex-basis:${width}%"></div>`).join("")}
  </div>`;
}

/** The first-visit intro, once in that browser, skippable, never under reduced motion. */
function playIntro(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (location.pathname !== "/") return;
  if (sessionStorage.getItem("fio-intro-played") === "1") return;
  sessionStorage.setItem("fio-intro-played", "1");
  const intro = el("div", { class: "intro", "data-part": "intro" });
  const name = el("div", { class: "intro-name" }, "Fio Contado Desk");
  const words = el("div", { class: "intro-words" });
  for (const word of ["Materials", "Making", "Transport"]) words.append(el("span", {}, word));
  const skip = el("button", { class: "btn" }, "Skip intro");
  intro.append(name, words, el("div", { style: "margin-top:24px" }, skip));
  document.body.append(intro);
  skip.focus();
  const end = (): void => {
    window.clearTimeout(timer);
    intro.remove();
    const h1 = qs<HTMLElement>("main h1");
    h1?.setAttribute("tabindex", "-1");
    h1?.focus({ preventScroll: true });
  };
  const timer = window.setTimeout(end, 1600);
  skip.addEventListener("click", end);
  document.addEventListener("keydown", function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && document.body.contains(intro)) {
      end();
      document.removeEventListener("keydown", onKey);
    }
  });
}
