// The newsroom's licences table, the originals dialog with fresh grants, and
// the licensing manager's Usage screen with its CSV export.
import { el, clear, money } from "./dom.js";
import { api, errorOf } from "./api.js";
import type { User } from "./shell.js";

interface Licence {
  id: string;
  essay_id: string;
  essay_title: string;
  credit_line: string | null;
  kind: string;
  state: string;
  window_end: string;
  window_end_display: string;
  amount_minor: number;
  invoice_state: string;
  receipt_state: string | null;
  frames: { id: string; position: number }[];
}

function stateLabel(state: string): string {
  return { pending_invoice: "Pending invoice", active: "Active", expired: "Expired", revoked: "Revoked" }[state] ?? state;
}
function invoiceLabel(state: string): string {
  return state === "raised" ? "Raised" : "Pending";
}
function receiptLabel(state: string | null): string {
  if (state === "sent") return "Sent";
  if (state === "cancelled") return "Cancelled";
  if (state === "queued") return "Queued";
  return "";
}

export async function renderLicences(main: HTMLElement, user: User, focusDownload = false): Promise<void> {
  clear(main);
  main.append(el("h1", { class: "display", text: "Licences" }));
  const result = await api.get<{ licences: Licence[] }>("/api/licences");
  if (result.status !== 200) {
    const err = errorOf(result);
    main.append(el("div", { class: "status", role: "status", text: err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again." }));
    return;
  }
  const licences = (result.body as { licences: Licence[] }).licences;
  const table = el("table", { class: "table", "aria-label": "Licences" },
    el("thead", {},
      el("tr", {},
        el("th", { text: "Essay" }),
        el("th", { text: "Kind" }),
        el("th", { text: "State" }),
        el("th", { text: "Window ends" }),
        el("th", { text: "Amount" }),
        el("th", { text: "Invoice" }),
        el("th", { text: "Receipt" }),
        el("th", { text: "" }),
      ),
    ),
  );
  const tbody = el("tbody", {});
  for (const licence of licences) {
    const row = el("tr", {},
      el("td", { class: "title-cell", text: licence.state === "revoked" ? "Removed essay (legal takedown)" : licence.essay_title }),
      el("td", { text: licence.kind }),
      el("td", { text: stateLabel(licence.state) }),
      el("td", { class: "mono", text: licence.window_end_display }),
      el("td", { class: "mono", text: money(licence.amount_minor) }),
      el("td", { text: invoiceLabel(licence.invoice_state) }),
      el("td", { text: receiptLabel(licence.receipt_state) }),
    );
    if (user.role === "picture_editor") {
      const cell = el("td", {});
      if (licence.state === "active" && licence.frames.length > 0) {
        const btn = el("button", { class: "btn", type: "button", "aria-label": `Download originals for ${licence.essay_title}`, text: "Download originals" }) as HTMLButtonElement;
        btn.addEventListener("click", () => openOriginals(licence, btn));
        cell.append(btn);
      }
      row.append(cell);
    }
    tbody.append(row);
  }
  table.append(tbody);
  main.append(table);
  if (focusDownload) {
    void 0;
  }
}

function openOriginals(licence: Licence, opener: HTMLElement): void {
  const status = el("div", { id: "download-status", class: "status", role: "status", "aria-label": "Download status" });
  const list = el("div", { class: "download-list" });
  for (const frame of licence.frames) {
    const btn = el("button", { class: "btn", type: "button", "aria-label": `Download frame ${frame.position}`, text: `Download frame ${frame.position}` }) as HTMLButtonElement;
    btn.addEventListener("click", async () => {
      status.textContent = "Preparing download…";
      const result = await api.post<{ url: string }>(`/api/licences/${licence.id}/grants`, { frame_id: frame.id });
      const err = errorOf(result);
      if (result.network) {
        status.textContent = "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
        return;
      }
      if (err) {
        if (err.code === "licence_ended") status.textContent = `This licence ended at ${licence.window_end_display}. Originals are no longer available.`;
        else if (err.code === "licence_revoked") status.textContent = "Licence revoked after a legal takedown. Originals are no longer available.";
        else if (err.code === "licence_pending") status.textContent = "The invoice is still pending; originals unlock when it is raised.";
        else if (err.code === "storage_unavailable") status.textContent = "Image storage is unreachable. Try again shortly.";
        else status.textContent = err.message;
        return;
      }
      const grant = result.body as { url: string };
      status.textContent = "Download ready.";
      const link = document.createElement("a");
      link.href = grant.url;
      link.download = "";
      document.body.append(link);
      link.click();
      link.remove();
    });
    list.append(btn);
  }
  const dialog = el("dialog", { class: "modal", "aria-label": `Originals: ${licence.essay_title}`, role: "dialog" },
    el("h2", { class: "display", text: `Originals: ${licence.essay_title}` }),
    status,
    list,
  );
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  const close = (): void => {
    dialog.remove();
    document.removeEventListener("keydown", keydown);
    opener.focus();
  };
  const keydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", keydown);
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
  const firstBtn = dialog.querySelector("button");
  (firstBtn as HTMLElement | null)?.focus();
}

interface Usage {
  newsroom: { slug: string; name: string };
  active: number;
  pending_invoice: number;
  expired: number;
  revoked: number;
  exclusive: number;
  standard: number;
  invoiced_minor: number;
  shortlist_count: number;
  next_expiry: { licence_id: string; window_end: string; window_end_display: string } | null;
}

export async function renderUsage(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(el("h1", { class: "display", text: "Usage" }));
  const result = await api.get<Usage>("/api/usage");
  if (result.status !== 200) {
    const err = errorOf(result);
    main.append(el("div", { class: "status", role: "status", text: err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again." }));
    return;
  }
  const usage = result.body as Usage;
  const totals = el("div", { class: "usage-totals", role: "region", "aria-label": "Usage totals" },
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: String(usage.active) }), el("div", { class: "dim", text: "Active" })),
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: String(usage.pending_invoice) }), el("div", { class: "dim", text: "Pending invoice" })),
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: String(usage.expired) }), el("div", { class: "dim", text: "Expired" })),
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: String(usage.revoked) }), el("div", { class: "dim", text: "Revoked" })),
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: String(usage.exclusive) }), el("div", { class: "dim", text: "Exclusive" })),
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: String(usage.standard) }), el("div", { class: "dim", text: "Standard" })),
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: money(usage.invoiced_minor) }), el("div", { class: "dim", text: "Invoiced" })),
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: String(usage.shortlist_count) }), el("div", { class: "dim", text: "Shortlist" })),
    el("div", { class: "usage-item" }, el("div", { class: "usage-num mono", text: usage.next_expiry ? usage.next_expiry.window_end_display : "—" }), el("div", { class: "dim", text: "Next expiry" })),
  );

  const licencesResult = await api.get<{ licences: Licence[] }>("/api/licences");
  const expiries = el("table", { class: "table", "aria-label": "Licence expiries" },
    el("thead", {}, el("tr", {}, el("th", { text: "Essay" }), el("th", { text: "Kind" }), el("th", { text: "Window ends" }))),
  );
  const tbody = el("tbody", {});
  if (licencesResult.status === 200) {
    const licences = (licencesResult.body as { licences: Licence[] }).licences;
    for (const licence of licences) {
      if (licence.state !== "active") continue;
      if (!usage.next_expiry || licence.id !== usage.next_expiry.licence_id) {
        // The expiries table lists licences eligible for next_expiry: the
        // active ones, in next-expiry order.
      }
      tbody.append(el("tr", {},
        el("td", { text: licence.essay_title }),
        el("td", { text: licence.kind }),
        el("td", { class: "mono", text: licence.window_end_display }),
      ));
    }
  }
  expiries.append(tbody);

  const exportLink = el("a", { class: "btn", href: "/api/usage.csv", text: "Export CSV" });
  exportLink.setAttribute("aria-label", "Export CSV");
  main.append(totals, el("h2", { class: "display", text: "Licence expiries" }), expiries, exportLink);
}
