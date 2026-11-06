import { escapeHtml } from "./layout.js";
import { COPY } from "../../shared/copy.js";
import { formatMoney, sharePercent, type Money } from "../../shared/money.js";

export type QuoteVariant = "purchase" | "change";

export interface QuoteFigures {
  leftLabel: string;
  rightLabel: string;
  left: Money;
  right: Money;
  total: Money;
  crease: string;
}

export function purchaseFigures(dueNow: Money, dueAtLaunch: Money, total: Money): QuoteFigures {
  return {
    leftLabel: "Due now",
    rightLabel: "Due at launch",
    left: dueNow,
    right: dueAtLaunch,
    total,
    crease: sharePercent(dueNow.minor, total.minor),
  };
}

/** The fold-line sheet, with the reduced-motion table inside the same region. */
export function quoteSheet(figures: QuoteFigures | null, state: "ready" | "quoting" | "outage"): string {
  const left = figures ? formatMoney(figures.left) : "";
  const right = figures ? formatMoney(figures.right) : "";
  const total = figures ? formatMoney(figures.total) : "";
  const leftLabel = figures?.leftLabel ?? "Due now";
  const rightLabel = figures?.rightLabel ?? "Due at launch";
  const crease = figures?.crease ?? "0.0";
  return `<section class="quote" role="region" aria-label="Quote" data-quote data-state="${state}" data-crease="${crease}" data-tilt="${
    state === "ready" ? "18" : "0"
  }">
  <div class="sheet" data-sheet style="--crease:${crease}%">
    <div class="sheet-panels">
      <div class="sheet-panel sheet-panel-left" role="group" aria-label="${escapeHtml(leftLabel)}">
        <span class="panel-label">${escapeHtml(leftLabel)}</span>
        <span class="amount" data-quote-left>${escapeHtml(left)}</span>
      </div>
      <div class="sheet-crease" data-crease-line></div>
      <div class="sheet-panel sheet-panel-right" role="group" aria-label="${escapeHtml(rightLabel)}">
        <span class="panel-label">${escapeHtml(rightLabel)}</span>
        <span class="amount" data-quote-right>${escapeHtml(right)}</span>
      </div>
    </div>
    <p class="sheet-total" data-quote-total-line>Total <span class="amount" data-quote-total>${escapeHtml(
      total,
    )}</span></p>
    <p class="sheet-flag" data-quote-flag>${state === "outage" ? COPY.quoteOutage : COPY.quotePending}</p>
  </div>
  <table class="quote-table" aria-label="Quote">
    <thead>
      <tr>
        <th scope="col">${escapeHtml(leftLabel)}</th>
        <th scope="col">${escapeHtml(rightLabel)}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="amount" data-quote-left>${escapeHtml(left)}</td>
        <td class="amount" data-quote-right>${escapeHtml(right)}</td>
      </tr>
      <tr>
        <th scope="row">Total</th>
        <td class="amount" data-quote-total>${escapeHtml(total)}</td>
      </tr>
    </tbody>
  </table>
</section>`;
}

export function liveRegion(name: string, attribute: string, text = ""): string {
  return `<p class="live" role="status" aria-label="${escapeHtml(name)}" ${attribute}>${escapeHtml(text)}</p>`;
}
