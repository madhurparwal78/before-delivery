/** The pricing page's billing period: kept in the address as ?billing=annual, one history entry per toggle. */
import { announce } from "../shared/announce";
import { PlanPrices, type BillingPeriod } from "./plan-prices";

const PARAMETER = "billing";
const ANNUAL = "annual";

const ANNOUNCEMENTS: Record<BillingPeriod, string> = {
  annual: "Showing annual prices",
  monthly: "Showing monthly prices",
};

function periodOf(url: URL): BillingPeriod {
  return url.searchParams.get(PARAMETER) === ANNUAL ? "annual" : "monthly";
}

function addressFor(period: BillingPeriod): string {
  const url = new URL(window.location.href);
  if (period === "annual") url.searchParams.set(PARAMETER, ANNUAL);
  else url.searchParams.delete(PARAMETER);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function initBillingPeriod(): void {
  const toggle = document.querySelector<HTMLInputElement>("[data-billing-toggle]");
  if (!toggle) return;
  const jumpLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-jump-link]"));

  const opened = new URL(window.location.href);
  const period = periodOf(opened);
  if (opened.searchParams.has(PARAMETER) && period === "monthly") {
    window.history.replaceState(window.history.state, "", addressFor("monthly"));
  }
  const prices = new PlanPrices(document, period);
  let current = period;

  /** Jump-list links carry the period so following one keeps the figures on screen. */
  const show = (shown: BillingPeriod): void => {
    current = shown;
    toggle.checked = shown === "annual";
    prices.setPeriod(shown);
    for (const link of jumpLinks) {
      const url = new URL(`/pricing${link.hash}`, window.location.origin);
      if (shown === "annual") url.searchParams.set(PARAMETER, ANNUAL);
      link.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
    }
  };

  show(period);

  toggle.addEventListener("change", () => {
    const next: BillingPeriod = toggle.checked ? "annual" : "monthly";
    window.history.pushState(null, "", addressFor(next));
    show(next);
    announce(ANNOUNCEMENTS[next]);
  });

  window.addEventListener("popstate", () => {
    const restored = periodOf(new URL(window.location.href));
    if (restored === current) return;
    show(restored);
    announce(ANNOUNCEMENTS[restored]);
  });
}
