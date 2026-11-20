// Pay periods: months with their closed or open state and a Close button.

import { OFFLINE, api } from "../api.js";
import { clear, el, say, statusRegion } from "../dom.js";
import { formatDate, monthLabel } from "../format.js";

export async function render() {
  const status = statusRegion("Admin status");
  const body = el("tbody", {});

  async function load() {
    const payload = await api.get("/api/pay-periods");
    clear(body);
    for (const item of payload.items) {
      const label = monthLabel(item.period);
      body.append(
        el(
          "tr",
          {},
          el("td", { dataset: { label: "Month" }, text: label }),
          el("td", {
            dataset: { label: "State" },
            text: item.closed_at ? `Closed ${formatDate(item.closed_at.slice(0, 10))}` : "Open",
          }),
          el(
            "td",
            { dataset: { label: "Close" } },
            item.closed_at
              ? null
              : el("button", {
                  type: "button",
                  text: `Close ${label}`,
                  onclick: async () => {
                    say(status, `Closing ${label}…`);
                    try {
                      const closed = await api.post(`/api/pay-periods/${item.period}/close`, {});
                      say(status, `${label} closed. ${closed.entries.length} ledger entries added.`);
                      await load();
                    } catch (error) {
                      say(status, error.status === 0 ? OFFLINE : error.message);
                    }
                  },
                })
          )
        )
      );
    }
  }

  await load();
  return el(
    "div",
    {},
    el("h1", { text: "Pay periods" }),
    el(
      "section",
      { class: "panel" },
      status,
      el(
        "table",
        { class: "cards", "aria-label": "Pay periods" },
        el(
          "thead",
          {},
          el("tr", {}, ["Month", "State", "Close"].map((name) => el("th", { text: name })))
        ),
        body
      )
    )
  );
}
