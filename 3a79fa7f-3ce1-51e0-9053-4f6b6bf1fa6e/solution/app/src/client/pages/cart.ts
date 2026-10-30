// Cart /cart and shared cart /cart/shared/<token> (brief: Cart): steppers under the server's caps, codes, totals
// summed from the server's amounts with its financing, Check out and Share your cart.
import { api } from "../api.ts";
import { boot } from "../boot.ts";
import { h, replace, s } from "../dom.ts";
import { busy, form, input, showRefusal } from "../forms.ts";
import { price } from "../format.ts";
import { icon } from "../icons.ts";
import { navigate, type PageContext } from "../router.ts";
import { announce, refreshCart, setCartCount, type Cart, type CartLine } from "../state.ts";
import { financingLine, lowestMonthly, pageHead } from "../ui.ts";

interface BuildView {
  slots: Record<string, { name: string }>;
  spares: number;
}

/** The cap a line has reached, if any: its own line cap first, then the cap on all build lines together. */
function capReached(line: CartLine, cart: Cart): number | null {
  const caps = boot.cartLimits;
  if (line.type === "accessory") return line.quantity >= caps.accessoryLine ? caps.accessoryLine : null;
  if (line.quantity >= caps.buildLine) return caps.buildLine;
  const builds = cart.lines.filter((l) => l.type === "build").reduce((sum, l) => sum + l.quantity, 0);
  return builds >= caps.builds ? caps.builds : null;
}

function continueShopping(): HTMLAnchorElement {
  return h("a", { href: "/boards", class: "pill" }, "Continue shopping");
}

function emptyState(): HTMLElement {
  const drawing = s("svg", { viewBox: "0 0 96 96", width: 96, height: 96, class: "empty-art", "aria-hidden": "true", focusable: "false" },
    s("path", { d: "M18 34h60l-6 46H24Z", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round" }),
    s("path", { d: "M36 34v-8a12 12 0 0 1 24 0v8", fill: "none", stroke: "currentColor", "stroke-width": 2 }),
    s("path", { d: "M30 62q18-6 36 0", fill: "none", stroke: "#2b9a95", "stroke-width": 2, "stroke-linecap": "round" }));
  return h("div", { class: "empty card" }, drawing, h("p", { class: "empty-title" }, "Your cart is empty"), h("p", null, "Build a board or add parts, and they will wait for you here."), continueShopping());
}

function totalsRows(cart: Cart): HTMLElement {
  const off = cart.codes.reduce((sum, c) => sum + c.amount_cents, 0);
  const row = (label: string, value: string, cls = "") => h("div", { class: `total-row ${cls}` }, h("dt", null, label), h("dd", null, value));
  return h("div", null,
    h("dl", { class: "totals" },
      row("Subtotal", price(cart.subtotal_cents)),
      cart.codes.map((c) => row(c.code, price(-c.amount_cents))),
      row("Shipping", "Calculated at checkout"),
      row("Total before shipping and tax", price(cart.subtotal_cents - off), "total-row-grand")),
    financingLine(lowestMonthly(cart.financing)));
}

async function buildViews(lines: CartLine[]): Promise<Map<string, BuildView>> {
  const views = new Map<string, BuildView>();
  await Promise.all(lines.filter((l) => l.code).map(async (l) => {
    const r = await api<BuildView>("GET", `/api/builds/${encodeURIComponent(l.code!)}`);
    if (r.ok) views.set(l.code!, r.data);
  }));
  return views;
}

function lineCopy(line: CartLine, view: BuildView | undefined): HTMLElement {
  if (line.type === "build" && line.code) {
    return h("div", { class: "line-copy" },
      h("a", { href: `/build/${line.code}`, class: "line-name" }, line.name),
      view ? h("p", { class: "caption" }, ["wing", "mast", "propulsion", "battery", "controller"].map((sl) => view.slots[sl]?.name).join(" · ")) : null,
      h("p", { class: "caption" }, `Spares: ${view?.spares ?? 0}`),
      h("p", { class: "caption" }, `${price(line.unit_cents)} each`));
  }
  return h("div", { class: "line-copy" }, h("p", { class: "line-name" }, line.name), h("p", { class: "caption" }, `${price(line.unit_cents)} each`));
}

export async function cartPage({ main }: PageContext): Promise<void> {
  document.title = "Your cart | Tern Foils";
  main.append(pageHead("Your cart"));
  const body = h("div", { class: "wrap" });
  main.append(body);
  const code = input("Discount code", { name: "code", autocomplete: "off" });
  const apply = h("button", { type: "submit", class: "pill pill-outline" }, "Apply");
  const codeForm = form({ class: "code-form" }, h("div", { class: "inline-field" }, code.wrap, apply));
  const limits = new Map<number, string>();

  async function render(cart: Cart, focusLabel?: string): Promise<void> {
    setCartCount(cart.item_count);
    if (!cart.lines.length) {
      replace(body, emptyState());
      return;
    }
    const views = await buildViews(cart.lines);
    const lines = cart.lines.map((line) => {
      const cap = capReached(line, cart);
      const limitText = limits.get(line.id) ?? (cap ? `Limit ${cap} per order.` : null);
      const quantity = h("input", { type: "number", class: "stepper-value", min: 0, value: String(line.quantity), "aria-label": `Quantity for ${line.name}`, inputmode: "numeric" });
      const minus = h("button", { type: "button", class: "stepper-button", "aria-label": `Decrease ${line.name}` }, icon("minus", 18));
      const plus = h("button", { type: "button", class: "stepper-button", "aria-label": `Increase ${line.name}`, disabled: cap !== null }, icon("plus", 18));
      const remove = h("button", { type: "button", class: "text-button", "aria-label": `Remove ${line.name}` }, icon("cross", 16), "Remove");
      const stepper = h("div", { class: "stepper" }, minus, quantity, plus);
      const change = async (to: number, control: HTMLElement) => {
        stepper.querySelectorAll("button, input").forEach((c) => ((c as HTMLButtonElement).disabled = true));
        const r = to === 0 ? await api<Cart>("DELETE", `/api/cart/lines/${line.id}`) : await api<Cart>("PATCH", `/api/cart/lines/${line.id}`, { quantity: to });
        limits.delete(line.id);
        if (!r.ok) {
          limits.set(line.id, r.error.message);
          const fresh = await refreshCart();
          if (fresh) await render(fresh, control.getAttribute("aria-label") ?? undefined);
          return;
        }
        announce(`Cart has ${r.data.item_count} items.`);
        await render(r.data, control.getAttribute("aria-label") ?? undefined);
      };
      minus.addEventListener("click", () => void change(line.quantity - 1, minus));
      plus.addEventListener("click", () => void change(line.quantity + 1, plus));
      quantity.addEventListener("change", () => {
        const to = Number(quantity.value);
        if (Number.isInteger(to) && to >= 0) void change(to, quantity);
      });
      remove.addEventListener("click", () => void change(0, remove));
      return h("li", { class: "cart-line card" },
        lineCopy(line, line.code ? views.get(line.code) : undefined),
        h("div", { class: "line-controls" }, h("p", { class: "caption" }, "Quantity"), stepper, limitText ? h("p", { class: "limit" }, limitText) : null, remove),
        h("p", { class: "line-amount" }, price(line.line_cents)));
    });
    const applied = h("ul", { class: "applied-codes" }, cart.codes.map((c) => {
      const drop = h("button", { type: "button", class: "text-button", "aria-label": `Remove code ${c.code}` }, icon("cross", 16), "Remove");
      drop.addEventListener("click", async () => {
        const r = await api<Cart>("DELETE", `/api/cart/codes/${encodeURIComponent(c.code)}`);
        if (r.ok) {
          announce(`Code ${c.code} removed.`);
          await render(r.data);
        }
      });
      return h("li", null, h("span", { class: "code-chip" }, c.code), h("span", null, price(-c.amount_cents)), drop);
    }));
    const checkout = h("button", { type: "button", class: "pill pill-large" }, "Check out");
    checkout.addEventListener("click", () => navigate("/checkout"));
    const share = h("button", { type: "button", class: "pill pill-quiet" }, "Share your cart");
    const shared = h("p", { class: "caption share-link" });
    share.addEventListener("click", async () => {
      const r = await api<{ token: string; expires_at: string }>("POST", "/api/cart/share", {});
      if (!r.ok) return;
      const link = `${location.origin}/cart/shared/${r.data.token}`;
      shared.textContent = link;
      await navigator.clipboard.writeText(link).catch(() => undefined);
      announce("Cart link copied.");
    });
    replace(body, h("div", { class: "cart-grid" },
      h("ul", { class: "cart-lines" }, lines),
      h("aside", { class: "card cart-side" }, codeForm.el, applied, totalsRows(cart), h("div", { class: "actions-column" }, checkout, share), shared)));
    if (focusLabel) body.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusLabel)}"]:not([disabled])`)?.focus();
  }

  codeForm.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const r = await busy(apply, "Applying...", () => api<Cart>("POST", "/api/cart/codes", { code: code.control.value }));
    if (!r.ok) {
      showRefusal({ ...r.error, fields: r.error.fields ?? { code: r.error.message } }, { code }, codeForm.alert);
      return;
    }
    code.setError(null);
    const added = r.data.codes[r.data.codes.length - 1]?.code ?? "";
    code.control.value = "";
    announce(`Code ${added} applied.`);
    await render(r.data);
  });

  const cart = await refreshCart();
  if (cart) await render(cart);
}

