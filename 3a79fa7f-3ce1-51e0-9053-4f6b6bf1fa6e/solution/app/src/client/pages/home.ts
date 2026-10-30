// Home (brief: Home): drawn hero, benefit tiles, lineup from the catalog, comparison, press carousel,
// parts band, workshop numbers and the rider questions.
import { api } from "../api.ts";
import { BOARD_COPY, PRESS, QUESTIONS } from "../content.ts";
import { EASE, h, reducedMotion, s } from "../dom.ts";
import { boot } from "../boot.ts";
import { price } from "../format.ts";
import { icon } from "../icons.ts";
import type { PageContext } from "../router.ts";
import { boardSilhouette, financingLine, onward } from "../ui.ts";
import type { Build, Catalog } from "../catalog.ts";

function heroArt(): SVGSVGElement {
  const streak = (x: number, y: number, w: number, o: number) => s("rect", { x, y, width: w, height: 2, rx: 1, fill: "#fcfcfc", opacity: o });
  return s("svg", { class: "hero-art", viewBox: "0 0 560 420", "aria-hidden": "true", focusable: "false" },
    s("defs", null,
      s("linearGradient", { id: "sky", x1: 0, y1: 0, x2: 0, y2: 1 }, s("stop", { offset: 0, "stop-color": "#e8eeef" }), s("stop", { offset: 1, "stop-color": "#fcfcfc" })),
      s("linearGradient", { id: "sea", x1: 0, y1: 0, x2: 0, y2: 1 }, s("stop", { offset: 0, "stop-color": "#9fd6d1" }), s("stop", { offset: 0.45, "stop-color": "#4fb0aa" }), s("stop", { offset: 1, "stop-color": "#1e6f6c" })),
      s("clipPath", { id: "hero-clip" }, s("rect", { width: 560, height: 420, rx: 24 }))),
    s("g", { "clip-path": "url(#hero-clip)" },
      s("rect", { width: 560, height: 262, fill: "url(#sky)" }),
      s("circle", { cx: 420, cy: 120, r: 46, fill: "#fcfcfc" }),
      s("path", { d: "M0 262 L0 236 Q60 214 128 228 Q170 236 214 222 Q262 206 318 230 Q340 240 372 236 L372 262 Z", fill: "#cfd8da" }),
      s("path", { d: "M300 262 Q380 244 470 250 Q520 252 560 244 L560 262 Z", fill: "#dde4e5" }),
      s("rect", { y: 262, width: 560, height: 158, fill: "url(#sea)" }),
      s("rect", { y: 261, width: 560, height: 1.5, fill: "#6b6b6b", opacity: 0.35 }),
      streak(40, 284, 120, 0.55), streak(220, 292, 90, 0.4), streak(380, 280, 140, 0.5), streak(90, 318, 70, 0.35),
      streak(300, 330, 160, 0.3), streak(30, 360, 110, 0.25), streak(420, 372, 100, 0.25),
      s("g", { fill: "#111111" },
        s("path", { d: "M170 196 Q176 182 200 181 L360 178 Q392 178 398 188 Q394 198 366 200 L198 204 Q176 205 170 196 Z" }),
        s("rect", { x: 266, y: 202, width: 7, height: 64, rx: 2 })),
      s("g", { fill: "#0b3d3b", opacity: 0.85 },
        s("rect", { x: 266, y: 262, width: 7, height: 52, rx: 2 }),
        s("ellipse", { cx: 270, cy: 290, rx: 20, ry: 7 }),
        s("path", { d: "M214 318 Q270 306 340 314 Q272 328 214 318 Z" }),
        s("path", { d: "M180 318 L222 314 L224 320 L182 322 Z" })),
      s("path", { d: "M150 266 Q190 258 230 266 T310 266", stroke: "#fcfcfc", "stroke-width": 2, fill: "none", opacity: 0.7 })));
}

function reveal(el: HTMLElement): HTMLElement {
  el.classList.add("reveal");
  if (reducedMotion() || !("IntersectionObserver" in window)) {
    el.classList.add("revealed");
    return el;
  }
  const watch = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        watch.unobserve(entry.target);
      }
    }
  }, { threshold: 0.2 });
  watch.observe(el);
  return el;
}

