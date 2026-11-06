/** Billing: hour pack, hour ledger, invoices; the operator issues them. */

import type { HourPack, Invoice, User } from "../../shared/api-types.js";
import { ApiClientError, apiJson, apiDownload } from "../api.js";
import type { Feedback } from "../feedback.js";
import { clearActivity, fallbackCopy, showActivity, showError } from "../feedback.js";
import { dollars, hmm } from "../kitchen-time.js";
import { randomUUID } from "../api-keys.js";

interface ScreenDeps {
  user: User | null;
  feedback: Feedback;
  navigate(path: string): void;
}

export async function renderBilling(root: HTMLElement, deps: ScreenDeps): Promise<void> {
  const user = deps.user;
  if (user === null) return;
  const activeUser = user;
  const screen = document.createElement("div");
  screen.className = "screen";
  const title = document.createElement("h1");
  title.textContent = "Billing";
  screen.appendChild(title);

  // Hour pack panel
  const packPanel = document.createElement("section");
  packPanel.className = "panel";
  packPanel.setAttribute("role", "region");
  packPanel.setAttribute("aria-label", "Hour pack");
  const balanceText = document.createElement("p");
  balanceText.className = "mono";
  const buyRow = document.createElement("div");
  buyRow.className = "row-actions";
  packPanel.append(balanceText, buyRow);

  // Hour ledger
  const ledgerPanel = document.createElement("section");
  ledgerPanel.className = "panel";
  const ledgerTitle = document.createElement("h2");
  ledgerTitle.textContent = "Hour ledger";
  const ledgerWrap = document.createElement("div");
  ledgerWrap.className = "table-wrap";
  const ledgerTable = document.createElement("table");
  ledgerTable.className = "data";
  ledgerTable.setAttribute("aria-label", "Hour ledger");
  ledgerTable.innerHTML = `<thead><tr><th scope="col">When</th><th scope="col">Movement</th><th scope="col">Booking</th><th scope="col">Minutes</th></tr></thead>`;
  const ledgerBody = document.createElement("tbody");
  ledgerTable.appendChild(ledgerBody);
  ledgerWrap.appendChild(ledgerTable);
  ledgerPanel.append(ledgerTitle, ledgerWrap);

  // Invoices
  const invoicePanel = document.createElement("section");
  invoicePanel.className = "panel";
  const invoiceTitle = document.createElement("h2");
  invoiceTitle.textContent = "Invoices";
  const invoiceWrap = document.createElement("div");
  invoiceWrap.className = "table-wrap";
  const invoiceTable = document.createElement("table");
  invoiceTable.className = "data";
  invoiceTable.setAttribute("aria-label", "Invoices");
  invoiceTable.innerHTML = `<thead><tr><th scope="col">Number</th><th scope="col">Period</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Actions</th></tr></thead>`;
  const invoiceBody = document.createElement("tbody");
  invoiceTable.appendChild(invoiceBody);
  invoiceWrap.appendChild(invoiceTable);
  invoicePanel.append(invoiceTitle, invoiceWrap);

  screen.append(packPanel, ledgerPanel, invoicePanel);
  root.replaceChildren(screen);

  let tenantId = activeUser.tenant_id;
  if (activeUser.role === "operator") {
    // The operator picks a tenant, then reads their billing.
    const pickerPanel = document.createElement("section");
    pickerPanel.className = "panel";
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.setAttribute("for", "billing-tenant");
    label.textContent = "Tenant";
    const select = document.createElement("select");
    select.id = "billing-tenant";
    select.add(new Option("Choose a tenant", ""));
    field.append(label, select);
    const tenants = await apiJson<{ tenants: Array<{ id: string; business_name: string }> }>("GET", "/api/tenants");
    for (const t of tenants.tenants) select.add(new Option(t.business_name, t.id));
    select.addEventListener("change", () => {
      tenantId = select.value || null;
      void load();
    });
    pickerPanel.appendChild(field);
    screen.insertBefore(pickerPanel, packPanel);
    tenantId = null;
  }

  async function load(): Promise<void> {
    showActivity(deps.feedback, "Loading…");
    try {
      if (tenantId === null) {
        clearActivity(deps.feedback);
        return;
      }
      const query = activeUser.role === "operator" ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
      const [packs, ledger, invoices] = await Promise.all([
        apiJson<{ packs: HourPack[] }>("GET", "/api/hour-packs").catch(() => ({ packs: [] as HourPack[] })),
        apiJson<{ balance_minutes: number; entries: Array<{ id: string; created_at: string; reason: string; booking_id: string | null; minutes: number; account: string }> }>("GET", `/api/hour-ledger${query}`),
        apiJson<{ invoices: Invoice[] }>("GET", `/api/invoices${query}`)
      ]);
      clearActivity(deps.feedback);
      balanceText.textContent = `Balance ${hmm(ledger.balance_minutes)}`;
      renderPacks(packs.packs);
      renderLedger(ledger.entries.filter((e) => e.account === "tenant_pack"));
      renderInvoices(invoices.invoices);
    } catch (e) {
      clearActivity(deps.feedback);
      if (e instanceof ApiClientError) showError(deps.feedback, fallbackCopy(e));
    }
  }

  function renderPacks(packs: HourPack[]): void {
    buyRow.replaceChildren();
    if (activeUser.role !== "owner") return;
    for (const pack of packs) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Buy ${pack.name}`;
      btn.addEventListener("click", () => void buyPack(pack, btn));
      buyRow.appendChild(btn);
    }
  }

  async function buyPack(pack: HourPack, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    showActivity(deps.feedback, `Buying ${pack.name}…`);
    try {
      const res = await apiJson<{ balance_minutes: number }>(
        "POST",
        "/api/hour-packs/purchase",
        { pack_id: pack.id },
        randomUUID()
      );
      await load();
      clearActivity(deps.feedback);
      showActivity(deps.feedback, `${pack.name} added. Balance: ${hmm(res.balance_minutes)}.`);
    } catch (e) {
      button.disabled = false;
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "billing_unavailable"
            ? "Billing is unreachable. Nothing was charged and your balance is unchanged."
            : fallbackCopy(e)
        );
      }
    }
  }

  function renderLedger(entries: Array<{ id: string; created_at: string; reason: string; booking_id: string | null; minutes: number }>): void {
    ledgerBody.replaceChildren();
    for (const entry of entries) {
      const tr = document.createElement("tr");
      const cells: Array<[string, string]> = [
        ["When", entry.created_at.slice(0, 16).replace("T", " ")],
        ["Movement", movementWord(entry.reason)],
        ["Booking", entry.booking_id ?? ""],
        ["Minutes", String(entry.minutes)]
      ];
      for (const [label, value] of cells) {
        const td = document.createElement("td");
        td.dataset.label = label;
        td.textContent = value;
        td.className = "mono";
        tr.appendChild(td);
      }
      ledgerBody.appendChild(tr);
    }
  }

  function renderInvoices(invoices: Invoice[]): void {
    invoiceBody.replaceChildren();
    for (const invoice of invoices) {
      const tr = document.createElement("tr");
      const cells: Array<[string, string]> = [
        ["Number", invoice.number],
        ["Period", invoice.period],
        ["Status", invoice.status === "paid" ? "Paid" : "Issued"],
        ["Total", dollars(invoice.total_cents)]
      ];
      for (const [label, value] of cells) {
        const td = document.createElement("td");
        td.dataset.label = label;
        td.textContent = value;
        td.className = "mono";
        tr.appendChild(td);
      }
      const actionTd = document.createElement("td");
      actionTd.dataset.label = "Actions";
      const pdfLink = document.createElement("a");
      pdfLink.textContent = `Download PDF ${invoice.number}`;
      pdfLink.href = "#";
      pdfLink.addEventListener("click", (event) => {
        event.preventDefault();
        void downloadPdf(invoice);
      });
      actionTd.appendChild(pdfLink);
      if (activeUser.role === "owner" && invoice.status === "issued") {
        const pay = document.createElement("button");
        pay.className = "btn";
        pay.textContent = `Pay invoice ${invoice.number}`;
        pay.addEventListener("click", () => void payInvoice(invoice, pay));
        actionTd.appendChild(pay);
      }
      tr.appendChild(actionTd);
      invoiceBody.appendChild(tr);
    }
  }

  async function downloadPdf(invoice: Invoice): Promise<void> {
    showActivity(deps.feedback, "Preparing PDF…");
    try {
      await apiDownload(`/api/invoices/${invoice.id}/pdf`);
      clearActivity(deps.feedback);
    } catch (e) {
      clearActivity(deps.feedback);
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "storage_unavailable"
            ? "Document storage is unreachable. Try again in a moment."
            : fallbackCopy(e)
        );
      }
    }
  }

  async function payInvoice(invoice: Invoice, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    showActivity(deps.feedback, "Paying…");
    try {
      const res = await apiJson<Invoice>("POST", `/api/invoices/${invoice.id}/pay`, {}, randomUUID());
      await load();
      clearActivity(deps.feedback);
      showActivity(deps.feedback, `Invoice ${invoice.number} paid. A receipt is queued for ${deps.user?.email}.`);
    } catch (e) {
      button.disabled = false;
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "invoice_paid"
            ? "This invoice is already paid."
            : e.detail.code === "billing_unavailable"
              ? "Billing is unreachable. Nothing was changed; try again in a moment."
              : fallbackCopy(e)
        );
      }
    }
  }

  // The operator issues invoices from Billing.
  if (activeUser.role === "operator") {
    const issuePanel = document.createElement("section");
    issuePanel.className = "panel";
    const issueTitle = document.createElement("h2");
    issueTitle.textContent = "Issue invoice";
    const form = document.createElement("form");
    form.className = "form-row";
    const tenantField = document.createElement("div");
    tenantField.innerHTML = `<label for="issue-tenant">Tenant</label>`;
    const tenantSelect = document.createElement("select");
    tenantSelect.id = "issue-tenant";
    tenantSelect.required = true;
    tenantSelect.add(new Option("Choose a tenant", ""));
    tenantField.appendChild(tenantSelect);
    const monthField = document.createElement("div");
    monthField.innerHTML = `<label for="issue-month">Invoice month</label>`;
    const monthInput = document.createElement("input");
    monthInput.type = "month";
    monthInput.id = "issue-month";
    monthInput.required = true;
    monthField.appendChild(monthInput);
    const issueButton = document.createElement("button");
    issueButton.className = "btn primary";
    issueButton.type = "submit";
    issueButton.textContent = "Issue invoice";
    form.append(tenantField, monthField, issueButton);
    issuePanel.append(issueTitle, form);
    screen.insertBefore(issuePanel, packPanel);

    const tenants = await apiJson<{ tenants: Array<{ id: string; business_name: string }> }>("GET", "/api/tenants");
    for (const t of tenants.tenants) tenantSelect.add(new Option(t.business_name, t.id));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      showActivity(deps.feedback, "Issuing invoice…");
      try {
        const invoice = await apiJson<Invoice>("POST", "/api/invoices", {
          tenant_id: tenantSelect.value,
          period: monthInput.value
        });
        tenantId = tenantSelect.value;
        await load();
        clearActivity(deps.feedback);
        const businessName = tenantSelect.options[tenantSelect.selectedIndex]?.text ?? "";
        showActivity(
          deps.feedback,
          `Invoice ${invoice.number} issued. Its email notice is queued for ${businessName}.`
        );
      } catch (e) {
        if (e instanceof ApiClientError) {
          showError(
            deps.feedback,
            e.detail.code === "nothing_to_invoice"
              ? `Nothing to invoice for ${monthInput.value}.`
              : e.detail.code === "billing_unavailable"
                ? "Billing is unreachable. Nothing was changed; try again in a moment."
                : e.detail.code === "storage_unavailable"
                  ? "Document storage is unreachable. No invoice was issued; try again in a moment."
                  : fallbackCopy(e)
          );
        }
      }
    });
  }

  await load();
}

function movementWord(reason: string): string {
  switch (reason) {
    case "opening_balance":
      return "Opening balance";
    case "pack_purchase":
      return "Pack purchase";
    case "booking":
      return "Booking";
    case "cancellation_return":
      return "Cancellation return";
    case "fee_refund":
      return "Fee refund";
    default:
      return reason;
  }
}
