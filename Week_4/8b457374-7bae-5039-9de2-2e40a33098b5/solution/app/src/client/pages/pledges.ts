import type { Campaign, MyPledge } from "../../shared/api.js";
import { api, download, heldKey } from "../api.js";
import { h } from "../dom.js";
import { emptyState, loading, stateMark } from "../marks.js";
import { cover, money, title, type Page } from "../page.js";

// My pledges (brief: Screens and layout › My pledges): every pledge with its mark, word and actions.

const EMPTY = "No pledges yet. Back a run and it will show here.";

function row(p: MyPledge, tierTitle: string): HTMLLIElement {
  const actions = h("div", { class: "row-actions" });
  if (p.statement === "ready") {
    const link = h("a", { href: `/api/pledges/${p.id}/statement.pdf`, class: "action-link" }, "Download statement");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void download(`/api/pledges/${p.id}/statement.pdf`, `dotgain-statement-${p.id}.pdf`);
    });
    actions.append(link);
  } else if (p.statement === "pending") {
    actions.append(h("span", { class: "pending-note" }, "Statement being prepared"));
  }
  if (p.state === "errored" && p.fix_code) actions.append(h("a", { href: `/fix/${p.fix_code}`, class: "action-link" }, "Fix payment"));
  if (p.state === "authorised") actions.append(h("a", { href: `/campaigns/${p.campaign_id}#manage`, class: "action-link" }, "Manage pledge"));
  return h("li", { class: "pledge-row" },
    cover(p.campaign.cover_media_id ? `/api/media/${p.campaign.cover_media_id}` : null, "", "small"),
    h("div", { class: "row-main" },
      h("a", { href: `/campaigns/${p.campaign_id}`, class: "row-title" }, p.campaign.title),
      h("p", { class: "row-meta" }, tierTitle),
      h("p", { class: "row-total figure" }, money(p.amount)),
      stateMark(p.state)),
    actions);
}

export const pledgesPage: Page = (main, _param, onLeave) => {
  title("My pledges");
  const area = h("div", { class: "list-area" });
  main.append(h("section", { class: "page narrow" }, h("div", { class: "page-head" }, h("h1", {}, "My pledges")), area));
  if (!heldKey()) {
    area.append(emptyState(EMPTY));
    return;
  }
  area.append(loading());
  const tiers = new Map<string, string>();
  const paint = async () => {
    const found = await api<MyPledge[]>("GET", "/api/me/pledges");
    if (!found.ok) return;
    const missing = [...new Set(found.data.map((p) => p.campaign_id))].filter((id) => ![...tiers.keys()].some((k) => k.startsWith(`${id}:`)));
    await Promise.all(missing.map(async (id) => {
      const campaign = await api<Campaign>("GET", `/api/campaigns/${id}`);
      if (campaign.ok) for (const t of campaign.data.tiers) tiers.set(`${id}:${t.id}`, t.title);
    }));
    area.replaceChildren(found.data.length
      ? h("ul", { class: "pledge-list", "aria-label": "Pledges" }, ...found.data.map((p) => row(p, tiers.get(`${p.campaign_id}:${p.tier_id}`) ?? "")))
      : emptyState(EMPTY));
  };
  void paint();
  const timer = setInterval(() => void paint(), 30_000);
  onLeave(() => clearInterval(timer));
};
