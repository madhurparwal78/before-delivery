// Schedulers and monthly statement (org admin).
import { api, ApiCallError, el } from "../lib";
import { formField, statusRegion } from "../components";
import { App } from "../main";
import type { SchedulerRow } from "../types";

export function renderOrg(app: App): void {
  const main = app.main;
  const schedulerStatus = statusRegion("Scheduler status");
  const statementStatus = statusRegion("Statement status", "");

  const body = el("tbody");
  const table = el("table", { class: "paper", "aria-label": "Schedulers" },
    el("thead", {}, el("tr", {},
      el("th", { text: "Name" }), el("th", { text: "Email" }), el("th", { text: "Phone" }), el("th", { text: "" }))),
    body);

  const name = formField({ name: "name", label: "Name" });
  const email = formField({ name: "email", label: "Email", type: "email" });
  const phone = formField({ name: "phone", label: "Phone", type: "tel" });
  const password = formField({ name: "password", label: "Initial password", type: "password" });

  const addForm = el("form", { "aria-label": "Add scheduler" },
    el("h3", { text: "Add scheduler" }),
    name.row, email.row, phone.row, password.row,
    schedulerStatus.el,
    el("button", { class: "btn btn-primary", type: "submit", text: "Add scheduler" }),
  );

  const month = formField({ name: "month", label: "Month", type: "text", placeholder: "YYYY-MM" });
  const statementForm = el("form", { "aria-label": "Monthly statement" },
    el("h3", { text: "Monthly statement" }),
    month.row,
    statementStatus.el,
    el("button", { class: "btn btn-primary", type: "submit", text: "Download statement" }),
  );

  const load = (): void => {
    api<{ schedulers: SchedulerRow[] }>("GET", "/api/org/schedulers").then((res) => {
      body.replaceChildren();
      for (const row of res.schedulers) {
        body.append(el("tr", {},
          el("td", { "data-label": "Name", text: row.name }),
          el("td", { "data-label": "Email", text: row.email }),
          el("td", { "data-label": "Phone", text: row.phone }),
          el("td", { "data-label": "" },
            el("button", {
              class: "btn btn-danger",
              text: `Remove ${row.name}`,
              onclick: async () => {
                schedulerStatus.set("Saving…");
                try {
                  await api("DELETE", `/api/org/schedulers/${row.id}`);
                  schedulerStatus.set(`${row.name} no longer has access.`);
                  load();
                } catch {
                  schedulerStatus.set("Couldn't reach Teamseat. Try again.");
                }
              },
            })),
        ));
      }
    }).catch(() => {
      schedulerStatus.set("Schedulers not loading. Try again.");
    });
  };

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    schedulerStatus.set("Saving…");
    try {
      const created = await api<SchedulerRow>("POST", "/api/org/schedulers", {
        name: (name.input as HTMLInputElement).value,
        email: (email.input as HTMLInputElement).value,
        phone: (phone.input as HTMLInputElement).value,
        password: password.input.value,
      });
      schedulerStatus.set(`${created.name} can now request interpreters.`);
      addForm.reset();
      load();
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "email_taken") schedulerStatus.set("That email is already in use.");
        else if (err.code === "validation") schedulerStatus.set("Check the highlighted fields.");
        else schedulerStatus.set(err.message);
      } else {
        schedulerStatus.set("Couldn't reach Teamseat. Try again.");
      }
    }
  });

  statementForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = (month.input as HTMLInputElement).value.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      statementStatus.set("Enter the month as YYYY-MM.");
      return;
    }
    statementStatus.set("Preparing the statement…");
    try {
      const res = await fetch(`/api/org/statement?month=${value}`, { credentials: "same-origin" });
      if (!res.ok) {
        statementStatus.set("Couldn't prepare the statement. Try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = el("a", { href: url, download: `statement-${value}.csv` });
      link.click();
      URL.revokeObjectURL(url);
      statementStatus.set("");
    } catch {
      statementStatus.set("Couldn't reach Teamseat. Try again.");
    }
  });

  main.append(
    el("h1", { text: "Schedulers" }),
    table,
    el("div", { class: "grid-12", style: "margin-top: 24px;" },
      el("section", { class: "w-4" }, addForm),
      el("section", { class: "w-4" }, statementForm),
    ),
  );

  void app;
  load();
}
