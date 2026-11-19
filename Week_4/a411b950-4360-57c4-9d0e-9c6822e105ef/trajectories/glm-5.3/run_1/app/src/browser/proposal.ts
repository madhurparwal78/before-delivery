import { apiFetch, ApiError, NoResponseError, fetchOrNoResponse } from "./api.js";
import { Milestone, formatMoney } from "../shared/domain.js";

/**
 * The producer's proposal page (DP-26, DP-55, DP-62): milestone amounts,
 * accept and pay deposit with idempotent retries and a live re-read.
 */

interface ProposalView {
  reference: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  currency: "USD";
  production_month: string;
  production_month_label: string;
  month_open: boolean;
  milestones: Milestone[];
  status: string;
  expires_at: string;
  deposit: {
    invoice_number: string;
    killbill_invoice_id: string;
    amount_cents: number;
    balance_cents: number;
    paid: boolean;
    invoice_date: string;
    billing: "live" | "unreachable";
  } | null;
}

const COPY = {
  acceptPending: (label: string) => `Holding ${label}…`,
  accepted: (label: string) => `${label} is held. Pay the deposit to confirm it.`,
  alreadyAccepted: "This proposal has already been accepted. The deposit invoice is below.",
  monthTaken: (label: string) => `${label} has just been booked by another production. Ask Kettlehole Audio for another month.`,
  expired: "This proposal has expired. Ask Kettlehole Audio for a new one.",
  closed: "This proposal is no longer open.",
  acceptBillingDown: "Billing is unreachable, so nothing was held. Try again in a few minutes.",
  depositUnreachable: "Billing can’t be reached, so these deposit figures may be out of date.",
  payPending: "Recording payment…",
  payLost: "Connection lost. Retrying with the same payment…",
  payUnconfirmed: "We couldn't confirm the payment. Press Pay deposit to check again. You won't be charged twice.",
  paid: (label: string) => `Deposit received. ${label} is confirmed. A confirmation email will follow.`,
  payBillingDown: "Billing is unreachable, so no payment was taken. Try again in a few minutes.",
  payRefused: "The payment request was refused. Reload the page to see the current deposit.",
};

class ProposalPage {
  private readonly token: string;
  private readonly heading: HTMLHeadingElement;
  private readonly scope: HTMLElement;
  private readonly fee: HTMLElement;
  private readonly month: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly acceptArea: HTMLElement;
  private readonly acceptButton: HTMLButtonElement;
  private readonly depositArea: HTMLElement;
  private readonly depositNumber: HTMLElement;
  private readonly depositAmount: HTMLElement;
  private readonly payForm: HTMLFormElement;
  private readonly payerName: HTMLInputElement;
  private readonly payButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private view: ProposalView | null = null;
  private accepting = false;
  private paying = false;
  private payKey: string | null = null;
  private paySignature = "";
  private payAttempts = 0;
  private pollTimer: number | null = null;

