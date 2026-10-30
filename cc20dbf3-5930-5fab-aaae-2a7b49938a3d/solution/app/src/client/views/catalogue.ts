import type { Item, Lanes, SpanStatus } from "../../shared/api.js";
import { formatMoney } from "../../shared/money.js";
import { get, messageOf } from "../api.js";
import { h, label, loadingLine } from "../dom.js";
import { freeChip, spanChip } from "../status.js";

/** Each unit's state today, from its lane. */
function todayPreview(lanes: Lanes): HTMLUListElement {
  return h(
    "ul",
    { class: "unit-preview", "aria-label": "Units today" },
    lanes.lanes.map((lane) => {
      const span = lane.spans.find((s) => s.start_date <= lanes.from && lanes.from <= s.end_date);
      const status: SpanStatus | null = span ? span.status : null;
      return h("li", { class: "unit-preview__unit" }, h("span", { class: "unit-preview__label" }, lane.label), status ? spanChip(status) : freeChip());
    }),
  );
}

function card(item: Item, lanes: Lanes): HTMLElement {
  const titleId = `item-${item.id}`;
  return h(
    "article",
    { class: "card box", "aria-labelledby": titleId },
    h("p", { class: "label card__category" }, item.category),
    h("h2", { class: "card__title" }, h("a", { id: titleId, href: `/items/${item.id}`, class: "card__link" }, item.name)),
    h(
      "p",
      { class: "card__free" },
      h("span", { class: `card__count${item.units_free_today > 0 ? " is-free" : ""}` }, String(item.units_free_today)),
      ` of ${item.unit_count} free today`,
    ),
    h(
      "p",
      { class: "money-line" },
      item.deposit_cents > 0 ? [label("Deposit"), " ", h("span", { class: "money" }, formatMoney(item.deposit_cents))] : label("No deposit"),
    ),
    h("p", { class: "money-line" }, label("Replacement"), " ", h("span", { class: "money" }, formatMoney(item.replacement_cents))),
    todayPreview(lanes),
  );
}

export function catalogueView(root: HTMLElement): () => void {
  let active = true;
  const grid = h("div", { class: "cards" }, loadingLine());
  const summary = h("p", { class: "page-head__lede" }, "Tools to borrow, with the units free today.");
  root.append(h("div", { class: "page-head" }, h("h1", null, "Catalogue"), summary), grid);

  void (async () => {
    try {
      const { items } = await get<{ items: Item[] }>("/api/items");
      if (!active) return;
      const free = items.reduce((sum, item) => sum + item.units_free_today, 0);
      const total = items.reduce((sum, item) => sum + item.unit_count, 0);
      summary.textContent = `${items.length} items · ${free} of ${total} units free today`;
      const lanes = await Promise.all(items.map((item) => get<Lanes>(`/api/items/${item.id}/lanes`)));
      if (!active) return;
      grid.replaceChildren(...items.flatMap((item, i) => (lanes[i] ? [card(item, lanes[i])] : [])));
    } catch (error) {
      if (active) grid.replaceChildren(h("p", { class: "result" }, messageOf(error)));
    }
  })();

  return () => {
    active = false;
  };
}
