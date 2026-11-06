import { COPY, quoteAccepted } from "../shared/copy.js";
import { formatMoney, parseAmount, type Currency } from "../shared/money.js";
import { announce, api, pageData, qs, qsa, type ErrorBody } from "./dom.js";
import { QuoteSheet, purchaseFigures } from "./sheet.js";

interface CheckoutData {
  page: string;
  orderId: string;
  state: string;
  dueAmount: string;
  currency: Currency;
}

interface OrderBody {
  id: string;
  state: string;
  currency: Currency;
  total: string;
  dueNow: string;
  dueAtLaunch: string;
}

function clearFieldErrors(form: HTMLElement): void {
  for (const node of qsa<HTMLElement>("[data-field-error]", form)) node.remove();
}

function showFieldErrors(form: HTMLElement, fields: Record<string, string>): void {
  clearFieldErrors(form);
  for (const [field, message] of Object.entries(fields)) {
    const input = qs<HTMLElement>(`[name="${cssEscape(field)}"]`, form) ?? fieldByLabel(form, field);
    const note = document.createElement("p");
    note.className = "field-error";
    note.setAttribute("data-field-error", field);
    note.textContent = message;
    (input?.closest("label") ?? form).append(note);
  }
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function fieldByLabel(form: HTMLElement, label: string): HTMLElement | null {
  for (const node of qsa<HTMLLabelElement>("label", form)) {
    if (node.textContent?.trim().startsWith(label)) return qs<HTMLElement>("input", node);
  }
  return null;
}

export function initCheckout(): void {
  const data = pageData<CheckoutData>();
  if (!data || data.page !== "checkout") return;
  const status = qs<HTMLElement>("[data-checkout-status]");
  const alert = qs<HTMLElement>("[data-checkout-alert]");
  const acceptForm = qs<HTMLFormElement>("[data-accept-form]");
  const paymentForm = qs<HTMLFormElement>("[data-payment-form]");
  const region = qs<HTMLElement>("[data-quote]");
  const sheet = region ? new QuoteSheet(region) : null;
  let payKey = crypto.randomUUID();

  const showBanner = (text: string | null): void => {
    if (!alert) return;
    if (text === null) {
      alert.hidden = true;
      alert.textContent = "";
      return;
    }
    alert.hidden = false;
    alert.textContent = text;
  };

  const enablePayment = (): void => {
    if (!paymentForm) return;
    paymentForm.removeAttribute("data-disabled");
    for (const input of qsa<HTMLInputElement>("input", paymentForm)) input.disabled = false;
    const button = qs<HTMLButtonElement>("button[type=submit]", paymentForm);
    if (button) button.disabled = false;
    qs<HTMLInputElement>('[name="cardNumber"]', paymentForm)?.focus();
  };

  acceptForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showBanner(null);
    clearFieldErrors(acceptForm);
    announce(status, COPY.acceptPending);
    const body: Record<string, unknown> = {
      acceptTerms: qs<HTMLInputElement>("[data-accept-terms]", acceptForm)?.checked === true,
    };
    for (const name of ["businessName", "name", "email", "password"]) {
      const input = qs<HTMLInputElement>(`[name="${name}"]`, acceptForm);
      if (input) body[name] = input.value;
    }
    const result = await api<{ order: OrderBody } & ErrorBody>(`/api/orders/${data.orderId}/accept`, {
      method: "POST",
      body,
    });
    if (result.status === 200) {
      const order = result.body.order;
      const total = parseAmount(order.currency, order.total);
      announce(status, quoteAccepted(total ? formatMoney(total) : order.total));
      acceptForm.hidden = true;
      enablePayment();
      return;
    }
    if (result.status === 409 && result.body.error === "quote_stale") {
      const order = result.body.order;
      if (order && sheet) {
        sheet.show(
          purchaseFigures({
            currency: order.currency,
            dueNow: order.dueNow,
            dueAtLaunch: order.dueAtLaunch,
            total: order.total,
          }),
        );
        const due = parseAmount(order.currency, order.dueNow);
        const payButton = paymentForm ? qs<HTMLButtonElement>("button[type=submit]", paymentForm) : null;
        if (payButton && due) payButton.textContent = `Pay ${formatMoney(due)}`;
      }
      announce(status, COPY.quoteStale);
      return;
    }
    if (result.status === 422 && result.body.fields) {
      showFieldErrors(acceptForm, result.body.fields);
      announce(status, result.body.message);
      return;
    }
    if (result.status === 503) {
      showBanner(COPY.billingOutage);
      announce(status, COPY.billingOutage);
      return;
    }
    announce(status, result.body.message ?? COPY.billingOutage);
  });

  if (paymentForm) {
    for (const input of qsa<HTMLInputElement>("input", paymentForm)) {
      input.addEventListener("input", () => {
        payKey = crypto.randomUUID();
      });
    }
    paymentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = qs<HTMLButtonElement>("button[type=submit]", paymentForm);
      if (button?.disabled) return;
      showBanner(null);
      clearFieldErrors(paymentForm);
      const label = button?.textContent ?? "";
      if (button) {
        button.disabled = true;
        button.dataset.pending = "true";
      }
      announce(status, COPY.payPending);
      const result = await api<{ receiptUrl: string } & ErrorBody>(`/api/orders/${data.orderId}/pay`, {
        method: "POST",
        idempotencyKey: payKey,
        body: {
          card: {
            number: qs<HTMLInputElement>('[name="cardNumber"]', paymentForm)?.value ?? "",
            expiry: qs<HTMLInputElement>('[name="cardExpiry"]', paymentForm)?.value ?? "",
            cvc: qs<HTMLInputElement>('[name="cardCvc"]', paymentForm)?.value ?? "",
          },
        },
      });
      if (button) {
        button.disabled = false;
        delete button.dataset.pending;
        button.textContent = label;
      }
      if (result.status === 201) {
        window.location.assign(result.body.receiptUrl);
        return;
      }
      if (result.status === 402) {
        announce(status, COPY.cardDeclined);
        return;
      }
      if (result.status === 422 && result.body.fields) {
        showFieldErrors(paymentForm, result.body.fields);
        announce(status, result.body.message);
        return;
      }
      if (result.status === 503 && result.body.error === "storage_unavailable") {
        showBanner(COPY.storageOutageCheckout);
        announce(status, COPY.storageOutageCheckout);
        return;
      }
      if (result.status === 503) {
        showBanner(COPY.billingOutage);
        announce(status, COPY.billingOutage);
        return;
      }
      announce(status, result.body.message ?? COPY.billingOutage);
    });
  }
}
