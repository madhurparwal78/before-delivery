import { drawing } from "../dom.js";
import { NITRATE_STEPS } from "../copy.js";

/** Atom positions around each step's nitrogen: one, two or three oxygens. */
const OXYGENS: readonly (readonly [number, number])[][] = [
  [[-20, -18], [20, -18], [0, 24]],
  [[-20, 14], [20, 14]],
  [[24, 0]],
];

const CENTRES = [110, 320, 530] as const;

/** The nitrate, nitrite and nitric oxide steps, with the chosen step marked in beet red. */
export function createNitrateDiagram() {
  const nodes = NITRATE_STEPS.map((step, index) => {
    const centre = CENTRES[index];
    const atoms = OXYGENS[index].map(([x, y]) =>
      `<circle class="fill-oxygen stroke-ink" stroke-width="1.5" cx="${centre + x}" cy="${86 + y}" r="9"/>`).join("");
    return `<g class="step-node" data-index="${index + 1}">
      <circle class="step-shape" cx="${centre}" cy="86" r="62"/>
      ${atoms}
      <text class="step-atom body" x="${centre}" y="91" text-anchor="middle" font-size="16" font-weight="700">N</text>
      <text class="step-name body" x="${centre}" y="184" text-anchor="middle" font-size="15">${step.name}</text>
    </g>`;
  }).join("");
  const arrows = [[176, 254], [386, 464]].map(([from, to]) =>
    `<path class="stroke-line" fill="none" stroke-width="1.5" d="M${from} 86 H${to} M${to - 8} 80 L${to} 86 L${to - 8} 92"/>`).join("");
  const element = drawing(`<svg class="nitrate-diagram" viewBox="0 0 640 200" role="img" aria-label="Nitrate pathway diagram" data-step="1">
    ${arrows}${nodes}
  </svg>`);
  const setStep = (step: number): void => {
    element.setAttribute("data-step", String(step));
    element.querySelectorAll(".step-node").forEach((node) => {
      if (node.getAttribute("data-index") === String(step)) node.setAttribute("data-current", "");
      else node.removeAttribute("data-current");
    });
  };
  setStep(1);
  return { element, setStep };
}
