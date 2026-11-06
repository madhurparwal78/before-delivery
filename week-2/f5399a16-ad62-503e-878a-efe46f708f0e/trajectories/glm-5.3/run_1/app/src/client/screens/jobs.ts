// Jobs: search after the published pause with the latest input winning,
// filters and sort in the URL with each committed change one history entry,
// pages by cursor, and the row menu.

import { el, link, type ScreenContext, heading, field } from "../lib/ui";
import { ApiError, type Json } from "../lib/state";
import { api } from "../lib/ui";

export async function buildJobs(ctx: ScreenContext, query: URLSearchParams): Promise<{ heading: HTMLElement; body: HTMLElement }> {
  const h = heading(["Jobs"], ctx.announcer);
  const search = field("input", { type: "search", "aria-label": "Search jobs and clients", role: "searchbox", autocomplete: "off" });
  const results = el("ul", { role: "list", "aria-label": "Search results", class: "search-results", hidden: "true" });
  const clientFilter = query.get("client") ?? "";
  const stateFilter = query.get("state") ?? "";
  const rateFilter = query.get("frameRate") ?? "";
  const sort = query.get("sort") ?? "dueDate";
  const cursor = query.get("cursor");

  const table = el("div", { class: "table-frame", role: "region", "aria-label": "Jobs table", tabindex: "0" });
  const rowsEl = el("tbody", {});
  const tableEl = el("table", { class: "jobs-table" }, el("thead", {}, el("tr", {}, el("th", {}, "Title"), el("th", {}, "Client"), el("th", {}, "State"), el("th", {}, "Frame rate"), el("th", {}, "Due date"))), rowsEl);
  table.append(tableEl);

  const newJobButton = el("button", { type: "button", class: "primary" }, "New job");
  newJobButton.style.minHeight = "44px";

  let searchTimer: number | null = null;
  let searchSeq = 0;
  search.addEventListener("input", () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    const text = search.value.trim();
    if (text.length === 0) {
      results.hidden = true;
      results.replaceChildren();
      return;
    }
    searchTimer = window.setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const answer = await api.get(`/api/search?q=${encodeURIComponent(text)}`);
        if (seq !== searchSeq) return;
        const jobs = (answer.jobs as Json[]) ?? [];
        const clients = (answer.clients as Json[]) ?? [];
        const producers = (answer.producers as Json[]) ?? [];
        const total = Number(answer.total ?? 0);
        results.replaceChildren();
        for (const job of jobs) {
          results.append(el("li", {}, link(`/desk/jobs/${String(job.id)}`, String(job.title))));
        }
        for (const client of clients) {
          results.append(el("li", {}, link(`/desk/clients/${String(client.id)}`, String(client.name))));
        }
        for (const producer of producers) {
          results.append(el("li", {}, String(producer.name)));
        }
        results.hidden = false;
        ctx.announcer.announce(total === 0 ? "No results." : total === 1 ? "1 result." : `${total} results.`);
      } catch {
        // The search answer shows within a second of the pause ending; a
        // failed ask stays quiet until the next input.
      }
    }, 300);
  });

  async function load(): Promise<void> {
    const params = new URLSearchParams();
    if (clientFilter.length > 0) params.set("client", clientFilter);
    if (stateFilter.length > 0) params.set("state", stateFilter);
    if (rateFilter.length > 0) params.set("frameRate", rateFilter);
    params.set("sort", sort);
    if (cursor !== null && cursor.length > 0) params.set("cursor", cursor);
    const answer = await api.get(`/api/jobs?${params.toString()}`);
    const jobs = (answer.jobs as Json[]) ?? [];
    rowsEl.replaceChildren();
    for (const job of jobs) {
      const title = String(job.title);
      const row = el("tr", {},
        el("td", {}, link(`/desk/jobs/${String(job.id)}`, title)),
        el("td", {}, String(job.clientName ?? "")),
        el("td", {}, jobStateText(String(job.state))),
        el("td", {}, String(job.frameRate)),
        el("td", {}, String(job.dueDate)),
      );
      const menuButton = el("button", { type: "button", "aria-label": `Actions for ${title}` }, "Actions");
      menuButton.style.minHeight = "44px";
      menuButton.addEventListener("click", () => {
        const menu = el("div", { role: "menu", class: "menu" });
        const open = el("button", { role: "menuitem", type: "button" }, "Open");
        const duplicate = el("button", { role: "menuitem", type: "button" }, "Duplicate");
        const archive = el("button", { role: "menuitem", type: "button" }, "Archive");
        open.addEventListener("click", () => {
          void ctx.router.go(`/desk/jobs/${String(job.id)}`);
        });
        duplicate.addEventListener("click", async () => {
          try {
            const copy = await api.post(`/api/jobs/${String(job.id)}/duplicate`, {});
            ctx.announcer.announce("Job duplicated.");
            await ctx.router.go(`/desk/jobs/${String(copy.id)}`);
          } catch (e) {
            if (e instanceof ApiError) ctx.announcer.announce(e.message);
          }
        });
        archive.addEventListener("click", async () => {
          try {
            await api.post(`/api/jobs/${String(job.id)}/archive`, {});
            ctx.announcer.announce(`${title} archived.`);
            h.setAttribute("tabindex", "-1");
            h.focus();
            await load();
          } catch (e) {
            if (e instanceof ApiError) ctx.announcer.announce(e.message);
          }
        });
        menu.append(open, duplicate, archive);
        menu.style.position = "absolute";
        menu.append();
        const rect = menuButton.getBoundingClientRect();
        const menuWrap = el("div", { class: "menu-wrap", style: `position:absolute; top:${rect.bottom}px; right:12px;` }, menu);
        document.body.append(menuWrap);
        const close = (): void => {
          menuWrap.remove();
          document.removeEventListener("click", close);
        };
        document.addEventListener("click", close);
      });
      row.append(el("td", {}, menuButton));
      rowsEl.append(row);
    }
  }
  await load();

  const body = el("main", { class: "jobs" }, h, search, results, table, newJobButton);
  return { heading: h, body, refresh: load } as { heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null };
}

function jobStateText(state: string): string {
  switch (state) {
    case "draft": return "Draft";
    case "inReview": return "In review";
    case "signedOff": return "Signed off";
    case "delivered": return "Delivered";
    case "archived": return "Archived";
    default: return state;
  }
}
