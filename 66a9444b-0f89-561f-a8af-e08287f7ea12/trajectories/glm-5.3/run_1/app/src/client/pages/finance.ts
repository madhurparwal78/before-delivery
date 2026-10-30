import { api, el, announce, problemText, eur, dateLong } from "../api.js";
import type { Order } from "../api.js";

interface Invoice {
  id: string;
  number: string;
  status: string;
  amount_cents: number;
  balance_cents: number;
  due_at: string;
  retries_used: number;
}

interface Mismatch {
  id: string;
  type: string;
  order_ref: string | null;
  killbill_amount_cents: number | null;
  status: string;
}

export async function renderFinance(root: HTMLElement): Promise<void> {
  const wrap = el("div", { class: "wrap" });
  wrap.append(el("h1", { class: "section-head", text: "Finance" }));
  const statusNode = el("div", { role: "status", "aria-label": "Finance status", text: "" });
  wrap.append(statusNode);

  let tab = "orders";
  const tabs = el("div", { class: "tabs" });
  const tabDefs: Array<[string, string]> = [
    ["orders", "Orders and refunds"],
    ["invoices", "Invoices"],
    ["vouchers", "Vouchers"],
    ["reconciliation", "Reconciliation"],
  ];
  const content = el("div");
  for (const [id, label] of tabDefs) {
    const btn = el("button", { text: label, role: "tab" });
    btn.addEventListener("click", () => {
      tab = id;
      void refresh();
    });
    tabs.append(btn);
  }
  wrap.append(tabs, content);

  async function refresh(): Promise<void> {
    content.replaceChildren();
    if (tab === "orders") {
      const searchInput = el("input", { type: "search", "aria-label": "Search orders" }) as HTMLInputElement;
      const searchBtn = el("button", { text: "Search" });
      const table = el("table", { class: "ruled" });
      const loadOrders = async (q: string): Promise<void> => {
        const orders = (await api<{ orders: Order[] }>(`/api/finance/orders?q=${encodeURIComponent(q)}`)).orders;
        table.replaceChildren();
        const head = el("thead");
        const headRow = el("tr");
        for (const col of ["Ref", "Buyer", "Status", "Total", "Refund"]) headRow.append(el("th", { text: col }));
        head.append(headRow);
        table.append(head);
        const tbody = el("tbody");
        for (const order of orders) {
          const tr = el("tr");
          tr.append(
            el("td", { text: order.ref }),
            el("td", { text: order.buyer_name }),
            el("td", { text: order.status }),
            el("td", { text: eur(order.total_cents) }),
          );
          const refundCell = el("td");
          const refundBtn = el("button", { text: "Refund selected lines", "aria-label": `Refund lines of ${order.ref}` });
          refundBtn.addEventListener("click", () => openRefundDialog(order));
          refundCell.append(refundBtn);
          tr.append(refundCell);
          tbody.append(tr);
        }
        table.append(tbody);
      };
      searchBtn.addEventListener("click", () => void loadOrders(searchInput.value));
      const searchLabel = el("label", { text: "Search orders (ref or email)" });
      searchLabel.append(searchInput);
      content.append(searchLabel, searchBtn, table);
      await loadOrders("");
    }

    if (tab === "invoices") {
      const invoices = (await api<{ invoices: Invoice[] }>("/api/invoices")).invoices;
      const table = el("table", { class: "ruled", "aria-label": "Invoices" });
      const head = el("thead");
      const headRow = el("tr");
      for (const col of ["Number", "Status", "Amount", "Balance", "Due", "Returns"]) headRow.append(el("th", { text: col }));
      head.append(headRow);
      table.append(head);
      const tbody = el("tbody");
      for (const invoice of invoices) {
        const tr = el("tr");
        tr.append(
          el("td", { text: invoice.number }),
          el("td", { text: invoice.status }),
          el("td", { text: eur(invoice.amount_cents) }),
          el("td", { text: eur(invoice.balance_cents) }),
          el("td", { text: dateLong(invoice.due_at) }),
        );
        const cell = el("td");
        if (invoice.status === "paid" || invoice.status === "retried") {
          const returnBtn = el("button", { text: `Record bank return for ${invoice.number}`, "aria-label": `Record bank return for ${invoice.number}` });
          returnBtn.addEventListener("click", async () => {
            try {
              const res = await api<{ status: string; next_retry_at: string | null }>(`/api/finance/invoices/${invoice.id}/returns`, {
                method: "POST",
                body: JSON.stringify({ note: "bank returned the collection" }),
              });
              announce(statusNode, res.status === "written_off"
                ? `Return recorded. Invoice ${invoice.number} is written off.`
                : `Return recorded. Next retry on ${res.next_retry_at ? dateLong(res.next_retry_at) : "—"}.`);
              await refresh();
            } catch (err) {
              announce(statusNode, problemText(err));
            }
          });
          cell.append(returnBtn);
        }
        tr.append(cell);
        tbody.append(tr);
      }
      table.append(tbody);
      content.append(table);
    }

    if (tab === "vouchers") {
      const amountInput = el("input", { type: "number", "aria-label": "Amount cents" }) as HTMLInputElement;
      const noteInput = el("input", { type: "text", "aria-label": "Note" }) as HTMLInputElement;
      const issueBtn = el("button", { text: "Issue voucher" });
      issueBtn.addEventListener("click", async () => {
        try {
          const res = await api<{ code: string; balance_cents: number }>("/api/finance/vouchers", {
            method: "POST",
            body: JSON.stringify({ amount_cents: Number(amountInput.value), note: noteInput.value }),
          });
          announce(statusNode, `Voucher ${res.code} issued for ${eur(res.balance_cents)}.`);
        } catch (err) {
          announce(statusNode, problemText(err));
        }
      });
      const ledgerHost = el("div");
      const accountInput = el("input", { type: "text", "aria-label": "Ledger account", placeholder: "voucher:KERF-GIFT-A1" }) as HTMLInputElement;
      const loadBtn = el("button", { text: "Load ledger" });
      loadBtn.addEventListener("click", async () => {
        try {
          const res = await api<{ account: string; balance_cents: number; movements: Array<{ id: number; kind: string; amount_cents: number; created_at: string; actor: string; order_ref: string | null; entries: Array<{ account: string; side: string; amount_cents: number }> }> }>(`/api/finance/ledger?account=${encodeURIComponent(accountInput.value)}`);
          ledgerHost.replaceChildren();
          ledgerHost.append(el("div", { text: `${res.account} balance: ${eur(res.balance_cents)}` }));
          const table = el("table", { class: "ruled" });
          const head = el("thead");
          const headRow = el("tr");
          for (const col of ["Movement", "Kind", "Amount", "Entries"]) headRow.append(el("th", { text: col }));
          head.append(headRow);
          table.append(head);
          const tbody = el("tbody");
          for (const m of res.movements) {
            const tr = el("tr");
            tr.append(
              el("td", { text: String(m.id) }),
              el("td", { text: m.kind }),
              el("td", { text: eur(m.amount_cents) }),
              el("td", { text: m.entries.map((e) => `${e.account} ${e.side} ${eur(e.amount_cents)}`).join(" · ") }),
            );
            tbody.append(tr);
          }
          table.append(tbody);
          ledgerHost.append(table);
        } catch (err) {
          announce(statusNode, problemText(err));
        }
      });
      const amountLabel = el("label", { text: "Amount cents" });
      amountLabel.append(amountInput);
      const noteLabel = el("label", { text: "Note" });
      noteLabel.append(noteInput);
      content.append(amountLabel, noteLabel, issueBtn, accountInput, loadBtn, ledgerHost);
    }

    if (tab === "reconciliation") {
      const runBtn = el("button", { text: "Run reconciliation" });
      const table = el("table", { class: "ruled", "aria-label": "Mismatches" });
      const load = async (): Promise<void> => {
        const res = await api<{ mismatches: Mismatch[] }>("/api/finance/mismatches?status=open");
        table.replaceChildren();
        const head = el("thead");
        const headRow = el("tr");
        for (const col of ["Id", "Type", "Order", "KB amount", "Resolve"]) headRow.append(el("th", { text: col }));
        head.append(headRow);
        table.append(head);
        const tbody = el("tbody");
        for (const mismatch of res.mismatches) {
          const tr = el("tr");
          tr.append(
            el("td", { text: mismatch.id.slice(0, 8) }),
            el("td", { text: mismatch.type }),
            el("td", { text: mismatch.order_ref ?? "—" }),
            el("td", { text: mismatch.killbill_amount_cents === null ? "—" : eur(mismatch.killbill_amount_cents) }),
          );
          const cell = el("td");
          const resolveBtn = el("button", { text: `Resolve mismatch ${mismatch.id}`, "aria-label": `Resolve mismatch ${mismatch.id}` });
          resolveBtn.addEventListener("click", () => {
            const note = noteInput.value.trim();
            if (note.length === 0) {
              announce(statusNode, "Write a note explaining the resolution.");
              return;
            }
            void api(`/api/finance/mismatches/${mismatch.id}/resolve`, { method: "POST", body: JSON.stringify({ note }) })
              .then(async () => {
                announce(statusNode, "Mismatch resolved.");
                await load();
              })
              .catch((err) => announce(statusNode, problemText(err)));
          });
          cell.append(resolveBtn);
          tr.append(cell);
          tbody.append(tr);
        }
        table.append(tbody);
      };
      const noteLabel = el("label", { text: "Resolution note" });
      const noteInput = el("input", { type: "text", "aria-label": "Resolution note" }) as HTMLInputElement;
      noteLabel.append(noteInput);
      runBtn.addEventListener("click", async () => {
        announce(statusNode, "Reconciling with the payment service…");
        try {
          const run = await api<{ mismatches: Mismatch[]; checked_transactions: number }>("/api/finance/reconciliation-runs", { method: "POST" });
          announce(statusNode, `${run.mismatches.filter((m) => m.status === "open").length} open mismatches.`);
          await load();
        } catch (err) {
          announce(statusNode, problemText(err));
        }
      });
      await load();
      content.append(runBtn, noteLabel, table);
    }
  }

  function openRefundDialog(order: Order): void {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Refund lines");
    const inner = el("div", { class: "dialog-inner" });
    inner.append(el("h2", { text: `Refund lines of ${order.ref}` }));
    const checkboxes: Array<[number, HTMLInputElement, string]> = [];
    for (const line of order.lines) {
      const box = el("input", { type: "checkbox" }) as HTMLInputElement;
      box.disabled = !(line.state === "captured" || line.state === "transferred");
      const label = el("label", {}, box, document.createTextNode(` ${line.title} (${line.state}, ${eur(line.charged_cents)})`));
      inner.append(label);
      checkboxes.push([line.id, box, line.state]);
    }
    const reasonInput = el("input", { type: "text", "aria-label": "Refund reason" }) as HTMLInputElement;
    const reasonLabel = el("label", { text: "Reason" });
    reasonLabel.append(reasonInput);
    inner.append(reasonLabel);
    const refundBtn = el("button", { text: "Refund selected lines" });
    refundBtn.addEventListener("click", async () => {
      const lineIds = checkboxes.filter(([, box]) => box.checked).map(([id]) => id);
      if (lineIds.length === 0) {
        announce(statusNode, "Select at least one line.");
        return;
      }
      try {
        const refund = await api<{ id: string; status: string }>(`/api/finance/orders/${order.id}/refunds`, {
          method: "POST",
          headers: { "Idempotency-Key": `rf-${order.id}-${lineIds.join("-")}` },
          body: JSON.stringify({ line_ids: lineIds, reason: reasonInput.value }),
        });
        announce(statusNode, refund.status === "pending"
          ? "Refund pending — we'll complete it as soon as our payment service is back."
          : `Refund started for ${lineIds.length} lines.`);
        dialog.close();
        dialog.remove();
        await refresh();
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    });
    const cancel = el("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      dialog.close();
      dialog.remove();
    });
    inner.append(refundBtn, cancel);
    dialog.append(inner);
    document.body.append(dialog);
    dialog.showModal();
  }

  root.append(wrap);
  await refresh();
}
