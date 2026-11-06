import { COPY, refundDone } from "../shared/copy.js";
import { formatMoney, parseAmount, type Currency } from "../shared/money.js";
import { announce, api, pageData, qs, qsa, trapDialog, type ErrorBody } from "./dom.js";

interface PaymentBody {
  kind: string;
  amount: string;
  refunded: string;
  remaining: string;
}

interface StudioOrderBody {
  id: string;
  number: string;
  currency: Currency;
  state: string;
  payments: PaymentBody[];
}

function formatAmount(currency: Currency, text: string): string {
  const parsed = parseAmount(currency, text);
  return parsed ? formatMoney(parsed) : text;
}

export function initStudio(): void {
  const data = pageData<{ page: string }>();
  if (!data || data.page !== "studio") return;
  const refundDialogRoot = qs<HTMLElement>("[data-refund-dialog]");
  const refundStatus = qs<HTMLElement>("[data-refund-status]");
  const dialog = refundDialogRoot ? trapDialog(refundDialogRoot) : null;
  let order: StudioOrderBody | null = null;

  const paintRefundFigures = (): void => {
    if (!order || !refundDialogRoot) return;
    const kind = qs<HTMLInputElement>('input[name="refund-payment"]:checked', refundDialogRoot)?.value ?? "deposit";
    const payment = order.payments.find((candidate) => candidate.kind === kind);
    const soFar = qs<HTMLElement>("[data-refund-so-far]", refundDialogRoot);
    const remaining = qs<HTMLElement>("[data-refund-remaining]", refundDialogRoot);
    if (soFar) {
      soFar.textContent = `Refunded so far ${
        payment ? formatAmount(order.currency, payment.refunded) : formatAmount(order.currency, "0.00")
      }`;
    }
    if (remaining) {
      remaining.textContent = `Left on this payment ${
        payment ? formatAmount(order.currency, payment.remaining) : formatAmount(order.currency, "0.00")
      }`;
    }
  };

  if (refundDialogRoot) {
    for (const radio of qsa<HTMLInputElement>('input[name="refund-payment"]', refundDialogRoot)) {
      radio.addEventListener("change", paintRefundFigures);
    }
    qs<HTMLElement>("[data-refund-close]", refundDialogRoot)?.addEventListener("click", () => dialog?.close());
    const form = qs<HTMLFormElement>("[data-refund-form]", refundDialogRoot);
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!order) return;
      const field = qs<HTMLElement>("[data-refund-field]", refundDialogRoot);
      if (field) field.hidden = true;
      const payment = qs<HTMLInputElement>('input[name="refund-payment"]:checked', refundDialogRoot)?.value ?? "deposit";
      const amount = qs<HTMLInputElement>('[name="amount"]', form)?.value ?? "";
      const reason = qs<HTMLInputElement>('[name="reason"]', form)?.value ?? "";
      announce(refundStatus, COPY.refundPending);
      const result = await api<{ payment: PaymentBody; refund: { amount: string } } & ErrorBody>(
        `/api/studio/orders/${order.id}/refunds`,
        {
          method: "POST",
          idempotencyKey: crypto.randomUUID(),
          body: { payment, amount, reason },
        },
      );
      if (result.status === 201) {
        const currency = order.currency;
        const updated = result.body.payment;
        order.payments = order.payments.map((candidate) =>
          candidate.kind === updated.kind ? updated : candidate,
        );
        paintRefundFigures();
        announce(
          refundStatus,
          refundDone(formatAmount(currency, result.body.refund.amount), formatAmount(currency, updated.remaining)),
        );
        const refundedCell = qs<HTMLElement>(`[data-order-refunded="${order.id}"]`);
        if (refundedCell) {
          const total = order.payments.reduce((sum, candidate) => {
            const parsed = parseAmount(currency, candidate.refunded);
            return sum + (parsed?.minor ?? 0n);
          }, 0n);
          refundedCell.textContent = formatMoney({ currency, minor: total });
        }
        return;
      }
      if (result.status === 422 && field) {
        field.hidden = false;
        field.textContent = result.body.fields?.amount ?? result.body.message;
        announce(refundStatus, result.body.fields?.amount ?? result.body.message);
        return;
      }
      announce(refundStatus, result.status === 503 ? COPY.billingOutage : result.body.message);
    });
  }

  document.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const refundOpen = target.closest<HTMLElement>("[data-refund-open]");
    if (refundOpen) {
      const orderId = refundOpen.dataset.refundOpen ?? "";
      dialog?.open();
      const result = await api<StudioOrderBody>(`/api/studio/orders/${orderId}`);
      if (result.status !== 200) return;
      order = result.body;
      paintRefundFigures();
      return;
    }
    const transition = target.closest<HTMLElement>("[data-order-transition]");
    if (transition) {
      const orderId = transition.dataset.order ?? "";
      const to = transition.dataset.orderTransition ?? "";
      const button = transition as HTMLButtonElement;
      button.disabled = true;
      const result = await api<ErrorBody>(`/api/studio/orders/${orderId}/transitions`, {
        method: "POST",
        body: { to },
      });
      button.disabled = false;
      if (result.status === 200) {
        window.location.reload();
        return;
      }
      announce(refundStatus, result.status === 503 ? COPY.billingOutage : result.body.message);
      return;
    }
    const publish = target.closest<HTMLElement>("[data-entry-publish]");
    if (publish) {
      const result = await api<ErrorBody>(`/api/studio/entries/${publish.dataset.entryPublish}/publish`, {
        method: "POST",
        body: {},
      });
      if (result.status === 200) window.location.reload();
      return;
    }
    const withdraw = target.closest<HTMLElement>("[data-entry-withdraw]");
    if (withdraw) {
      const result = await api<ErrorBody>(`/api/studio/entries/${withdraw.dataset.entryWithdraw}/withdraw`, {
        method: "POST",
        body: {},
      });
      if (result.status === 200) window.location.reload();
    }
  });

  for (const select of qsa<HTMLSelectElement>("[data-assign-project]")) {
    select.addEventListener("change", async () => {
      if (!select.value) return;
      const result = await api<ErrorBody>(`/api/studio/projects/${select.dataset.assignProject}/assignments`, {
        method: "POST",
        body: { contractorId: select.value },
      });
      if (result.status === 201 || result.status === 200) {
        window.location.reload();
        return;
      }
      announce(refundStatus, result.body.message);
    });
  }

  const priceForm = qs<HTMLFormElement>("[data-price-form]");
  priceForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const field = qs<HTMLElement>("[data-price-field]", priceForm);
    if (field) field.hidden = true;
    const body: Record<string, unknown> = {
      plan: qs<HTMLSelectElement>('[name="plan"]', priceForm)?.value ?? "",
      currency: "ARS",
      amount: qs<HTMLInputElement>('[name="amount"]', priceForm)?.value ?? "",
    };
    const effectiveAt = qs<HTMLInputElement>('[name="effectiveAt"]', priceForm)?.value ?? "";
    if (effectiveAt) body.effectiveAt = effectiveAt;
    const result = await api<ErrorBody>("/api/studio/prices", { method: "POST", body });
    if (result.status === 201) {
      window.location.reload();
      return;
    }
    if (field) {
      field.hidden = false;
      field.textContent = Object.values(result.body.fields ?? {})[0] ?? result.body.message;
    }
  });
}