  constructor() {
    this.token = window.location.pathname.split("/").pop() || "";
    this.heading = document.getElementById("proposal-heading") as HTMLHeadingElement;
    this.scope = document.getElementById("proposal-scope") as HTMLElement;
    this.fee = document.getElementById("proposal-fee") as HTMLElement;
    this.month = document.getElementById("proposal-month") as HTMLElement;
    this.rows = document.getElementById("milestone-rows") as HTMLElement;
    this.acceptArea = document.getElementById("accept-area") as HTMLElement;
    this.acceptButton = document.getElementById("accept-button") as HTMLButtonElement;
    this.depositArea = document.getElementById("deposit-area") as HTMLElement;
    this.depositNumber = document.getElementById("deposit-invoice-number") as HTMLElement;
    this.depositAmount = document.getElementById("deposit-amount") as HTMLElement;
    this.payForm = document.getElementById("pay-form") as HTMLFormElement;
    this.payerName = document.getElementById("payer-name") as HTMLInputElement;
    this.payButton = document.getElementById("pay-button") as HTMLButtonElement;
    this.status = document.getElementById("proposal-status") as HTMLElement;
    this.acceptButton.addEventListener("click", () => void this.accept());
    this.payForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.pay();
    });
  }

  async init(): Promise<void> {
    await this.read();
    this.startPolling();
  }

  private async read(): Promise<void> {
    try {
      const view = await apiFetch<ProposalView>(`/api/proposals/${this.token}`);
      this.render(view);
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        const code = error.code;
        this.status.textContent = code === "proposal_expired" ? COPY.expired : COPY.closed;
        this.acceptArea.hidden = true;
        this.stopPolling();
      }
    }
  }

  private render(view: ProposalView): void {
    const previousStatus = this.view?.status;
    this.view = view;
    this.heading.textContent = `Proposal ${view.reference}`;
    this.scope.textContent = `${view.project_title} — ${view.scope}`;
    this.fee.textContent = formatMoney(view.fee_cents);
    this.month.textContent = view.production_month_label;
    this.rows.innerHTML = "";
    for (const milestone of view.milestones) {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(milestone.name)}</td><td>${milestone.percent}%</td><td class="amount">${formatMoney(milestone.amount_cents)}</td>`;
      this.rows.appendChild(row);
    }
    if (view.status === "proposal_sent") {
      if (!view.month_open) {
        this.acceptArea.hidden = true;
        if (previousStatus !== undefined) this.status.textContent = COPY.monthTaken(view.production_month_label);
        else this.status.textContent = COPY.monthTaken(view.production_month_label);
      } else {
        this.acceptArea.hidden = false;
        this.acceptButton.textContent = `Accept and hold ${view.production_month_label}`;
        if (this.status.textContent === COPY.monthTaken(view.production_month_label)) {
          this.status.textContent = "";
        }
      }
      this.depositArea.hidden = true;
      return;
    }
    this.acceptArea.hidden = true;
    if (view.deposit) {
      this.renderDeposit(view);
    }
    if (view.status === "accepted" && !view.deposit?.paid) {
      // Waiting for payment; keep the polling for paid state.
    }
    if (view.status === "deposit_paid" || view.status === "booked") {
      this.status.textContent = COPY.paid(view.production_month_label);
      this.payForm.hidden = true;
      this.stopPolling();
    } else {
      this.stopPolling();
    }
  }

  private renderDeposit(view: ProposalView): void {
    const deposit = view.deposit!;
    this.depositArea.hidden = false;
    this.depositNumber.textContent = `Invoice ${deposit.invoice_number}`;
    this.depositAmount.textContent = `Deposit ${formatMoney(deposit.amount_cents)}`;
    this.payKey = null;
    if (deposit.billing === "unreachable") {
      this.status.textContent = COPY.depositUnreachable;
    }
    if (deposit.paid) {
      this.payForm.hidden = true;
      this.status.textContent = COPY.paid(view.production_month_label);
    } else {
      this.payForm.hidden = false;
    }
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = window.setInterval(async () => {
      if (this.accepting) return;
      const view = this.view;
      if (view && (view.status === "accepted" || view.status === "proposal_sent")) {
        await this.read();
      }
    }, 2000);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async accept(): Promise<void> {
    if (this.accepting) return;
    this.accepting = true;
    this.acceptButton.disabled = true;
    const label = this.view?.production_month_label ?? "";
    this.status.textContent = COPY.acceptPending(label);
    try {
      const response = await fetchOrNoResponse(`/api/proposals/${this.token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 201) {
        this.status.textContent = COPY.accepted(label);
        await this.read();
        this.accepting = false;
        return;
      }
      const payload = (await response.json().catch(() => null)) as { error?: string; month?: string } | null;
      if (response.status === 409 && payload?.error === "illegal_transition") {
        await this.read();
        const view = this.view;
        if (view && view.status !== "proposal_sent") {
          this.status.textContent = COPY.alreadyAccepted;
        }
        this.accepting = false;
        return;
      }
      if (response.status === 409 && payload?.error === "month_taken") {
        this.acceptArea.hidden = true;
        this.status.textContent = COPY.monthTaken(label);
        this.accepting = false;
        return;
      }
      if (response.status === 503) {
        this.status.textContent = COPY.acceptBillingDown;
        this.acceptButton.disabled = false;
        this.accepting = false;
        return;
      }
      if (response.status === 410) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        this.status.textContent = body?.error === "proposal_expired" ? COPY.expired : COPY.closed;
        this.acceptArea.hidden = true;
        this.accepting = false;
        return;
      }
      this.status.textContent = COPY.acceptBillingDown;
      this.acceptButton.disabled = false;
      this.accepting = false;
    } catch (error) {
      if (error instanceof NoResponseError) {
        this.status.textContent = COPY.acceptBillingDown;
        this.acceptButton.disabled = false;
        this.accepting = false;
        return;
      }
      throw error;
    }
  }

  private async pay(): Promise<void> {
    if (this.paying) return;
    const deposit = this.view?.deposit;
    if (!deposit) return;
    const payer = this.payerName.value;
    const signature = payer;
    if (this.payKey === null || signature !== this.paySignature) {
      this.payKey = `deposit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      this.paySignature = signature;
      this.payAttempts = 0;
    }
    this.paying = true;
    this.payButton.disabled = true;
    this.status.textContent = COPY.payPending;
    const label = this.view?.production_month_label ?? "";
    const body = JSON.stringify({ payer_name: payer, amount_cents: deposit.amount_cents });

    const attempt = async (): Promise<void> => {
      let response: Response;
      try {
        response = await fetchOrNoResponse(`/api/proposals/${this.token}/deposit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": this.payKey! },
          body,
        });
      } catch (error) {
        if (error instanceof NoResponseError) {
          this.status.textContent = COPY.payLost;
          this.payAttempts += 1;
          if (this.payAttempts > 5) {
            this.status.textContent = COPY.payUnconfirmed;
            this.paying = false;
            this.payButton.disabled = false;
            return;
          }
          window.setTimeout(() => void attempt(), 3000);
          return;
        }
        throw error;
      }
      if (response.status === 200) {
        this.status.textContent = COPY.paid(label);
        this.payForm.hidden = true;
        this.paying = false;
        await this.read();
        return;
      }
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 409 && payload?.error === "request_in_progress") {
        this.status.textContent = COPY.payLost;
        this.payAttempts += 1;
        if (this.payAttempts > 5) {
          this.status.textContent = COPY.payUnconfirmed;
          this.paying = false;
          this.payButton.disabled = false;
          return;
        }
        window.setTimeout(() => void attempt(), 3000);
        return;
      }
      this.payAttempts = 0;
      if (response.status === 409 && payload?.error === "illegal_transition") {
        await this.read();
        this.paying = false;
        this.payButton.disabled = false;
        return;
      }
      if (response.status === 503) {
        this.status.textContent = COPY.payBillingDown;
        this.paying = false;
        this.payButton.disabled = false;
        return;
      }
      if (response.status === 422) {
        this.status.textContent = COPY.payRefused;
        this.paying = false;
        this.payButton.disabled = false;
        return;
      }
      this.status.textContent = COPY.payRefused;
      this.paying = false;
      this.payButton.disabled = false;
    };
    await attempt();
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const page = new ProposalPage();
void page.init();
