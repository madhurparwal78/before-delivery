import { api, el, announce, problemText, clock } from "../api.js";

interface Proof {
  id: string;
  order_id: string;
  order_ref: string;
  kind: string;
  status: string;
  uploaded_at: string;
  deadline: string;
  content_type: string;
  size_bytes: number;
  buyer_name?: string;
}

export async function renderBoxOffice(root: HTMLElement): Promise<void> {
  const wrap = el("div", { class: "wrap" });
  wrap.append(el("h1", { class: "section-head", text: "Box office" }));
  const statusNode = el("div", { role: "status", text: "" });
  wrap.append(statusNode);

  const proofQueue = el("section", { class: "panel", role: "region", "aria-label": "Proof queue" });
  proofQueue.append(el("h2", { text: "Proof queue" }));
  const decisionStatus = el("div", { role: "status", "aria-label": "Proof decision", text: "" });

  const doorScan = el("section", { class: "panel", role: "region", "aria-label": "Door scan" });
  doorScan.append(el("h2", { text: "Door scan" }));
  const scanStatus = el("div", { role: "status", "aria-label": "Door scan result", text: "" });

  const admissions = el("section", { class: "panel", role: "region", "aria-label": "Admissions" });
  admissions.append(el("h2", { text: "Admissions" }));

  async function refreshProofs(): Promise<void> {
    const host = el("div");
    const proofs = (await api<{ proofs: Proof[] }>("/api/box-office/proofs?status=pending")).proofs;
    const reasonInput = el("input", { type: "text", "aria-label": "Reason" }) as HTMLInputElement;
    for (const proof of proofs) {
      const row = el("div", { class: "row" });
      row.append(el("span", { text: `${proof.order_ref} — ${proof.buyer_name ?? ""} — ${proof.kind} (by ${clock(proof.deadline)})` }));
      const viewBtn = el("button", { text: `View proof for ${proof.order_ref}`, "aria-label": `View proof for ${proof.order_ref}` });
      viewBtn.addEventListener("click", async () => {
        const res = await api<{ url: string }>(`/api/box-office/proofs/${proof.id}/read`, { method: "POST" });
        window.open(res.url, "_blank");
      });
      const approveBtn = el("button", { text: `Approve ${proof.order_ref}`, "aria-label": `Approve ${proof.order_ref}` });
      approveBtn.addEventListener("click", async () => {
        try {
          const res = await api<{ order: { status: string } }>(`/api/box-office/proofs/${proof.id}/decision`, {
            method: "POST",
            body: JSON.stringify({ decision: "approve" }),
          });
          announce(decisionStatus, `Approved — payment taken for order ${proof.order_ref}.`);
          void res;
          await refreshProofs();
        } catch (err) {
          announce(decisionStatus, problemText(err));
        }
      });
      const rejectBtn = el("button", { text: `Reject ${proof.order_ref}`, "aria-label": `Reject ${proof.order_ref}` });
      rejectBtn.addEventListener("click", async () => {
        if (reasonInput.value.trim().length === 0) {
          announce(decisionStatus, "Write a reason for the rejection.");
          return;
        }
        try {
          await api(`/api/box-office/proofs/${proof.id}/decision`, {
            method: "POST",
            body: JSON.stringify({ decision: "reject", reason: reasonInput.value }),
          });
          announce(decisionStatus, `Rejected — authorisation released for order ${proof.order_ref}.`);
          await refreshProofs();
        } catch (err) {
          announce(decisionStatus, problemText(err));
        }
      });
      row.append(viewBtn, approveBtn, rejectBtn);
      host.append(row);
    }
    const reasonLabel = el("label", { text: "Reason" });
    reasonLabel.append(reasonInput);
    host.append(reasonLabel);
    proofQueue.append(host, decisionStatus);
  }

  async function renderScan(): Promise<void> {
    const programme = await api<{ sessions: Array<{ id: string; title: string }> }>("/api/programme");
    const sessionSelect = el("select", { "aria-label": "Session" }) as HTMLSelectElement;
    for (const session of programme.sessions) {
      sessionSelect.append(el("option", { value: session.id, text: session.title }));
    }
    const passInput = el("input", { type: "text", "aria-label": "Pass code" }) as HTMLInputElement;
    const scanBtn = el("button", { text: "Scan" });
    scanBtn.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/box-office/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pass_code: passInput.value, session_id: sessionSelect.value }),
        });
        const body = (await res.json()) as Record<string, unknown>;
        if (res.ok) {
          announce(scanStatus, `Admitted — ${String(body.holder_name)}, ${String(body.item_title)}`);
        } else if (body.error === "unknown_pass") {
          announce(scanStatus, "Unknown pass code");
        } else if (body.error === "admission_refused") {
          const reason = String(body.reason);
          if (reason === "already_admitted") announce(scanStatus, `Already admitted at ${clock(String(body.first_admitted_at))}`);
          else if (reason === "pass_transferred") announce(scanStatus, "This pass was transferred — ask for the new pass");
          else if (reason === "pass_refunded") announce(scanStatus, "This pass was refunded");
          else if (reason === "pass_voided") announce(scanStatus, "This pass is not valid");
          else if (reason === "not_entitled") announce(scanStatus, "This pass doesn't cover this session");
          else if (reason === "session_cancelled") announce(scanStatus, "This session is cancelled");
        }
      } catch {
        announce(scanStatus, "Scan failed.");
      }
      // The pass code field keeps focus for the next hardware scan.
      passInput.focus();
      passInput.select();
    });
    passInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        scanBtn.click();
      }
    });
    const sessionLabel = el("label", { text: "Session" });
    sessionLabel.append(sessionSelect);
    const passLabel = el("label", { text: "Pass code" });
    passLabel.append(passInput);
    doorScan.append(sessionLabel, passLabel, scanBtn, scanStatus);
  }

  async function renderAdmissions(): Promise<void> {
    const programme = await api<{ festival_days: Array<{ date: string; label: string }> }>("/api/programme");
    const daySelect = el("select", { "aria-label": "Festival day" }) as HTMLSelectElement;
    for (const day of programme.festival_days) {
      daySelect.append(el("option", { value: day.date, text: day.label }));
    }
    const table = el("table", { class: "ruled", "aria-label": "Admissions by venue" });
    const load = async (): Promise<void> => {
      try {
        const res = await api<{
          festival_day: string;
          venues: Array<{ venue_id: string; name: string; admissions: number }>;
          total: number;
        }>(`/api/box-office/admissions?festival_day=${daySelect.value}`);
        table.replaceChildren();
        const head = el("thead");
        const headRow = el("tr");
        headRow.append(el("th", { text: "Venue" }), el("th", { text: "Admissions" }));
        head.append(headRow);
        table.append(head);
        const tbody = el("tbody");
        for (const venue of res.venues) {
          const tr = el("tr");
          tr.append(el("td", { text: venue.name }), el("td", { text: String(venue.admissions) }));
          tbody.append(tr);
        }
        const totalRow = el("tr");
        totalRow.append(el("td", { text: "Total" }), el("td", { text: String(res.total) }));
        tbody.append(totalRow);
        table.append(tbody);
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    };
    daySelect.addEventListener("change", () => void load());
    const dayLabelNode = el("label", { text: "Festival day" });
    dayLabelNode.append(daySelect);
    admissions.append(dayLabelNode, table);
    await load();
  }

  await refreshProofs();
  await renderScan();
  await renderAdmissions();
  wrap.append(proofQueue, doorScan, admissions);
  root.append(wrap);
}
