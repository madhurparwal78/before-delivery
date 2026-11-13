import { drawing, find } from "../dom.js";
import { STAGE_COUNT, stageProgress } from "../story/progress.js";

const AIR_PATH = "M110 160 C220 60 330 270 450 175 C560 90 660 70 760 150 C810 190 860 190 905 150";

/**
 * Lungs on the left, a cell with mitochondria and ATP on the right, and the air path between them.
 * `place` puts the oxygen dot the given share (0 to 1) of the way along the path.
 */
export function createOxygenDiagram() {
  const element = drawing(`<svg class="oxygen-diagram" viewBox="0 0 1000 320" aria-hidden="true" focusable="false">
    <g class="lungs" fill="none" stroke-width="2" stroke-linecap="round">
      <path class="stroke-mist-soft" d="M72 90 C26 112 18 206 52 246 C74 270 104 256 106 222 L106 104 C104 90 86 82 72 90 Z"/>
      <path class="stroke-mist-soft" d="M148 90 C194 112 202 206 168 246 C146 270 116 256 114 222 L114 104 C116 90 134 82 148 90 Z"/>
      <path class="stroke-mist-soft" d="M110 36 V126 M110 126 C100 146 84 156 70 188 M110 126 C120 146 136 156 150 188"/>
      <path class="stroke-mist-soft" opacity=".6" d="M84 150 C76 164 66 176 60 198 M136 150 C144 164 154 176 160 198"/>
    </g>
    <g class="cell" fill="none" stroke-width="2">
      <path class="stroke-mist-soft" d="M812 160 C812 78 872 48 928 56 C980 64 996 126 986 182 C976 246 928 272 876 266 C826 258 812 214 812 160 Z"/>
      <g class="stroke-oxygen" opacity=".75"><ellipse cx="872" cy="124" rx="30" ry="14" transform="rotate(-18 872 124)"/>
        <path d="M850 126 q6 -10 12 0 t12 0 t12 0" transform="rotate(-18 872 124)"/></g>
      <g class="stroke-oxygen" opacity=".75"><ellipse cx="936" cy="212" rx="30" ry="14" transform="rotate(22 936 212)"/>
        <path d="M914 214 q6 -10 12 0 t12 0 t12 0" transform="rotate(22 936 212)"/></g>
      <circle class="stroke-mist-soft" cx="948" cy="112" r="9"/>
    </g>
    <text class="fill-mist-soft display" x="900" y="304" text-anchor="middle" font-size="22">ATP</text>
    <path class="air-path" d="${AIR_PATH}" fill="none" stroke-width="3" stroke-linecap="round" stroke-opacity=".35"/>
    <path class="air-trail" d="${AIR_PATH}" fill="none" stroke-width="3" stroke-linecap="round"/>
    <g class="ticks"></g>
    <g class="dot-group"><circle class="dot-halo" r="22" opacity=".22"/><circle class="dot" data-dot r="10"/></g>
  </svg>`);
  const path = find(element, ".air-path", SVGPathElement);
  const trail = find(element, ".air-trail", SVGPathElement);
  const dot = find(element, ".dot", SVGCircleElement);
  const halo = find(element, ".dot-halo", SVGCircleElement);
  const ticks = find(element, ".ticks", SVGGElement);
  const length = path.getTotalLength();

  for (let stage = 1; stage <= STAGE_COUNT; stage += 1) {
    const point = path.getPointAtLength(length * stageProgress(stage));
    ticks.insertAdjacentHTML("beforeend",
      `<circle class="tick" cx="${point.x}" cy="${point.y}" r="4"/><text class="tick-label body" x="${point.x}" y="${point.y + 26}" text-anchor="middle" font-size="14">${stage}</text>`);
  }

  const place = (share: number): void => {
    const point = path.getPointAtLength(length * share);
    for (const circle of [dot, halo]) {
      circle.setAttribute("cx", String(point.x));
      circle.setAttribute("cy", String(point.y));
    }
    trail.setAttribute("stroke-dasharray", `${length * share} ${length}`);
  };
  place(0);
  return { element, place };
}
