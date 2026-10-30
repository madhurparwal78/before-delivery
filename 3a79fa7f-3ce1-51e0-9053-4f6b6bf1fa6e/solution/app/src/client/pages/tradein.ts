// Trade-in /trade-in (brief: Trade-in): the form, and the latest trade-in with its status, quote and expiry.
import { api } from "../api.ts";
import { boot } from "../boot.ts";
import { h, replace, uid } from "../dom.ts";
import { busy, form, input, select, showRefusal, textarea, type Field } from "../forms.ts";
import { capitalised, dateTime, longDate, price } from "../format.ts";
import type { PageContext } from "../router.ts";
import { announce, session } from "../state.ts";
import { badge, pageHead } from "../ui.ts";

interface TradeIn {
  id: number;
  status: string;
  brand: string;
  model_year: number;
  condition: string;
  serial: string;
  quote_cents: number | null;
  quote_expires_at: string | null;
  reject_reason: string | null;
  order_number: string | null;
}

const TITLE = "Trade your board for credit toward a Crest.";

function conditionField(): Field {
  const name = uid("condition");
  const labelId = uid("cond-label");
  const hintId = uid("cond-hint");
  const error = h("p", { class: "field-error", hidden: true, id: uid("err") });
  const radios = ["A", "B", "C"].map((grade) => {
    const id = `${name}-${grade}`;
    return h("div", { class: "choice choice-inline" }, h("input", { type: "radio", class: "sr-radio", name, id, value: grade }), h("label", { for: id }, grade));
  });
  const group = h("div", { role: "radiogroup", "aria-labelledby": labelId, "aria-describedby": `${hintId} ${error.id}`, class: "choice-row" }, radios);
  const wrap = h("div", { class: "field" }, h("p", { id: labelId, class: "label" }, "Condition"), h("p", { id: hintId, class: "hint" }, "A: like new. B: light wear. C: heavy wear or repairs."), group, error);
  const first = radios[0]!.querySelector("input") as HTMLInputElement;
  return {
    wrap,
    control: first,
    setError(message) {
      error.hidden = !message;
      error.textContent = message ?? "";
      if (message) first.setAttribute("aria-invalid", "true");
      else first.removeAttribute("aria-invalid");
    },
  };
}

function panel(trade: TradeIn | undefined, refresh: () => Promise<void>): HTMLElement {
  if (!trade) return h("p", null, "You have no trade-in yet.");
  const alert = h("div", { role: "alert", class: "form-alert" });
  const rows: (Node | null)[] = [
    h("p", { class: "trade-board" }, `${trade.brand}, ${trade.model_year}, condition ${trade.condition}, serial ${trade.serial}`),
  ];
  if (trade.status === "quoted" && trade.quote_cents !== null && trade.quote_expires_at) {
    const accept = h("button", { type: "button", class: "pill" }, "Accept quote");
    const decline = h("button", { type: "button", class: "pill pill-outline" }, "Decline");
    const act = async (button: HTMLButtonElement, pending: string, path: string, done: string) => {
      alert.textContent = "";
      const r = await busy(button, pending, () => api("POST", `/api/trade-ins/${trade.id}/${path}`, {}));
      if (!r.ok) {
        await refresh();
        announce(r.error.message);
        return;
      }
      announce(done);
      await refresh();
    };
    accept.addEventListener("click", () => void act(accept, "Accepting...", "accept", "Quote accepted."));
    decline.addEventListener("click", () => void act(decline, "Declining...", "decline", "Quote declined."));
    rows.push(h("p", { class: "trade-credit" }, `Credit ${price(trade.quote_cents)}`), h("p", null, `Valid until ${dateTime(trade.quote_expires_at)}`), h("div", { class: "actions" }, accept, decline));
  }
  if (trade.status === "accepted" && trade.quote_cents !== null) rows.push(h("p", { class: "trade-credit" }, `Credit ${price(trade.quote_cents)}`), h("p", null, "Your credit comes off a Crest build at checkout."));
  if (trade.status === "expired" && trade.quote_expires_at) rows.push(h("p", null, `This quote expired on ${longDate(trade.quote_expires_at)}.`));
  if (trade.status === "applied" && trade.order_number) rows.push(h("p", null, `Applied to order ${trade.order_number}`));
  if (trade.status === "rejected" && trade.reject_reason) rows.push(h("p", null, `Reason: ${trade.reject_reason}`));
  return h("div", null, h("div", { class: "trade-status" }, h("span", { class: "caption" }, "Status"), badge(capitalised(trade.status), trade.status === "quoted" || trade.status === "accepted" ? "accent" : "plain")), rows, alert);
}

export async function tradeIn({ main }: PageContext): Promise<void> {
  document.title = "Trade-in | Tern Foils";
  main.append(pageHead(TITLE, "Tell us about your current board. Our team quotes a credit that holds for 14 days."));
  const body = h("div", { class: "wrap trade-grid" });
  main.append(body);
  const user = await session();
  if (!user || user.role !== "customer") {
    body.append(h("div", { class: "card" },
      h("p", null, "Any electric hydrofoil, or an unpowered surf foil board, can earn credit toward a new Crest. Sign in to send us its details."),
      h("a", { href: "/login?next=/trade-in", class: "pill" }, "Sign in to trade in")));
    return;
  }
  const fields: Record<string, Field> = {
    brand: select("Current board", boot.tradeInBrands.map((b) => ({ value: b, label: b })), { name: "brand" }),
    model_year: input("Model year", { type: "number", name: "model_year", min: 2018, max: 2025, inputmode: "numeric" }),
    condition: conditionField(),
    serial: input("Serial number", { name: "serial", autocomplete: "off" }, "6 to 20 letters and digits"),
    note: textarea("Note", { name: "note", maxlength: 500 }),
  };
  const submit = h("button", { type: "submit", class: "pill pill-large" }, "Submit trade-in");
  const f = form({ class: "stack-form card" }, h("h2", null, "Your board"), ...Object.values(fields).map((x) => x.wrap), submit);
  const side = h("section", { class: "card trade-panel" });
  const refresh = async () => {
    const r = await api<{ trade_ins: TradeIn[] }>("GET", "/api/trade-ins/mine");
    replace(side, h("h2", null, "Your trade-in"), panel(r.ok ? r.data.trade_ins[0] : undefined, refresh));
  };
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const condition = f.el.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? "";
    const year = fields.model_year!.control.value;
    const r = await busy(submit, "Submitting...", () => api("POST", "/api/trade-ins", {
      brand: fields.brand!.control.value, model_year: /^\d+$/.test(year) ? Number(year) : year, condition,
      serial: fields.serial!.control.value, note: fields.note!.control.value,
    }));
    if (!r.ok) {
      showRefusal(r.error, fields, f.alert);
      return;
    }
    showRefusal({ error: "", message: "" }, fields, f.alert);
    announce("Trade-in submitted.");
    await refresh();
  });
  body.append(f.el, side);
  await refresh();
}
