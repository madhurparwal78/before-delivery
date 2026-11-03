// Kill Bill invoices for one organisation; the billing lead picks which.
import type { Invoices } from "../../shared/api.js";
import { ORGANISATIONS } from "../../shared/domain.js";
import { get } from "../api.js";
import type { Screen } from "../app.js";
import { h, replace, say, statusRegion } from "../dom.js";
import { emptyNote, field, select } from "../ui.js";

export async function invoicesScreen({ main, user }: Screen): Promise<void> {
  const status = statusRegion("Invoice status");
  const holder = h("div", {});
  const sheet = h("section", { class: "sheet" }, h("h1", {}, "Invoices"));
  main.append(sheet);

  const load = async (orgId: string): Promise<void> => {
    replace(holder);
    say(status, "Loading invoices…");
    const result = await get<Invoices>(`/api/orgs/${orgId}/invoices`);
    if (!result.ok) {
      say(status, result.error.code === "billing_unavailable" ? "Billing is unreachable, so invoices cannot be shown right now." : "Invoices could not be loaded.");
      return;
    }
    const { invoices, total } = result.data;
    say(status, `${invoices.length} invoice(s), total $${total}.`);
    if (!invoices.length) {
      holder.append(emptyNote("No invoices yet."));
      return;
    }
    holder.append(
      h(
        "table",
        { class: "table invoices", "aria-label": "Invoices" },
        h("thead", {}, h("tr", {}, ["Number", "Date", "Amount", "Balance"].map((c) => h("th", { scope: "col" }, c)))),
        invoices.map((i) =>
          h(
            "tbody",
            { class: "invoice" },
            h(
              "tr",
              { class: "invoice-row" },
              h("td", { "data-label": "Number", class: "fig" }, i.invoice_number),
              h("td", { "data-label": "Date", class: "fig" }, i.invoice_date),
              h("td", { "data-label": "Amount", class: "fig" }, `$${i.amount}`),
              h("td", { "data-label": "Balance", class: "fig" }, `$${i.balance}`),
            ),
            i.items.map((item) =>
              h(
                "tr",
                { class: "item-row" },
                h("td", { colspan: "3", "data-label": "Item" }, item.description),
                h("td", { "data-label": "Item amount", class: "fig" }, `$${item.amount}`),
              ),
            ),
          ),
        ),
      ),
    );
  };

  if (user?.role === "billing") {
    const picker = field("Organisation", select(ORGANISATIONS.map((o) => [o.id, o.name]), "Choose an organisation"));
    picker.control.addEventListener("change", () => {
      if (picker.control.value) void load(picker.control.value);
    });
    holder.append(emptyNote("Choose an organisation to see its invoices."));
    sheet.append(h("p", { class: "lede" }, "Kill Bill invoices, newest first, read live for the organisation you choose."), picker.wrap, status, holder);
    return;
  }
  const org = ORGANISATIONS.find((o) => o.id === user?.org_id);
  sheet.append(h("p", { class: "lede" }, `Kill Bill invoices for ${org?.name ?? "your organisation"}, newest first.`), status, holder);
  if (user?.org_id) await load(user.org_id);
}
