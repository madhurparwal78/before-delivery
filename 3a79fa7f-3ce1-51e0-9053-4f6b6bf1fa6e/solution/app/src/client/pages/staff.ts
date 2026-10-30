// Staff console /staff (brief: Staff console): one tab per role-allowed area; the server enforces every move.
import { api } from "../api.ts";
import { openDialog } from "../dialog.ts";
import { h, replace } from "../dom.ts";
import { busy, form, input, select, showRefusal } from "../forms.ts";
import { capitalised, dateTime, longDate, price } from "../format.ts";
import { toSignIn, type PageContext } from "../router.ts";
import { announce, session, type User } from "../state.ts";
import { pageHead, scrollBox } from "../ui.ts";

interface TradeIn {
  id: number;
  status: string;
  brand: string;
  model_year: number;
  condition: string;
  serial: string;
  note: string;
}

type Tab = { name: string; roles: User["role"][]; render(panel: HTMLElement, onLeave: (stop: () => void) => void): Promise<void> };

/** Dollars and cents typed by staff, converted to integer cents without floating point. */
function cents(text: string): number | null {
  const m = /^\s*\$?(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text.replace(/,/g, ""));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
}

function actionDialog(title: string, fieldLabel: string, attrs: Record<string, string>, submitText: string, opener: HTMLElement, send: (value: string) => Promise<{ ok: true } | { ok: false; message: string; field?: string }>): void {
  const field = input(fieldLabel, attrs);
  const submit = h("button", { type: "submit", class: "pill" }, submitText);
  const cancel = h("button", { type: "button", class: "pill pill-outline" }, "Cancel");
  const f = form({ class: "stack-form" }, field.wrap, h("div", { class: "actions" }, submit, cancel));
  const dialog = h("dialog", { class: "modal", "aria-labelledby": "staff-dialog-title" }, h("h2", { id: "staff-dialog-title" }, title), f.el);
  document.body.append(dialog);
  const opened = openDialog(dialog, opener, "dialog", () => dialog.remove());
  cancel.addEventListener("click", () => void opened.close());
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const r = await busy(submit, "Saving...", () => send(field.control.value));
    if (r.ok) {
      await opened.close();
      return;
    }
    if (r.field) field.setError(r.message);
    else f.alert.textContent = r.message;
  });
}

