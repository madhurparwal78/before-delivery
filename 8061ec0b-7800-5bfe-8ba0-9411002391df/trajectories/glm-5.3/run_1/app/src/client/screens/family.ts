// My family (DP-38, DP-39).
import { api } from "../api.js";
import { h } from "../ui/dom.js";
import { formatMoney } from "../format.js";
import type { RenderContext } from "../router.js";

interface FamilyResponse {
  family: { id: string; parent_name: string; email: string };
  totals: { open_contracts: number; equity_cents: number; owned: number };
  students: {
    id: string;
    name: string;
    grade: number;
    school: { id: string; name: string };
    contracts: {
      id: string;
      status: string;
      instrument_label: string;
      serial: string;
      equity_cents: number;
    }[];
  }[];
}

export async function renderFamily(ctx: RenderContext): Promise<void> {
  ctx.root.appendChild(h("h1", { text: "My family" }));
  const data = await api<FamilyResponse>("GET", "/api/family");
  const totals = h("section", { class: "family-totals", "aria-label": "Family totals" });
  totals.appendChild(
    h("p", { class: "totals-line" },
      h("span", { class: "brass-text", text: `Equity across open contracts ${formatMoney(data.totals.equity_cents)}` }),
      h("span", { class: "totals-owned", text: `${data.totals.owned} owned` })
    )
  );
  ctx.root.appendChild(totals);

  for (const student of data.students) {
    const section = h("section", { class: "student-section", "aria-label": student.name });
    section.append(
      h("h2", { text: student.name }),
      h("p", { class: "muted", text: `${student.school.name} · Grade ${student.grade}` })
    );
    if (student.contracts.length > 0) {
      const list = h("ul", { class: "contract-list" });
      for (const contract of student.contracts) {
        list.appendChild(
          h("li", { class: "contract-list-item" },
            h("a", { class: "contract-link mono", href: `/contracts/${contract.id}`, text: contract.id }),
            h("span", { text: `${contract.instrument_label} ${contract.serial}` }),
            h("span", { class: "brass-text", text: formatMoney(contract.equity_cents) }),
            h("span", { class: "muted", text: statusWord(contract.status) })
          )
        );
      }
      section.appendChild(list);
    } else {
      section.appendChild(h("p", { class: "muted", text: "No contracts yet." }));
    }
    const hasOpen = student.contracts.some((c) =>
      ["reserved", "agreement_sent", "signed", "active"].includes(c.status)
    );
    if (!hasOpen) {
      section.appendChild(
        h("a", {
          class: "btn btn-secondary reserve-link",
          href: `/reserve?student=${encodeURIComponent(student.id)}`,
          text: "Reserve an instrument",
        })
      );
    }
    ctx.root.appendChild(section);
  }
}

function statusWord(status: string): string {
  const words: Record<string, string> = {
    reserved: "Reserved",
    agreement_sent: "Agreement sent",
    signed: "Signed",
    active: "Active",
    paid_off: "Owned",
    exchanged: "Exchanged",
    returned: "Returned",
    written_off: "Written off",
    expired: "Expired",
  };
  return words[status] ?? status;
}
