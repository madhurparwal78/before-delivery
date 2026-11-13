import { el, busy } from "../ui.ts";
import { get, put, ApiFailure } from "../api.ts";
import { amount } from "../format.ts";
import { state, navigate, signinLink } from "../app.ts";

export async function renderSellerStock(): Promise<HTMLElement> {
  const main = el("main", {});
  if (!state.account || state.account.role !== "seller") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "sign in to your seller console." })));
    return main;
  }
  main.append(el("h1", { text: "low stock" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Save status" });
  const res = await get<{ listings: Array<{ listing_id: string; title: string; stock: number }> }>("/api/seller/low-stock");
  const wrap = el("div", { class: "table-wrap" });
  const table = el("table", { "aria-label": "Low stock" });
  const thead = el("thead", {});
  const headRow = el("tr", {});
  for (const h of ["Title", "Stock", ""]) headRow.append(el("th", { text: h }));
  thead.append(headRow);
  const tbody = el("tbody", {});
  for (const listing of res.listings) {
    const row = el("tr", {});
    row.append(el("td", { text: listing.title }), el("td", { text: String(listing.stock) }));
    const cell = el("td", {});
    const input = el("input", { type: "number", min: "0", max: "9999", value: String(listing.stock), "aria-label": `Stock for ${listing.title}` });
    const saveBtn = el("button", { class: "btn btn-primary", text: `Save stock for ${listing.title}` });
    saveBtn.addEventListener("click", () => {
      void busy(saveBtn, async () => {
        try {
          await put(`/api/seller/listings/${listing.listing_id}/stock`, { stock: Number(input.value) });
          status.textContent = `Stock saved: ${listing.title}, ${input.value} units.`;
        } catch (err) {
          if (err instanceof ApiFailure) status.textContent = `Not saved: ${err.message}`;
        }
      });
    });
    cell.append(input, saveBtn);
    row.append(cell);
    tbody.append(row);
  }
  if (res.listings.length === 0) {
    const empty = el("tr", {});
    empty.append(el("td", { colspan: "3", text: "nothing below 6 units. the shelf is full." }));
    tbody.append(empty);
  }
  table.append(thead, tbody);
  wrap.append(table);
  main.append(status, wrap);
  void amount;
  return main;
}
