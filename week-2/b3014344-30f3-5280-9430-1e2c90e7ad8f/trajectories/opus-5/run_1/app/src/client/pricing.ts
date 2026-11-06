import { COPY, quoteReady } from "../shared/copy.js";
import { formatMoney, parseAmount, type Currency } from "../shared/money.js";
import { carePlanId, type PlanId } from "../shared/plans.js";
import { announce, api, qs, qsa } from "./dom.js";
import { QuoteSheet, purchaseFigures } from "./sheet.js";

interface QuoteResponse {
  plan: PlanId;
  currency: Currency;
  total: string;
  dueNow: string;
  dueAtLaunch: string;
  dueNowShare: string;
}

interface PlansResponse {
  currency: Currency;
  plans: Array<{ plan: PlanId; name: string; amount: string; interval: string | null }>;
}

type Choice = "launch-page" | "studio-site" | "care";

export function initPricing(): void {
  const section = qs<HTMLElement>('[data-section="pricing"]');
  const region = qs<HTMLElement>("[data-quote]", section ?? document);
  if (!section || !region) return;
  const sheet = new QuoteSheet(region);
  const status = qs<HTMLElement>("[data-quote-status]", section);
  let currency: Currency = "USD";
  let choice: Choice = "studio-site";
  let tier: "lite" | "plus" = "lite";
  let sequence = 0;

  const planId = (): PlanId => (choice === "care" ? carePlanId(tier) : choice);

  const paintPressed = (): void => {
    for (const button of qsa<HTMLButtonElement>("[data-choose-plan]", section)) {
      button.setAttribute("aria-pressed", button.dataset.choosePlan === choice ? "true" : "false");
    }
  };

  const refreshPlanAmounts = async (): Promise<void> => {
    const result = await api<PlansResponse>(`/api/plans?currency=${currency}`);
    if (result.status !== 200) return;
    for (const plan of result.body.plans) {
      const amount = parseAmount(result.body.currency, plan.amount);
      if (!amount) continue;
      for (const node of qsa<HTMLElement>(`[data-plan-amount="${plan.plan}"]`, section)) {
        node.textContent = formatMoney(amount);
      }
    }
  };

  const requestQuote = async (): Promise<void> => {
    const mine = ++sequence;
    sheet.quoting();
    announce(status, COPY.quotePending);
    const result = await api<QuoteResponse>("/api/quotes", {
      method: "POST",
      body: { plan: planId(), currency },
    });
    if (mine !== sequence) return;
    if (result.status !== 200) {
      sheet.outage(COPY.quoteOutage);
      announce(status, COPY.quoteOutage);
      return;
    }
    const quote = result.body;
    sheet.show(purchaseFigures(quote));
    const dueNow = parseAmount(quote.currency, quote.dueNow);
    const dueAtLaunch = parseAmount(quote.currency, quote.dueAtLaunch);
    const total = parseAmount(quote.currency, quote.total);
    if (dueNow && dueAtLaunch && total) {
      announce(status, quoteReady(formatMoney(dueNow), formatMoney(dueAtLaunch), formatMoney(total)));
    }
  };

  for (const radio of qsa<HTMLInputElement>("[data-currency]", section)) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      currency = radio.dataset.currency === "ARS" ? "ARS" : "USD";
      void refreshPlanAmounts();
      void requestQuote();
    });
  }

  for (const button of qsa<HTMLButtonElement>("[data-choose-plan]", section)) {
    button.addEventListener("click", () => {
      choice = (button.dataset.choosePlan as Choice) ?? "studio-site";
      paintPressed();
      void requestQuote();
    });
  }

  for (const radio of qsa<HTMLInputElement>("[data-care-tier]", section)) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      tier = radio.dataset.careTier === "plus" ? "plus" : "lite";
      choice = "care";
      paintPressed();
      void requestQuote();
    });
  }

  section.addEventListener("keydown", (event) => {
    if (event.key !== "c" && event.key !== "C") return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      const input = target as HTMLInputElement;
      if (input.type !== "radio") return;
    }
    event.preventDefault();
    const next: Currency = currency === "USD" ? "ARS" : "USD";
    const radio = qs<HTMLInputElement>(`[data-currency="${next}"]`, section);
    if (!radio) return;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const startCheckout = qs<HTMLButtonElement>("[data-start-checkout]", section);
  startCheckout?.addEventListener("click", async () => {
    startCheckout.disabled = true;
    const result = await api<{ id: string }>("/api/orders", {
      method: "POST",
      body: { plan: planId(), currency },
    });
    startCheckout.disabled = false;
    if (result.status === 201) {
      window.location.assign(`/checkout/${result.body.id}`);
      return;
    }
    announce(status, COPY.quoteOutage);
  });
}
