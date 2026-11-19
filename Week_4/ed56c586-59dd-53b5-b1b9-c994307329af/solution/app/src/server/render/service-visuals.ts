import { type Service } from "../../shared/catalog.js";
import { html, type Markup } from "./html.js";

/** One vector visual per service, each with its own shape and pattern. Style sheets colour and animate the parts. */

const VISUALS: Readonly<Record<Service["value"], () => Markup>> = {
  web: () => html`<svg viewBox="0 0 320 240" class="service-art" focusable="false">
    <rect class="art-line" x="24" y="24" width="272" height="192" />
    <path class="art-line" d="M24 60h272" />
    <rect class="art-fill art-part" x="44" y="80" width="120" height="14" />
    <rect class="art-line art-part" x="44" y="108" width="196" height="10" />
    <rect class="art-line art-part" x="44" y="128" width="168" height="10" />
    <rect class="art-fill art-part" x="196" y="152" width="80" height="44" />
    <rect class="art-line art-part" x="44" y="152" width="136" height="44" />
    <circle class="art-fill" cx="40" cy="42" r="4" /><circle class="art-line" cx="56" cy="42" r="4" /><circle class="art-line" cx="72" cy="42" r="4" />
  </svg>`,
  motion: () => html`<svg viewBox="0 0 320 240" class="service-art" focusable="false">
    <path class="art-line art-part" d="M20 190C80 190 80 50 140 50S200 190 260 190 300 120 300 120" />
    <path class="art-line art-part" d="M20 150C70 150 80 90 140 90S210 150 260 150" />
    <circle class="art-fill art-part" cx="140" cy="50" r="10" />
    <circle class="art-fill art-part" cx="260" cy="190" r="10" />
    <circle class="art-line art-part" cx="20" cy="190" r="10" />
    <path class="art-line art-part" d="M20 220h280" />
  </svg>`,
  cloud: () => html`<svg viewBox="0 0 320 240" class="service-art" focusable="false">
    <path class="art-fill art-part" d="M90 120a40 40 0 0 1 78-12 34 34 0 0 1 60 16 28 28 0 0 1-6 56H98a30 30 0 0 1-8-60z" />
    <path class="art-line art-part" d="M70 210h180M110 176v34M160 176v34M210 176v34" />
    <circle class="art-line art-part" cx="60" cy="70" r="14" /><circle class="art-line art-part" cx="268" cy="64" r="10" />
    <path class="art-dash art-part" d="M74 74 110 100M258 70 228 100" />
  </svg>`,
  design: () => html`<svg viewBox="0 0 320 240" class="service-art" focusable="false">
    <circle class="art-fill art-part" cx="120" cy="110" r="64" />
    <rect class="art-line art-part" x="130" y="60" width="130" height="130" />
    <path class="art-line art-part" d="M60 210 280 40" />
    <circle class="art-line art-part" cx="230" cy="170" r="30" />
    <rect class="art-fill art-part" x="24" y="24" width="28" height="28" />
  </svg>`,
  ai: () => html`<svg viewBox="0 0 320 240" class="service-art" focusable="false">
    <path class="art-line art-part" d="M50 60 140 120 50 180M140 120 250 70M140 120 250 170M250 70 290 120 250 170" />
    <circle class="art-fill art-part" cx="140" cy="120" r="18" />
    <circle class="art-line art-part" cx="50" cy="60" r="12" /><circle class="art-line art-part" cx="50" cy="180" r="12" />
    <circle class="art-line art-part" cx="250" cy="70" r="12" /><circle class="art-line art-part" cx="250" cy="170" r="12" />
    <circle class="art-fill art-part" cx="290" cy="120" r="8" />
  </svg>`,
};

export function serviceVisual(service: Service): Markup {
  return VISUALS[service.value]();
}
