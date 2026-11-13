import { el } from "../ui.ts";
import { get } from "../api.ts";
import { amount } from "../format.ts";

interface CompareResponse {
  category: string;
  products: Array<{ id: string; title: string; brand: string; rating: number; best_price_paise: number; specs: Record<string, string | number> }>;
  attributes: Array<{ name: string; values: Array<string | number | null>; differs: boolean }>;
}

export async function renderCompare(query: URLSearchParams): Promise<HTMLElement> {
  const ids = (query.get("ids") ?? "").split(",").filter(Boolean);
  const diffOn = query.get("diff") === "1";
  const main = el("main", {});

  if (ids.length < 2) {
    const panel = el("div", { class: "panel-pink" });
    panel.append(el("p", { text: "Pick at least 2 products." }));
    main.append(panel);
    return main;
  }

  let data: CompareResponse;
  try {
    data = await get<CompareResponse>(`/api/compare?ids=${ids.join(",")}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const panel = el("div", { class: "panel-pink" });
    panel.append(el("p", { text: message || "Compare products from one category." }));
    main.append(panel);
    return main;
  }

  main.append(el("h1", { text: "compare" }));

  const toggle = el("input", { type: "checkbox", role: "switch", id: "diff-switch" });
  toggle.checked = diffOn;
  const toggleLabel = el("label", { for: "diff-switch", style: "display:flex;align-items:center;gap:10px;margin:12px 0" });
  toggleLabel.append(toggle, el("span", { text: "Highlight differences" }));
  toggle.addEventListener("change", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("diff", toggle.checked ? "1" : "0");
    window.history.replaceState({}, "", url.toString());
    paintRows(toggle.checked);
  });
  main.append(toggleLabel);

  const wrap = el("div", { class: "table-wrap", style: "max-height:70vh;overflow:auto" });
  const table = el("table", { "aria-label": "Compare products" });
  const thead = el("thead", {});
  const headRow = el("tr", {});
  headRow.append(el("th", { text: "" }));
  for (const p of data.products) {
    headRow.append(el("th", { text: p.title }));
  }
  thead.append(headRow);
  const tbody = el("tbody", {});

  const baseRow = (label: string, cells: Array<string | number | null>, differs: boolean): void => {
    const row = el("tr", { class: differs ? "maybe-diff" : "" });
    row.dataset.differs = differs ? "1" : "0";
    row.append(el("th", { scope: "row", text: label }));
    cells.forEach((c) => row.append(el("td", { text: c === null ? "-" : String(c) })));
    tbody.append(row);
  };

  baseRow("brand", data.products.map((p) => p.brand), new Set(data.products.map((p) => p.brand)).size > 1);
  baseRow("rating", data.products.map((p) => p.rating.toFixed(1)), new Set(data.products.map((p) => p.rating)).size > 1);
  baseRow("best price", data.products.map((p) => amount(p.best_price_paise)), new Set(data.products.map((p) => p.best_price_paise)).size > 1);
  for (const attr of data.attributes) {
    baseRow(attr.name.replace(/_/g, " "), attr.values, attr.differs);
  }

  const removeRow = el("tr", {});
  removeRow.append(el("th", { text: "" }));
  for (const p of data.products) {
    const btn = el("button", { class: "btn btn-ghost", text: `Remove ${p.title}` });
    btn.addEventListener("click", () => {
      const remaining = ids.filter((id) => id !== p.id);
      window.history.replaceState({}, "", `/compare?ids=${remaining.join(",")}${diffOn ? "&diff=1" : ""}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    removeRow.append(el("td", {}, btn));
  }
  tbody.append(removeRow);

  function paintRows(diff: boolean): void {
    for (const row of Array.from(tbody.querySelectorAll("tr"))) {
      if (diff && row.dataset.differs === "1") row.classList.add("diff-row");
      else row.classList.remove("diff-row");
    }
  }

  table.append(thead, tbody);
  wrap.append(table);
  main.append(wrap);
  paintRows(diffOn);
  return main;
}
