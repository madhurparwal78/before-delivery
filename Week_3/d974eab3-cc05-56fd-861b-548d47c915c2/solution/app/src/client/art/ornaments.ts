import { drawing } from "../dom.js";
import { beetMarkup } from "./beet.js";

/** Concentric breath arcs behind the Opening: still, drawn in aqua at low strength. */
export function openingArcs(): SVGSVGElement {
  const arcs = [120, 200, 280, 360, 440].map((radius, index) =>
    `<circle class="stroke-oxygen" cx="620" cy="420" r="${radius}" fill="none" stroke-width="1.5" stroke-opacity="${0.5 - index * 0.08}"/>`).join("");
  return drawing(`<svg class="opening-arcs" viewBox="0 0 800 600" aria-hidden="true" focusable="false" preserveAspectRatio="xMaxYMax slice">${arcs}</svg>`);
}

/** A line drawing for each Inner Pace panel: effort climbs, recovery rests, one pace joins them. */
export function panelArt(index: number): SVGSVGElement {
  const art = [
    `<path class="stroke-ink" fill="none" stroke-width="2" stroke-linecap="round" d="M20 170 H70 V130 H120 V90 H170 V50 H220"/>
     <circle class="fill-beet" cx="220" cy="50" r="9"/>`,
    `<path class="stroke-ink" fill="none" stroke-width="2" stroke-linecap="round" d="M20 110 q25 -40 50 0 t50 0 t50 0 t50 0"/>
     <path class="stroke-ink" fill="none" stroke-width="1" stroke-opacity=".5" d="M20 140 q25 -30 50 0 t50 0 t50 0 t50 0"/>
     <circle class="fill-beet" cx="120" cy="110" r="9"/>`,
    `<circle class="stroke-ink" cx="96" cy="100" r="58" fill="none" stroke-width="2"/>
     <circle class="stroke-ink" cx="152" cy="100" r="58" fill="none" stroke-width="2"/>
     <path class="fill-beet" opacity=".85" d="M124 52 A58 58 0 0 1 124 148 A58 58 0 0 1 124 52 Z"/>`,
  ][index];
  return drawing(`<svg class="panel-art" viewBox="0 0 240 200" aria-hidden="true" focusable="false">${art}</svg>`);
}

/** The Science spread's beet root: a large line drawing with the root filled in beet red. */
export function beetDrawing(): SVGSVGElement {
  return drawing(`<svg class="beet-drawing" viewBox="-80 -140 160 240" aria-hidden="true" focusable="false">${beetMarkup("scale(1.2)")}</svg>`);
}

/** A broken air path for the two pages that cannot be found. */
export function brokenPath(): SVGSVGElement {
  return drawing(`<svg class="broken-path" viewBox="0 0 400 100" aria-hidden="true" focusable="false">
    <path class="stroke-oxygen" fill="none" stroke-width="3" stroke-linecap="round" d="M10 60 C70 10 120 90 170 50"/>
    <path class="stroke-oxygen" fill="none" stroke-width="3" stroke-linecap="round" stroke-opacity=".4" d="M230 50 C280 10 330 90 390 40"/>
    <circle class="fill-oxygen" cx="170" cy="50" r="7"/>
  </svg>`);
}
