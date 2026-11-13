import { ApiFail, get, post } from "../api";
import { app, loadMe, onOutage, pageStatus } from "../app";
import { h } from "../dom";
import { swatch } from "../match/art";
import type { Mount } from "../router";
import { topBar } from "../ui/shell";

interface Item {
  id: string;
  kind: "striker" | "board" | "coins";
  name: string;
  price: number;
  owned: boolean;
  equipped: boolean;
}

const KINDS: { kind: Item["kind"]; label: string }[] = [
  { kind: "striker", label: "Strikers" },
  { kind: "board", label: "Boards" },
  { kind: "coins", label: "Coin sets" },
];

const shop: Mount = async ({ root }) => {
  let data = await get<{ chalk: number; items: Item[] }>("/api/shop").catch(() => ({ chalk: app.me?.chalk ?? 0, items: [] as Item[] }));
  let selected = 0;
  const keys = new Map<string, string>();
  const failure = h("p", { class: "field-error-text", role: "alert" });
  const tabs = KINDS.map(({ label }, index) =>
    h("button", { type: "button", role: "tab", id: `tab-${index}`, "aria-controls": `panel-${index}`, class: "tab" }, label),
  );
  const panels = KINDS.map((_, index) => h("div", { role: "tabpanel", id: `panel-${index}`, "aria-labelledby": `tab-${index}`, class: "tile-grid" }));
  const tablist = h("div", { role: "tablist", "aria-label": "Item kinds", class: "tabs" }, ...tabs);

  const select = (index: number, focus: boolean): void => {
    selected = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      (panels[i] as HTMLElement).hidden = i !== index;
    });
    if (focus) (tabs[index] as HTMLElement).focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index, false));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
      if (target >= 0) {
        event.preventDefault();
        select(target, true);
      }
    });
  });

  const balance = (): void => {
    const chalk = document.getElementById("chalk-balance");
    if (chalk) chalk.textContent = `${data.chalk} chalk`;
  };

  const act = async (item: Item, button: HTMLButtonElement, run: () => Promise<void>, done: string): Promise<void> => {
    button.disabled = true;
    failure.textContent = "";
    try {
      await run();
      data = await get<{ chalk: number; items: Item[] }>("/api/shop");
      await loadMe();
      render();
      balance();
      pageStatus(done);
      panels[selected]?.querySelector<HTMLElement>(`[data-item="${item.id}"] button`)?.focus();
    } catch (error) {
      button.disabled = false;
      failure.textContent = error instanceof ApiFail && error.code === "INSUFFICIENT_CHALK" ? "Not enough chalk." : "Purchase failed. No chalk was taken.";
    }
  };

  const tile = (item: Item): HTMLElement => {
    const missing = item.price - data.chalk;
    const button = item.equipped
      ? h("button", { type: "button", class: "btn btn-ink", "aria-pressed": "true" }, "Equipped")
      : item.owned
        ? h("button", { type: "button", class: "btn", "aria-label": `Equip ${item.name}` }, "Equip")
        : h("button", { type: "button", class: "btn btn-ink", "aria-label": missing > 0 ? `Buy ${item.name}, need ${missing} more` : `Buy ${item.name}` }, missing > 0 ? `Need ${missing} more` : "Buy");
    if (item.equipped) button.disabled = false;
    else if (item.owned) {
      button.addEventListener("click", () =>
        void act(item, button, async () => void (await post("/api/shop/equip", { itemId: item.id })), `Equipped ${item.name}.`),
      );
    } else {
      button.disabled = missing > 0 || app.outage;
      button.addEventListener("click", () => {
        const key = keys.get(item.id) ?? crypto.randomUUID();
        keys.set(item.id, key);
        void act(item, button, async () => void (await post("/api/shop/purchase", { itemId: item.id, idempotencyKey: key })), `Bought ${item.name}.`);
      });
    }
    return h(
      "article",
      { class: "tile", "aria-label": item.name, "data-item": item.id },
      h("div", { class: "tile-art" }, swatch(item.kind, item.id)),
      h("h3", { class: "tile-name" }, item.name),
      h("p", { class: "tile-price" }, `${item.price} chalk`),
      button,
    );
  };

  const render = (): void => {
    KINDS.forEach(({ kind }, index) => {
      (panels[index] as HTMLElement).replaceChildren(...data.items.filter((i) => i.kind === kind).map(tile));
    });
  };

  render();
  select(0, false);
  root.replaceChildren(
    h("div", { class: "working" }, topBar(true), h("div", { class: "working-body" }, h("h1", { class: "page-title", tabindex: -1 }, "Shop"), tablist, ...panels, failure)),
  );
  balance();
  return onOutage(() => render());
};

export default shop;
