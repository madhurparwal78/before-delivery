import { el, clear, announce, mountStatus } from "./ui.js";
import { api, ApiFailure, money, newKey } from "./api.js";
import { state, refreshMe, type Reservation } from "./state.js";
import { openSignInDialog } from "./authDialog.js";

interface DeskRow {
  reservation: Reservation & { buyer_email?: string; kb?: { paid_cents: number; refunded_cents: number } | null };
  refund_due_cents: number | null;
  kb: { paid_cents: number; refunded_cents: number } | null;
}

interface DeskPayload {
  billing: "ok" | "unavailable";
  reservations: (Reservation & { buyer_email: string; kb: { paid_cents: number; refunded_cents: number } | null })[];
}

/** A sign-out button shared by the staff screens. */
function signOutButton(onDone: () => Promise<void> | void): HTMLElement {
  const btn = el("button", { class: "btn btn-quiet" }, "Sign out");
  btn.addEventListener("click", async () => {
    await api("/api/auth/signout", { method: "POST" });
    await refreshMe();
    await onDone();
  });
  return btn;
}

/** The registrar desk: the reservations table with search and actions. */
export function buildDesk(root: HTMLElement): void {
  let query = "";
  let latestSearchId = 0;

  async function load(): Promise<void> {
    await refreshMe();
    render();
    await search("");
  }

  function render(): void {
    clear(root);
    const me = state.me;
    const wrap = el("div", { class: "staff-page" });
    wrap.append(el("h1", { class: "chapter-title", id: "desk-heading", tabindex: "-1" }, "Registrar desk"));
    if (!me) {
      wrap.append(el("p", { class: "lede" }, "Sign in as the registrar to open the desk."));
      const signIn = el("button", { class: "btn btn-live" }, "Sign in");
      signIn.addEventListener("click", () => openSignInDialog(signIn, load));
      wrap.append(signIn);
      root.append(wrap);
      return;
    }
    if (me.account.role !== "registrar" && me.account.role !== "director") {
      wrap.append(el("p", { class: "hint" }, "This desk is for the registrar."));
      wrap.append(signOutButton(load));
      root.append(wrap);
      return;
    }
    root.append(wrap);
  }

  function text(searchBox: HTMLInputElement): string {
    return searchBox.value;
  }

  let tableWrap: HTMLElement | null = null;
  let cardsWrap: HTMLElement | null = null;

  async function search(q: string): Promise<void> {
    const searchId = ++latestSearchId;
    query = q;
    let payload: DeskPayload | null = null;
    try {
      payload = await api<DeskPayload>(`/api/desk/reservations?q=${encodeURIComponent(q)}`);
    } catch {
      payload = null;
    }
    if (searchId !== latestSearchId) return;
    renderRows(payload);
  }

  function renderRows(payload: DeskPayload | null): void {
    const page = document.querySelector(".staff-page");
    if (!page) return;
    const me = state.me;
    if (!me || (me.account.role !== "registrar" && me.account.role !== "director")) return;
    const existing = page.querySelector(".desk-live");
    if (existing) existing.remove();

    const live = el("div", { class: "desk-live" });

    const searchBox = el("input", {
      class: "staff-search",
      type: "search",
      "aria-label": "Find a reservation",
      placeholder: "Find a reservation",
      value: query,
    }) as HTMLInputElement;
    let debounce = 0;
    searchBox.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        search(text(searchBox));
      }, 200);
    });

    const banner = el("div", { class: "billing-banner", role: "alert", hidden: "true" }, "Kill Bill is not answering. Paid and refunded totals will refresh when it is back.");

    live.append(searchBox, banner);

    const seats = el("div", { class: "seats-region", role: "region", "aria-label": "Seats" });
    const table = el("table", { class: "desk-table", "aria-label": "Reservations" });
    const cards = el("div", { class: "desk-cards" });
    tableWrap = table;
    cardsWrap = cards;

    if (payload && payload.billing === "unavailable") {
      banner.hidden = false;
    }

    const thead = el("thead", {});
    thead.append(
      el("tr", {},
        el("th", {}, "Bench"),
        el("th", {}, "Attendee"),
        el("th", {}, "Buyer"),
        el("th", {}, "Tier"),
        el("th", {}, "State"),
        el("th", {}, "Paid in Kill Bill"),
        el("th", {}, "Refunded in Kill Bill"),
        el("th", {}, "Refund due"),
        el("th", {}, "Licence"),
        el("th", {}, "")
      )
    );
    const tbody = el("tbody", {});
    table.append(thead, tbody);

    for (const row of payload?.reservations ?? []) {
      const actions = el("div", { class: "actions" });
      const kbPaid = payload?.billing === "ok" && row.kb ? money(row.kb.paid_cents) : "Unavailable";
      const kbRefunded = payload?.billing === "ok" && row.kb ? money(row.kb.refunded_cents) : "Unavailable";
      const refundDue = row.refund_due_cents !== null && row.refund_due_cents !== undefined ? money(row.refund_due_cents) : "—";

      if (row.state === "cancelled" && (row.refund_due_cents ?? 0) > 0) {
        const refundBtn = el("button", { class: "btn btn-live" }, `Issue refund $${money(row.refund_due_cents ?? 0)}`);
        refundBtn.addEventListener("click", async () => {
          try {
            await api(`/api/desk/reservations/${row.id}/refund`, { method: "POST", idempotencyKey: newKey() });
            await search(searchBox.value);
            announceDesk(`Refunded $${money(row.refund_due_cents ?? 0)} for Bench ${row.bench}.`);
          } catch (e) {
            if (e instanceof ApiFailure && e.body.error === "billing_unavailable") {
              announceDesk("Refund not sent: Kill Bill is not answering. Nothing was refunded.");
            }
          }
        });
        actions.append(refundBtn);
      }
      if (row.licence_status === "submitted" || row.licence_status === "rejected") {
        const open = el("button", { class: "btn" }, "Open licence");
        open.addEventListener("click", async () => {
          try {
            const res = await api<{ url: string }>(`/api/reservations/${row.id}/licence`);
            window.open(res.url, "_blank", "noopener");
          } catch {
            announceDesk("Documents are unavailable right now. Try again shortly.");
          }
        });
        const matched = el("button", { class: "btn" }, "Mark licence matched");
        matched.addEventListener("click", async () => {
          await api(`/api/desk/reservations/${row.id}/licence-review`, {
            method: "POST",
            body: JSON.stringify({ decision: "matched" }),
          });
          await search(searchBox.value);
          announceDesk(`Licence matched for ${row.attendee?.name ?? row.buyer.name}.`);
        });
        const rejected = el("button", { class: "btn btn-quiet" }, "Reject licence");
        rejected.addEventListener("click", async () => {
          await api(`/api/desk/reservations/${row.id}/licence-review`, {
            method: "POST",
            body: JSON.stringify({ decision: "rejected" }),
          });
          await search(searchBox.value);
          announceDesk(`Licence rejected for ${row.attendee?.name ?? row.buyer.name}.`);
        });
        actions.append(open, matched, rejected);
      }
      if (row.passport_status === "submitted" && !row.documents.includes("visa-letter")) {
        const visa = el("button", { class: "btn" }, "Issue visa letter");
        visa.addEventListener("click", async () => {
          try {
            await api(`/api/desk/reservations/${row.id}/visa-letter`, { method: "POST" });
            await search(searchBox.value);
            announceDesk(`Visa-support letter issued to ${row.attendee?.name ?? row.buyer.name}.`);
          } catch (e) {
            if (e instanceof ApiFailure && e.body.error === "storage_unavailable") {
              announceDesk("Visa letter not issued: document storage is not answering. Nothing was sent.");
            }
          }
        });
        actions.append(visa);
      }
      if (row.documents.includes("visa-letter")) {
        const download = el("button", { class: "btn btn-quiet" }, "Download visa letter");
        download.addEventListener("click", async () => {
          const res = await api<{ url: string }>(`/api/reservations/${row.id}/documents/visa-letter`);
          window.open(res.url, "_blank", "noopener");
        });
        actions.append(download);
      }
      if (row.state === "checked_in_day2" && !row.documents.includes("certificate")) {
        const cert = el("button", { class: "btn btn-live" }, "Issue certificate");
        cert.addEventListener("click", async () => {
          try {
            await api(`/api/desk/reservations/${row.id}/certificate`, { method: "POST" });
            await search(searchBox.value);
            announceDesk(`Certificate issued to ${row.attendee?.name ?? row.buyer.name}.`);
          } catch (e) {
            if (e instanceof ApiFailure) {
              if (e.body.error === "certificate_not_eligible") {
                const words: Record<string, string> = {
                  balance_unpaid: "balance unpaid",
                  day1_check_in: "day 1 check-in",
                  day2_check_in: "day 2 check-in",
                  licence_not_matched: "licence not matched",
                };
                announceDesk(`Certificate not ready: ${(e.body.missing ?? []).map((m) => words[m] ?? m).join(", ")}.`);
              } else if (e.body.error === "storage_unavailable") {
                announceDesk("Certificate not issued: document storage is not answering. No certificate number was used.");
              }
            }
          }
        });
        actions.append(cert);
      }
      if (row.documents.includes("certificate")) {
        const download = el("button", { class: "btn btn-quiet" }, "Download certificate");
        download.addEventListener("click", async () => {
          const res = await api<{ url: string }>(`/api/reservations/${row.id}/documents/certificate`);
          window.open(res.url, "_blank", "noopener");
        });
        actions.append(download);
      }

      const tr = el("tr", {},
        el("td", { class: "num" }, row.bench),
        el("td", {}, row.attendee?.name ?? "—"),
        el("td", {}, `${row.buyer.name} (${row.buyer_email ?? ""})`),
        el("td", {}, row.tier === "atelier" ? "Atelier" : "Bench"),
        el("td", {}, row.state === "deposit_paid" && !state.me?.deposits_open ? "Balance overdue" : row.state),
        el("td", { class: "num" }, kbPaid),
        el("td", { class: "num" }, kbRefunded),
        el("td", { class: "num" }, refundDue),
        el("td", {}, row.licence_status),
        el("td", {}, actions)
      );
      tbody.append(tr);

      const card = el("div", { class: "card" });
      card.append(
        el("h3", { class: "num" }, `Bench ${row.bench}`),
        el("p", { class: "hint" }, `${row.attendee?.name ?? "No attendee"} · ${row.state}`),
        el("p", { class: "hint" }, `Paid ${kbPaid} · Refunded ${kbRefunded} · Refund due ${refundDue}`),
        actions.cloneNode(true) as HTMLElement
      );
      cards.append(card);
    }

    live.append(table, cards, seats);
    mountStatus(live, "Desk updates");
    page.append(live);
  }

  function announceDesk(message: string): void {
    if (message) announce("Desk updates", message);
  }

  render();
  search("");
  window.setInterval(() => {
    const box = document.querySelector<HTMLInputElement>(".staff-search");
    if (box) search(box.value);
  }, 10000);
}

interface InventoryPayload {
  seats_total: number;
  seats_remaining: number;
  held: number;
  sold: number;
  waitlisted: { bench: number; atelier: number };
  atelier: { active: number; cap: number; remaining: number; sold_out: boolean };
}

/** The Seats region shared by the registrar desk and the content desk. */
export async function renderSeats(target: HTMLElement): Promise<void> {
  try {
    const inv = await api<InventoryPayload>("/api/desk/inventory");
    clear(target);
    target.append(
      el("span", {}, "Sold ", el("strong", { class: "num" }, String(inv.sold))),
      el("span", {}, "Held ", el("strong", { class: "num" }, String(inv.held))),
      el("span", {}, "Waitlisted ", el("strong", { class: "num" }, String(inv.waitlisted.bench + inv.waitlisted.atelier)))
    );
  } catch {
    /* keep the last render */
  }
}

export type _DeskRow = DeskRow;
