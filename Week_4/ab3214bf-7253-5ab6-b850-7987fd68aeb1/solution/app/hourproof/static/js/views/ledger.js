// The watt-hour ledger of a window: balances beside the paired entries, 200 to a page.
import { h, commas, link, loadingFigure } from "../dom.js";
import { get, ApiError } from "../api.js";
import { poll } from "../poll.js";
import { table, row } from "../table.js";

export function mount({ container, params }) {
  const [id] = params;
  let page = 1;
  let ledgerPage = null;
  const balances = h("section", { role: "region", "aria-label": "Balances", class: "balances" });
  const grid = table("Ledger entries", ["Label", "Kind", "Account", "Watt-hours", "At", "Movement"], "1.8fr .9fr .9fr 1.2fr 1.5fr 1.2fr");
  const empty = h("p", { class: "figure", hidden: true, text: "NO MOVEMENTS YET." });
  const previous = h("button", { type: "button", text: "Previous page" });
  const next = h("button", { type: "button", text: "Next page" });
  const failure = h("p", { class: "figure", hidden: true, text: "THAT PAGE DOES NOT EXIST." });
  const loading = loadingFigure();
  const content = h("div", { class: "split", hidden: true }, balances, h("div", { class: "entries" }, grid.el, empty,
    h("div", { class: "row" }, previous, next)));
  container.replaceChildren(h("section", { class: "page field-white" },
    h("h1", { text: "EVERY WATT-HOUR, ACCOUNTED." }), link(`/windows/${id}`, "Back to the window"), loading, content, failure));

  const draw = () => {
    const { balances: b, opening_wh: opening, entries, page_count: pages } = ledgerPage;
    balances.replaceChildren(h("h2", { text: "BALANCES" }), h("dl", {},
      ...[["Opening", opening], ["Holdings", b.holdings_wh], ["Allocated", b.allocated_wh], ["Cancelled", b.cancelled_wh], ["Loss", b.loss_wh]]
        .map(([name, value]) => h("div", { class: "fact" }, h("dt", { text: name }), h("dd", { class: "figure small nowrap", text: commas(value) }, h("span", { class: "unit", text: " Wh" }))))));
    grid.body.replaceChildren(...entries.map((e) => row([
      ["Label", e.label], ["Kind", e.kind], ["Account", e.account], ["Watt-hours", h("span", { class: "nowrap", text: commas(e.wh) })],
      ["At", h("span", { class: "nowrap", text: e.at })], ["Movement", h("span", { class: "muted", text: e.movement_id })]])));
    empty.hidden = entries.length > 0;
    grid.el.hidden = entries.length === 0;
    loading.remove();
    content.hidden = false;
    previous.setAttribute("aria-disabled", String(ledgerPage.page <= 1));
    next.setAttribute("aria-disabled", String(ledgerPage.page >= pages));
  };
  let last = "";
  const refresh = async () => {
    try {
      ledgerPage = await get(`/api/windows/${id}/ledger?page=${page}`, { background: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) { container.replaceChildren(failure); failure.hidden = false; return; }
      throw error;
    }
    const serial = JSON.stringify(ledgerPage);
    if (serial !== last) { last = serial; draw(); }
  };
  previous.addEventListener("click", () => { if (previous.getAttribute("aria-disabled") !== "true") { page -= 1; refresh(); } });
  next.addEventListener("click", () => { if (next.getAttribute("aria-disabled") !== "true") { page += 1; refresh(); } });
  refresh();
  const loop = poll(refresh, 3000);
  return { unmount() { loop.stop(); } };
}
