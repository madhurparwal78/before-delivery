// "Holiday accrual": pending hours for the open period and the ledger.

import { api } from "../api.js";
import { el } from "../dom.js";
import { monthLabel } from "../format.js";

export async function render() {
  const payload = await api.get("/api/me/accrual");
  const body = el("tbody", {});
  for (const entry of payload.entries) {
    body.append(
      el(
        "tr",
        {},
        el("td", { dataset: { label: "Period" }, text: monthLabel(entry.period) }),
        el("td", { dataset: { label: "Kind" }, text: entry.kind }),
        el("td", { dataset: { label: "Worked hours" }, text: entry.worked_hours }),
        el("td", { dataset: { label: "Accrued hours" }, text: entry.accrued_hours })
      )
    );
  }
  const table = el(
    "table",
    { class: "cards", "aria-label": "Accrual ledger" },
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        el("th", { text: "Period" }),
        el("th", { text: "Kind" }),
        el("th", { text: "Worked hours" }),
        el("th", { text: "Accrued hours" })
      )
    ),
    body
  );
  return el(
    "div",
    {},
    el("h1", { text: "Holiday accrual" }),
    el(
      "section",
      { class: "panel", "aria-label": "Holiday accrual" },
      el("p", {
        text: `Pending this period: ${payload.open_period.pending_accrual_hours} hours from ${payload.open_period.worked_hours} worked`,
      }),
      el("p", { text: `Total accrued: ${payload.ledger_total_hours} hours` })
    ),
    el(
      "section",
      { class: "panel" },
      payload.entries.length ? table : el("p", { text: "No closed pay periods yet." })
    )
  );
}
