// Shop pages /foil-boards and /parts (brief: Shop pages) and the product dialog.
import { api } from "../api.ts";
import { openDialog } from "../dialog.ts";
import { h, uid } from "../dom.ts";
import { busy } from "../forms.ts";
import { price } from "../format.ts";
import { icon } from "../icons.ts";
import { openCartDrawer } from "../layout.ts";
import type { PageContext } from "../router.ts";
import { announce, refreshCart, type Cart } from "../state.ts";
import type { Accessory, Catalog, Component } from "../catalog.ts";
import { badge, financingLine, pageHead } from "../ui.ts";

type Product = Accessory | Component;

function fitsLine(item: Product): string | null {
  return "fits" in item ? `Fits: ${item.fits.join(", ")}` : null;
}

async function openProduct(item: Product, opener: HTMLElement): Promise<void> {
  const cart = await refreshCart();
  const inCart = cart?.lines.find((l) => l.type === "accessory" && l.sku === item.sku)?.quantity ?? 0;
  const qtyId = uid("qty");
  const quantity = h("input", { id: qtyId, type: "number", min: 1, max: 5, value: "1", inputmode: "numeric", "aria-describedby": `${qtyId}-help` });
  const alert = h("div", { role: "alert", class: "form-alert" });
  const add = h("button", { type: "submit", class: "pill", disabled: !item.in_stock }, "Add to cart");
  const close = h("button", { type: "button", class: "icon-button", "aria-label": "Close product" }, icon("cross", 22));
  const dialog = h("dialog", { class: "modal product-dialog", "aria-labelledby": `${qtyId}-title` },
    h("div", { class: "modal-head" }, h("h2", { id: `${qtyId}-title` }, item.name), close),
    h("p", { class: "from" }, `Price ${price(item.price_cents)}`),
    financingLine(item.as_low_as_cents),
    fitsLine(item) ? h("p", null, fitsLine(item)) : null,
    item.in_stock ? null : badge("Out of Stock"),
    h("form", { novalidate: true, class: "product-form" },
      h("div", { class: "field" }, h("label", { for: qtyId }, "Quantity"), h("p", { class: "hint", id: `${qtyId}-help` }, `(${inCart} in cart)`), quantity),
      add, alert));
  document.body.append(dialog);
  const opened = openDialog(dialog, opener, "dialog", () => dialog.remove());
  close.addEventListener("click", () => void opened.close());
  dialog.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    alert.textContent = "";
    const r = await busy(add, "Adding...", () => api<Cart>("POST", "/api/cart/lines", { type: "accessory", sku: item.sku, quantity: Number(quantity.value) }));
    if (!r.ok) {
      alert.textContent = r.error.message;
      return;
    }
    await opened.close();
    openCartDrawer(opener, item.name, r.data);
    announce(`Added ${item.name}. Cart has ${r.data.item_count} items.`);
  });
}

function productCard(item: Product): HTMLElement {
  const button = h("button", { type: "button", class: "card product-card" },
    h("span", { class: "product-name" }, item.name),
    h("span", { class: "product-price" }, `Price ${price(item.price_cents)}`),
    financingLine(item.as_low_as_cents),
    fitsLine(item) ? h("span", { class: "caption" }, fitsLine(item)) : null,
    item.in_stock ? null : badge("Out of Stock"));
  button.addEventListener("click", () => void openProduct(item, button));
  return button;
}

async function catalog(main: HTMLElement): Promise<Catalog | null> {
  const r = await api<Catalog>("GET", "/api/catalog");
  if (!r.ok) main.append(h("div", { class: "wrap" }, h("p", { role: "alert" }, r.error.message)));
  return r.ok ? r.data : null;
}

export async function foilBoards({ main }: PageContext): Promise<void> {
  document.title = "Foil boards | Tern Foils";
  main.append(pageHead("Foil boards", "Unpowered boards for prone, wing and towed riding."));
  const data = await catalog(main);
  if (!data) return;
  main.append(h("section", { class: "band" }, h("div", { class: "wrap product-grid" }, data.accessories.filter((a) => a.sku.startsWith("SFB-")).map(productCard))));
}

export async function parts({ main }: PageContext): Promise<void> {
  document.title = "Masts and wings | Tern Foils";
  main.append(pageHead("Masts and wings", "SnapFit masts and wings, sold on their own for the boards they fit."));
  const data = await catalog(main);
  if (!data) return;
  main.append(
    h("section", { class: "band", id: "masts" }, h("div", { class: "wrap" }, h("h2", null, "Masts"), h("div", { class: "product-grid" }, data.components.filter((c) => c.slot === "mast").map(productCard)))),
    h("section", { class: "band band-surface", id: "wings" }, h("div", { class: "wrap" }, h("h2", null, "Wings"), h("div", { class: "product-grid" }, data.components.filter((c) => c.slot === "wing").map(productCard)))),
  );
}
