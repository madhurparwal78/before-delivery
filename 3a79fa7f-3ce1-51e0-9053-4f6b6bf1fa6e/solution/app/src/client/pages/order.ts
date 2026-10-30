// Order page /account/orders/<number> (brief: Order page): timeline, lines with protection and board
// registration, the same totals and delivery rows as checkout, the billing account and cancellation behind a
// confirmation dialog.
import { api } from "../api.ts";
import { boot } from "../boot.ts";
import { openDialog } from "../dialog.ts";
import { h, replace, uid } from "../dom.ts";
import { busy, form, input } from "../forms.ts";
import { capitalised, dateTime, longDate, price } from "../format.ts";
import { toSignIn, type PageContext } from "../router.ts";
import { announce, session } from "../state.ts";
import type { Catalog } from "../catalog.ts";
import { banner, pageHead } from "../ui.ts";
import { totalsList, type TaxLine } from "./checkout.ts";

interface OrderLine {
  id: number;
  type: "build" | "accessory";
  sku: string;
  code: string | null;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
  protected_until: string | null;
}

export interface Order {
  number: string;
  status: string;
  placed_at: string;
  country: string;
  address: { name: string; line1: string; city: string; postal_code: string; phone: string };
  lines: OrderLine[];
  subtotal_cents: number;
  discounts: { code: string; amount_cents: number }[];
  credits: { kind: string; amount_cents: number }[];
  taxable_cents: number;
  shipping_cents: number;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: TaxLine[];
  tax_cents: number;
  total_cents: number;
  ships_on: string;
  arrives_on: string;
  trade_in_id: number | null;
  billing_account_key: string;
  billing_invoice_id: string | null;
  events: { status: string; at: string; by: string }[];
}

export interface Registration {
  serial: string;
  order_number: string;
  board_name: string;
  country: string;
  registered_at: string;
  board_warranty_ends_on: string;
  battery_warranty_ends_on: string;
  board_days_left: number;
  battery_days_left: number;
}

/** One row per event with its status and when; `when` formats the instant (the order page shows the time too). */
export function timeline(events: { status: string; at: string }[], when: (iso: string) => string = longDate): HTMLElement {
  return h("ol", { class: "timeline" }, events.map((e) => h("li", null, h("span", { class: "timeline-status" }, capitalised(e.status)), h("span", { class: "caption" }, when(e.at)))));
}

function protection(order: Order, line: OrderLine, onDone: () => void): HTMLElement | null {
  if (line.type !== "build") return null;
  if (line.protected_until) return h("p", { class: "protected" }, `Protected until ${longDate(line.protected_until)}`);
  if (order.status === "cancelled") return null;
  const group = uid("term");
  const error = h("p", { class: "field-error", hidden: true });
  const terms = (["2", "3"] as const).map((years, i) => {
    const id = `${group}-${years}`;
    return h("div", { class: "choice choice-inline" },
      h("input", { type: "radio", class: "sr-radio", name: group, id, value: years, checked: i === 0 }),
      h("label", { for: id }, `${years} years`, h("span", { class: "caption" }, ` ${price(boot.protection[years])} plus tax`)));
  });
  const add = h("button", { type: "button", class: "pill pill-outline" }, "Add protection");
  add.setAttribute("aria-label", `Add protection to ${line.name}`);
  add.addEventListener("click", async () => {
    const term = Number((document.querySelector(`input[name="${group}"]:checked`) as HTMLInputElement | null)?.value ?? 2);
    error.hidden = true;
    const r = await busy(add, "Adding...", () => api<{ protected_until: string }>("POST", `/api/orders/${order.number}/protection`, { line_id: line.id, term_years: term }));
    if (!r.ok) {
      error.hidden = false;
      error.textContent = r.error.message;
      return;
    }
    announce(`Protected until ${longDate(r.data.protected_until)}.`);
    onDone();
  });
  return h("div", { class: "protection" },
    h("div", { role: "radiogroup", "aria-label": `Term for ${line.name}`, class: "choice-row" }, h("span", { class: "caption" }, "Term"), terms), error, add);
}

/** "Register <line name>" opens "Register your board"; every refusal shows beneath "Serial number". */
function registerButton(order: Order, line: OrderLine, onDone: () => void): HTMLElement {
  const open = h("button", { type: "button", class: "pill pill-outline" }, `Register ${line.name}`);
  open.addEventListener("click", () => {
    const serial = input("Serial number", { name: "serial", autocomplete: "off", spellcheck: "false" }, "From the deck plate, like TF123456782");
    const submit = h("button", { type: "submit", class: "pill" }, "Register board");
    const cancel = h("button", { type: "button", class: "pill pill-outline" }, "Cancel");
    const titleId = uid("register");
    const f = form({ class: "stack-form" }, serial.wrap, h("div", { class: "actions" }, submit, cancel));
    const dialog = h("dialog", { class: "modal", "aria-labelledby": titleId }, h("h2", { id: titleId }, "Register your board"), h("p", { class: "caption" }, line.name), f.el);
    document.body.append(dialog);
    const opened = openDialog(dialog, open, "dialog", () => dialog.remove());
    cancel.addEventListener("click", () => void opened.close());
    f.el.addEventListener("submit", async (event) => {
      event.preventDefault();
      serial.setError(null);
      const r = await busy(submit, "Registering...", () => api<Registration>("POST", "/api/registrations", { order_number: order.number, line_id: line.id, serial: serial.control.value }));
      if (!r.ok) {
        serial.setError(r.error.fields?.serial ?? r.error.message);
        serial.control.focus();
        return;
      }
      await opened.close();
      announce(`Board ${r.data.serial} registered.`);
      onDone();
    });
  });
  return open;
}

