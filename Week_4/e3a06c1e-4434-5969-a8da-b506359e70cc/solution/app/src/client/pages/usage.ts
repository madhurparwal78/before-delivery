// Usage for the current UTC month: billable minutes and cost per project, Confirmed or Pending.
import type { Usage } from "../../shared/types";
import { dollarsText, minutesText } from "../../shared/billing";
import { api, GENERIC_FAILURE, setOutage } from "../api";
import { cardTable, h, replace, say } from "../dom";
import { usageMonth } from "../format";
import type { Page } from "../main";

export function renderUsage(page: Page): void {
  const month = h("p", { class: "muted" }, "Current UTC month");
  const body = h("tbody", {}, ...[0, 1].map(() => h("tr", { class: "skeleton" }, h("td", { colspan: 5 }, h("span", { class: "bar" })))));
  const table = h(
    "table",
    { class: "data cards", "aria-label": "Usage by project" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col" }, "Project"),
        h("th", { scope: "col", class: "right" }, "Sessions"),
        h("th", { scope: "col", class: "right" }, "Billable minutes"),
        h("th", { scope: "col", class: "right" }, "Cost"),
        h("th", { scope: "col" }, "Status"),
      ),
    ),
    body,
  );
  const totalMonth = h("p", { class: "muted" });
  const total = h("p", { class: "num total" }, "—");
  const totalRegion = h("section", { "aria-label": "Organisation total", class: "total-card" }, h("h2", {}, "Organisation total"), totalMonth, total);
  page.root.append(
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Usage"), month)),
    h("div", { class: "usage-layout" }, h("div", { class: "table-wrap", tabindex: 0 }, table), totalRegion),
    h("p", { class: "hint" }, "Each figure counts closed billable sessions that ended this UTC month. Cost rounds up to a whole cent once per plan."),
  );
  const rows = new Map<string, HTMLTableCellElement[]>();

  const load = async () => {
    const found = await api<Usage>("GET", "/api/usage");
    if (!page.current()) return;
    if (!found.ok) {
      if (rows.size === 0) replace(body, h("tr", {}, h("td", { colspan: 5 }, GENERIC_FAILURE)));
      return;
    }
    const usage = found.data;
    setOutage("billing", !usage.billing_reachable);
    const label = usageMonth(usage.month);
    say(month, `${label}, UTC`);
    say(totalMonth, label);
    say(total, dollarsText(usage.org_total_cents));
    if (rows.size === 0) body.replaceChildren();
    for (const p of usage.projects) {
      let cells = rows.get(p.project_id);
      if (!cells) {
        cells = [h("th", { scope: "row" }), h("td", { class: "num right" }), h("td", { class: "num right" }), h("td", { class: "num right" }), h("td")] as HTMLTableCellElement[];
        body.append(h("tr", {}, ...cells));
        rows.set(p.project_id, cells);
      }
      const [name, sessions, minutes, cost, status] = cells;
      say(name, p.name);
      say(sessions, String(p.sessions));
      say(minutes, minutesText(p.billable_seconds));
      say(cost, dollarsText(p.cost_cents));
      const badge = p.billing_state === "confirmed" ? "Confirmed" : "Pending";
      if (status.textContent !== badge) replace(status, h("span", { class: `badge ${p.billing_state === "confirmed" ? "accent" : "caution"}` }, badge));
    }
    cardTable(table);
  };
  void load();
  const poll = setInterval(() => void load(), 2000);
  page.onLeave(() => clearInterval(poll));
}
