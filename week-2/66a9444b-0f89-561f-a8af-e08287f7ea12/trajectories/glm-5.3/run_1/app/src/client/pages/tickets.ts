import { api, el, eur, announce, deadlineFmt, me } from "../api.js";
import type { Order } from "../api.js";
import { openCheckout } from "./checkout.js";

interface WaitlistEntry {
  id: string;
  session_id: string;
  title: string;
  position: number;
  status: string;
  offer_expires_at: string | null;
}

export async function renderTickets(root: HTMLElement): Promise<void> {
  const wrap = el("div", { class: "wrap" });
  wrap.append(el("h1", { class: "section-head", text: "My tickets" }));
  const statusNode = el("div", { role: "status", text: "" });

  const ordersTable = el("table", { class: "ruled", "aria-label": "My orders" });
  const head = el("thead");
  const headRow = el("tr");
  for (const col of ["Ref", "Date", "Status", "Total"]) headRow.append(el("th", { text: col }));
  head.append(headRow);
  ordersTable.append(head);
  const tbody = el("tbody");

  const waitlistNode = el("ul", { "aria-label": "My waitlist" });

  async function refresh(): Promise<void> {
    const orders = (await api<{ orders: Order[] }>("/api/orders")).orders;
    tbody.replaceChildren();
    for (const order of orders) {
      const tr = el("tr");
      const link = el("a", { href: `/orders/${order.id}`, text: order.ref });
      tr.append(el("td", {}, link));
      tr.append(el("td", { text: order.created_at.slice(0, 10) }));
      tr.append(el("td", { text: order.status }));
      tr.append(el("td", { text: eur(order.total_cents) }));
      tbody.append(tr);
    }
    ordersTable.append(tbody);
    const waitlist = (await api<{ entries: WaitlistEntry[] }>("/api/waitlist")).entries;
    waitlistNode.replaceChildren();
    for (const entry of waitlist) {
      const li = el("li");
      if (entry.status === "offered" && entry.offer_expires_at) {
        li.append(el("span", { text: `${entry.title} — Claim by ${deadlineFmt(entry.offer_expires_at)}` }));
        const claimBtn = el("button", { text: `Claim seat for ${entry.title}`, "aria-label": `Claim seat for ${entry.title}` });
        claimBtn.addEventListener("click", async () => {
          try {
            await api(`/api/waitlist/${entry.id}/claim`, { method: "POST" });
            announce(statusNode, "Seat claimed and held.");
            openCheckout("tickets");
          } catch (err) {
            const body = (err as { body?: Record<string, unknown> }).body;
            if (body?.error === "offer_lapsed") {
              announce(statusNode, "This offer lapsed and the seat went to the next person.");
            } else {
              announce(statusNode, "Could not claim that seat.");
            }
            void refresh();
          }
        });
        li.append(claimBtn);
      } else {
        li.append(el("span", { text: `${entry.title} — position ${entry.position}` }));
      }
      waitlistNode.append(li);
    }
  }

  await refresh();
  wrap.append(ordersTable, el("h2", { text: "My waitlist" }), waitlistNode, statusNode);
  root.append(wrap);
  void me;
  window.setInterval(() => void refresh(), 10000);
}
