import { PageCtx } from "../main";
import { h, clearEl } from "../ui";
import { api, AuditEntry } from "../api";
import { emptyIllustration } from "../illustrations";

export async function renderAuditPage(ctx: PageCtx): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  const container = h("div", { class: "container", style: "padding-bottom:60px" });
  container.appendChild(h("div", { class: "page-head" },
    h("div", null, h("h1", {}, "Audit log"), h("p", { class: "sub" }, "Every state change, newest first.")),
    h("a", { class: "btn btn-outline", href: "/api/audit.csv", download: "audit.csv", "data-download": "" }, "Download CSV"),
  ));

  const holder = h("div", { class: "card", style: "margin-top:20px" });
  container.appendChild(holder);
  main.appendChild(container);

  try {
    const res = await api<{ entries: AuditEntry[] }>("/api/audit");
    if (res.entries.length === 0) {
      const empty = h("div", { class: "empty", style: "border:none;padding:30px" });
      empty.innerHTML = emptyIllustration();
      empty.appendChild(h("h3", {}, "Nothing in the audit log yet"));
      holder.appendChild(empty);
      return;
    }
    const table = h("table", { class: "plain", "aria-label": "Audit log" });
    table.appendChild(h("thead", null, h("tr", null, h("th", null, "Time"), h("th", null, "Actor"), h("th", null, "Action"), h("th", null, "Project"), h("th", null, "Detail"))));
    const tbody = h("tbody");
    for (const e of res.entries) {
      tbody.appendChild(h("tr", null,
        h("td", { class: "num" }, new Date(e.at).toLocaleString()),
        h("td", null, e.actor),
        h("td", null, e.action),
        h("td", null, e.project || "—"),
        h("td", { class: "muted" }, e.detail || "—"),
      ));
    }
    table.appendChild(tbody);
    const wrap = h("div", { class: "table-wrap" });
    wrap.appendChild(table);
    holder.appendChild(wrap);
  } catch (e: any) {
    holder.appendChild(h("p", { class: "muted" }, "The desk couldn't reach the server. Check your connection and try again."));
    ctx.fb.setProblem(e.message);
  }
  void clearEl;
}
