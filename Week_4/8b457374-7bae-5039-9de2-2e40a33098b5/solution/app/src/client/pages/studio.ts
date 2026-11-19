import type { CampaignRow } from "../../shared/api.js";
import { api, heldKey } from "../api.js";
import { h } from "../dom.js";
import { emptyState, loading, statusChip } from "../marks.js";
import { title, type Page } from "../page.js";
import { campaignListItem } from "./home.js";
import { startCampaign } from "./identity.js";

// The Studio, the creator's home (brief: Screens and layout › Studio).

const EMPTY = "No campaigns yet. Start one when your printer quotes a minimum run.";

export const studioPage: Page = (main) => {
  title("Studio");
  const create = h("button", { type: "button", class: "btn" }, "New campaign");
  create.addEventListener("click", () => startCampaign(create));
  const area = h("div", { class: "list-area" });
  main.append(h("section", { class: "page narrow" },
    h("div", { class: "page-head" }, h("h1", {}, "Studio"), create),
    area));
  if (!heldKey()) {
    area.append(emptyState(EMPTY));
    return;
  }
  area.append(loading());
  void api<CampaignRow[]>("GET", "/api/me/campaigns").then((found) => {
    const rows = found.ok ? found.data : [];
    area.replaceChildren(rows.length
      ? h("ul", { class: "campaign-list", "aria-label": "Your campaigns" },
        ...rows.map((row) => campaignListItem(row, `/studio/campaigns/${row.id}`, statusChip(row.status))))
      : emptyState(EMPTY));
  });
};
