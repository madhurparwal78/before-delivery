// Billing: approve submitted timesheets and keep the hourly rates.
import type { QueuedTimesheet, Rates } from "../../shared/api.js";
import { ORGANISATIONS, SETTING_LABELS, SETTINGS } from "../../shared/domain.js";
import { call, get, newKey } from "../api.js";
import type { Screen } from "../app.js";
import { h, replace, say, statusRegion, uid } from "../dom.js";
import { button, emptyNote, field, showErrors, textInput, when } from "../ui.js";

const orgName = (id: string): string => ORGANISATIONS.find((o) => o.id === id)?.name ?? id;

export async function billingScreen({ main }: Screen): Promise<void> {
  const status = statusRegion("Billing status");
  const queue = h("div", {});
  const ratesId = uid("rates");
  const rateFields = Object.fromEntries(
    SETTINGS.map((s) => [s, field(`${SETTING_LABELS[s]} hourly rate`, textInput({ inputmode: "decimal" }))]),
  );
  const saveRates = h("button", { type: "submit", class: "button primary" }, "Save rates");
  const ratesForm = h(
    "form",
    { class: "stack", novalidate: true },
    h("p", { class: "meta" }, "Dollars per hour, for example 80.00. New rates apply to approvals and cancellations from now on."),
    h("div", { class: "grid-2" }, SETTINGS.map((s) => rateFields[s]?.wrap)),
    h("div", { class: "actions" }, saveRates),
  );
  const sheet = h(
    "section",
    { class: "sheet" },
    h("div", { class: "title-row" }, h("h1", {}, "Billing"), h("a", { href: "/invoices" }, "See invoices by organisation")),
    status,
    h("h2", {}, "Timesheets awaiting approval"),
    queue,
    h("section", { class: "block", "aria-labelledby": ratesId }, h("h2", { id: ratesId }, "Rates"), ratesForm),
  );

  const keys = new Map<string, string>();
  const loadQueue = async (): Promise<void> => {
    const result = await get<{ timesheets: QueuedTimesheet[] }>("/api/timesheets?status=submitted");
    const sheets = result.ok ? result.data.timesheets : [];
    if (!sheets.length) {
      replace(queue, emptyNote("No timesheets are waiting."));
      return;
    }
    replace(
      queue,
      h(
        "table",
        { class: "table", "aria-label": "Timesheets awaiting approval" },
        h("thead", {}, h("tr", {}, ["Ref", "Organisation", "Interpreter", "Worked", "Billed hours", "Action"].map((c) => h("th", { scope: "col" }, c)))),
        h(
          "tbody",
          {},
          sheets.map((t) => {
            const approve = button("Approve", { "aria-label": `Approve ${t.ref} for ${t.interpreter.name}` });
            const row = h(
              "tr",
              {},
              h("td", { "data-label": "Ref", class: "fig" }, t.ref),
              h("td", { "data-label": "Organisation" }, orgName(t.org_id)),
              h("td", { "data-label": "Interpreter" }, t.interpreter.name),
              h("td", { "data-label": "Worked", class: "fig" }, when(t.actual_start, t.actual_end)),
              h("td", { "data-label": "Billed hours", class: "fig" }, t.billed_hours),
              h("td", { "data-label": "Action" }, approve),
            );
            approve.addEventListener("click", async () => {
              const key = keys.get(t.id) ?? newKey();
              keys.set(t.id, key);
              approve.disabled = true;
              say(status, "Approving…");
              const result = await call<{ timesheet: { amount: string } }>("POST", `/api/timesheets/${t.id}/approve`, {}, { "Idempotency-Key": key });
              if (result.ok) {
                say(status, `Approved ${t.ref} for ${t.interpreter.name}: $${result.data.timesheet.amount}.`);
                row.remove();
                return;
              }
              approve.disabled = false;
              const copy: Record<string, string> = {
                billing_unavailable: "Billing is unreachable. The timesheet is not approved. Try again in a few minutes.",
                storage_unavailable: "File storage is unreachable. The timesheet is not approved.",
                invalid_transition: "This timesheet is no longer awaiting approval.",
              };
              say(status, copy[result.error.code] ?? "The timesheet could not be approved. Try again.");
            });
            return row;
          }),
        ),
      ),
    );
  };

  const loadRates = async (): Promise<void> => {
    const result = await get<{ rates: Rates }>("/api/rates");
    if (!result.ok) return;
    for (const s of SETTINGS) {
      const f = rateFields[s];
      if (f) f.control.value = result.data.rates[s];
    }
  };

  ratesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(SETTINGS.map((s) => [s, rateFields[s]?.control.value.trim() ?? ""]));
    say(status, "Saving rates…");
    const result = await call<{ rates: Rates }>("PUT", "/api/rates", body);
    showErrors(rateFields, result.ok ? {} : result.error.fields);
    if (result.ok) say(status, "Rates saved. They apply to approvals and cancellations from now on.");
    else say(status, result.error.code === "validation" ? "Check the highlighted fields." : "Rates could not be saved. Try again.");
  });

  // The queue is drawn before the sheet is shown, so its rows never push the rates form down.
  await Promise.all([loadQueue(), loadRates()]);
  main.append(sheet);
}
