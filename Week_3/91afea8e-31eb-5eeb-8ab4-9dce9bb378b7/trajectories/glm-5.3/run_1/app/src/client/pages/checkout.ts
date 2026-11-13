import { el, busy, announce, openDialog } from "../ui.ts";
import { get, post, patch, ApiFailure } from "../api.ts";
import { amount } from "../format.ts";
import { state, navigate, signinLink, refreshCartCount, CHECKOUT_KEY } from "../app.ts";

interface Quote {
  lines: Array<{ line_id: string; title: string; seller_id: string; selected: boolean; quantity: number; in_stock: boolean; line_total_paise: number }>;
  parcels: Array<{ seller_id: string; seller_name: string; line_ids: string[]; serviceable: boolean; promise_date: string | null; delivery_fee_paise: number }>;
  destination: { address_id: string | null; pincode: string; city: string | null; state: string | null };
  payment: { method: string | null; use_balance: boolean; emi_tenure_months: number | null };
  payable_paise: number; balance_applied_paise: number; due_paise: number;
  cod: { eligible: boolean; reason: string | null; message: string | null; cap_paise: number; cash_paise: number };
  server_time: string;
}

interface Address { address_id: string; label: string; name: string; line1: string; line2: string; city: string; state: string; pincode: string; phone: string }
interface Card { card_id: string; network: string; last4: string; expiry_month: number; expiry_year: number; name: string }

interface CheckoutState {
  addressId: string | null;
  method: string | null;
  useBalance: boolean;
  emiTenure: number | null;
}

function loadCheckoutState(): CheckoutState {
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_KEY);
    if (raw) return JSON.parse(raw) as CheckoutState;
  } catch { /* fresh tab */ }
  return { addressId: null, method: null, useBalance: false, emiTenure: null };
}

function saveCheckoutState(next: CheckoutState): void {
  window.sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(next));
}

