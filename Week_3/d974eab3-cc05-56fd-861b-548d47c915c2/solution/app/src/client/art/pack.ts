import type { Product } from "../../shared/content.js";
import { escapeHtml } from "../../shared/html.js";
import { COMPANY } from "../../shared/titles.js";
import { drawing, h } from "../dom.js";
import { beetMarkup } from "./beet.js";

export type PackView = "front" | "side" | "back";
export const PACK_VIEWS: readonly PackView[] = ["front", "side", "back"];
export const PACK_VIEW_LABELS: Record<PackView, string> = { front: "Front", side: "Side", back: "Back" };

const CLIP_INGREDIENT = 28;
const CLIP_SERVING = 34;

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function nameSize(name: string, width: number, ceiling: number): number {
  return Math.max(12, Math.min(ceiling, Math.floor(width / (name.length * 0.58))));
}

/** What the pack calls the product: the words before the first comma of its format, in capitals. */
function descriptor(product: Product): string {
  return product.format.split(",")[0].toUpperCase();
}

function frontFace(product: Product): SVGSVGElement {
  return drawing(`<svg viewBox="0 0 210 300" width="210" height="300" aria-hidden="true" focusable="false">
    <rect class="fill-beet" width="210" height="300" rx="6"/>
    <rect class="fill-ink" opacity=".35" width="210" height="14"/>
    <text class="fill-mist display" x="105" y="62" text-anchor="middle" font-size="${nameSize(product.name, 178, 36)}">${escapeHtml(product.name)}</text>
    <path class="stroke-mist" stroke-opacity=".5" stroke-width="1" d="M42 82h126"/>
    <text class="fill-mist body" x="105" y="102" text-anchor="middle" font-size="11" letter-spacing="1.6">${escapeHtml(clip(descriptor(product), 24))}</text>
    ${beetMarkup("translate(105 206) scale(.68)")}
    <text class="fill-mist body" x="105" y="272" text-anchor="middle" font-size="12" font-weight="500">${product.packs[0].sticks} sticks</text>
    <text class="fill-mist body" x="105" y="288" text-anchor="middle" font-size="9" letter-spacing="1" opacity=".85">${escapeHtml(COMPANY.toUpperCase())}</text>
  </svg>`);
}

function backFace(product: Product): SVGSVGElement {
  const rows = product.ingredients.slice(0, 6).map((ingredient, index) =>
    `<text class="fill-mist body" x="22" y="${84 + index * 20}" font-size="11">${escapeHtml(clip(ingredient.name, CLIP_INGREDIENT))}</text>`).join("");
  const bars = Array.from({ length: 26 }, (_, index) => `<rect class="fill-mist" x="${34 + index * 5.6}" y="238" width="${index % 3 === 0 ? 3 : 1.6}" height="34"/>`).join("");
  return drawing(`<svg viewBox="0 0 210 300" width="210" height="300" aria-hidden="true" focusable="false">
    <rect class="fill-ink" width="210" height="300" rx="6"/>
    <text class="fill-mist display" x="22" y="42" font-size="20">Ingredients</text>
    <path class="stroke-mist" stroke-opacity=".4" d="M22 54h166"/>
    ${rows}
    <text class="fill-mist body" x="22" y="224" font-size="10" opacity=".8">${escapeHtml(clip(product.serving, CLIP_SERVING))}</text>
    ${bars}
  </svg>`);
}

function sideFace(product: Product): SVGSVGElement {
  return drawing(`<svg viewBox="0 0 96 300" width="96" height="300" aria-hidden="true" focusable="false">
    <rect class="fill-beet" width="96" height="300"/>
    <rect class="fill-ink" opacity=".3" width="96" height="300"/>
    <text class="fill-mist display" font-size="${nameSize(product.name, 200, 26)}" transform="translate(58 250) rotate(-90)">${escapeHtml(product.name)}</text>
    <text class="fill-mist body" font-size="9" letter-spacing="1.2" transform="translate(76 250) rotate(-90)">${escapeHtml(descriptor(product))}</text>
  </svg>`);
}

/** The pack as a drawn carton with three faces that turn about its vertical axis. */
export function createPack(product: Product) {
  const element = h("div", { class: "pack", role: "img" },
    h("div", { class: "pack-body" },
      h("div", { class: "pack-face pack-front" }, frontFace(product)),
      h("div", { class: "pack-face pack-back" }, backFace(product)),
      h("div", { class: "pack-face pack-side" }, sideFace(product)),
    ),
  );
  const setView = (view: PackView): void => {
    element.setAttribute("data-view", view);
    element.setAttribute("aria-label", `${product.name} pack, ${view} view`);
  };
  setView("front");
  return { element, setView };
}
