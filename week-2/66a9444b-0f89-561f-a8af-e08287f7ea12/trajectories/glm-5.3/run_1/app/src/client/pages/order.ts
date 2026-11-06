import { api, el, eur, announce, deadlineFmt, dateLong, clock } from "../api.js";
import type { Order } from "../api.js";
import { openCheckout } from "./checkout.js";

export async function renderOrder(root: HTMLElement, id: string): Promise<void> {
  const wrap = el("div", { class: "wrap" });
  const statusNode = el("div", { role: "status", "aria-label": "Order status", text: "" });
  let order: Order;

  async function refresh(): Promise<void> {
    let current: Order;
    try {
      current = await api<Order>(`/api/orders/${id}`);
    } catch {
      wrap.replaceChildren(el("h1", { class: "section-head", text: "Order not found" }));
      if (!wrap.parentElement) root.append(wrap);
      return;
    }
    order = current;
    wrap.replaceChildren();
    wrap.append(el("h1", { class: "section-head", text: `Order ${order.ref}` }));
    wrap.append(statusNode);
    if (order.confirmation_mail === "sent") announce(statusNode, "Confirmation email: sent");
    else announce(statusNode, "Confirmation email: pending — we'll send it as soon as our mail service is back.");
    if (order.proof_deadline && order.status === "proof_pending") {
      announce(statusNode, `Reduced rate awaiting proof — upload by ${deadlineFmt(order.proof_deadline)}.`);
    }
    if (order.status === "voided") announce(statusNode, "Reduced rate not approved — your payment authorisation was released.");
    if (order.refunds.some((r) => r.status === "pending")) {
      announce(statusNode, "Refund pending — we'll complete it as soon as our payment service is back.");
    }

    const table = el("table", { class: "ruled", "aria-label": "Order lines" });
    const head = el("thead");
    const headRow = el("tr");
    for (const col of ["Item", "Holder", "State", "List", "Discount", "Voucher", "To pay", "Pass"]) headRow.append(el("th", { text: col }));
    head.append(headRow);
    table.append(head);
    const tbody = el("tbody");
    for (const line of order.lines) {
      const tr = el("tr");
      tr.append(
        el("td", { text: line.title }),
        el("td", { text: line.holder_name }),
        el("td", { text: line.state }),
        el("td", { text: eur(line.list_cents) }),
        el("td", { text: eur(line.group_discount_cents) }),
        el("td", { text: eur(line.voucher_cents) }),
        el("td", { text: eur(line.charged_cents) }),
      );
      const passCell = el("td");
      if (line.pass && (line.state === "captured" || line.state === "transferred")) {
        const link = el("a", { href: `/api/orders/${current.id}/passes/${line.pass.code}`, text: `Download pass ${line.pass.code}` });
        link.addEventListener("click", async (e) => {
          e.preventDefault();
          try {
            const res = await fetch(`/api/orders/${current.id}/passes/${line.pass?.code}`);
            if (!res.ok) throw new Error("failed");
            const blob = await res.blob();
            const url2 = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url2;
            a.download = `${line.pass?.code}.pdf`;
            a.click();
            URL.revokeObjectURL(url2);
          } catch {
            announce(statusNode, "Your pass is safe but can't be downloaded right now. Try again in a moment.");
          }
        });
        passCell.append(link);
      }
      tr.append(passCell);

      if (line.state === "captured") {
        const transferCell = el("td");
        const transferBtn = el("button", { text: `Transfer ${line.title}`, "aria-label": `Transfer ${line.title}` });
        transferBtn.addEventListener("click", () => openTransferDialog(line.id, line.title));
        transferCell.append(transferBtn);
        tr.append(transferCell);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);

    if (order.status === "proof_pending" && order.proof_deadline) {
      const panel = el("div", { class: "panel", role: "group", "aria-label": "Proof of reduced rate" });
      panel.append(el("h2", { text: "Proof of reduced rate" }));
      const radioStudent = el("input", { type: "radio", name: "proof-kind", id: "proof-student", value: "student" }) as HTMLInputElement;
      const radioJobseeker = el("input", { type: "radio", name: "proof-kind", id: "proof-jobseeker", value: "jobseeker" }) as HTMLInputElement;
      radioStudent.checked = true;
      const studentLabel = el("label", { for: "proof-student", text: "Student" });
      const jobseekerLabel = el("label", { for: "proof-jobseeker", text: "Jobseeker" });
      const kindRow = el("div");
      kindRow.append(radioStudent, studentLabel, radioJobseeker, jobseekerLabel);
      const fileInput = el("input", { type: "file", "aria-label": "Proof document" }) as HTMLInputElement;
      const uploadBtn = el("button", { text: "Upload proof" });
      const uploadStatus = el("div", { role: "status", "aria-label": "Upload status", text: "" });
      uploadBtn.addEventListener("click", async () => {
        if (!fileInput.files || fileInput.files.length === 0) {
          announce(uploadStatus, "Choose a proof document first.");
          return;
        }
        const kind = radioStudent.checked ? "student" : "jobseeker";
        announce(uploadStatus, "Uploading…");
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", fileInput.files[0]);
        try {
          const proof = await api<{ deadline: string }>(`/api/orders/${order?.id}/proof`, { method: "POST", body: form });
          announce(uploadStatus, `Proof received. We'll decide by ${deadlineFmt(proof.deadline)}.`);
        } catch (err) {
          const body = (err as { body?: Record<string, Record<string, string>> }).body;
          const fileErr = body?.errors?.file;
          if (fileErr === "too_large" || fileErr === "unsupported_type") announce(uploadStatus, "Upload a PDF, JPEG or PNG file.");
          else announce(uploadStatus, "We couldn't store your file right now. Try again in a moment.");
        }
      });
      panel.append(kindRow, fileInput, uploadBtn, uploadStatus);
      wrap.append(panel);
    }
    if (!wrap.parentElement) root.append(wrap);
  }

  function openTransferDialog(lineId: number, title: string): void {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Transfer ticket");
    const inner = el("div", { class: "dialog-inner" });
    const heading = el("h2", { text: "Transfer ticket", id: "transfer-heading", tabindex: "-1" });
    const nameInput = el("input", { type: "text", "aria-label": "Recipient name" }) as HTMLInputElement;
    const emailInput = el("input", { type: "email", "aria-label": "Recipient email" }) as HTMLInputElement;
    const nameLabel = el("label", { text: "Recipient name" });
    nameInput.required = true;
    nameLabel.append(nameInput);
    const emailLabel = el("label", { text: "Recipient email" });
    emailInput.required = true;
    emailLabel.append(emailInput);
    const transferStatus = el("div", { role: "status", text: "" });
    const submit = el("button", { text: "Transfer ticket" });
    submit.addEventListener("click", async () => {
      announce(transferStatus, "Transferring…");
      try {
        const res = await api<{ line: { holder_name: string } }>(`/api/orders/${id}/lines/${lineId}/transfer`, {
          method: "POST",
          body: JSON.stringify({ recipient_name: nameInput.value, recipient_email: emailInput.value }),
        });
        announce(transferStatus, `Transferred to ${res.line.holder_name}. Their new pass is on its way and your old pass no longer scans.`);
        dialog.close();
        dialog.remove();
        await refresh();
        if (opener) opener.focus();
      } catch (err) {
        const body = (err as { body?: Record<string, unknown> }).body;
        if (body?.error === "already_transferred") announce(transferStatus, "This ticket was already transferred.");
        else if (body?.error === "storage_unavailable") announce(transferStatus, "We couldn't issue the new pass right now. Nothing changed — try again in a moment.");
        else announce(transferStatus, "Could not transfer that ticket.");
      }
    });
    const cancel = el("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      dialog.close();
      dialog.remove();
      if (opener) opener.focus();
    });
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      dialog.close();
      dialog.remove();
      if (opener) opener.focus();
    });
    inner.append(heading, nameLabel, emailLabel, submit, cancel, transferStatus);
    dialog.append(inner);
    document.body.append(dialog);
    dialog.showModal();
    nameInput.focus();
    void title;
    void dateLong;
    void clock;
    void openCheckout;
  }

  await refresh();
  window.setInterval(() => void refresh(), 10000);
}
