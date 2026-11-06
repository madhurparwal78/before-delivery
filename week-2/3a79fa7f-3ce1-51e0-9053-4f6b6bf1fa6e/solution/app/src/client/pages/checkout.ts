// Checkout /checkout (brief: Checkout, Interactions/Checkout): address, re-quote without a reload on the country
// and on a Canadian postal code of the right shape (newest answer wins), credits the server allows, one
// idempotency key per page load, the progress bar and every refusal state.
import { api, type Refusal } from "../api.ts";
import { boot } from "../boot.ts";
import { CURVES, h, reducedMotion, replace, tween } from "../dom.ts";
import { form, input, select, showRefusal, type Field } from "../forms.ts";
import { dayLabel, percent, price } from "../format.ts";
import { navigate, toSignIn, type PageContext } from "../router.ts";
import { announce, refreshCart, session, type Cart } from "../state.ts";
import type { Catalog, FinancingTerm } from "../catalog.ts";
import { banner, financingLine, lowestMonthly, pageHead } from "../ui.ts";

export interface TaxLine {
  name: string;
  rate_pcm: number;
  amount_cents: number;
}

export interface Breakdown {
  lines: Cart["lines"];
  subtotal_cents: number;
  discounts: { code: string; amount_cents: number }[];
  credits: { kind: string; amount_cents: number }[];
  taxable_cents: number;
  shipping_cents: number;
  free_shipping: boolean;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: TaxLine[];
  tax_cents: number;
  total_cents: number;
  ships_on: string;
  arrives_on: string;
  financing: FinancingTerm[];
}

type Totals = Pick<Breakdown, "discounts" | "credits" | "shipping_cents" | "packed_batteries" | "standalone_batteries" | "dangerous_goods_cents" | "taxes" | "tax_cents" | "total_cents" | "ships_on" | "arrives_on">;

/**
 * The totals and delivery rows shared by checkout and the order page. Without amounts every server-decided row
 * reads `placeholder`; with `financing` (checkout) the financing line for the total follows.
 */
export function totalsList(b: Totals | null, discounts: number, placeholder: string, financing?: FinancingTerm[]): HTMLElement {
  const row = (label: string, value: Node | string, extra?: string, cls = "") =>
    h("div", { class: `total-row ${cls}` }, h("dt", null, label, extra ? h("span", { class: "caption" }, ` ${extra}`) : null), h("dd", null, value));
  const credits = b ? b.credits.reduce((sum, c) => sum + c.amount_cents, 0) : 0;
  const dangerous = !b
    ? row("Dangerous goods handling", placeholder)
    : b.dangerous_goods_cents > 0 ? row("Dangerous goods handling", price(b.dangerous_goods_cents), `${b.packed_batteries} packed with a board, ${b.standalone_batteries} shipped alone`) : null;
  return h("div", { class: "totals-block" },
    h("dl", { class: "totals" },
      row("Discounts", price(-(b ? b.discounts.reduce((sum, d) => sum + d.amount_cents, 0) : discounts))),
      row("Credits", price(-credits)),
      row("Shipping", b ? (b.shipping_cents === 0 ? "Free" : price(b.shipping_cents)) : placeholder),
      dangerous,
      b?.taxes.map((t) => row(`${t.name} (${percent(t.rate_pcm)})`, price(t.amount_cents))),
      row("Tax", b ? price(b.tax_cents) : placeholder),
      row("Total", b ? price(b.total_cents) : placeholder, undefined, "total-row-grand"),
      row("Delivery", b ? `Ships ${dayLabel(b.ships_on)}, arrives ${dayLabel(b.arrives_on)}` : placeholder),
      financing && !b ? row("Financing", placeholder) : null),
    financing && b ? financingLine(lowestMonthly(financing)) : null);
}

/** Length rules of the order body table and the callback phone pattern, for the Address step of the progress bar. */
const ADDRESS_RULES: [string, (v: string) => boolean][] = [
  ["address.name", (v) => [...v].length >= 2 && [...v].length <= 80],
  ["address.line1", (v) => [...v].length >= 3 && [...v].length <= 120],
  ["address.city", (v) => [...v].length >= 2 && [...v].length <= 60],
  ["address.postal_code", (v) => [...v].length >= 2 && [...v].length <= 12],
  ["address.phone", (v) => /^\+[1-9][0-9]{7,14}$/.test(v)],
];
const PROGRESS_MS = 400;

