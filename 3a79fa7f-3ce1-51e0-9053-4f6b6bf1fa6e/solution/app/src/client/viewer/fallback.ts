// Without WebGL: a labelled still side drawing of the build, naming each part.
import { h, s } from "../dom.ts";
import { CHARGE_OFF, CHARGE_ON, hue, PACK_LENGTH, RING, shape } from "./parts.ts";
import type { SceneBuild } from "./types.ts";

const WING_SPAN = { broad: 210, swept: 180, wide: 230, narrow: 150 };

export function sideDrawing(build: SceneBuild, boardName: string, fill: number): HTMLElement {
  const p = build.parts;
  const mastEnd = 124 + Math.round(Number(build.mastM) * 160);
  const pack = { hex: hue(p.battery.colour), length: Math.round(PACK_LENGTH[shape(p.battery.sku).pack] * 260) };
  const span = WING_SPAN[shape(p.wing.sku).wing];
  const mastWidth = shape(p.mast.sku).mast === "round" ? 8 : 12;
  const ringed = shape(p.controller.sku).grip === "ring";
  const charge = (x: number, length: number, y: number) => [0, 1, 2, 3].map((i) =>
    s("rect", { x: x + 6 + i * ((length - 12) / 4), y, width: (length - 12) / 4 - 3, height: 4, rx: 1, fill: i < fill ? CHARGE_ON : CHARGE_OFF }));
  const spares = Array.from({ length: build.spares }, (_, i) => [
    s("rect", { x: 470 + i * 70, y: 108, width: 60, height: 22, rx: 4, fill: pack.hex, stroke: "#111111", "stroke-width": 1 }),
    charge(470 + i * 70, 60, 111)]);
  const drawing = s("svg", { viewBox: "0 0 640 300", class: "fallback-art", "aria-hidden": "true", focusable: "false" },
    s("path", { d: "M90 110 Q100 92 140 92 L420 90 Q470 92 476 104 Q470 120 420 122 L140 124 Q100 124 90 110 Z", fill: hue(build.finish), stroke: "#111111", "stroke-width": 1.5 }),
    s("rect", { x: 330 - pack.length / 2, y: 98, width: pack.length, height: 18, rx: 3, fill: pack.hex, stroke: "#111111", "stroke-width": 1 }),
    charge(330 - pack.length / 2, pack.length, 101),
    s("rect", { x: 242 - mastWidth / 2, y: 124, width: mastWidth, height: mastEnd - 124, fill: hue(p.mast.colour), stroke: "#111111", "stroke-width": 1 }),
    s("ellipse", { cx: 242, cy: 124 + (mastEnd - 124) * 0.55, rx: 44, ry: 12, fill: hue(p.propulsion.colour), stroke: "#111111", "stroke-width": 1 }),
    s("path", { d: `M${260 - span / 2} ${mastEnd + 6} Q260 ${mastEnd - 8} ${260 + span / 2} ${mastEnd + 4} Q260 ${mastEnd + 18} ${260 - span / 2} ${mastEnd + 6} Z`, fill: hue(p.wing.colour), stroke: "#111111", "stroke-width": 1 }),
    s("rect", { x: 520, y: 40, width: 14, height: 44, rx: 7, fill: hue(p.controller.colour), stroke: ringed ? RING : "#111111", "stroke-width": 2 }),
    spares);
  return h("div", { class: "viewer-fallback" }, drawing,
    h("ul", { class: "fallback-labels" },
      h("li", null, `Board: ${boardName} (${build.finish})`),
      h("li", null, `Wing: ${p.wing.name}`),
      h("li", null, `Mast: ${p.mast.name}`),
      h("li", null, `Propulsion: ${p.propulsion.name}`),
      h("li", null, `Battery: ${p.battery.name}`),
      h("li", null, `Controller: ${p.controller.name}`),
      build.spares ? h("li", null, `Spare batteries: ${build.spares}`) : null));
}