/** The chosen address and payment method, never card number or CVV, stay for the tab. */
export async function renderCheckout(step: "address" | "payment" | "review"): Promise<HTMLElement> {
  const main = el("main", {});
  if (!state.account || state.account.role !== "shopper") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "sign in to continue checkout." })));
    return main;
  }
  const cs = loadCheckoutState();
  const quote = await get<Quote>("/api/cart");
  const problems = el("div", { class: "alert-problems", role: "alert", "aria-label": "Checkout problems", hidden: "true" });

  const grid = el("div", { class: "checkout-grid" });
  const stepCol = el("div", {});
  const summaryCol = el("div", { class: "cart-summary" });
  grid.append(stepCol, summaryCol);

  const summaryHeading = el("h2", { text: "order summary" });
  summaryCol.append(summaryHeading);
  for (const parcel of quote.parcels) {
    const row = el("div", { class: "summary-row" });
    row.append(el("span", { text: `${parcel.seller_name} parcel` }), el("span", { text: amount(parcel.delivery_fee_paise) }));
    summaryCol.append(row);
  }
  const totalRow = el("div", { class: "summary-row total" });
  totalRow.append(el("span", { text: "payable" }), el("span", { class: "payable-total", text: amount(quote.payable_paise) }));
  summaryCol.append(totalRow);

  const heading = el("h2", { class: "step-heading", tabindex: "0", text: step });
  stepCol.append(heading, problems);

  const continueBtn = el("button", { class: "btn btn-primary", text: "Continue" });

  if (step === "address") {
    const addresses = await get<{ addresses: Address[] }>("/api/account/addresses");
    const group = el("fieldset", {});
    group.append(el("legend", { text: "Delivery address" }));
    for (const address of addresses.addresses) {
      const label = el("label", { style: "display:flex;gap:10px;align-items:flex-start;margin:10px 0" });
      const radio = el("input", { type: "radio", name: "address", value: address.address_id });
      radio.checked = cs.addressId === address.address_id;
      label.append(radio, el("span", { text: `${address.label}: ${address.name}, ${address.line1}${address.line2 ? `, ${address.line2}` : ""}, ${address.city} ${address.pincode}` }));
      group.append(label);
    }
    if (addresses.addresses.length === 0) {
      group.append(el("p", { text: "no addresses yet. add one to continue." }));
    }
    const addBtn = el("button", { class: "btn btn-yellow", type: "button", text: "Add address" });
    addBtn.addEventListener("click", () => {
      openAddressDialog(addBtn, async (id) => {
        cs.addressId = id;
        saveCheckoutState(cs);
        void navigate("/checkout/address", true);
      });
    });
    stepCol.append(group, addBtn, continueBtn);
    continueBtn.addEventListener("click", () => {
      const chosen = document.querySelector<HTMLInputElement>("input[name=address]:checked");
      if (!chosen) {
        problems.hidden = false;
        problems.textContent = "Choose a delivery address.";
        return;
      }
      cs.addressId = chosen.value;
      saveCheckoutState(cs);
      void putDestination(chosen.value);
      void navigate("/checkout/payment");
    });
  }

  if (step === "payment") {
    const methodGroup = el("fieldset", {});
    methodGroup.append(el("legend", { text: "Payment method" }));
    const methods: Array<{ value: string; label: string }> = [
      { value: "upi", label: "UPI" },
      { value: "card", label: "Card" },
      { value: "netbanking", label: "Net banking" },
      { value: "emi", label: "EMI" },
      { value: "cod", label: "Cash on delivery" },
    ];
    for (const m of methods) {
      const label = el("label", { style: "display:flex;gap:10px;align-items:center;margin:8px 0" });
      const radio = el("input", { type: "radio", name: "method", value: m.value });
      radio.checked = cs.method === m.value;
      label.append(radio, el("span", { text: m.label }));
      methodGroup.append(label);
    }
    const codNote = el("p", { class: "field-error", role: "status" });
    methodGroup.append(codNote);

    const balanceLabel = el("label", { style: "display:flex;gap:10px;align-items:center;margin:8px 0" });
    const balanceCheck = el("input", { type: "checkbox", "aria-label": "Use Chauraha balance" });
    balanceCheck.checked = cs.useBalance;
    balanceLabel.append(balanceCheck, el("span", { text: "Use Chauraha balance" }));
    stepCol.append(methodGroup, balanceLabel);

    // per-method fields
    const fields = el("div", { class: "payment-fields" });
    const paintFields = async () => {
      fields.textContent = "";
      const chosen = document.querySelector<HTMLInputElement>("input[name=method]:checked")?.value ?? null;
      if (chosen === "upi") {
        const l = el("label", { class: "field" });
        l.append(el("span", { class: "label-text", text: "UPI ID" }));
        const input = el("input", { type: "text", placeholder: "name@bank" });
        input.value = window.sessionStorage.getItem("chauraha_upi") ?? "";
        input.addEventListener("input", () => window.sessionStorage.setItem("chauraha_upi", input.value));
        l.append(input);
        fields.append(l);
      } else if (chosen === "card") {
        const saved = await get<{ cards: Card[] }>("/api/account/cards");
        if (saved.cards.length > 0) {
          const group = el("fieldset", {});
          group.append(el("legend", { text: "Saved cards" }));
          for (const card of saved.cards) {
            const l = el("label", { style: "display:flex;gap:10px;align-items:center" });
            const radio = el("input", { type: "radio", name: "savedcard", value: card.card_id });
            l.append(radio, el("span", { text: `${card.network} ending ${card.last4} · ${card.expiry_month}/${card.expiry_year}` }));
            group.append(l);
          }
          fields.append(group);
          const cvvLabel = el("label", { class: "field" });
          cvvLabel.append(el("span", { class: "label-text", text: "CVV" }));
          const cvvInput = el("input", { type: "password", maxlength: "3", inputmode: "numeric" });
          cvvLabel.append(cvvInput);
          fields.append(cvvLabel);
        }
        const numberLabel = el("label", { class: "field" });
        numberLabel.append(el("span", { class: "label-text", text: "Card number" }));
        const numberInput = el("input", { type: "text", inputmode: "numeric", autocomplete: "cc-number" });
        numberLabel.append(numberInput);
        const expiryLabel = el("label", { class: "field", style: "display:inline-block;width:40%" });
        expiryLabel.append(el("span", { class: "label-text", text: "Expiry (MM/YY)" }));
        const expiryInput = el("input", { type: "text", placeholder: "12/30", autocomplete: "cc-exp" });
        expiryLabel.append(expiryInput);
        const cvvLabel2 = el("label", { class: "field", style: "display:inline-block;width:25%" });
        cvvLabel2.append(el("span", { class: "label-text", text: "CVV" }));
        const cvvInput2 = el("input", { type: "password", maxlength: "3", inputmode: "numeric" });
        cvvLabel2.append(cvvInput2);
        const nameLabel = el("label", { class: "field" });
        nameLabel.append(el("span", { class: "label-text", text: "Name on card" }));
        const nameInput = el("input", { type: "text", autocomplete: "cc-name" });
        nameLabel.append(nameInput);
        const saveCheck = el("input", { type: "checkbox", "aria-label": "Save this card" });
        const saveLabel = el("label", { style: "display:flex;gap:10px;align-items:center" });
        saveLabel.append(saveCheck, el("span", { text: "Save this card" }));
        fields.append(numberLabel, expiryLabel, cvvLabel2, nameLabel, saveLabel);
      } else if (chosen === "netbanking") {
        const banks = await get<{ banks: Array<{ code: string; name: string }> }>("/api/banks");
        const group = el("fieldset", {});
        group.append(el("legend", { text: "Bank" }));
        for (const bank of banks.banks) {
          const l = el("label", { style: "display:flex;gap:10px;align-items:center" });
          const radio = el("input", { type: "radio", name: "bank", value: bank.code });
          l.append(radio, el("span", { text: bank.name }));
          group.append(l);
        }
        fields.append(group);
      } else if (chosen === "emi") {
        const group = el("fieldset", {});
        group.append(el("legend", { text: "EMI tenure" }));
        for (const tenure of [3, 6, 9, 12]) {
          const l = el("label", { style: "display:flex;gap:10px;align-items:center" });
          const radio = el("input", { type: "radio", name: "tenure", value: String(tenure) });
          radio.checked = cs.emiTenure === tenure;
          l.append(radio, el("span", { text: `${tenure} months` }));
          group.append(l);
        }
        fields.append(group);
        const numberLabel = el("label", { class: "field" });
        numberLabel.append(el("span", { class: "label-text", text: "Card number" }));
        const numberInput = el("input", { type: "text", inputmode: "numeric" });
        numberLabel.append(numberInput);
        const expiryLabel = el("label", { class: "field", style: "display:inline-block;width:40%" });
        expiryLabel.append(el("span", { class: "label-text", text: "Expiry (MM/YY)" }));
        const expiryInput = el("input", { type: "text", placeholder: "12/30" });
        expiryLabel.append(expiryInput);
        const cvvLabel = el("label", { class: "field", style: "display:inline-block;width:25%" });
        cvvLabel.append(el("span", { class: "label-text", text: "CVV" }));
        const cvvInput = el("input", { type: "password", maxlength: "3", inputmode: "numeric" });
        cvvLabel.append(cvvInput);
        const nameLabel = el("label", { class: "field" });
        nameLabel.append(el("span", { class: "label-text", text: "Name on card" }));
        const nameInput = el("input", { type: "text" });
        nameLabel.append(nameInput);
        fields.append(numberLabel, expiryLabel, cvvLabel, nameLabel);
      } else if (chosen === "cod") {
        fields.append(el("p", { text: "pay the courier in cash when the parcel arrives. a ₹25.00 fee per parcel applies." }));
      }
    };
    void paintFields();
    methodGroup.addEventListener("change", () => { void paintFields(); });

    continueBtn.addEventListener("click", () => {
      void busy(continueBtn, async () => {
        const chosen = document.querySelector<HTMLInputElement>("input[name=method]:checked")?.value ?? null;
        const useBalance = balanceCheck.checked;
        cs.method = chosen;
        cs.useBalance = useBalance;
        saveCheckoutState(cs);
        try {
          const nextQuote = await putPayment(chosen, useBalance, cs.emiTenure);
          problems.hidden = true;
          void navigate("/checkout/review");
        } catch (err) {
          if (err instanceof ApiFailure) {
            problems.hidden = false;
            problems.textContent = err.fields.method ?? err.message;
            if (err.fields.method) announce(err.fields.method);
          }
        }
      });
    });
    stepCol.append(fields, continueBtn);
  }

  if (step === "review") {
    const addresses = await get<{ addresses: Address[] }>("/api/account/addresses");
    const address = addresses.addresses.find((a) => a.address_id === cs.addressId);
    stepCol.append(el("p", { text: `delivering to ${address ? `${address.label}: ${address.name}, ${address.city} ${address.pincode}` : "no address chosen"}` }));
    stepCol.append(el("p", { text: `paying by ${cs.method ?? "nothing"}${cs.useBalance ? " with Chauraha balance" : ""}` }));
    const payLabel = cs.method === "cod" ? `Place order` : `Pay ${amount(quote.payable_paise)}`;
    const payBtn = el("button", { class: "btn btn-primary", text: payLabel });

    // one Idempotency-Key generated when the review step opens, reused for every retry
    if (!window.sessionStorage.getItem("chauraha_idem")) {
      const key = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
      window.sessionStorage.setItem("chauraha_idem", key);
    }
    const idemKey = window.sessionStorage.getItem("chauraha_idem") ?? "";
    payBtn.addEventListener("click", () => {
      void busy(payBtn, async () => {
        const payment: Record<string, unknown> = {
          method: cs.method,
          use_balance: cs.useBalance,
        };
        if (cs.method === "upi") {
          payment.upi = { vpa: window.sessionStorage.getItem("chauraha_upi") ?? "" };
        } else if (cs.method === "card") {
          const savedId = document.querySelector<HTMLInputElement>("input[name=savedcard]:checked")?.value;
          if (savedId) {
            payment.card = { saved_card_id: savedId, cvv: document.querySelector<HTMLInputElement>("input[type=password]")?.value ?? "" };
          } else {
            const expiry = (document.querySelectorAll<HTMLInputElement>("input[type=text]")[1]?.value ?? "").split("/");
            payment.card = {
              number: document.querySelectorAll<HTMLInputElement>("input[type=text]")[0]?.value ?? "",
              expiry_month: Number(expiry[0]),
              expiry_year: Number(`20${expiry[1] ?? "30"}`),
              cvv: document.querySelectorAll<HTMLInputElement>("input[type=password]")[0]?.value ?? "",
              name: document.querySelectorAll<HTMLInputElement>("input[type=text]")[2]?.value ?? "",
              save: document.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked ?? false,
            };
          }
        } else if (cs.method === "netbanking") {
          payment.netbanking = { bank_code: document.querySelector<HTMLInputElement>("input[name=bank]:checked")?.value ?? "" };
        } else if (cs.method === "emi") {
          const tenure = Number(document.querySelector<HTMLInputElement>("input[name=tenure]:checked")?.value ?? "3");
          payment.emi = {
            tenure_months: tenure,
            card: {
              number: document.querySelectorAll<HTMLInputElement>("input[type=text]")[0]?.value ?? "",
              expiry_month: Number(document.querySelectorAll<HTMLInputElement>("input[type=text]")[1]?.value.slice(0, 2)),
              expiry_year: Number(`20${document.querySelectorAll<HTMLInputElement>("input[type=text]")[1]?.value.slice(3)}`),
              cvv: document.querySelectorAll<HTMLInputElement>("input[type=password]")[0]?.value ?? "",
              name: document.querySelectorAll<HTMLInputElement>("input[type=text]")[2]?.value ?? "",
            },
          };
        }
        try {
          const res = await post<{ order_id: string; confirmation_url: string; payment: { status: string } }>("/api/checkout", {
            address_id: cs.addressId,
            expected_payable_paise: quote.payable_paise,
            payment,
          }, { "Idempotency-Key": idemKey });
          window.sessionStorage.removeItem("chauraha_idem");
          await refreshCartCount();
          await navigate(res.confirmation_url);
        } catch (err) {
          if (err instanceof ApiFailure) {
            problems.hidden = false;
            problems.textContent = err.message;
            if (err.code === "price_changed") {
              problems.textContent = "A price in your cart changed. Check the new total.";
              await navigate("/cart");
            }
          }
        }
      });
    });
    stepCol.append(payBtn);
  }

  main.append(grid);
  return main;
}

