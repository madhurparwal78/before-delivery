/** Payments: the company's payments, newest first, with cancel for scheduled ones. */
import { formatDollars } from "../../shared/money.js";
import { announce } from "../shared/announce.js";
import { api, ServerFault, SignedOut, Unreachable } from "../shared/api.js";
import { COPY } from "../shared/copy.js";
import { clear, h, isPending, pending } from "../shared/dom.js";
import { calendarDate, methodLabel } from "../shared/format.js";
import { actionFailed, actionSucceeded, refreshFailed } from "../shared/outage.js";

interface Payment {
  id: string;
  recipient_name: string;
  amount_cents: number;
  method: string;
  status: string;
  effective_date: string | null;
}

const STATUS_WORDS: Record<string, string> = {
  pending_approval: "Awaiting approval",
  scheduled: "Scheduled",
  posted: "Posted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  failed: "Failed",
  expired: "Expired",
};

function paymentRow(payment: Payment): HTMLElement {
  const row = h(
    "li",
    { class: "payment-row enter", "data-payment": payment.id },
    h(
      "div",
      { class: "payment-main" },
      h("strong", { class: "payment-name" }, payment.recipient_name),
      h("span", { class: "chip" }, methodLabel(payment.method)),
      h("span", { class: `status-word status-${payment.status}` }, STATUS_WORDS[payment.status] ?? payment.status),
      payment.effective_date ? h("span", { class: "payment-date" }, `Effective ${calendarDate(payment.effective_date)}`) : null,
    ),
    h("span", { class: "mono payment-amount" }, formatDollars(payment.amount_cents)),
  );
  if (payment.status === "scheduled") row.append(h("button", { class: "btn btn-quiet", type: "button", "data-cancel": payment.id }, "Cancel payment"));
  return row;
}

export function mountPayments(root: HTMLElement): void {
  const list = h("ul", { class: "payment-list", "aria-label": "Payments" });
  const empty = h("p", { class: "empty-state", hidden: true }, "No payments yet.");
  root.append(list, empty);

  async function load(): Promise<void> {
    try {
      const { data } = await api<{ payments: Payment[] }>("GET", "/api/payments");
      clear(list);
      list.append(...data.payments.map(paymentRow));
      empty.hidden = data.payments.length > 0;
    } catch (error) {
      if (error instanceof Unreachable) refreshFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    }
  }
  void load();

  list.addEventListener("click", async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-cancel]");
    if (!button || isPending(button)) return;
    const done = pending(button, "Cancelling…");
    try {
      const { status, data } = await api<{ error?: string }>("POST", `/api/payments/${button.dataset.cancel}/cancel`);
      actionSucceeded();
      if (status === 200) {
        announce("Payment cancelled");
        await load();
      } else if (status === 403) announce("You can only cancel payments you created.");
      else if (data.error === "payment_not_scheduled") {
        announce("This payment can no longer be cancelled.");
        await load();
      }
    } catch (error) {
      if (error instanceof Unreachable) actionFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    } finally {
      done();
    }
  });
}
