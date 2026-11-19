import type { CampaignStatus, PledgeState } from "../shared/api.js";
import { h, s } from "./dom.js";

// The dot motif's small marks: pledge state marks (always with their word), status chips, the empty-state
// dot and the inking loader (brief: Working screens, Other motion).

const STATE_WORDS: Record<PledgeState, string> = {
  authorising: "Holding",
  authorised: "Held",
  captured: "Charged",
  errored: "Needs fixing",
  voided: "Released",
  dropped: "Dropped",
};

function markSvg(state: PledgeState): SVGSVGElement {
  const ring = (extra: Record<string, string | number> = {}) => s("circle", { cx: 10, cy: 10, r: 7.5, fill: "none", stroke: "currentColor", "stroke-width": 2.5, ...extra });
  const parts: SVGElement[] = [];
  if (state === "captured") parts.push(s("circle", { cx: 10, cy: 10, r: 8.75, fill: "currentColor" }));
  if (state === "authorised") parts.push(ring());
  if (state === "authorising") parts.push(ring({ "stroke-dasharray": "2.4 2.3" }));
  if (state === "errored") parts.push(ring(), s("path", { d: "M10 2.5a7.5 7.5 0 0 0 0 15z", fill: "currentColor" }));
  if (state === "voided" || state === "dropped") parts.push(ring(), s("path", { d: "M4.7 15.3 15.3 4.7", stroke: "currentColor", "stroke-width": 2.5 }));
  return s("svg", { class: "mark-dot", viewBox: "0 0 20 20", width: 20, height: 20, "aria-hidden": "true", focusable: "false" }, ...parts);
}

export function stateMark(state: PledgeState): HTMLSpanElement {
  return h("span", { class: `state-mark state-${state}` }, markSvg(state), h("span", { class: "state-word" }, STATE_WORDS[state]));
}

const STATUS_WORDS: Record<CampaignStatus, string> = {
  draft: "Draft",
  live: "Live",
  funded: "Funded",
  collecting: "Collecting",
  settled: "Settled",
  unfunded: "Not funded",
  cancelled: "Cancelled",
};

export function statusChip(status: CampaignStatus): HTMLSpanElement {
  const filled = status === "live" || status === "funded" || status === "collecting" || status === "settled";
  return h("span", { class: `chip${filled ? " chip-filled" : ""}` }, STATUS_WORDS[status]);
}

export function emptyState(sentence: string): HTMLDivElement {
  return h("div", { class: "empty" },
    s("svg", { class: "empty-dot", viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" },
      s("circle", { cx: 50, cy: 50, r: 46, fill: "none", stroke: "currentColor", "stroke-width": 3 })),
    h("p", {}, sentence));
}

/** Outline dots inking ring by ring from the centre; under reduced motion one still ring. */
export function loading(): HTMLDivElement {
  const dots: SVGElement[] = [];
  const rings: [number, number][] = [[0, 0]];
  for (let k = 1; k <= 2; k++) {
    for (let i = 0; i < 6 * k; i++) {
      const angle = (2 * Math.PI * i) / (6 * k);
      rings.push([k, angle]);
    }
  }
  for (const [ring, angle] of rings) {
    dots.push(s("circle", {
      class: `load-dot load-ring-${ring}`, cx: 30 + Math.cos(angle) * ring * 11, cy: 30 + Math.sin(angle) * ring * 11, r: 4,
    }));
  }
  return h("div", { class: "loading", role: "status", "aria-label": "Loading" },
    s("svg", { viewBox: "0 0 60 60", width: 60, height: 60, "aria-hidden": "true", focusable: "false" }, ...dots),
    h("span", {}, "Loading"));
}
