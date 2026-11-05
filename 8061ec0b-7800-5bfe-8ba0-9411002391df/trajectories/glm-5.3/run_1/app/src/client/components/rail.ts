// The Buyout Rail: one notch per month, drag/tap/keys, the measured spring
// onto the notch, and the plain range slider under reduced motion
// (DP-20, DP-21, DP-69, DP-72).
import { h } from "../ui/dom.js";
import { prefersReducedMotion, springTo } from "../ui/motion.js";
import type { Quote } from "../../shared/domain.js";

export interface RailOptions {
  termMonths: number;
  currentMonth: number;
  quotes: Quote[];
  onRelease(month: number): void;
  disabled: boolean;
  reducedTable: (month: number) => HTMLElement;
}

export interface RailHandle {
  region: HTMLElement;
  setQuotes(quotes: Quote[], currentMonth: number): void;
  getMonth(): number;
}

export function createRail(options: RailOptions): RailHandle {
  const term = options.termMonths;
  const reduced = prefersReducedMotion();
  const region = h("div", { class: "buyout-rail-region", role: "region", "aria-label": "Buyout rail" });
  let month = Math.max(0, Math.min(term, options.currentMonth));
  let quotes = options.quotes;
  let disabled = options.disabled;

  const figures = h("div", { class: "rail-figures" });
  const equityText = h("span", { class: "brass-text rail-figure" });
  const payoffText = h("span", { class: "rail-figure" });
  const tierLabelEl = h("span", { class: "rail-tier-label" });
  figures.append(equityText, payoffText, tierLabelEl);
  const status = h("div", {
    class: "status-text rail-status",
    role: "status",
    "aria-live": "polite",
    "data-status-name": "Payoff quote",
  });

  // The accessible slider: at least 44 by 44 at every width.
  const slider = h("input", {
    type: "range",
    class: reduced ? "rail-slider rail-slider-reduced" : "rail-slider rail-slider-overlay",
    min: "0",
    max: String(term),
    step: "1",
    value: String(month),
    "aria-label": "Buyout month",
  }) as HTMLInputElement;

  let visualRail: HTMLElement | null = null;
  let handle: HTMLElement | null = null;
  let track: HTMLElement | null = null;
  let tierBands: HTMLElement | null = null;
  let notches: HTMLElement | null = null;

  function money(cents: number): string {
    return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function updateAccessibleValues(): void {
    const quote = quotes[month];
    if (!quote) return;
    slider.value = String(month);
    slider.setAttribute("aria-valuenow", String(month));
    slider.setAttribute(
      "aria-valuetext",
      `Month ${month} of ${term}: equity $${money(quote.equity_cents)}, ${quote.tier.label}, payoff $${money(quote.payoff_cents)}`
    );
    equityText.textContent = `Equity $${money(quote.equity_cents)}`;
    payoffText.textContent = `Payoff $${money(quote.payoff_cents)}`;
    tierLabelEl.textContent = quote.tier.label;
  }

  function positionHandle(targetMonth: number, spring: boolean): void {
    if (!handle) return;
    const percent = (targetMonth / term) * 100;
    if (!spring || prefersReducedMotion()) {
      handle.style.left = `${percent}%`;
      return;
    }
    // The handle springs onto its notch, passing it by 2 to 8 pixels on the
    // way, and comes to rest between 600 and 800 milliseconds after the step.
    const from = Number.parseFloat(handle.style.left || "0");
    springTo({
      from: Number.isFinite(from) ? from : 0,
      to: percent,
      onUpdate: (value) => {
        handle!.style.left = `${value}%`;
      },
    });
  }

  function setMonth(next: number, spring: boolean): void {
    month = Math.max(0, Math.min(term, next));
    positionHandle(month, spring);
    updateAccessibleValues();
  }

  if (!reduced) {
    visualRail = h("div", { class: "buyout-rail" });
    track = h("div", { class: "rail-track" });
    tierBands = h("div", { class: "rail-tiers" });
    notches = h("div", { class: "rail-notches" });
    handle = h("div", { class: "rail-handle", "aria-hidden": "true" },
      h("div", { class: "rail-handle-grip" }));
    visualRail.append(track, tierBands, notches, handle);
    // A mostly vertical swipe that starts on the rail scrolls the page: the
    // rail leaves vertical panning to the browser.
    visualRail.style.touchAction = "pan-y";

    const nearestMonth = (clientX: number): number => {
      if (!track) return month;
      const rect = track.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(fraction * term);
    };

    let dragging = false;
    let dragMoved = false;
    const railEl: HTMLElement = visualRail;
    railEl.addEventListener("pointerdown", (event) => {
      if (disabled) return;
      dragging = true;
      dragMoved = false;
      railEl.setPointerCapture(event.pointerId);
      setMonth(nearestMonth(event.clientX), true);
      const move = (moveEvent: PointerEvent): void => {
        if (!dragging) return;
        dragMoved = true;
        // The handle follows the finger, its month always the nearest notch.
        setMonth(nearestMonth(moveEvent.clientX), false);
      };
      const up = (): void => {
        dragging = false;
        railEl.removeEventListener("pointermove", move);
        railEl.removeEventListener("pointerup", up);
        // On release the handle settles on its notch.
        positionHandle(month, true);
        options.onRelease(month);
      };
      railEl.addEventListener("pointermove", move);
      railEl.addEventListener("pointerup", up);
      void dragMoved;
    });

    region.append(visualRail, slider, figures, status);
  } else {
    region.append(slider, figures, status);
    const table = options.reducedTable(month);
    region.appendChild(table);
  }

  slider.addEventListener("input", () => {
    setMonth(Number(slider.value), true);
  });
  slider.addEventListener("change", () => {
    options.onRelease(Number(slider.value));
  });
  // Page Up and Page Down move twelve months; the arrows and Home and End
  // come natively with the range input.
  slider.addEventListener("keydown", (event) => {
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const delta = event.key === "PageDown" ? 12 : -12;
      setMonth(Number(slider.value) + delta, true);
      options.onRelease(month);
    }
  });

  function renderTiers(currentMonth: number): void {
    if (!tierBands || !notches) return;
    tierBands.textContent = "";
    notches.textContent = "";
    const tiers: { label: string; from: number; to: number }[] = [];
    for (let i = 0; i < quotes.length; i++) {
      const label = quotes[i].tier.label;
      if (tiers.length === 0 || tiers[tiers.length - 1].label !== label) {
        tiers.push({ label, from: i, to: i });
      } else {
        tiers[tiers.length - 1].to = i;
      }
    }
    for (const tier of tiers) {
      const band = h("div", { class: "rail-tier-band" });
      band.style.left = `${(tier.from / term) * 100}%`;
      band.style.width = `${((tier.to - tier.from + 1) / (term + 1)) * 100}%`;
      band.appendChild(h("span", { class: "rail-tier-name", text: tier.label }));
      tierBands.appendChild(band);
      if (tier.from > 0) {
        const rule = h("div", { class: "rail-tier-rule" });
        rule.style.left = `${(tier.from / term) * 100}%`;
        tierBands.appendChild(rule);
      }
    }
    for (let i = 0; i <= term; i++) {
      notches.appendChild(h("div", {
        class: `rail-notch ${i <= currentMonth ? "rail-notch-paid" : "rail-notch-future"}`,
        style: `left:${(i / term) * 100}%`,
      }));
    }
  }

  const handleApi: RailHandle = {
    region,
    getMonth: () => month,
    setQuotes(nextQuotes: Quote[], currentMonth: number) {
      quotes = nextQuotes;
      renderTiers(currentMonth);
      setMonth(month, false);
      updateAccessibleValues();
    },
  };
  renderTiers(options.currentMonth);
  updateAccessibleValues();
  positionHandle(month, false);
  return handleApi;
}
