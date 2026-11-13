import { api, jsonFetch, mountOutageBanner, loadingEl, el, type Me } from "../lib/app.js";

interface ShopItem {
  id: string;
  kind: "striker" | "board" | "coins";
  name: string;
  price: number;
  owned: boolean;
  equipped: boolean;
}

interface ShopBody {
  chalk: number;
  items: ShopItem[];
}

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  root.appendChild(loadingEl());
  let me: Me | null = null;
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  api.invalidate();
  const res = await jsonFetch<ShopBody | { error: string }>("/api/shop");
  root.textContent = "";
  const page = el("div", { class: "page" });
  if (me !== null) {
    const bar = el("nav", { class: "top-bar" });
    bar.append(
      el("a", { href: `/profile/${encodeURIComponent(me.name)}` }, `${me.name} profile`),
      el("span", { class: "chip", id: "chalk-balance" }, ""),
      el("a", { href: "/leaderboard" }, "Leaderboard"),
      el("a", { href: "/" }, "Home")
    );
    page.appendChild(bar);
  }
  const h1 = el("h1", { class: "display", style: "font-size: 40px" }, "Shop");
  page.appendChild(h1);
  root.appendChild(page);

  if (res.status !== 200 || me === null) {
    page.appendChild(el("p", {}, "The shop is unavailable right now."));
    return;
  }
  renderShop(page, res.body as ShopBody, me);
}

function renderShop(page: HTMLElement, shop: ShopBody, me: Me): void {
  const chalkEl = document.getElementById("chalk-balance");
  if (chalkEl !== null) chalkEl.textContent = `${shop.chalk} chalk`;

  const tablist = el("div", { role: "tablist", "aria-label": "Item kinds" });
  const panels: Record<string, HTMLElement> = {};
  const kinds: { id: string; label: string }[] = [
    { id: "striker", label: "Strikers" },
    { id: "board", label: "Boards" },
    { id: "coins", label: "Coin sets" },
  ];
  let selected = 0;
  const tabs: HTMLElement[] = [];

  const panelHolder = el("div", {});
  page.append(tablist, panelHolder);

  kinds.forEach((kind, i) => {
    const tab = el("button", {
      role: "tab",
      id: `tab-${kind.id}`,
      "aria-selected": i === 0 ? "true" : "false",
      "aria-controls": `panel-${kind.id}`,
      tabindex: i === 0 ? "0" : "-1",
    }, kind.label);
    tablist.appendChild(tab);
    tabs.push(tab);
    const panel = el("div", {
      role: "tabpanel",
      id: `panel-${kind.id}`,
      "aria-labelledby": `tab-${kind.id}`,
    });
    if (i !== 0) panel.style.display = "none";
    panels[kind.id] = panel;
    panelHolder.appendChild(panel);
  });

  const select = (index: number, focus = false): void => {
    selected = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", i === index ? "true" : "false");
      tab.setAttribute("tabindex", i === index ? "0" : "-1");
    });
    kinds.forEach((kind, i) => {
      panels[kind.id].style.display = i === index ? "block" : "none";
    });
    if (focus) tabs[index].focus();
  };

  tablist.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      select(Math.min(kinds.length - 1, selected + 1), true);
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      select(Math.max(0, selected - 1), true);
    }
  });
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i));
  });

  const idempotencyKey = `buy-${me.id}-${Date.now()}`;

  for (const kind of kinds) {
    const panel = panels[kind.id];
    const grid = el("div", { class: "shop-grid" });
    for (const item of shop.items.filter((i) => i.kind === kind.id)) {
      const card = el("article", { "aria-label": item.name });
      card.appendChild(el("h2", { class: "item-name" }, item.name));
      const swatch = el("div", { class: "swatch", "data-item": item.id });
      card.appendChild(swatch);
      card.appendChild(el("p", { class: "price" }, `${item.price} chalk`));
      if (item.owned) {
        if (item.equipped) {
          const equipped = el("button", { class: "btn", "aria-pressed": "true" }, "Equipped");
          equipped.disabled = true;
          card.appendChild(equipped);
        } else {
          const equip = el("button", { class: "btn" }, `Equip ${item.name}`);
          equip.addEventListener("click", async () => {
            equip.disabled = true;
            const res = await jsonFetch("/api/shop/equip", {
              method: "POST",
              body: JSON.stringify({ itemId: item.id }),
            });
            if (res.status === 200) {
              window.location.reload();
              return;
            }
            equip.disabled = false;
          });
          card.appendChild(equip);
        }
      } else {
        const buy = el("button", { class: "btn btn-primary" }, `Buy ${item.name}`);
        if (shop.chalk < item.price) {
          buy.disabled = true;
          buy.textContent = `Need ${item.price - shop.chalk} more`;
        }
        buy.addEventListener("click", async () => {
          buy.disabled = true;
          const res = await jsonFetch<{ chalk: number } | { error: string; needed?: number }>(
            "/api/shop/purchase",
            {
              method: "POST",
              body: JSON.stringify({ itemId: item.id, idempotencyKey: `${idempotencyKey}-${item.id}` }),
            }
          );
          if (res.status === 200) {
            window.location.reload();
            return;
          }
          buy.disabled = false;
          const body = res.body as { error: string; needed?: number };
          if (body.error === "INSUFFICIENT_CHALK" && body.needed !== undefined) {
            buy.textContent = `Need ${body.needed} more`;
            buy.disabled = true;
          } else {
            const note = el("div", { role: "alert", class: "error-alert" }, "Purchase failed. No chalk was taken.");
            card.appendChild(note);
          }
        });
        card.appendChild(buy);
      }
      grid.appendChild(card);
    }
    panel.appendChild(grid);
  }

  // Drawn swatches for each kind.
  for (const kind of kinds) {
    for (const item of shop.items.filter((i) => i.kind === kind.id)) {
      const swatch = document.querySelector<HTMLElement>(`.swatch[data-item="${item.id}"]`);
      if (swatch === null) continue;
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 120 60");
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "60");
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("width", "120");
      rect.setAttribute("height", "60");
      const fill = swatchFill(item.id);
      rect.setAttribute("fill", fill);
      svg.appendChild(rect);
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", "60");
      circle.setAttribute("cy", "30");
      circle.setAttribute("r", "18");
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", swatchRing(item.id));
      circle.setAttribute("stroke-width", "6");
      svg.appendChild(circle);
      swatch.appendChild(svg);
    }
  }
}

function swatchFill(id: string): string {
  const fills: Record<string, string> = {
    "striker-ply": "#f7f2e6",
    "striker-tomato": "#e04a24",
    "striker-cobalt": "#1e3fd8",
    "striker-brass": "#b08d3c",
    "board-ply": "#d8a35c",
    "board-chalk": "#e8e2d0",
    "board-walnut": "#5a3a22",
    "coins-ivory": "#f5f2ea",
    "coins-shell": "#efe0cd",
  };
  return fills[id] ?? "#fff";
}

function swatchRing(id: string): string {
  const rings: Record<string, string> = {
    "striker-ply": "#14100c",
    "striker-tomato": "#14100c",
    "striker-cobalt": "#14100c",
    "striker-brass": "#14100c",
    "board-ply": "#14100c",
    "board-chalk": "#14100c",
    "board-walnut": "#e8d9b8",
    "coins-ivory": "#14100c",
    "coins-shell": "#14100c",
  };
  return rings[id] ?? "#14100c";
}

void main();
