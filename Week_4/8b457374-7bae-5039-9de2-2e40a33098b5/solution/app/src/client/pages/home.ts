import type { CampaignRow } from "../../shared/api.js";
import { api } from "../api.js";
import { h } from "../dom.js";
import { drawDisc } from "../hero.js";
import { emptyState, loading } from "../marks.js";
import { cover, money, title, type Page } from "../page.js";
import { PlateFill } from "../platefill.js";
import { startCampaign } from "./identity.js";

// Home (brief: Screens and layout › Home; DP-56): the halftone hero, then the live campaigns.

export function campaignListItem(row: CampaignRow, href: string, extra: Node | null = null): HTMLLIElement {
  const gauge = new PlateFill(row.goal, [], row.total, row.percent, "");
  gauge.el.classList.add("plate-fill-mini");
  return h("li", { class: "campaign-row" },
    cover(row.cover_media_id ? `/api/media/${row.cover_media_id}` : null, "", "small"),
    h("div", { class: "row-main" },
      h("a", { href, class: "row-title" }, row.title),
      extra,
      h("p", { class: "row-total figure" }, money(row.total))),
    gauge.el);
}

export const homePage: Page = (main, _param, onLeave) => {
  title("Print it if they back it");
  const start = h("a", { href: "/studio/campaigns/new", class: "btn btn-hero" }, "Start a campaign");
  start.addEventListener("click", (event) => {
    event.preventDefault();
    startCampaign(start);
  });
  const hero = h("section", { class: "hero", "aria-labelledby": "hero-title" },
    h("div", { class: "hero-copy" },
      h("h1", { id: "hero-title", class: "hero-title" }, h("span", {}, "PRINT IT IF"), " ", h("span", {}, "THEY BACK IT")),
      h("p", { class: "hero-sentence" }, "All-or-nothing pledges for comics, zines and art books. No card is charged unless the print run is funded."),
      start));
  const listArea = h("div", { class: "list-area" }, loading());
  main.append(hero, h("section", { class: "home-list", id: "live", "aria-labelledby": "live-title" },
    h("h2", { id: "live-title" }, "Live campaigns"), listArea));
  drawDisc(hero);
  const redraw = () => drawDisc(hero);
  addEventListener("resize", redraw);
  onLeave(() => removeEventListener("resize", redraw));
  if (location.hash === "#live") document.getElementById("live")?.scrollIntoView({ behavior: "instant" });

  void api<CampaignRow[]>("GET", "/api/campaigns").then((found) => {
    const live = found.ok ? found.data.filter((c) => c.status === "live") : [];
    listArea.replaceChildren(live.length
      ? h("ul", { class: "campaign-list", "aria-label": "Live campaigns" }, ...live.map((c) => campaignListItem(c, `/campaigns/${c.id}`)))
      : emptyState("No live campaigns right now."));
  });
};
