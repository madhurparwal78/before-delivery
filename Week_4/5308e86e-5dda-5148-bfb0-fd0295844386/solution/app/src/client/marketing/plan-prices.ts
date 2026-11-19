/** Plan prices: shown for the billing period, counting up from zero the first time a plan card scrolls into view. */
import { formatPlanPrice } from "../../shared/money";
import { prefersReducedMotion } from "./dom";

export type BillingPeriod = "monthly" | "annual";

const COUNT_UP_MS = 900;
const UNITS: Record<BillingPeriod, string> = { monthly: "/mo.", annual: "/yr." };

interface PlanPrice {
  figure: HTMLElement;
  unit: HTMLElement | null;
  monthlyCents: number;
  annualCents: number;
  /** waiting: not seen yet; counting: running; settled: shows its final figure. */
  state: "waiting" | "counting" | "settled";
  frame: number;
}

function readPlanPrices(root: ParentNode): PlanPrice[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-plan-price]")).map((figure) => ({
    figure,
    unit: figure.parentElement?.querySelector<HTMLElement>("[data-plan-unit]") ?? null,
    monthlyCents: Number.parseInt(figure.dataset.monthlyCents ?? "0", 10),
    annualCents: Number.parseInt(figure.dataset.annualCents ?? "0", 10),
    state: "waiting",
    frame: 0,
  }));
}

export class PlanPrices {
  private readonly prices: PlanPrice[];
  private period: BillingPeriod;

  constructor(root: ParentNode, period: BillingPeriod) {
    this.prices = readPlanPrices(root);
    this.period = period;
    this.showUnits();
    if (prefersReducedMotion()) this.prices.forEach((price) => this.settle(price));
    else this.watchForView();
  }

  /** Switches the figures at once; a plan that has not been seen yet keeps waiting at zero. */
  setPeriod(period: BillingPeriod): void {
    this.period = period;
    this.showUnits();
    for (const price of this.prices) if (price.state !== "waiting") this.settle(price);
  }

  private target(price: PlanPrice): number {
    return this.period === "annual" ? price.annualCents : price.monthlyCents;
  }

  private showUnits(): void {
    for (const price of this.prices) if (price.unit) price.unit.textContent = UNITS[this.period];
  }

  private settle(price: PlanPrice): void {
    cancelAnimationFrame(price.frame);
    price.state = "settled";
    price.figure.textContent = formatPlanPrice(this.target(price));
  }

  private watchForView(): void {
    for (const price of this.prices) price.figure.textContent = formatPlanPrice(0);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const price = this.prices.find((candidate) => candidate.figure.closest(".plan-card") === entry.target);
        if (!entry.isIntersecting || !price || price.state !== "waiting") continue;
        observer.unobserve(entry.target);
        this.countUp(price);
      }
    });
    for (const price of this.prices) {
      const card = price.figure.closest(".plan-card");
      if (card) observer.observe(card);
    }
  }

  /** Integer cents all the way: elapsed whole milliseconds scale the target by integer arithmetic. */
  private countUp(price: PlanPrice): void {
    price.state = "counting";
    let startedAt: number | null = null;
    const step = (now: number): void => {
      startedAt ??= now;
      const elapsed = Math.min(Math.floor(now - startedAt), COUNT_UP_MS);
      price.figure.textContent = formatPlanPrice(Math.floor((this.target(price) * elapsed) / COUNT_UP_MS));
      if (elapsed >= COUNT_UP_MS) price.state = "settled";
      else price.frame = requestAnimationFrame(step);
    };
    price.frame = requestAnimationFrame(step);
  }
}
