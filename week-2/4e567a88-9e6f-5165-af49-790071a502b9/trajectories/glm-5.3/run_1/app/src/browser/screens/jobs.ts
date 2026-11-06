// The Jobs screen: filter, table, export, detail dialog.
import type { AppCtx } from "../main.js";
import type { Job } from "../types.js";
import { api, h, clear, openDialog } from "../lib.js";
import { Ribbon } from "../ribbon.js";
import { openJobDialog } from "../jobdialog.js";

export function renderJobs(ctx: AppCtx): void {
  const { main } = ctx;
  clear(main);
  const ribbon = new Ribbon(() => undefined);
  const meterHost = h("div", {}, ribbon.build());
  if (!ctx.member.team_id) meterHost.hidden = false;

  const teamBar = teamToolbar(ctx);
  main.append(
    h("div", { class: "screen-title" }, h("h1", { text: "Jobs" })),
    teamBar,
    meterHost,
  );

  const statusSel = h("select", { "aria-label": "Status" }) as HTMLSelectElement;
  for (const s of ["", "queued", "leased", "running", "succeeded", "failed", "cancelled"]) {
    statusSel.append(h("option", { value: s, text: s === "" ? "All" : s }));
  }
  const exportLink = h("a", { href: "#", text: "Export CSV" });
  const tableWrap = h("div", { class: "table-wrap" });

  main.append(
    h("div", { class: "toolbar" },
      h("div", { class: "field" }, h("label", { text: "Status" }), statusSel),
      exportLink,
    ),
    h("section", { class: "panel" },
      h("header", {}, h("h2", { text: "Jobs" })),
      tableWrap,
    ),
  );

  async function refresh(): Promise<void> {
    const team = ctx.selectedTeam();
    if (!team) return;
    const query = new URLSearchParams({ team });
    if (statusSel.value) query.set("status", statusSel.value);
    const res = await api<{ jobs: Job[] }>("GET", `/api/jobs?${query.toString()}`);
    if (res.status !== 200) return;
    clear(tableWrap);
    if (res.body.jobs.length === 0) {
      tableWrap.append(h("div", { class: "empty-note", text: "No jobs." }));
      return;
    }
    const table = h("table", { "aria-label": "Jobs" },
      h("thead", {}, h("tr", {},
        h("th", { text: "Job" }), h("th", { text: "Model" }), h("th", { text: "Status" }),
        h("th", { text: "Submitted by" }), h("th", { text: "Submitted" }), h("th", { class: "num", text: "Units" }),
        h("th", { class: "num", text: "Rate" }), h("th", { class: "num", text: "Cost (credits)" }), h("th", { text: "Prompt" }),
      )),
    );
    const tbody = h("tbody");
    for (const job of res.body.jobs) {
      const promptText = job.payload_visible
        ? String((job.input?.prompt as string) ?? (job.input?.text as string) ?? "")
        : "Hidden — restricted payload";
      tbody.append(h("tr", { onclick: () => openJobDialog(job.id) },
        h("td", { class: "num", text: job.id }),
        h("td", { text: job.model }),
        h("td", { text: job.status }),
        h("td", { text: job.submitted_by.name }),
        h("td", { class: "num", text: job.submitted_at }),
        h("td", { class: "num", text: job.billed_units ?? job.estimated_units }),
        h("td", { class: "num", text: (job.rate.micro_per_unit / 1_000_000).toFixed(6) }),
        h("td", { class: "num", text: job.charged_micro === null ? (job.reserved_micro / 1_000_000).toFixed(2) : (job.charged_micro / 1_000_000).toFixed(2) }),
        h("td", { text: promptText }),
      ));
    }
    table.append(tbody);
    tableWrap.append(table);
    exportLink.setAttribute("href", `/api/jobs.csv?${query.toString()}`);
    const meterRes = await api<import("../types.js").Meter>("GET", `/api/teams/${team}/meter`);
    if (meterRes.status === 200) ribbon.update(meterRes.body, (id) => openJobDialog(id));
  }

  statusSel.addEventListener("change", () => void refresh());
  void refresh();
  const timer = window.setInterval(() => void refresh(), 3000);
  observeRemoved(main, () => window.clearInterval(timer));
}

export function teamToolbar(ctx: AppCtx): HTMLElement {
  if (ctx.member.team_id) return h("div", {});
  const wrap = h("div", { class: "toolbar" });
  const sel = h("select", { "aria-label": "Team" }) as HTMLSelectElement;
  for (const t of ctx.teams) {
    sel.append(h("option", { value: t.id, text: t.name, selected: t.id === ctx.selectedTeam() ? true : undefined }));
  }
  sel.addEventListener("change", () => ctx.onTeamChange(sel.value));
  wrap.append(h("div", { class: "field" }, h("label", { text: "Team" }), sel));
  return wrap;
}

export function observeRemoved(root: HTMLElement, cleanup: () => void): void {
  const obs = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      cleanup();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

export { openDialog };
