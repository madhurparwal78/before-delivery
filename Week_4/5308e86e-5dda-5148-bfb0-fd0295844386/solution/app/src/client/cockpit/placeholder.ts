/** Cards, Treasury and Bill Pay: a heading and a plain line for this company. */
import { h } from "../shared/dom.js";
import { currentMe } from "./store.js";

export function mountPlaceholder(root: HTMLElement): void {
  root.append(h("p", { class: "empty-state" }, `Nothing here yet for ${currentMe().company.name}.`));
}
