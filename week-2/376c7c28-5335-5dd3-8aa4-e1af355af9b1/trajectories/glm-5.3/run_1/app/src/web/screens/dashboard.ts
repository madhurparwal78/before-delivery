import { api, type Dashboard } from "../api";
import { h, clear, dollars, screen as appScreen, registerRefresh } from "../helpers";

export function renderDashboard(root: HTMLElement): void {
  const backlogRegion = h("section", { class: "panel", "aria-label": "Backlog" });
  const pendingRegion = h("section", { class: "panel", "aria-label": "Pending charges", role: "group" });
  const revenueRegion = h("section", { class: "panel", "aria-label": "Month revenue", role: "group" });
  const longestBody = h("tbody");
  const longestTable = h("table", { class: "table", "aria-label": "Longest waiting" },
    h("thead", null, h("tr", null, h("th", { class: "cell", text: "Piece" }), h("th", { class: "cell", text: "Owner" }), h("th", { class: "cell", text: "Days waiting" }))),
    longestBody);
  const grid = h("div", { class: "dashboard-grid" }, backlogRegion, h("section", { class: "panel" }, h("div", { class: "caption", text: "LONGEST WAITING" }), longestTable), pendingRegion, revenueRegion);
  root.appendChild(appScreen(grid));
  void load();

  async function load(): Promise<void> {
    try {
      const data = await api<Dashboard>("/api/dashboard");
      const names: [string, string][] = [
        ["logged", "Logged"],
        ["waiting_bisque", "Waiting for bisque"],
        ["bisqued", "Bisqued"],
        ["waiting_glaze", "Waiting for glaze"],
        ["ready_for_pickup", "Ready for pickup"],
      ];
      clear(backlogRegion);
      backlogRegion.appendChild(h("div", { class: "caption", text: "BACKLOG" }));
      const tiles = h("div", { class: "tile-row" });
      for (const [key, label] of names) {
        tiles.appendChild(h("div", { class: "tile", role: "group", "aria-label": label }, h("div", { class: "caption", text: label.toUpperCase() }), h("div", { class: "fig big", text: String(data.counts[key as keyof typeof data.counts]) })));
      }
      backlogRegion.appendChild(tiles);
      clear(pendingRegion);
      pendingRegion.append(h("div", { class: "caption", text: "PENDING CHARGES" }), h("div", { class: "fig big", text: `PENDING CHARGES ${data.pending_charges}` }));
      clear(revenueRegion);
      revenueRegion.append(h("div", { class: "caption", text: "MONTH REVENUE" }), h("div", { class: "fig big", text: `MONTH REVENUE ${dollars(data.month_revenue_cents)}` }));
      clear(longestBody);
      for (const piece of data.longest_waiting) {
        longestBody.appendChild(h("tr", null,
          h("td", { class: "cell", text: piece.title }),
          h("td", { class: "cell", text: piece.owner_handle }),
          h("td", { class: "cell mono", text: `${piece.days_waiting} days` })));
      }
    } catch {
      /* the next live update will refill */
    }
  }

  registerRefresh(() => void load());
}
