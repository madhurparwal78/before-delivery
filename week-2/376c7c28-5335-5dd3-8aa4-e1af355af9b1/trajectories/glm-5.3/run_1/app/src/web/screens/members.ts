import { api, ApiCallError, errorFields, chargeKindLabel, chargeStatusLabel, type Charge, type LedgerEntry } from "../api";
import { h, clear, dollars, screenDate, liveRegion, announce, debounce, screen as appScreen, registerRefresh, showModal, closeModal } from "../helpers";
import { me } from "../main";

type MemberRow = { id: string; name: string; handle: string; email: string; membership: string | null; card_status: string; balance_cents: number; active: boolean };
type MemberDetail = MemberRow & { entries: LedgerEntry[]; charges: Charge[] };

export function renderMembers(root: HTMLElement): void {
  const status = liveRegion("Members status");
  const search = h("input", { class: "input", type: "search", "aria-label": "Search members", placeholder: "Search members" });
  const tbody = h("tbody");
  const table = h("table", { class: "table", "aria-label": "Members" },
    h("thead", null, h("tr", null, h("th", { class: "cell", text: "Name" }), h("th", { class: "cell", text: "Handle" }), h("th", { class: "cell", text: "Email" }), h("th", { class: "cell", text: "Balance" }), h("th", { class: "cell", text: "Status" }))),
    tbody);
  const detailPanel = h("section", { class: "panel member-detail", "aria-label": "Member detail" });
  const layout = h("div", { class: "members-split" }, h("section", { class: "panel" }, search, table), detailPanel);
  root.appendChild(appScreen(layout, status));
  const timeZone = me()?.timeZone ?? "UTC";
  let selected: MemberRow | null = null;
  void load("");

  async function load(q: string): Promise<void> {
    try {
      const members = await api<MemberRow[]>(`/api/members?q=${encodeURIComponent(q)}`);
      clear(tbody);
      for (const member of members) {
        const link = h("a", { class: "member-link", text: member.name, href: `#member-${member.handle}` });
        link.addEventListener("click", (e) => {
          e.preventDefault();
          void select(member);
        });
        tbody.appendChild(h("tr", { class: member.active ? "" : "inactive-row" },
          h("td", { class: "cell" }, link, member.active ? null : h("span", { class: "inactive-tag", text: "INACTIVE" })),
          h("td", { class: "cell", text: member.handle }),
          h("td", { class: "cell", text: member.email }),
          h("td", { class: "cell mono", text: dollars(member.balance_cents) }),
          h("td", { class: "cell", text: member.active ? "" : "INACTIVE" })));
      }
    } catch {
      /* refill on next change */
    }
  }

  const searchDebounced = debounce(() => void load((search as HTMLInputElement).value.trim()), 300);
  search.addEventListener("input", searchDebounced);

  async function select(member: MemberRow): Promise<void> {
    selected = member;
    await renderDetail(member.id);
  }

  async function renderDetail(memberId: string): Promise<void> {
    let detail: MemberDetail;
    try {
      detail = await api<MemberDetail>(`/api/members/${encodeURIComponent(memberId)}`);
    } catch {
      return;
    }
    const dateOf = (d: string): string => screenDate(d, timeZone);
    clear(detailPanel);
    const adjustButton = h("button", { class: "btn", text: "Adjust credit" });
    const deactivateButton = h("button", { class: "btn", text: "Deactivate" });
    const reactivateButton = h("button", { class: "btn", text: "Reactivate" });
    const chargesBody = h("tbody");
    const chargesTable = h("table", { class: "table", "aria-label": "Charges" },
      h("thead", null, h("tr", null, h("th", { class: "cell", text: "Kind" }), h("th", { class: "cell", text: "Piece" }), h("th", { class: "cell", text: "Fee" }), h("th", { class: "cell", text: "Status" }), h("th", { class: "cell", text: "" }))),
      chargesBody);
    const ledgerBody = h("tbody");
    const ledgerTable = h("table", { class: "table", "aria-label": "Ledger" },
      h("thead", null, h("tr", null, h("th", { class: "cell", text: "Label" }), h("th", { class: "cell", text: "Amount" }))),
      ledgerBody);
    for (const entry of detail.entries) {
      ledgerBody.appendChild(h("tr", null, h("td", { class: "cell", text: entry.kind }), h("td", { class: "cell mono", text: dollars(entry.amount_cents) })));
    }
    for (const charge of detail.charges) {
      const refundButton = charge.status === "settled" ? h("button", { class: "btn small", text: `Refund ${charge.piece_title}` }) : null;
      refundButton?.addEventListener("click", () => openRefundDialog(refundButton, charge, detail.id));
      chargesBody.appendChild(h("tr", null,
        h("td", { class: "cell", text: chargeKindLabel(charge, dateOf) }),
        h("td", { class: "cell", text: charge.piece_title }),
        h("td", { class: "cell mono", text: dollars(charge.fee_cents) }),
        h("td", { class: "cell", text: chargeStatusLabel(charge) }),
        h("td", { class: "cell" }, refundButton)));
    }
    detailPanel.append(
      h("div", { class: "member-head" },
        h("h2", { class: "subheading", text: detail.name }),
        detail.active ? null : h("span", { class: "inactive-tag", text: "INACTIVE" })),
      h("div", { class: "muted", text: `${detail.handle} · ${detail.email} · ${detail.membership ?? ""} · card ${detail.card_status === "on_file" ? "on file" : "none"}` }),
      h("div", { class: "fig big", text: detail.balance_cents < 0 ? `OWING ${dollars(-detail.balance_cents)}` : `BALANCE ${dollars(detail.balance_cents)}` }),
      chargesTable,
      ledgerTable,
      h("div", { class: "button-row" }, adjustButton, detail.active ? deactivateButton : reactivateButton),
    );

    adjustButton.addEventListener("click", () => openAdjustDialog(adjustButton, detail.id));
    deactivateButton.addEventListener("click", () => openDeactivateDialog(deactivateButton, detail));
    reactivateButton.addEventListener("click", () => void reactivate(detail.id));
  }

  function openAdjustDialog(opener: HTMLElement, memberId: string): void {
    const amount = h("input", { class: "input", type: "text", id: "adjust-amount", "data-field": "amount_cents" });
    const reason = h("input", { class: "input", type: "text", id: "adjust-reason", "data-field": "reason" });
    const submit = h("button", { class: "btn primary", text: "Post adjustment" });
    const cancel = h("button", { class: "btn", text: "Cancel" });
    const dialog = h("div", { class: "dialog panel", "aria-label": "Adjust credit" },
      h("div", { class: "caption", text: "ADJUST CREDIT" }),
      fieldBlock("Amount ($)", amount, "adjust-amount"),
      fieldBlock("Reason", reason, "adjust-reason"),
      submit,
      cancel);
    const onSubmit = (): void => {
      submit.setAttribute("disabled", "true");
      announce(status, "Posting…");
      void (async () => {
        const raw = (amount as HTMLInputElement).value.trim();
        const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
        if (!match) {
          submit.removeAttribute("disabled");
          announce(status, "Fix the highlighted fields.");
          return;
        }
        const cents = Number(`${match[1]}${match[2]}${(match[3] ?? "").padEnd(2, "0")}`) * (match[1] ? -1 : 1);
        try {
          const res = await api<{ balance_cents: number }>(`/api/members/${encodeURIComponent(memberId)}/adjustments`, { method: "POST", body: { amount_cents: cents, reason: (reason as HTMLInputElement).value } });
          closeModal();
          announce(status, `Adjustment posted. Balance ${dollars(res.balance_cents)}.`);
          await renderDetail(memberId);
        } catch (err) {
          const fields = errorFields(err);
          if (fields) {
            applyErrors(dialog, fields);
            announce(status, "Fix the highlighted fields.");
          } else if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
          else announce(status, "No connection. Check the studio wifi and try again.");
          submit.removeAttribute("disabled");
        }
      })();
    };
    submit.addEventListener("click", onSubmit);
    cancel.addEventListener("click", () => closeModal());
    showModal(dialog, opener);
  }

  function openRefundDialog(opener: HTMLElement, charge: Charge, memberId: string): void {
    const reason = h("input", { class: "input", type: "text", id: "refund-reason", "data-field": "reason" });
    const submit = h("button", { class: "btn primary", text: "Confirm refund" });
    const cancel = h("button", { class: "btn", text: "Cancel" });
    const dialog = h("div", { class: "dialog panel", "aria-label": "Refund charge" },
      h("div", { class: "caption", text: "REFUND CHARGE" }),
      h("p", { text: `${charge.piece_title} · ${dollars(charge.fee_cents)}` }),
      fieldBlock("Reason", reason, "refund-reason"),
      submit,
      cancel);
    submit.addEventListener("click", () => {
      submit.setAttribute("disabled", "true");
      announce(status, "Refunding…");
      void (async () => {
        try {
          const res = await api<{ charge: Charge; balance_cents: number }>(`/api/charges/${encodeURIComponent(charge.id)}/refund`, { method: "POST", body: { reason: (reason as HTMLInputElement).value } });
          closeModal();
          if (res.charge.status === "refund_pending") {
            announce(status, "Refund sent to billing. It shows as Refund pending until billing confirms it.");
          } else {
            announce(status, `Refund issued. Balance ${dollars(res.balance_cents)}.`);
          }
          await renderDetail(memberId);
        } catch (err) {
          const fields = errorFields(err);
          if (fields) {
            applyErrors(dialog, fields);
            announce(status, "Fix the highlighted fields.");
          } else if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
          else announce(status, "No connection. Check the studio wifi and try again.");
          submit.removeAttribute("disabled");
        }
      })();
    });
    cancel.addEventListener("click", () => closeModal());
    showModal(dialog, opener);
  }

  function openDeactivateDialog(opener: HTMLElement, member: MemberRow): void {
    const confirm = h("button", { class: "btn primary", text: "Confirm deactivation" });
    const cancel = h("button", { class: "btn", text: "Cancel" });
    const dialog = h("div", { class: "dialog panel", "aria-label": "Deactivate member" },
      h("div", { class: "caption", text: "DEACTIVATE MEMBER" }),
      h("p", { text: `Deactivate ${member.name}?` }),
      confirm,
      cancel);
    confirm.addEventListener("click", () => {
      confirm.setAttribute("disabled", "true");
      announce(status, "Deactivating…");
      void (async () => {
        try {
          await api(`/api/members/${encodeURIComponent(member.id)}/deactivate`, { method: "POST", body: {} });
          closeModal();
          announce(status, `${member.name} deactivated. Their sessions have ended.`);
          await load((search as HTMLInputElement).value.trim());
          await renderDetail(member.id);
        } catch (err) {
          if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
          else announce(status, "No connection. Check the studio wifi and try again.");
          confirm.removeAttribute("disabled");
        }
      })();
    });
    cancel.addEventListener("click", () => closeModal());
    showModal(dialog, opener);
  }

  async function reactivate(memberId: string): Promise<void> {
    announce(status, "Reactivating…");
    try {
      const member = await api<MemberRow>(`/api/members/${encodeURIComponent(memberId)}/reactivate`, { method: "POST", body: {} });
      announce(status, `${member.name} can sign in again.`);
      await load((search as HTMLInputElement).value.trim());
      await renderDetail(memberId);
    } catch (err) {
      if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
      else announce(status, "No connection. Check the studio wifi and try again.");
    }
  }

  function applyErrors(form: HTMLElement, fields: Record<string, string>): void {
    const containers = form.querySelectorAll<HTMLElement>(".field");
    for (const container of containers) {
      const input = container.querySelector<HTMLInputElement>("input");
      const errorEl = container.querySelector<HTMLElement>(".field-error");
      if (!input || !errorEl) continue;
      const message = fields[input.getAttribute("data-field") ?? input.id];
      if (message) errorEl.textContent = message;
    }
  }

  function fieldBlock(label: string, input: HTMLElement, id: string): HTMLElement {
    return h("div", { class: "field" }, h("label", { for: id, text: label }), input, h("div", { class: "field-error", "data-for": id }));
  }

  registerRefresh(() => {
    void load((search as HTMLInputElement).value.trim());
    if (selected) void renderDetail(selected.id);
  });
}
