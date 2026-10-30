import type { LedgerView } from "../../shared/api.js";
import { LEDGER_KIND_WORD } from "../../shared/copy.js";
import { formatMoney } from "../../shared/money.js";
import { get, messageOf } from "../api.js";
import { emptyState, h, loadingLine } from "../dom.js";
import { localTime } from "../session.js";

export function ledgerView(root: HTMLElement): () => void {
  let active = true;
  const held = h("p", { class: "ledger__held" }, loadingLine());
  const body = h("div", { class: "ledger__table-wrap" });
  root.append(
    h("div", { class: "page-head" }, h("h1", null, "Deposit ledger"), held),
    h("section", { class: "box ledger", "aria-label": "Ledger entries" }, body),
  );

  void (async () => {
    try {
      const view = await get<LedgerView>("/api/ledger");
      if (!active) return;
      held.replaceChildren(h("span", { class: "label" }, "Deposits held now:"), " ", h("span", { class: "money ledger__figure" }, formatMoney(view.deposits_held_cents)));
      if (!view.entries.length) {
        body.replaceChildren(emptyState("No ledger entries yet"));
        return;
      }
      body.replaceChildren(
        h(
          "table",
          { class: "table", "aria-label": "Deposit ledger" },
          h(
            "thead",
            null,
            h("tr", null, ["Loan", "Item", "Kind", "Amount", "Recorded"].map((name) => h("th", { scope: "col", class: name === "Amount" ? "num" : null }, name))),
          ),
          h(
            "tbody",
            null,
            view.entries.map((entry) =>
              h(
                "tr",
                null,
                h("td", { "data-label": "Loan" }, h("a", { href: `/loans/${entry.loan_id}`, class: "table__link mono" }, entry.loan_id.slice(0, 8))),
                h("td", { "data-label": "Item" }, entry.item.name),
                h("td", { "data-label": "Kind" }, LEDGER_KIND_WORD[entry.kind]),
                h("td", { class: "num money", "data-label": "Amount" }, formatMoney(entry.amount_cents)),
                h("td", { class: "mono", "data-label": "Recorded" }, localTime(entry.created_at)),
              ),
            ),
          ),
        ),
      );
    } catch (error) {
      if (active) body.replaceChildren(h("p", { class: "result" }, messageOf(error)));
    }
  })();

  return () => {
    active = false;
  };
}
