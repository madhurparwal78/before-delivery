// Shared storefront pieces: page headings, badges, banners, the battery gauge, the financing line and the board
// silhouettes.
import { h, s, type Child } from "./dom.ts";
import { icon } from "./icons.ts";
import { price } from "./format.ts";
import type { FinancingTerm } from "./catalog.ts";

export function pageHead(title: string, line?: Child, eyebrow?: string): HTMLElement {
  return h("div", { class: "page-head" },
    eyebrow ? h("p", { class: "eyebrow" }, eyebrow) : null,
    h("h1", { tabindex: "-1" }, title),
    line ? h("p", { class: "lead" }, line) : null);
}

export function badge(text: string, tone: "plain" | "accent" | "danger" | "success" = "plain"): HTMLElement {
  return h("span", { class: `badge-lozenge tone-${tone}` }, text);
}

export function banner(text: string, tone: "success" | "warning"): HTMLElement {
  return h("div", { class: `banner banner-${tone}`, role: tone === "warning" ? "alert" : null },
    icon(tone === "success" ? "tick" : "error", 22, `icon ${tone === "success" ? "tick" : "error-icon"}`), h("p", null, text));
}

/** The four-bar battery gauge; the bar count is the server's battery_bars. */
export function gauge(bars: number): SVGSVGElement {
  return s("svg", { class: "gauge", role: "img", "aria-label": `Battery gauge, ${bars} of 4 bars`, viewBox: "0 0 44 20", width: 44, height: 20 },
    s("rect", { x: 0.75, y: 0.75, width: 39, height: 18.5, rx: 3, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }),
    s("rect", { x: 40.5, y: 6, width: 3, height: 8, rx: 1, fill: "currentColor" }),
    [0, 1, 2, 3].map((i) => s("rect", { x: 3.5 + i * 9, y: 3.5, width: 7, height: 13, rx: 1.5, fill: i < bars ? "currentColor" : "none", stroke: "currentColor", "stroke-width": 1 })));
}

/** The smallest monthly payment of the server's financing terms, or null when none are offered. */
export function lowestMonthly(terms: FinancingTerm[] | null): number | null {
  return terms?.length ? Math.min(...terms.map((t) => t.monthly_cents)) : null;
}

/** "As low as $<m>/mo" with the shown amount in data-monthly-cents, or nothing when financing is not offered. */
export function financingLine(monthlyCents: number | null): HTMLElement | null {
  return monthlyCents === null ? null : h("span", { class: "financing", "data-monthly-cents": monthlyCents }, `As low as ${price(monthlyCents)}/mo`);
}

const FINISH: Record<string, string> = { Drift: "#efece4", Crest: "#2b2d30", Swift: "#5c626a" };
/** Each board's default wing as the card draws it: hue, and half span, root chord and tip sweep in metres. */
const DEFAULT_WING: Record<string, { hex: string; half: number; chord: number; sweep: number }> = {
  Drift: { hex: "#5fb3e6", half: 0.43, chord: 0.2, sweep: 0.03 },
  Crest: { hex: "#2a9d8f", half: 0.4, chord: 0.15, sweep: 0.12 },
  Swift: { hex: "#ef7a5d", half: 0.31, chord: 0.12, sweep: 0.1 },
};

/** A wing outline seen from slightly above: straight swept leading edge, curved trailing edge, joined at the root. */
function wingPath(plan: { half: number; chord: number; sweep: number }, cx: number, cy: number, scale: number): string {
  const lead = (t: number) => plan.chord * 0.35 - plan.sweep * Math.abs(t);
  const chord = (t: number) => plan.chord * (0.16 + 0.84 * Math.sqrt(Math.max(0, 1 - t * t)));
  const at = (x: number, t: number) => `${(cx + x * scale).toFixed(1)} ${(cy + t * plan.half * scale * 0.1).toFixed(1)}`;
  const trailing = Array.from({ length: 17 }, (_, i) => 1 - i / 8).map((t) => `L${at(lead(t) - chord(t), t)}`);
  return `M${at(lead(-1), -1)} L${at(lead(0), 0)} L${at(lead(1), 1)} ${trailing.join(" ")} Z`;
}

/** A board on its mast, pod and wing, sized to its rider: the deck in the board's finish, the wing in its default colour. */
export function boardSilhouette(kind: string): SVGSVGElement {
  const length = kind === "Crest" ? 250 : kind === "Swift" ? 200 : 230;
  const tail = (320 - length) / 2;
  const nose = tail + length;
  const mast = tail + length * 0.42;
  const wing = DEFAULT_WING[kind] ?? DEFAULT_WING.Drift!;
  const ink = "#111111";
  return s("svg", { class: "board-art", viewBox: "0 0 320 130", "aria-hidden": "true", focusable: "false" },
    s("ellipse", { cx: 160, cy: 122, rx: 110, ry: 4, fill: "#111111", opacity: 0.08 }),
    s("path", { d: `M${tail} 37 L${tail} 50 Q${tail} 54 ${tail + 6} 54 L${nose - 40} 54 Q${nose - 8} 53 ${nose} 38 Q${nose - 2} 33 ${nose - 14} 34 L${tail + 4} 35 Q${tail} 35 ${tail} 37 Z`, fill: FINISH[kind] ?? "currentColor", stroke: ink, "stroke-width": 1.5, "stroke-linejoin": "round" }),
    s("path", { d: `M${tail + 10} 41 L${nose - 30} 41`, stroke: ink, "stroke-width": 1, opacity: 0.25 }),
    s("rect", { x: mast - 3, y: 54, width: 6, height: 50, rx: 2, fill: "#232528" }),
    s("rect", { x: mast - 30, y: 79, width: 52, height: 11, rx: 5.5, fill: "#4a4f56" }),
    s("path", { d: `M${mast - 36} 76 L${mast - 31} 84.5 L${mast - 36} 93`, fill: "none", stroke: "#4a4f56", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }),
    s("path", { d: wingPath({ half: wing.half * 0.4, chord: wing.chord * 0.5, sweep: wing.sweep * 0.4 }, mast - 58, 104, 200), fill: wing.hex, stroke: ink, "stroke-width": 1, "stroke-linejoin": "round" }),
    s("rect", { x: mast - 66, y: 102.5, width: 86, height: 3, rx: 1.5, fill: "#232528" }),
    s("path", { d: wingPath(wing, mast + 16, 105, 200), fill: wing.hex, stroke: ink, "stroke-width": 1, "stroke-linejoin": "round" }));
}

export function onward(href: string, text: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  return h("a", { href, class: "onward", ...attrs }, text, icon("arrow", 18));
}

/** A wide table that scrolls inside its own box, reachable by keyboard. */
export function scrollBox(label: string, table: HTMLTableElement): HTMLElement {
  return h("div", { class: "table-scroll", role: "region", "aria-label": label, tabindex: "0" }, table);
}
