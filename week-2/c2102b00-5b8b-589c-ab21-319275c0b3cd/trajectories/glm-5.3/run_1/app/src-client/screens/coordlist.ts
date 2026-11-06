import { api, CycleSummary, Me } from "../api.js";
import { clear, el } from "../util.js";
import { navigate } from "../app.js";

/** Coordinator cycles table plus the new-cycle button. */
export async function renderCoordinatorList(page: HTMLElement, me: Me): Promise<void> {
  void me;
  const notices = el("div", { class: "notices", role: "region", "aria-label": "Notices" });
  const tableWrap = el("div");
  const newBtn = el("button", { text: "New cycle" });
  newBtn.addEventListener("click", () => navigate("/coordinator/cycles/new"));
  page.append(el("h1", { text: "Cycles" }), notices, tableWrap, el("div", { class: "actions" }, newBtn));

  const draw = (cycles: CycleSummary[]) => {
    clear(tableWrap);
    const table = el("table", { class: "data", "aria-label": "Cycles" });
    table.append(
      el("thead", {}, el("tr", {}, el("th", { text: "NAME" }), el("th", { text: "STATUS" }), el("th", { text: "CUTOFF" })))
    );
    const tbody = el("tbody");
    for (const c of cycles) {
      tbody.append(
        el("tr", {},
          el("td", {}, el("a", { href: `/coordinator/cycles/${c.id}`, "data-nav": true, text: c.name })),
          el("td", { text: c.status }),
          el("td", { text: c.cutoff_display ?? "" })
        )
      );
    }
    table.append(tbody);
    tableWrap.append(table);
  };

  const load = async () => {
    const { data } = await api<{ cycles: CycleSummary[] }>("/api/cycles");
    draw(data.cycles);
  };
  await load();
  const timer = setInterval(() => {
    if (!document.body.contains(tableWrap)) {
      clearInterval(timer);
      return;
    }
    void load();
  }, 10000);
}