/** Each card's ride time is the server's quote for the board's standard build at the configurator's start values. */
function lineup(catalog: Catalog | null, standard: Map<string, Build>): HTMLElement {
  const cards = h("div", { class: "lineup-cards" });
  for (const [index, name] of ["Drift", "Crest", "Swift"].entries()) {
    const copy = BOARD_COPY[name]!;
    const packages = catalog?.boards.filter((b) => b.name === name) ?? [];
    const first = packages[0];
    const battery = first ? catalog?.components.find((c) => c.sku === first.defaults.battery) : undefined;
    const from = catalog?.boards.find((b) => b.sku === boot.lineupFrom[name]) ?? null;
    const ride = standard.get(name);
    const spec = (label: string, value: string) => h("div", { class: "spec" }, h("dt", null, label), h("dd", null, value));
    cards.append(h("article", { class: "card lineup-card", style: `--stagger:${index}` },
      boardSilhouette(name),
      h("p", { class: "eyebrow" }, copy.rider),
      h("h3", null, name),
      h("p", null, copy.line),
      h("dl", { class: "specs" },
        spec("Material", copy.material),
        spec("Battery", battery?.name ?? ""),
        spec("Ride time", ride ? `Up to ${ride.total_ride_min} min` : ""),
        spec("Sizes", packages.map((b) => b.size).join(", "))),
      h("p", { class: "from" }, from === null ? "" : `From ${price(from.price_cents)}`),
      financingLine(from?.as_low_as_cents ?? null),
      onward(`/boards#${copy.anchor}`, `Explore ${name}`)));
  }
  return reveal(h("section", { class: "band lineup" }, h("div", { class: "wrap" },
    h("p", { class: "eyebrow" }, "Three boards"),
    h("h2", null, "Pick the board that fits your water."),
    onward("/match", "Not sure? Take the five-question quiz"),
    cards)));
}

function comparison(): HTMLElement {
  const rows: [string, string, string, string][] = [
    ["Snap-fit in a minute", "Wing, mast, pod and pack lock in with one lever.", "Tools and bolts", "An hour with hex keys and thread lock."],
    ["Swap parts, keep the board", "Change wings for the day's water and keep riding the same deck.", "Buy a second board", "A new style of riding means a whole new package."],
    ["Hushed drive", "A slow-turning direct drive you barely hear above the water.", "Loud whine", "High-revving pods you hear from the beach."],
  ];
  return reveal(h("section", { class: "band" }, h("div", { class: "wrap" },
    h("h2", null, "Why riders choose a modular board"),
    h("div", { class: "compare" },
      h("div", { class: "compare-col compare-ours" }, h("p", { class: "eyebrow" }, "Tern Foils"), rows.map(([a, b]) => h("div", { class: "compare-item" }, h("h3", null, a), h("p", null, b)))),
      h("div", { class: "compare-col compare-theirs" }, h("p", { class: "eyebrow" }, "The usual way"), rows.map(([, , c, d]) => h("div", { class: "compare-item" }, h("h3", null, c), h("p", null, d))))))));
}

function carousel(): HTMLElement {
  let index = 0;
  const quote = h("blockquote", { class: "press-quote" });
  const counter = h("p", { class: "press-count", "aria-live": "polite" });
  const show = () => {
    const item = PRESS[index]!;
    quote.replaceChildren(h("p", null, `“${item.quote}”`), h("footer", null, item.source));
    counter.textContent = `${index + 1} of ${PRESS.length}`;
  };
  const prev = h("button", { type: "button", class: "round-button", "aria-label": "Previous quote" }, icon("chevronLeft", 22));
  const next = h("button", { type: "button", class: "round-button", "aria-label": "Next quote" }, icon("chevronRight", 22));
  prev.addEventListener("click", () => {
    index = (index + PRESS.length - 1) % PRESS.length;
    show();
  });
  next.addEventListener("click", () => {
    index = (index + 1) % PRESS.length;
    show();
  });
  show();
  return reveal(h("section", { class: "band band-surface" }, h("div", { class: "wrap press" },
    h("h2", null, "What the rider magazines wrote"), quote, h("div", { class: "press-controls" }, prev, counter, next))));
}

function partsBand(): HTMLElement {
  const tile = (href: string, word: string, tone: string) => h("a", { href, class: `foil-tile tone-${tone}` }, h("span", null, word), icon("arrow", 22));
  return reveal(h("section", { class: "band" }, h("div", { class: "wrap" },
    h("h2", null, "Build from parts"),
    h("div", { class: "foil-tiles" }, tile("/parts#wings", "Wings", "teal"), tile("/foil-boards", "Foil boards", "ink"), tile("/parts", "Masts", "mist")))));
}

