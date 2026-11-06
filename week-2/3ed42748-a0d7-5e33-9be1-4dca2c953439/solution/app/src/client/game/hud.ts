// The game screen's overlays: the three stamp-cards (and their phone tabs), the compass ring
// with the Route readout, the toolbar, the touch controls and the dialog layer.
import { h, svg } from "../lib/dom";
import { icon, type IconName } from "../lib/icons";
import { paper } from "../lib/paper";

export function iconButton(name: IconName, label: string, text?: string, extra = ""): HTMLButtonElement {
  const b = h("button", { type: "button", class: `button icon-button ${extra}`.trim(), "aria-label": label });
  b.innerHTML = icon(name) + (text ? `<span class="icon-button-text">${text}</span>` : "");
  return b;
}

export function textButton(text: string, extra = ""): HTMLButtonElement {
  return h("button", { type: "button", class: `button ${extra}`.trim() }, text);
}

const RING_TICKS = Array.from({ length: 24 }, (_, i) => i * 15);
const LABELS: Array<[string, number]> = [
  ["N", 0],
  ["E", 90],
  ["S", 180],
  ["W", 270],
];

/** The horizon compass: a flattened ring whose markings turn so the notch points along the bearing. */
export class Compass {
  readonly el: HTMLElement;
  readonly metres = h("span", { class: "compass-metres", "aria-hidden": "true" });
  private readonly marks: SVGGElement;
  private readonly notch: SVGGElement;
  private lastDeg = Number.NaN;
  private lastNotch = "";

  constructor() {
    const art = svg(`<svg class="compass-art" viewBox="0 0 640 120" preserveAspectRatio="none" aria-hidden="true">
      <ellipse class="compass-band" cx="320" cy="70" rx="306" ry="42"/>
      <ellipse class="compass-line" cx="320" cy="70" rx="306" ry="42"/>
      <ellipse class="compass-line compass-inner" cx="320" cy="70" rx="262" ry="30"/>
      <g class="compass-marks"></g>
      <g class="compass-notch" transform="translate(320 24)"></g>
    </svg>`);
    this.marks = art.querySelector(".compass-marks")!;
    this.notch = art.querySelector(".compass-notch")!;
    this.el = h(
      "div",
      { role: "img", "aria-label": "Horizon compass", class: "compass", "data-ring-deg": "0", "data-notch": "idle" },
      art,
      this.metres,
    );
    this.setNotch("idle");
    this.turn(0);
  }

  turn(deg: number): void {
    if (deg === this.lastDeg) return;
    this.lastDeg = deg;
    this.el.setAttribute("data-ring-deg", String(deg));
    const parts: string[] = [];
    for (const tick of RING_TICKS) {
      const a = ((tick - deg) * Math.PI) / 180;
      const x = 320 + 284 * Math.sin(a);
      const y = 70 - 36 * Math.cos(a);
      const front = Math.cos(a) < 0;
      const major = tick % 90 === 0;
      const len = major ? 9 : 5;
      parts.push(
        `<line class="compass-tick${front ? " is-front" : ""}" x1="${x.toFixed(1)}" y1="${(y - len / 2).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + len / 2).toFixed(1)}"/>`,
      );
    }
    for (const [label, at] of LABELS) {
      const a = ((at - deg) * Math.PI) / 180;
      const x = 320 + 284 * Math.sin(a);
      const y = 70 - 36 * Math.cos(a);
      const back = Math.cos(a) > 0.2;
      parts.push(
        `<text class="compass-label${back ? " is-back" : ""}" x="${x.toFixed(1)}" y="${(y + (back ? 16 : -8)).toFixed(1)}" text-anchor="middle">${label}</text>`,
      );
    }
    this.marks.innerHTML = parts.join("");
  }

  setNotch(kind: "idle" | "bearing" | "stamp"): void {
    if (kind === this.lastNotch) return;
    this.lastNotch = kind;
    this.el.setAttribute("data-notch", kind);
    if (kind === "stamp") {
      this.notch.innerHTML = `<rect class="notch-stamp" x="-15" y="-17" width="30" height="30"/>
        <path class="notch-stamp-edge" d="M-15 -17h30v30h-30z"/>
        <path class="notch-star" d="M0 -10 L3 -3.5 L10 -3 L4.6 1.6 L6.3 8.5 L0 4.7 L-6.3 8.5 L-4.6 1.6 L-10 -3 L-3 -3.5 Z"/>`;
    } else if (kind === "bearing") {
      this.notch.innerHTML = `<path class="notch-solid" d="M-13 -14 H13 L0 6 Z"/>`;
    } else {
      this.notch.innerHTML = `<path class="notch-outline" d="M-12 -13 H12 L0 5 Z"/>`;
    }
  }
}

export function makeCard(label: string, id: string, ...children: Node[]): HTMLElement {
  return paper(h("aside", { "aria-label": label, class: `card card-${id}`, id: `card-${id}` }, ...children));
}

export function makeTab(label: string, id: string, glyph: IconName): HTMLButtonElement {
  const b = h("button", {
    type: "button",
    class: "card-tab",
    "aria-expanded": "false",
    "aria-controls": `card-${id}`,
  });
  b.innerHTML = `${icon(glyph, 18)}<span>${label}</span>`;
  return paper(b);
}
