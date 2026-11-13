import type { Content } from "../../shared/content.js";
import { editionLine, packHeading, priceLine } from "../../shared/format.js";
import { ONLINE_STORE } from "../copy.js";
import { h } from "../dom.js";
import { icon } from "../icons.js";

/** The online store: each stored pack with its price, each stored store, and the edition. */
export function renderStore({ product, edition }: Content): HTMLElement {
  return h("div", { class: "page store-page" },
    h("h1", { tabindex: "-1" }, ONLINE_STORE),
    h("div", { class: "store-packs" }, ...product.packs.map((pack) =>
      h("div", { class: "store-pack" }, h("p", { class: "pack-name" }, packHeading(product, pack)), h("p", { class: "pack-price" }, priceLine(pack))))),
    h("h2", {}, "Where to buy"),
    h("ul", { class: "store-links" }, ...product.stores.map((store) =>
      h("li", {}, h("a", { class: "button button-quiet", href: store.url, target: "_blank", rel: "noopener noreferrer" },
        `Buy at ${store.name} (opens in a new tab)`, icon("arrow"))))),
    h("p", { class: "edition" }, editionLine(edition)));
}
