import { api, ApiError } from "../api";
import { el, fmtHours } from "../ui";
import { state, actionPaused } from "../main";

interface MemberRow {
  id: string;
  business: string;
  contact_email: string;
  covered_until: string | null;
  month_hours: string;
  pack_balance_quarters: number;
}

export function renderMembers(container: HTMLElement): void {
  const wide = el("div", { class: "wide editorial" });
  wide.append(el("h1", { class: "page-title", text: "Members" }));
  const statusRegion = el("div", { role: "status", "aria-label": "Form status", class: "status-line" });
  const content = el("div");
  wide.append(statusRegion, content);
  container.append(wide);

  async function refresh(): Promise<void> {
    const body = await api<{ members: MemberRow[] }>("GET", `/kitchens/${state.user!.kitchen_id}/members`);
    content.replaceChildren();
    const table = el("table", { class: "data card-table", "aria-label": "Members" });
    const headRow = el("tr");
    for (const column of ["Business", "Contact", "Papers covered until", "Hours this month", "Pack balance"]) {
      headRow.append(el("th", { text: column, class: ["Hours this month", "Pack balance"].includes(column) ? "num" : "" }));
    }
    const thead = el("thead");
    thead.append(headRow);
    table.append(thead);
    const tbody = el("tbody");
    for (const member of body.members) {
      const row = el("tr");
      row.append(el("td", { text: member.business, "data-label": "Business" }));
      row.append(el("td", { text: member.contact_email, "data-label": "Contact" }));
      row.append(el("td", { text: member.covered_until ?? "\u2014", class: "num", "data-label": "Papers covered until" }));
      row.append(el("td", { text: member.month_hours, class: "num", "data-label": "Hours this month" }));
      row.append(el("td", { text: fmtHours(member.pack_balance_quarters), class: "num", "data-label": "Pack balance" }));
      const actions = el("td", { class: "actions", "data-label": "Actions" });
      const buy = el("button", { class: "btn", onclick: () => void buyPack(member) });
      buy.textContent = "Buy 20-hour pack";
      if (actionPaused("buy_pack")) {
        buy.disabled = true;
      }
      actions.append(buy);
      row.append(actions);
      tbody.append(row);
    }
    table.append(tbody);
    content.append(table);
  }

  async function buyPack(member: MemberRow): Promise<void> {
    statusRegion.textContent = "Adding pack…";
    try {
      await api("POST", `/members/${member.id}/packs`, {}, {
        "Idempotency-Key": `pack-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      statusRegion.textContent = `20-hour pack added for ${member.business}. Balance ${fmtHours(0)} hours.`;
      await refresh();
      const pack = await api<{ balance_hours: string }>("GET", `/members/${member.id}/pack`);
      statusRegion.textContent = `20-hour pack added for ${member.business}. Balance ${pack.balance_hours} hours.`;
    } catch (error) {
      if (error instanceof ApiError && error.code === "billing_unavailable") {
        statusRegion.textContent = "Billing is unreachable. Pack purchases are paused; try again shortly.";
      } else {
        statusRegion.textContent = error instanceof ApiError ? error.message : "Something went wrong.";
      }
    }
  }

  window.addEventListener("pilotlight:status", () => {
    void refresh();
  });
  void refresh();
}