async function putDestination(addressId: string): Promise<void> {
  try { await patch("/api/cart/destination", { address_id: addressId }); } catch { /* the quote re-fetches on the next step */ }
}

async function putPayment(method: string | null, useBalance: boolean, tenure: number | null): Promise<Quote> {
  const res = await fetch("/api/cart/payment", {
    method: "PUT",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    credentials: "same-origin",
    body: JSON.stringify({ method, use_balance: useBalance, emi_tenure_months: tenure }),
  });
  const body = await res.json();
  if (!res.ok) throw new ApiFailure(res.status, body);
  return body as Quote;
}

function openAddressDialog(opener: HTMLElement, onCreated: (id: string) => void): void {
  const fields: Array<[string, string]> = [
    ["label", "Label"], ["name", "Name"], ["line1", "Street"], ["line2", "Area (optional)"],
    ["city", "City"], ["pincode", "Pincode"], ["phone", "Phone"],
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  const form = el("form", {});
  for (const [key, label] of fields) {
    const wrap = el("label", { class: "field" });
    wrap.append(el("span", { class: "label-text", text: label }));
    const input = el("input", { type: "text", name: key });
    inputs[key] = input;
    wrap.append(input);
    form.append(wrap);
  }
  const saveBtn = el("button", { class: "btn btn-primary", type: "submit", text: "Save address" });
  form.append(saveBtn);
  const error = el("p", { class: "field-error", role: "alert" });
  const dlg = el("dialog", { "aria-label": "New address" });
  dlg.append(el("h2", { text: "New address" }), form, error);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void busy(saveBtn, async () => {
      error.textContent = "";
      try {
        const res = await post<Address>("/api/account/addresses", {
          label: inputs.label.value, name: inputs.name.value, line1: inputs.line1.value,
          line2: inputs.line2.value, city: inputs.city.value, pincode: inputs.pincode.value, phone: inputs.phone.value,
        });
        dlg.close();
        dlg.remove();
        onCreated(res.address_id);
      } catch (err) {
        if (err instanceof ApiFailure) {
          const first = Object.values(err.fields)[0] ?? err.message;
          error.textContent = first;
        }
      }
    });
  });
  openDialog(dlg, opener);
}
