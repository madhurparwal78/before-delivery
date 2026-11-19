// The method page: five stages side by side from 1100 px, two columns 768-1099, one below.

import { el } from "./api.js";
import type { RouteCtx } from "./app.js";
import { MEASURE_NAMES, STAGE_NAMES } from "./copy.js";

const STAGE_TEXT: Record<string, string> = {
  materials: "The fibre, the farm and the first spinning. Mass times the material's own figures.",
  making: "Knitting, weaving, dyeing and sewing. The tier 1 factory's grid and its megajoules.",
  transport: "Every leg from factory to warehouse. Mass in tonnes times kilometres times the mode.",
  use: "Thirty washes is the working default. The wash row carries the use stage.",
  endOfLife: "What happens after wear. The disposal row per kilogram of the finished goods.",
};

export function registerMethod(ctx: RouteCtx): void {
  const main = ctx.main;
  const h1 = el("h1", {}, "How a footprint is worked out");
  const grid = el("div", { class: "method-grid" });
  for (const [id, name] of Object.entries(STAGE_NAMES)) {
    const section = el("section", { class: "method-stage" });
    section.append(el("h2", {}, name));
    section.append(el("p", {}, STAGE_TEXT[id]));
    grid.append(section);
  }
  const measures = el("section", { class: "method-measures", id: "measures" });
  measures.append(el("h2", {}, "Six measures"));
  const list = el("ul", { class: "measure-list" });
  const units: Record<string, string> = {
    climate: "kg CO\u2082e",
    water: "L",
    fossilEnergy: "MJ",
    landUse: "points",
    freshwaterToxicity: "CTUe",
    microfibres: "mg",
  };
  for (const [id, name] of Object.entries(MEASURE_NAMES)) {
    list.append(el("li", {}, `${name} \u2014 ${units[id]}`));
  }
  measures.append(list);
  main.append(h1, grid, measures);
}