const TABS: Tab[] = [
  {
    name: "Trade-ins",
    roles: ["admin", "support"],
    async render(panel) {
      const r = await api<{ trade_ins: TradeIn[] }>("GET", "/api/staff/trade-ins?status=submitted");
      const list = r.ok ? r.data.trade_ins : [];
      const alert = h("div", { role: "alert", class: "form-alert" });
      const again = () => void this.render(panel, () => undefined);
      replace(panel, h("h2", null, "Submitted trade-ins"), alert, list.length ? scrollBox("Staff table", h("table", { class: "data-table" },
        h("thead", null, h("tr", null, ["Trade-in", "Board", "Year", "Condition", "Serial", "Note", "Actions"].map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", null, list.map((t) => {
          const quote = h("button", { type: "button", class: "pill pill-small" }, `Quote ${t.id}`);
          const reject = h("button", { type: "button", class: "pill pill-small pill-outline" }, `Reject ${t.id}`);
          quote.addEventListener("click", () => actionDialog(`Quote trade-in ${t.id}`, "Amount in dollars", { name: "amount", inputmode: "decimal", autocomplete: "off", placeholder: "250.00" }, "Save quote", quote, async (value) => {
            const amount = cents(value);
            if (amount === null) return { ok: false, field: "amount", message: "Enter dollars and cents, like 250.00." };
            const res = await api("POST", `/api/staff/trade-ins/${t.id}/quote`, { amount_cents: amount });
            if (!res.ok) return { ok: false, field: res.error.fields?.amount_cents ? "amount" : undefined, message: res.error.fields?.amount_cents ?? res.error.message };
            announce("Quote saved.");
            again();
            return { ok: true };
          }));
          reject.addEventListener("click", () => actionDialog(`Reject trade-in ${t.id}`, "Reason", { name: "reason", autocomplete: "off" }, "Reject trade-in", reject, async (value) => {
            const res = await api("POST", `/api/staff/trade-ins/${t.id}/reject`, { reason: value });
            if (!res.ok) return { ok: false, field: res.error.fields?.reason ? "reason" : undefined, message: res.error.fields?.reason ?? res.error.message };
            announce("Trade-in rejected.");
            again();
            return { ok: true };
          }));
          return h("tr", null, h("td", null, String(t.id)), h("td", null, t.brand), h("td", null, String(t.model_year)), h("td", null, t.condition), h("td", null, t.serial), h("td", null, t.note), h("td", { class: "row-actions" }, quote, reject));
        })))) : h("p", null, "No trade-ins are waiting for a quote."));
    },
  },
  {
    name: "Demo days",
    roles: ["admin", "dealer"],
    async render(panel) {
      const locations = await api<{ locations: { id: number; name: string; city: string }[] }>("GET", "/api/locations");
      const options = locations.ok ? locations.data.locations.map((l) => ({ value: String(l.id), label: `${l.name}, ${l.city}` })) : [];
      const where = select("Location", options, { name: "location" });
      const fields = {
        starts_at: input("Starts (UTC)", { type: "datetime-local", name: "starts_at" }),
        ends_at: input("Ends (UTC)", { type: "datetime-local", name: "ends_at" }),
        capacity: input("Capacity", { type: "number", name: "capacity", min: 1, max: 20, value: "4" }),
      };
      const addButton = h("button", { type: "submit", class: "pill" }, "Add slot");
      const f = form({ class: "slot-form" }, h("h3", null, "Add a slot"), fields.starts_at.wrap, fields.ends_at.wrap, fields.capacity.wrap, addButton);
      const list = h("div", { class: "staff-bookings" });
      const listAlert = h("div", { role: "alert", class: "form-alert" });
      const load = async () => {
        const [r, open] = await Promise.all([
          api<{ bookings: { id: number; slot_id: number; status: string; customer_email: string }[] }>("GET", `/api/staff/locations/${where.control.value}/bookings`),
          api<{ slots: { id: number; label: string }[] }>("GET", `/api/locations/${where.control.value}/slots`),
        ]);
        const bookings = r.ok ? r.data.bookings : [];
        const labels = new Map(open.ok ? open.data.slots.map((x) => [x.id, x.label]) : []);
        const slots = [...new Set(bookings.map((b) => b.slot_id))];
        replace(list, h("h3", null, "Bookings by slot"), slots.length ? slots.map((id) => {
          const rows = bookings.filter((b) => b.slot_id === id);
          return h("section", { class: "slot-bookings" }, h("h4", null, labels.get(id) ?? `Slot ${id}`), h("ul", { class: "plain-list" }, rows.map((b) => {
            const mark = b.status === "booked" ? h("button", { type: "button", class: "pill pill-small" }, `Mark attended ${b.id}`) : null;
            mark?.addEventListener("click", async () => {
              listAlert.textContent = "";
              const res = await busy(mark, "Saving...", () => api("POST", `/api/staff/demo-bookings/${b.id}/attended`, {}));
              if (!res.ok) {
                listAlert.textContent = res.error.message;
                return;
              }
              announce("Marked attended.");
              await load();
            });
            return h("li", null, h("span", null, `${b.id}: ${b.customer_email}`), h("span", { class: "caption" }, capitalised(b.status)), mark);
          })));
        }) : h("p", null, "No bookings at this location yet."), listAlert);
      };
      where.control.addEventListener("change", () => void load());
      const utc = (value: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00Z` : value);
      f.el.addEventListener("submit", async (event) => {
        event.preventDefault();
        const capacity = fields.capacity.control.value;
        const r = await busy(addButton, "Saving...", () => api("POST", `/api/staff/locations/${where.control.value}/slots`, {
          starts_at: utc(fields.starts_at.control.value), ends_at: utc(fields.ends_at.control.value), capacity: /^\d+$/.test(capacity) ? Number(capacity) : capacity,
        }));
        if (!r.ok) {
          showRefusal(r.error, fields, f.alert);
          return;
        }
        showRefusal({ error: "", message: "" }, fields, f.alert);
        announce("Slot added.");
        await load();
      });
      replace(panel, h("h2", null, "Demo days"), where.wrap, h("div", { class: "staff-demo" }, f.el, list));
      await load();
    },
  },
  {
    name: "Orders",
    roles: ["admin"],
    async render(panel) {
      type StaffOrder = { number: string; status: string; placed_at: string; total_cents: number };
      type OrderPage = { orders: StaffOrder[]; next_cursor: string | null };
      const alert = h("div", { role: "alert", class: "form-alert" });
      const rows = h("tbody");
      // Each row offers the action the brief names for its status: a placed order ships, a shipped one is delivered.
      const next: Record<string, { action: string; label: string }> = { placed: { action: "ship", label: "shipped" }, shipped: { action: "deliver", label: "delivered" } };
      const row = (o: StaffOrder): HTMLTableRowElement => {
        const move = next[o.status];
        const button = move ? h("button", { type: "button", class: "pill pill-small" }, `Mark ${move.label} ${o.number}`) : null;
        const tr = h("tr", null, h("td", null, o.number), h("td", null, longDate(o.placed_at)), h("td", null, capitalised(o.status)), h("td", null, price(o.total_cents)), h("td", null, button ?? "—"));
        button?.addEventListener("click", async () => {
          alert.textContent = "";
          const res = await busy(button, "Saving...", () => api<StaffOrder>("POST", `/api/staff/orders/${o.number}/${move!.action}`, {}));
          if (!res.ok) {
            alert.textContent = res.error.message;
            return;
          }
          const fresh = row(res.data);
          tr.replaceWith(fresh);
          fresh.querySelector("button")?.focus();
          announce(`Order ${o.number} marked ${move!.label}.`);
        });
        return tr;
      };
      const first = await api<OrderPage>("GET", "/api/staff/orders");
      if (!first.ok) {
        replace(panel, h("h2", null, "Orders"), h("p", { role: "alert" }, first.error.message));
        return;
      }
      rows.append(...first.data.orders.map(row));
      let cursor = first.data.next_cursor;
      const more = h("button", { type: "button", class: "pill pill-outline", hidden: cursor === null }, "Load more orders");
      more.addEventListener("click", async () => {
        alert.textContent = "";
        const r = await busy(more, "Loading...", () => api<OrderPage>("GET", `/api/staff/orders?cursor=${encodeURIComponent(cursor ?? "")}`));
        if (!r.ok) {
          alert.textContent = r.error.message;
          return;
        }
        rows.append(...r.data.orders.map(row));
        cursor = r.data.next_cursor;
        more.hidden = cursor === null;
        announce(`${r.data.orders.length} more orders shown.`);
      });
      replace(panel, h("h2", null, "Orders"), alert, first.data.orders.length ? scrollBox("Staff table", h("table", { class: "data-table" },
        h("thead", null, h("tr", null, ["Order", "Placed", "Status", "Total", "Next step"].map((c) => h("th", { scope: "col" }, c)))),
        rows)) : h("p", null, "No orders yet."), more);
    },
  },
  {
    name: "Outbox",
    roles: ["admin", "support"],
    async render(panel, onLeave) {
      const load = async () => {
        const r = await api<{ notices: { id: number; to: string; subject: string; status: string; attempts: number; created_at: string }[] }>("GET", "/api/staff/outbox");
        const notices = r.ok ? r.data.notices : [];
        replace(panel, h("h2", null, "Notice outbox"), h("p", { class: "caption" }, "Refreshes every 5 seconds while open."), scrollBox("Staff table", h("table", { class: "data-table" },
          h("thead", null, h("tr", null, ["To", "Subject", "Status", "Created"].map((c) => h("th", { scope: "col" }, c)))),
          h("tbody", null, notices.map((n) => h("tr", null, h("td", null, n.to), h("td", null, n.subject), h("td", null, n.status === "sent" ? "Sent" : `Pending (attempt ${n.attempts + 1})`), h("td", null, dateTime(n.created_at))))))));
      };
      await load();
      const timer = window.setInterval(() => void load(), 5000);
      onLeave(() => clearInterval(timer));
    },
  },
];

export async function staff({ main, onLeave }: PageContext): Promise<void> {
  document.title = "Staff console | Tern Foils";
  const user = await session();
  if (!user) {
    toSignIn();
    return;
  }
  main.append(pageHead("Staff console"));
  const body = h("div", { class: "wrap" });
  main.append(body);
  if (user.role === "customer") {
    body.append(h("p", { class: "denied" }, "You do not have access to this page."));
    return;
  }
  const tabs = TABS.filter((t) => t.roles.includes(user.role));
  const panel = h("div", { role: "tabpanel", class: "tab-panel card", tabindex: "0" });
  let stop: (() => void) | null = null;
  onLeave(() => stop?.());
  const buttons = tabs.map((tab, i) => {
    const button = h("button", { type: "button", role: "tab", id: `tab-${i}`, "aria-selected": "false", tabindex: "-1" }, tab.name);
    button.addEventListener("click", () => void select(i));
    button.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = (i + step + tabs.length) % tabs.length;
      buttons[next]!.focus();
      void select(next);
    });
    return button;
  });
  const select = async (index: number) => {
    stop?.();
    stop = null;
    buttons.forEach((b, i) => {
      b.setAttribute("aria-selected", String(i === index));
      b.tabIndex = i === index ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", buttons[index]!.id);
    replace(panel, h("p", { class: "caption" }, "Loading"));
    await tabs[index]!.render(panel, (s) => (stop = s));
  };
  body.append(h("div", { role: "tablist", "aria-label": "Staff console", class: "tabs" }, buttons), panel);
  await select(0);
}