/**
 * Boards left to register on each build line: its quantity minus the caller's registrations from this order of
 * that board, counted against the order's build lines of that board in line order.
 */
function boardsLeft(order: Order, registrations: Registration[], catalog: Catalog | null): Map<number, number> {
  const taken = new Map<string, number>();
  for (const r of registrations) if (r.order_number === order.number) taken.set(r.board_name, (taken.get(r.board_name) ?? 0) + 1);
  const left = new Map<number, number>();
  for (const line of order.lines.filter((l) => l.type === "build")) {
    const board = catalog?.boards.find((b) => b.sku === line.sku)?.name ?? "";
    const used = Math.min(line.quantity, taken.get(board) ?? 0);
    taken.set(board, (taken.get(board) ?? 0) - used);
    left.set(line.id, line.quantity - used);
  }
  return left;
}

export async function orderPage({ main, params }: PageContext): Promise<void> {
  const number = params.number ?? "";
  document.title = `Order ${number} | Tern Foils`;
  const user = await session();
  if (!user) {
    toSignIn();
    return;
  }
  const head = h("div");
  const body = h("div", { class: "wrap order-page" });
  main.append(head, body);
  const placed = (history.state as { placed?: string } | null)?.placed === number;
  let flash: HTMLElement | null = placed ? banner(`Order ${number} placed.`, "success") : null;
  const catalog = await api<Catalog>("GET", "/api/catalog");

  const render = async () => {
    const r = await api<Order>("GET", `/api/orders/${encodeURIComponent(number)}`);
    if (!r.ok) {
      replace(head, pageHead("We could not find that order."));
      replace(body, h("a", { href: "/account", class: "pill" }, "Back to my account"));
      return;
    }
    const order = r.data;
    const delivered = order.status === "delivered";
    const mine = delivered ? await api<{ registrations: Registration[] }>("GET", "/api/registrations/mine") : null;
    const left = boardsLeft(order, mine?.ok ? mine.data.registrations : [], catalog.ok ? catalog.data : null);
    replace(head, pageHead(`Order ${order.number}`, `Placed ${longDate(order.placed_at)} · ${capitalised(order.status)}`));
    const alert = h("div", { role: "alert", class: "form-alert" });
    let cancel: HTMLElement | null = null;
    if (order.status === "placed") {
      const button = h("button", { type: "button", class: "pill pill-outline" }, "Cancel order");
      button.addEventListener("click", () => confirmCancel(order, button, alert));
      cancel = button;
    }
    replace(body,
      flash,
      h("div", { class: "order-grid" },
        h("section", { class: "card" }, h("h2", null, "Status"), timeline(order.events, dateTime)),
        h("section", { class: "card" }, h("h2", null, "Lines"),
          h("ul", { class: "order-lines" }, order.lines.map((l) => h("li", null,
            h("div", { class: "order-line" }, h("span", null, `${l.name} x ${l.quantity}`), h("span", null, price(l.line_cents))),
            protection(order, l, () => void render()),
            delivered && (left.get(l.id) ?? 0) > 0 ? registerButton(order, l, () => void render()) : null))),
          totalsList(order, 0, ""),
          h("p", { class: "caption billing" }, `Billing account ${order.billing_account_key}`),
          cancel, alert)));
  };

  const confirmCancel = (order: Order, opener: HTMLElement, alert: HTMLElement) => {
    const yes = h("button", { type: "button", class: "pill" }, "Yes, cancel order");
    const keep = h("button", { type: "button", class: "pill pill-outline" }, "Keep order");
    const dialog = h("dialog", { class: "modal", "aria-labelledby": "cancel-title" },
      h("h2", { id: "cancel-title" }, "Cancel this order?"),
      h("p", null, "Your charge is set to zero, the stock goes back on the shelf and any credit you used returns to your account."),
      h("div", { class: "actions" }, yes, keep));
    document.body.append(dialog);
    const opened = openDialog(dialog, opener, "dialog", () => dialog.remove());
    keep.addEventListener("click", () => void opened.close());
    yes.addEventListener("click", async () => {
      const r = await busy(yes, "Cancelling...", () => api<Order>("POST", `/api/orders/${order.number}/cancel`, {}));
      await opened.close();
      if (!r.ok) {
        alert.textContent = r.error.message;
        return;
      }
      flash = banner(`Order ${order.number} cancelled.`, "success");
      await render();
    });
  };

  await render();
}