export async function checkout({ main }: PageContext): Promise<void> {
  document.title = "Checkout | Tern Foils";
  const user = await session();
  if (!user) {
    toSignIn();
    return;
  }
  main.append(pageHead("Checkout"));
  const body = h("div", { class: "wrap" });
  main.append(body);
  if (user.role !== "customer") {
    body.append(h("p", null, "Staff accounts cannot place orders. Sign in with a customer account to check out."));
    return;
  }
  const cart = await refreshCart();
  if (!cart?.lines.length) {
    body.append(h("div", { class: "empty card" }, h("p", { class: "empty-title" }, "Your cart is empty"), h("a", { href: "/boards", class: "pill" }, "Continue shopping")));
    return;
  }
  const idempotencyKey = crypto.randomUUID();
  const fields: Record<string, Field> = {
    "address.name": input("Full name", { name: "name", autocomplete: "name" }),
    "address.line1": input("Address", { name: "line1", autocomplete: "address-line1" }),
    "address.city": input("City", { name: "city", autocomplete: "address-level2" }),
    "address.postal_code": input("Postal code", { name: "postal_code", autocomplete: "postal-code" }),
    country: select("Country", boot.countries.map((c) => ({ value: c.code, label: c.name })), { name: "country", autocomplete: "country" }),
    "address.phone": input("Phone", { name: "phone", type: "tel", autocomplete: "tel", placeholder: "+14155550100" }, "International format, like +14155550100"),
  };
  const countrySelect = fields.country!.control as HTMLSelectElement;
  const postal = fields["address.postal_code"]!;
  countrySelect.prepend(h("option", { value: "", disabled: true, hidden: true }, "Select a country"));
  countrySelect.value = "";
  const canadianPostal = new RegExp(boot.canadianPostalPattern, "i");
  const canada = () => countrySelect.value === "CA";

  const fill = h("div", { class: "progress-fill" });
  const bar = h("div", { class: "progress", role: "progressbar", "aria-label": "Checkout progress", "aria-valuemin": "0", "aria-valuemax": "3", "aria-valuenow": "0", "aria-valuetext": "0 of 3 steps done" },
    h("div", { class: "progress-track" }, fill),
    h("ol", { class: "progress-steps" }, h("li", null, "Address"), h("li", null, "Country"), h("li", null, "Place order")));
  let placing = false;
  let quote: Breakdown | null = null;
  let shown = 0;
  let filled = 0;
  let stopFill: (() => void) | null = null;
  const setProgress = (n: number) => {
    if (n === shown) return;
    shown = n;
    bar.setAttribute("aria-valuenow", String(n));
    bar.setAttribute("aria-valuetext", `${n} of 3 steps done`);
    bar.querySelectorAll("li").forEach((li, i) => li.classList.toggle("done", i < n));
    stopFill?.();
    const from = filled;
    const paint = (v: number) => {
      filled = v;
      fill.style.transform = `scaleX(${v})`;
    };
    if (reducedMotion()) paint(n / 3);
    else stopFill = tween(PROGRESS_MS, CURVES.decelerate, (p) => paint(from + (n / 3 - from) * p));
  };
  // Each step counts on its own: Address by the order body rules, Country by the newest quote's 200, Place order while in flight.
  const progress = () => {
    const address = ADDRESS_RULES.every(([key, ok]) => ok(fields[key]!.control.value));
    setProgress(Number(address) + Number(quote !== null) + Number(placing));
  };

  const credits = { trade: h("input", { type: "checkbox", id: "use-trade-in" }), demo: h("input", { type: "checkbox", id: "use-demo-credit" }) };
  const tradeRow = h("div", { class: "check", hidden: true }, credits.trade, h("label", { for: "use-trade-in" }, "Use trade-in credit"));
  const demoRow = h("div", { class: "check", hidden: true }, credits.demo, h("label", { for: "use-demo-credit" }, "Use demo credit"));
  // The server's credit rules decide which boxes show: a probe quote with the flag set, to a country that needs no postal code.
  const probe = async (flag: "use_trade_in" | "use_demo_credit") =>
    (await api("POST", "/api/checkout/quote", { country: boot.countries.find((c) => c.taxes !== null)!.code, [flag]: true })).ok;
  const [tradeOk, demoOk] = await Promise.all([probe("use_trade_in"), cart.lines.some((l) => l.type === "build") ? probe("use_demo_credit") : Promise.resolve(false)]);
  tradeRow.hidden = !tradeOk;
  demoRow.hidden = !demoOk;

  const summaryLines = h("ul", { class: "summary-lines-list" });
  const totals = h("div");
  const notice = h("div", { class: "checkout-notice" });
  const discounts = cart.codes.reduce((sum, c) => sum + c.amount_cents, 0);
  const renderSummary = (c: Cart) => {
    replace(summaryLines, (quote?.lines ?? c.lines).map((l) => h("li", null, h("span", null, `${l.name} x ${l.quantity}`), h("span", null, price(l.line_cents)))));
    replace(totals, totalsList(quote, discounts, canada() ? "Enter your postal code" : "Choose a country", quote?.financing ?? []));
  };
  renderSummary(cart);

  const place = h("button", { type: "submit", class: "pill pill-large place-order" }, "Place order");
  const f = form({ class: "checkout-form" },
    h("h2", null, "Delivery address"),
    ...Object.values(fields).map((x) => x.wrap),
    tradeRow, demoRow);
  const summary = h("aside", { class: "card checkout-summary" }, h("h2", null, "Order summary"), summaryLines, totals, place);

  let sequence = 0;
  /** Drops the current quote (and any answer still on its way) until the next one for the form as it now stands. */
  const invalidate = () => {
    sequence += 1;
    quote = null;
    renderSummary(cart);
    progress();
  };
  const quoteNow = async () => {
    if (!countrySelect.value) return;
    invalidate();
    const mine = sequence;
    const r = await api<Breakdown>("POST", "/api/checkout/quote", {
      country: countrySelect.value, postal_code: postal.control.value, use_trade_in: credits.trade.checked, use_demo_credit: credits.demo.checked,
    });
    if (mine !== sequence) return;
    postal.setError(null);
    if (!r.ok) {
      const postalMessage = r.error.fields?.postal_code;
      if (postalMessage) postal.setError(postalMessage);
      f.alert.textContent = postalMessage ? "" : r.error.message;
      return;
    }
    f.alert.textContent = "";
    quote = r.data;
    renderSummary(cart);
    announce(`Total ${price(quote.total_cents)}.`);
    progress();
  };
  countrySelect.addEventListener("change", () => {
    if (canada() && postal.control.value.trim() === "") invalidate();
    else void quoteNow();
  });
  postal.control.addEventListener("input", () => {
    if (!canada()) return;
    if (canadianPostal.test(postal.control.value)) void quoteNow();
    else invalidate();
  });
  postal.control.addEventListener("change", () => {
    if (canada() && postal.control.value.trim() !== "" && !canadianPostal.test(postal.control.value)) void quoteNow();
  });
  credits.trade.addEventListener("change", () => void quoteNow());
  credits.demo.addEventListener("change", () => void quoteNow());
  f.el.addEventListener("input", progress);

  const recoverSoldOut = async (refusal: Refusal) => {
    const [fresh, cat] = await Promise.all([refreshCart(), api<Catalog>("GET", "/api/catalog")]);
    const stock = new Map<string, number>(cat.ok ? [...cat.data.boards, ...cat.data.components, ...cat.data.accessories].map((i) => [i.sku, i.stock]) : []);
    const gone = fresh?.lines.find((l) => (stock.get(l.sku) ?? 0) < l.quantity);
    if (!gone) {
      f.alert.textContent = refusal.message;
      return;
    }
    await api("DELETE", `/api/cart/lines/${gone.id}`);
    replace(notice, banner(`Sorry, ${gone.name} just sold out. Your cart has been updated.`, "warning"));
    const updated = await refreshCart();
    if (updated) {
      cart.lines = updated.lines;
      invalidate();
      if (updated.lines.length) await quoteNow();
    }
  };

  const submit = async (): Promise<void> => {
    const order = {
      country: countrySelect.value,
      address: {
        name: fields["address.name"]!.control.value, line1: fields["address.line1"]!.control.value, city: fields["address.city"]!.control.value,
        postal_code: postal.control.value, phone: fields["address.phone"]!.control.value,
      },
      use_trade_in: !tradeRow.hidden && credits.trade.checked,
      use_demo_credit: !demoRow.hidden && credits.demo.checked,
    };
    const r = await api<{ number: string }>("POST", "/api/orders", order, { "Idempotency-Key": idempotencyKey });
    if (!r.ok && r.error.error === "idempotency_in_progress") {
      announce("Still placing your order.");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return submit();
    }
    if (r.ok) {
      navigate(`/account/orders/${r.data.number}`, { state: { placed: r.data.number } });
      return;
    }
    placing = false;
    progress();
    if (r.error.error === "out_of_stock") await recoverSoldOut(r.error);
    else showRefusal(r.error, fields, f.alert);
  };

  f.el.addEventListener("submit", (event) => event.preventDefault());
  place.addEventListener("click", async () => {
    replace(notice);
    f.alert.textContent = "";
    placing = true;
    progress();
    place.disabled = true;
    place.textContent = "Placing order...";
    announce("Placing your order.");
    try {
      await submit();
    } finally {
      place.disabled = false;
      place.textContent = "Place order";
    }
  });

  body.append(h("div", { class: "checkout-head" }, bar), notice, h("div", { class: "checkout-grid" }, f.el, summary));
  progress();
}