interface SharedLine {
  type: "build" | "accessory";
  code: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_cents: number;
}

export async function sharedCart({ main, params }: PageContext): Promise<void> {
  document.title = "Shared cart | Tern Foils";
  main.append(pageHead("A shared cart", "These lines were shared with you as they were at that moment."));
  const body = h("div", { class: "wrap narrow" });
  main.append(body);
  const token = encodeURIComponent(params.token ?? "");
  const r = await api<{ lines: SharedLine[]; expires_at: string }>("GET", `/api/cart/shared/${token}`);
  if (!r.ok) {
    body.append(r.status === 404 ? h("p", null, "This shared cart has expired or does not exist.") : h("p", { role: "alert" }, r.error.message), continueShopping());
    return;
  }
  const alert = h("div", { role: "alert", class: "form-alert" });
  const take = h("button", { type: "button", class: "pill" }, "Add all to my cart");
  take.addEventListener("click", async () => {
    alert.textContent = "";
    const done = await busy(take, "Adding...", () => api<Cart>("POST", `/api/cart/shared/${token}/import`, {}));
    if (!done.ok) {
      alert.textContent = done.status === 404 ? "This shared cart has expired or does not exist." : done.error.message;
      return;
    }
    setCartCount(done.data.item_count);
    announce(`Cart has ${done.data.item_count} items.`);
    navigate("/cart");
  });
  body.append(
    h("ul", { class: "cart-lines" }, r.data.lines.map((l) => h("li", { class: "cart-line card" },
      h("div", { class: "line-copy" }, h("p", { class: "line-name" }, l.name), h("p", { class: "caption" }, `Quantity ${l.quantity}`)),
      h("p", { class: "line-amount" }, `${price(l.unit_cents)} each`)))),
    take, alert);
}
