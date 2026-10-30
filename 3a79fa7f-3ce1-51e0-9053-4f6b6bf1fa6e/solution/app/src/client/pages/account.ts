// /account (brief: Accounts): orders page by page, the trade-in, bookings, callbacks, registered boards with their
// warranty and transfer, and the change-password form.
import { api } from "../api.ts";
import { openDialog } from "../dialog.ts";
import { h, replace, uid } from "../dom.ts";
import { busy, clearErrors, form, input, showRefusal } from "../forms.ts";
import { capitalised, longDate, price } from "../format.ts";
import { toSignIn, type PageContext } from "../router.ts";
import { announce, session } from "../state.ts";
import { badge, onward, pageHead, scrollBox } from "../ui.ts";
import type { Order, Registration } from "./order.ts";

interface Booking {
  id: number;
  slot_id: number;
  status: string;
  customer_email: string;
}

/** The signed-in customer's callbacks and booking names, which the server writes into the /account page shell. */
interface AccountData {
  callbacks: { reference: string; label: string; topic: string }[];
  bookings: { id: number; label: string; location_name: string }[];
}

/**
 * Reads the account data the shell was served with, once; after a move within the site the shell is fetched again
 * so the lists are current.
 */
async function accountData(): Promise<AccountData> {
  const inline = document.getElementById("account-data");
  let text = inline?.textContent ?? null;
  inline?.remove();
  if (text === null) {
    let shell = "";
    try {
      shell = await (await fetch("/account", { credentials: "same-origin" })).text();
    } catch {
      // Offline: the callback and booking lists stay empty.
    }
    text = new DOMParser().parseFromString(shell, "text/html").getElementById("account-data")?.textContent ?? null;
  }
  const data = text ? (JSON.parse(text) as Partial<AccountData>) : {};
  return { callbacks: data.callbacks ?? [], bookings: data.bookings ?? [] };
}

type OrderPage = { orders: Order[]; next_cursor: string | null };

/** The orders table, newest first, with "Load more orders" while the server has a next page. */
function ordersSection(first: OrderPage): HTMLElement {
  if (!first.orders.length) return h("p", null, "No orders yet.");
  const rows = h("tbody");
  const addRows = (orders: Order[]) => rows.append(...orders.map((o) => h("tr", null,
    h("td", null, h("a", { href: `/account/orders/${o.number}` }, o.number)),
    h("td", null, longDate(o.placed_at)),
    h("td", null, capitalised(o.status)),
    h("td", null, price(o.total_cents)))));
  addRows(first.orders);
  let cursor = first.next_cursor;
  const alert = h("div", { role: "alert", class: "form-alert" });
  const more = h("button", { type: "button", class: "pill pill-outline", hidden: cursor === null }, "Load more orders");
  more.addEventListener("click", async () => {
    alert.textContent = "";
    const r = await busy(more, "Loading...", () => api<OrderPage>("GET", `/api/orders?cursor=${encodeURIComponent(cursor ?? "")}`));
    if (!r.ok) {
      alert.textContent = r.error.message;
      return;
    }
    addRows(r.data.orders);
    cursor = r.data.next_cursor;
    more.hidden = cursor === null;
    announce(`${r.data.orders.length} more orders shown.`);
  });
  return h("div", null,
    scrollBox("Your orders", h("table", { class: "data-table" },
      h("thead", null, h("tr", null, ["Order", "Date", "Status", "Total"].map((c) => h("th", { scope: "col" }, c)))), rows)),
    more, alert);
}

/** Registered boards with the server's warranty days left; "Transfer <serial>" hands one to another customer. */
function boardsSection(registrations: Registration[]): HTMLElement {
  const list = h("ul", { class: "plain-list" });
  const empty = () => h("li", null, "No boards registered yet. Register a board from its delivered order.");
  const row = (r: Registration): HTMLElement => {
    const transfer = h("button", { type: "button", class: "pill pill-small pill-outline" }, `Transfer ${r.serial}`);
    const item = h("li", { class: "registration" },
      h("span", { class: "registration-name" }, `${r.board_name} ${r.serial}`),
      h("span", null, `Board warranty: ${r.board_days_left} days left`),
      h("span", null, `Battery warranty: ${r.battery_days_left} days left`),
      transfer);
    transfer.addEventListener("click", () => {
      const email = input("New owner's email", { type: "email", name: "email", autocomplete: "off" });
      const submit = h("button", { type: "submit", class: "pill" }, "Transfer board");
      const cancel = h("button", { type: "button", class: "pill pill-outline" }, "Cancel");
      const titleId = uid("transfer");
      const f = form({ class: "stack-form" }, email.wrap, h("div", { class: "actions" }, submit, cancel));
      const dialog = h("dialog", { class: "modal", "aria-labelledby": titleId }, h("h2", { id: titleId }, `Transfer ${r.serial}`), f.el);
      document.body.append(dialog);
      const opened = openDialog(dialog, transfer, "dialog", () => dialog.remove());
      cancel.addEventListener("click", () => void opened.close());
      f.el.addEventListener("submit", async (event) => {
        event.preventDefault();
        email.setError(null);
        const res = await busy(submit, "Transferring...", () => api<Registration>("POST", `/api/registrations/${encodeURIComponent(r.serial)}/transfer`, { email: email.control.value }));
        if (!res.ok) {
          email.setError(res.error.fields?.email ?? res.error.message);
          email.control.focus();
          return;
        }
        await opened.close();
        item.remove();
        if (!list.children.length) list.append(empty());
        list.closest("section")?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
        announce(`Board ${r.serial} transferred.`);
      });
    });
    return item;
  };
  list.append(...(registrations.length ? registrations.map(row) : [empty()]));
  return list;
}