function numbers(): HTMLElement {
  const stat = (value: string, label: string) => h("div", { class: "stat" }, h("p", { class: "stat-value" }, value), h("p", { class: "caption" }, label));
  return reveal(h("section", { class: "band" }, h("div", { class: "wrap" },
    h("h2", null, "Our workshop in numbers"),
    h("div", { class: "stats" }, stat("2018", "first board"), stat("14", "parts"), stat("6", "countries we ship to"), stat("7", "demo stations")))));
}

/** Question rows that open and close independently: unfold 0.3 s, fold 0.2 s. */
export function questionRows(): HTMLElement {
  return h("div", { class: "faq" }, QUESTIONS.map(({ q, a }, i) => {
    const panel = h("div", { class: "faq-answer", id: `faq-${i}`, hidden: true }, h("p", null, a));
    const sign = h("span", { class: "faq-sign" }, icon("plus", 20));
    const button = h("button", { type: "button", class: "faq-question", "aria-expanded": "false", "aria-controls": panel.id }, h("span", null, q), sign);
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      sign.replaceChildren(icon(open ? "minus" : "plus", 20));
      panel.getAnimations().forEach((x) => x.cancel());
      if (open) panel.hidden = false;
      if (reducedMotion()) {
        panel.hidden = !open;
        return;
      }
      const frames = [{ opacity: 0, transform: "scaleY(0.9)" }, { opacity: 1, transform: "scaleY(1)" }];
      const run = panel.animate(open ? frames : frames.reverse(), { duration: open ? 300 : 200, easing: open ? EASE.decelerate : EASE.accelerate });
      if (!open) run.onfinish = () => (panel.hidden = button.getAttribute("aria-expanded") !== "true");
    });
    return h("div", { class: "faq-row" }, h("h3", null, button), panel);
  }));
}

export async function home({ main }: PageContext): Promise<void> {
  document.title = "Tern Foils: electric hydrofoil boards";
  const hero = h("section", { class: "hero" }, h("div", { class: "wrap hero-grid" },
    h("div", { class: "hero-text" },
      h("p", { class: "eyebrow" }, "Hand-built by a family workshop since 2018"),
      h("h1", { tabindex: "-1" }, "Lift off quietly"),
      h("p", { class: "lead" }, "Three boards, one snap-fit parts system, and a set-up for every kind of water."),
      h("a", { href: "/match", class: "pill pill-large" }, "Find my board")),
    heroArt()));
  const tile = (title: Node | string, text: string) => h("div", { class: "tile" }, h("h3", null, title), h("p", null, text));
  const benefits = reveal(h("section", { class: "band" }, h("div", { class: "wrap tiles" },
    tile(h("a", { href: "/locations" }, "Ride a demo first"), "Seven demo stations in six countries, with a credit toward your board when you attend."),
    tile("Snap-fit parts", "Every wing, mast, pod and pack locks in with one lever."),
    tile(h("a", { href: "/trade-in" }, "Trade in your board"), "Send us your old board's details for a staff-quoted credit toward a Crest."),
    h("div", { class: "tile" }, h("h3", null, "Covered for a year"), h("p", null, "Every board carries a one-year workshop warranty."), onward("/protection", "Extend to 2 or 3 years")))));
  const placeholder = h("div");
  main.append(hero, benefits, placeholder, comparison(), carousel(), partsBand(), numbers(),
    reveal(h("section", { class: "band" }, h("div", { class: "wrap narrow" },
      h("h2", null, "Rider questions"), questionRows(),
      h("div", { class: "ask" }, h("p", null, "Want a person to answer?"), h("a", { href: "/callback", class: "pill pill-outline" }, "Book a call"))))));
  const r = await api<Catalog>("GET", "/api/catalog");
  const standard = new Map<string, Build>();
  if (r.ok) {
    const firsts = ["Drift", "Crest", "Swift"].map((name) => r.data.boards.find((b) => b.name === name && b.in_stock)).filter((b) => b !== undefined);
    await Promise.all(firsts.map(async (b) => {
      const q = await api<Build>("POST", "/api/builds/quote", { board_sku: b.sku, ...b.defaults, spares: 0, rider_kg: 80, gear: 5 });
      if (q.ok) standard.set(b.name, q.data);
    }));
  }
  placeholder.replaceWith(lineup(r.ok ? r.data : null, standard));
}
