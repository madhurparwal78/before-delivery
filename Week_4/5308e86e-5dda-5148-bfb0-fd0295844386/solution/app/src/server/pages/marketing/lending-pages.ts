/** Lending pages: venture debt and working capital loans. */
import type { RenderedPage } from "../layout.js";
import { marketingDocument } from "./chrome.js";
import { band, hero, linkButton, pageTitle, tileGrid } from "./parts.js";

export function ventureDebtPage(): RenderedPage {
  return marketingDocument({
    title: pageTitle("Venture debt"),
    description: "A venture debt line that sits beside your Tallwind accounts and is drawn when you need it.",
    page: "venture-debt",
    main: [
      hero({
        id: "venture-title",
        title: "More months of runway, drawn when you need them",
        lede: "A venture debt line that sits beside your Tallwind accounts. Draw what you need and the money lands in the account you choose.",
        actions: `<div class="hero-actions">${linkButton("/contact", "Check eligibility")}${linkButton("/contact", "Contact sales", "quiet")}</div>`,
      }),
      band({
        id: "venture-how",
        title: "A line you can see next to your cash",
        body: tileGrid([
          { glyph: "bolt", title: "Draw in seconds", body: "Request a draw from the Loans page and it is credited to your funding account at once." },
          { glyph: "chart", title: "See what remains", body: "Your drawn amount and remaining credit sit in the cockpit beside your balances." },
          { glyph: "shield", title: "Never past the limit", body: "A draw can never go beyond the credit that remains on the line." },
        ]),
      }),
    ].join("\n"),
  });
}

export function workingCapitalLoansPage(): RenderedPage {
  return marketingDocument({
    title: pageTitle("Working capital loans"),
    description: "Working capital for online sellers who need to buy inventory ahead of demand.",
    page: "working-capital-loans",
    main: [
      hero({
        id: "capital-title",
        title: "Inventory money for online sellers",
        lede: "Buy stock before the season starts and repay as the sales come in.",
        actions: `<div class="hero-actions">${linkButton("/contact", "Check eligibility")}</div>`,
      }),
      band({
        id: "capital-how",
        title: "Built around how sellers earn",
        body: tileGrid([
          { glyph: "layers", title: "Fund the next order", body: "Cover a supplier invoice today and repay it from the sales it produces." },
          { glyph: "chart", title: "Repay with the sales", body: "Repayments follow your revenue, so a slow week stays calm." },
          { glyph: "banknote", title: "One screen for the cash", body: "The loan sits beside your accounts, so you always see what you owe and what you hold." },
        ]),
      }),
    ].join("\n"),
  });
}
