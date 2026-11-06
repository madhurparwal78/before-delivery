// The Finance screen: top-ups, ledger, rate schedule.
import type { AppCtx } from "../main.js";
import type { TopUp, Ledger, Rate, Model, Meter } from "../types.js";
import { api, h, clear, notice, alertNotice, fmtWholeCredits } from "../lib.js";
import { Ribbon } from "../ribbon.js";
import { openJobDialog } from "../jobdialog.js";

export function renderFinance(ctx: AppCtx): void {
  const { main } = ctx;
  clear(main);
  const ribbon = new Ribbon(() => undefined);
  const meterHost = h("div", {}, ribbon.build());

  const teamSel = h("select", { "aria-label": "Team" }) as HTMLSelectElement;
  for (const t of ctx.teams) teamSel.append(h("option", { value: t.id, text: t.name, selected: t.id === ctx.selectedTeam() ? true : undefined }));
  teamSel.addEventListener("change", () => { ctx.onTeamChange(teamSel.value); });

  const creditsInput = h("input", { type: "number", "aria-label": "Credits", min: "100", max: "100000", step: "100" }) as HTMLInputElement;
  const topupsWrap = h("div", { class: "table-wrap" });
  const ledgerWrap = h("div", { class: "table-wrap" });
  const modelSel = h("select", { "aria-label": "Model" }) as HTMLSelectElement;
  const rateInput = h("input", { type: "text", "aria-label": "New rate (credits per unit)" }) as HTMLInputElement;
  const effInput = h("input", { type: "text", "aria-label": "Effective at" }) as HTMLInputElement;
  const rateScheduleWrap = h("div", { class: "table-wrap" });

  main.append(
    h("div", { class: "screen-title" }, h("h1", { text: "Finance" })),
    h("div", { class: "toolbar" }, h("div", { class: "field" }, h("label", { text: "Team" }), teamSel)),
    meterHost,
    h("section", { class: "panel" },
      h("header", {}, h("h2", { text: "Top-ups" })),
      h("div", { class: "panel-body" },
        h("form", {
          "aria-label": "Top up credits",
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const btn = (e.target as HTMLFormElement).querySelector('button[type="submit"]') as HTMLButtonElement;
            btn.textContent = "Recording payment…";
            btn.disabled = true;
            const res = await api<{ topup: TopUp }>("POST", "/api/topups", {
              team_id: teamSel.value,
              credits: Number(creditsInput.value),
            });
            btn.textContent = "Top up";
            btn.disabled = false;
            if (res.status === 201 && res.body.topup.status === "paid") {
              notice(`Added ${fmtWholeCredits(res.body.topup.credits)} credits to ${teamName(ctx, teamSel.value)}.`);
              void refresh();
            } else if (res.status === 202) {
              notice(`Billing is unreachable. Your top-up of ${fmtWholeCredits(res.body.topup.credits)} credits is pending; no credits have been added yet.`);
              void refresh();
            } else if (res.status === 502) {
              alertNotice("Billing declined the top-up; no credits were added.");
              void refresh();
            } else if (res.status === 422) {
              const fields = (res.body as unknown as { error: { fields?: Record<string, string> } }).error.fields ?? {};
              alertNotice(fields.credits ?? res.body.error?.message ?? "Fix the highlighted fields.");
            } else {
              alertNotice(res.body.error?.message ?? "The top-up failed.");
            }
          },
        },
          h("div", { class: "inline-fields" },
            h("div", { class: "field" }, h("label", { text: "Credits" }), creditsInput),
            h("div", { class: "field" }, h("button", { class: "btn", type: "submit", text: "Top up" })),
          ),
        ),
        topupsWrap,
      ),
    ),
    h("section", { class: "panel" },
      h("header", {}, h("h2", { text: "Ledger" }),
        h("a", { href: "#", id: "ledger-export", text: "Export ledger CSV" })),
      h("div", { class: "panel-body" }, ledgerWrap),
    ),
    h("section", { class: "panel" },
      h("header", {}, h("h2", { text: "Rate schedule" })),
      h("div", { class: "panel-body" },
        h("form", {
          "aria-label": "Schedule rate change",
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const rateText = rateInput.value.trim();
            if (!/^\d{1,7}(\.\d{1,6})?$/.test(rateText) || Number(rateText) < 0.000001 || Number(rateText) > 1000000) {
              alertNotice("Enter a rate from 0.000001 to 1000000 with at most six decimals.");
              return;
            }
            if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(effInput.value.trim())) {
              alertNotice("Use the format YYYY-MM-DD HH:MM.");
              return;
            }
            const btn = (e.target as HTMLFormElement).querySelector('button[type="submit"]') as HTMLButtonElement;
            btn.textContent = "Saving…";
            btn.disabled = true;
            const micro = Math.round(Number(rateText) * 1_000_000);
            const local = effInput.value.trim() + ":00";
            const res = await api<{ rate: Rate }>("POST", `/api/models/${modelSel.value}/rates`, {
              micro_per_unit: micro,
              effective_at_local: local,
            });
            btn.textContent = "Schedule";
            btn.disabled = false;
            if (res.status === 201) {
              notice(`New rate for ${modelLabel()} takes effect ${effInput.value.trim()} ${zoneName()}.`);
              void refresh();
            } else {
              const fields = (res.body as unknown as { error: { fields?: Record<string, string> } }).error.fields ?? {};
              alertNotice(fields.effective_at_local ?? fields.micro_per_unit ?? res.body.error?.message ?? "Fix the highlighted fields.");
            }
          },
        },
          h("div", { class: "inline-fields" },
            h("div", { class: "field" }, h("label", { text: "Model" }), modelSel),
            h("div", { class: "field" }, h("label", { text: "New rate (credits per unit)" }), rateInput),
            h("div", { class: "field" }, h("label", { text: "Effective at" }), effInput),
            h("div", { class: "field" }, h("button", { class: "btn", type: "submit", text: "Schedule" })),
          ),
        ),
        rateScheduleWrap,
      ),
    ),
  );

  let zone = "UTC";
  function modelLabel(): string {
    return modelSel.selectedOptions[0]?.text ?? modelSel.value;
  }
  function zoneName(): string {
    return zone;
  }

  async function refresh(): Promise<void> {
    const team = teamSel.value || ctx.selectedTeam();
    if (!team) return;
    const meterRes = await api<Meter>("GET", `/api/teams/${team}/meter`);
    if (meterRes.status === 200) ribbon.update(meterRes.body, (id) => openJobDialog(id));
    const orgRes = await api<{ policy: { timezone: string } }>("GET", "/api/policy");
    if (orgRes.status === 200) zone = orgRes.body.policy.timezone;

    const topupsRes = await api<{ topups: TopUp[] }>("GET", `/api/topups?team=${team}`);
    if (topupsRes.status === 200) {
      clear(topupsWrap);
      if (topupsRes.body.topups.length === 0) {
        topupsWrap.append(h("div", { class: "empty-note", text: "No top-ups yet." }));
      } else {
        const table = h("table", { "aria-label": "Top-ups" },
          h("thead", {}, h("tr", {},
            h("th", { text: "Top-up" }), h("th", { text: "Credits" }), h("th", { text: "Amount" }),
            h("th", { text: "Status" }), h("th", { text: "Kill Bill invoice" }), h("th", { text: "Paid at" })),
          ), h("tbody", {}));
        const tbody = table.querySelector("tbody") as HTMLElement;
        for (const t of topupsRes.body.topups) {
          tbody.append(h("tr", {},
            h("td", { class: "num", text: t.id }),
            h("td", { class: "num", text: fmtWholeCredits(t.credits) }),
            h("td", { class: "num", text: `$${t.amount_usd}` }),
            h("td", { text: t.status === "paid" ? "Paid" : t.status === "pending" ? "Pending" : "Failed" }),
            h("td", { class: "num", text: t.kb_invoice_id ?? "—" }),
            h("td", { class: "num", text: t.paid_at ?? "—" }),
          ));
        }
        topupsWrap.append(table);
      }
    }

    const ledgerRes = await api<Ledger>("GET", `/api/teams/${team}/ledger`);
    if (ledgerRes.status === 200) {
      clear(ledgerWrap);
      const table = h("table", { "aria-label": "Ledger" },
        h("thead", {}, h("tr", {},
          h("th", { text: "Movement" }), h("th", { text: "Kind" }), h("th", { text: "At" }),
          h("th", { text: "Job" }), h("th", { text: "Top-up" }), h("th", { text: "Entries" })),
        ), h("tbody", {}));
      const tbody = table.querySelector("tbody") as HTMLElement;
      for (const m of ledgerRes.body.movements) {
        tbody.append(h("tr", {},
          h("td", { class: "num", text: m.id }),
          h("td", { text: m.kind }),
          h("td", { class: "num", text: m.created_at }),
          h("td", { class: "num", text: m.job_id ?? "—" }),
          h("td", { class: "num", text: m.topup_id ?? "—" }),
          h("td", { class: "num", text: m.entries.map((e) => `${e.account} ${(e.amount_micro / 1_000_000).toFixed(2)}`).join("; ") }),
        ));
      }
      ledgerWrap.append(table);
      const exportEl = document.getElementById("ledger-export");
      if (exportEl) exportEl.setAttribute("href", `/api/teams/${team}/ledger.csv`);
    }

    const ratesRes = await api<{ rates: Rate[] }>("GET", `/api/models/${modelSel.value || "quill-still"}/rates`);
    if (ratesRes.status === 200) {
      clear(rateScheduleWrap);
      const table = h("table", { "aria-label": "Rate schedule" },
        h("thead", {}, h("tr", {},
          h("th", { text: "Rate" }), h("th", { text: "Effective" }), h("th", { text: "Status" }), h("th", { text: "" })),
        ), h("tbody", {}));
      const tbody = table.querySelector("tbody") as HTMLElement;
      for (const r of ratesRes.body.rates) {
        const row = h("tr", {},
          h("td", { class: "num", text: (r.micro_per_unit / 1_000_000).toFixed(6) }),
          h("td", { class: "num", text: r.effective_at_local }),
          h("td", { text: r.status.charAt(0).toUpperCase() + r.status.slice(1) }),
        );
        if (r.status === "scheduled") {
          row.append(h("td", {}, h("button", {
            class: "link-btn", text: "Withdraw", "aria-label": `Withdraw rate ${r.id}`,
            onclick: async () => {
              const res = await api("DELETE", `/api/models/${modelSel.value}/rates/${r.id}`);
              if (res.status === 204) {
                notice(`Scheduled rate ${r.id} withdrawn.`);
                void refresh();
              } else {
                alertNotice(res.body.error?.message ?? "That rate is already in effect and cannot be withdrawn.");
              }
            },
          })));
        } else {
          row.append(h("td", {}));
        }
        tbody.append(row);
      }
      rateScheduleWrap.append(table);
    }
  }

  void api<{ models: Model[] }>("GET", "/api/models").then((res) => {
    if (res.status !== 200) return;
    for (const m of res.body.models) modelSel.append(h("option", { value: m.slug, text: m.name }));
    modelSel.addEventListener("change", () => void refresh());
    void refresh();
  });

  const timer = window.setInterval(() => void refresh(), 5000);
  const obs = new MutationObserver(() => {
    if (!document.body.contains(main)) {
      window.clearInterval(timer);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

function teamName(ctx: AppCtx, teamId: string): string {
  return ctx.teams.find((t) => t.id === teamId)?.name ?? teamId;
}