export async function account({ main }: PageContext): Promise<void> {
  document.title = "My account | Tern Foils";
  const user = await session();
  if (!user) {
    toSignIn();
    return;
  }
  main.append(pageHead("My account", user.email));
  const body = h("div", { class: "wrap account" });
  main.append(body);
  if (user.role !== "customer") {
    body.append(h("p", null, "You are signed in as staff."), onward("/staff", "Open the staff console"));
    return;
  }
  const [orders, trades, bookings, boards, extra] = await Promise.all([
    api<OrderPage>("GET", "/api/orders"),
    api<{ trade_ins: { id: number; status: string; brand: string; model_year: number; quote_cents: number | null }[] }>("GET", "/api/trade-ins/mine"),
    api<{ bookings: Booking[] }>("GET", "/api/demo-bookings/mine"),
    api<{ registrations: Registration[] }>("GET", "/api/registrations/mine"),
    accountData(),
  ]);
  const callbackList = h("ul", { class: "plain-list" }, extra.callbacks.length
    ? extra.callbacks.map((c) => h("li", null, h("span", null, `${c.reference}: ${c.label}`), h("span", { class: "caption" }, c.topic)))
    : h("li", null, "No callbacks requested."));
  const trade = trades.ok ? trades.data.trade_ins[0] : undefined;
  const slotOf = new Map(extra.bookings.map((b) => [b.id, b]));
  const bookingAlert = h("div", { role: "alert", class: "form-alert" });
  const bookingList = h("ul", { class: "plain-list" });
  const renderBookings = (list: Booking[]) => replace(bookingList, list.length ? list.map((b) => {
    const named = slotOf.get(b.id);
    const label = named?.label ?? `Booking ${b.id}`;
    const cancel = b.status === "booked" ? h("button", { type: "button", class: "text-button", "aria-label": `Cancel booking, ${label}` }, "Cancel booking") : null;
    cancel?.addEventListener("click", async () => {
      bookingAlert.textContent = "";
      const r = await busy(cancel, "Cancelling...", () => api("POST", `/api/demo-bookings/${b.id}/cancel`, {}));
      if (!r.ok) {
        bookingAlert.textContent = r.error.message;
        return;
      }
      announce("Booking cancelled.");
      const fresh = await api<{ bookings: Booking[] }>("GET", "/api/demo-bookings/mine");
      if (fresh.ok) renderBookings(fresh.data.bookings);
    });
    return h("li", null, h("span", null, named ? `${named.location_name}: ${named.label}` : label), badge(capitalised(b.status)), cancel);
  }) : h("li", null, "No demo seats booked."));
  renderBookings(bookings.ok ? bookings.data.bookings : []);

  const fields = {
    current_password: input("Current password", { type: "password", name: "current_password", autocomplete: "current-password" }),
    new_password: input("New password", { type: "password", name: "new_password", autocomplete: "new-password" }, "10 or more characters with a letter and a digit"),
  };
  const save = h("button", { type: "submit", class: "pill" }, "Save new password");
  const f = form({ class: "stack-form" }, fields.current_password.wrap, fields.new_password.wrap, save);
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(fields, f.alert);
    const r = await busy(save, "Saving...", () => api("POST", "/api/auth/password", { current_password: fields.current_password.control.value, new_password: fields.new_password.control.value }));
    if (!r.ok) {
      showRefusal(r.error, fields, f.alert);
      return;
    }
    fields.current_password.control.value = "";
    fields.new_password.control.value = "";
    announce("Password changed. Other devices were signed out.");
  });

  body.append(
    h("section", { class: "card" }, h("h2", null, "Orders"), orders.ok ? ordersSection(orders.data) : h("p", { role: "alert" }, orders.error.message)),
    h("section", { class: "card" }, h("h2", null, "Trade-in"),
      trade ? h("p", null, `${trade.brand} ${trade.model_year} `, badge(capitalised(trade.status)), trade.quote_cents ? ` Credit ${price(trade.quote_cents)}` : "") : h("p", null, "No trade-in yet."),
      onward("/trade-in", "Go to trade-in")),
    h("section", { class: "card" }, h("h2", null, "Demo bookings"), bookingList, bookingAlert, onward("/locations", "Find a demo day")),
    h("section", { class: "card" }, h("h2", null, "Callbacks"), callbackList, onward("/callback", "Book a call")),
    h("section", { class: "card" }, h("h2", { tabindex: "-1" }, "Registered boards"), boardsSection(boards.ok ? boards.data.registrations : [])),
    h("section", { class: "card" }, h("h2", null, "Change password"), f.el));
}
