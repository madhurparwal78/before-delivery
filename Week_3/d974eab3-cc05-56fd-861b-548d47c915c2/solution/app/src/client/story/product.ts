import type { Content, Product } from "../../shared/content.js";
import { CAUTIONS_HEADING, HOW_TO_USE_HEADING, INGREDIENTS_HEADING, amount, detailLines, editionLine, notice, productLine, storageLine } from "../../shared/format.js";
import { SHEET_UNAVAILABLE_MESSAGE } from "../../shared/messages.js";
import { announce } from "../announce.js";
import { loadSheet } from "../api.js";
import { PACK_VIEWS, PACK_VIEW_LABELS, createPack, type PackView } from "../art/pack.js";
import { figures, h } from "../dom.js";
import { icon } from "../icons.js";
import { createRadioGroup } from "../radios.js";
import { createTabs } from "../tabs.js";

const TAB_NAMES = ["Details", "Ingredients", HOW_TO_USE_HEADING] as const;

function isPackView(value: string): value is PackView {
  return PACK_VIEWS.some((view) => view === value);
}

function ingredientTable(product: Product): HTMLTableElement {
  const lead = Math.max(...product.ingredients.map((ingredient) => ingredient.mg));
  return h("table", { class: "ingredients", "aria-label": INGREDIENTS_HEADING },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Ingredient"), h("th", { scope: "col", class: "amount" }, "Amount"))),
    h("tbody", {}, ...product.ingredients.map((ingredient) =>
      h("tr", { class: ingredient.mg === lead ? "lead-row" : "" },
        h("td", {}, ingredient.name),
        h("td", { class: "amount" }, figures(amount(ingredient)))))));
}

function panels(product: Product): HTMLElement[] {
  return [
    h("div", { class: "info-panel" }, ...detailLines(product).map((line) => h("p", {}, line))),
    h("div", { class: "info-panel" }, ingredientTable(product), h("p", { class: "notice" }, notice(product))),
    h("div", { class: "info-panel" },
      h("ol", {}, ...product.how_to_use.map((step) => h("li", {}, step))),
      h("p", {}, storageLine(product)),
      h("h3", {}, CAUTIONS_HEADING),
      h("ul", {}, ...product.cautions.map((caution) => h("li", {}, caution)))),
  ];
}

function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The Product chapter: the drawn pack, the information tabs and the product sheet download. */
export function createProduct({ product, edition }: Content, reveal: (heading: HTMLElement) => void): HTMLElement {
  const pack = createPack(product);
  const views = createRadioGroup({
    label: "Pack view",
    name: "pack-view",
    className: "segmented",
    options: PACK_VIEWS.map((view) => ({ value: view, label: PACK_VIEW_LABELS[view] })),
    checked: "front",
    onChange(view) {
      if (!isPackView(view)) return;
      pack.setView(view);
      announce(`Showing the ${view} of the pack.`);
    },
  });
  const infoPanels = panels(product);
  const info = createTabs({ label: "Product information", id: "product-info", names: TAB_NAMES, panels: infoPanels });

  const alertSlot = h("div", { class: "alert-slot" });
  const sheetButton = h("button", { type: "button", class: "button" }, icon("download"), "Download product sheet (PDF)");
  let pending = false;
  sheetButton.addEventListener("click", async () => {
    if (pending) return;
    alertSlot.replaceChildren();
    pending = true;
    sheetButton.setAttribute("aria-disabled", "true");
    announce("Preparing the product sheet.");
    try {
      const sheet = await loadSheet();
      saveFile(sheet.blob, sheet.filename);
      announce("Product sheet ready.");
    } catch {
      alertSlot.append(h("div", { class: "alert", role: "alert" }, icon("warning"), h("span", {}, SHEET_UNAVAILABLE_MESSAGE)));
    } finally {
      pending = false;
      sheetButton.removeAttribute("aria-disabled");
    }
  });

  const title = h("h2", { id: "product-title", tabindex: "-1" }, product.name);
  reveal(title);
  return h("section", { "data-chapter": "product", class: "chapter chapter-product paper-deep", "aria-labelledby": "product-title" },
    h("div", { class: "spread" },
      title,
      h("p", { class: "lead" }, productLine(product)),
      h("div", { class: "product-grid" },
        h("div", { class: "showcase" }, pack.element, views.element),
        h("div", { class: "information" },
          info.element, ...infoPanels,
          h("div", { class: "product-actions" },
            sheetButton, alertSlot,
            h("p", { class: "edition" }, editionLine(edition)),
            h("a", { class: "text-link", href: "/store" }, "Visit the online store", icon("arrow")))))));
}
