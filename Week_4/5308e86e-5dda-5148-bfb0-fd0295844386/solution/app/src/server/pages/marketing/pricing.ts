/** The pricing page: three plans rendered from PLANS, the billing period switch and the jump list. */
import { esc, type RenderedPage } from "../layout.js";
import { formatPlanPrice } from "../../../shared/money.js";
import { PLANS, type PlanDefinition } from "../../../shared/plans.js";
import { marketingDocument } from "./chrome.js";
import { icon } from "./icons.js";
import { band, hero, linkButton, pageTitle } from "./parts.js";

interface PricingSection {
  id: string;
  title: string;
  summary: string;
  /** What each plan adds to this section, in plan order. */
  byPlan: [string, string, string];
}

const SECTIONS: PricingSection[] = [
  { id: "banking", title: "Banking", summary: "Accounts for every purpose, with no monthly fee on the core plan.", byPlan: ["Free checking and savings", "Everything in Tallwind, with priority support", "Everything in Plus, with a named relationship manager"] },
  { id: "sending-and-receiving-money", title: "Sending and receiving money", summary: "ACH, wires, real-time payments and checks from one form.", byPlan: ["Free ACH, domestic wires and real-time payments", "Everything in Tallwind, with approval rules for large payments", "Everything in Plus, with custom approval workflows"] },
  { id: "access-to-treasury", title: "Access to Treasury", summary: "Put idle cash to work with same-day access to most of it.", byPlan: ["Treasury for balances from $250K", "Everything in Tallwind", "A personalised portfolio above $25M"] },
  { id: "company-cards", title: "Company cards", summary: "Virtual and physical Lift Cards with 1.5 percent cashback.", byPlan: ["Virtual Lift Cards", "Everything in Tallwind, with higher limits", "Everything in Plus, with limits set by your relationship manager"] },
  { id: "expense-management", title: "Expense management", summary: "Budgets that every card swipe and receipt counts against.", byPlan: ["Card caps you set per card", "Shared budgets with reset dates", "Custom spend workflows"] },
  { id: "invoicing", title: "Invoicing", summary: "Bill customers and settle each invoice into the account you choose.", byPlan: ["Send and track invoices", "Recurring invoicing and reminders", "Everything in Plus, for complex billing"] },
  { id: "bill-pay", title: "Bill pay", summary: "Schedule bills around bank holidays and approve them in one place.", byPlan: ["Pay bills by ACH, wire or check", "Scheduled and recurring bills", "Everything in Plus, with custom approvals"] },
  { id: "accounting", title: "Accounting", summary: "Books that read straight from your ledger.", byPlan: ["Export to your accountant", "Accounting integrations", "Everything in Plus, with a relationship manager's help at close"] },
  { id: "taxes", title: "Taxes", summary: "Year-end paperwork without the scramble.", byPlan: ["Downloadable statements", "Everything in Tallwind, with tax-ready exports", "Everything in Plus, with filing support"] },
];

const ADD_ONS = [
  { name: "Books", price: "$35/mo." },
  { name: "Payroll", price: "$100/mo. plus $50 per person each month" },
];

const PLAN_CALLS: Record<PlanDefinition["name"], string> = {
  base: "Start with Tallwind",
  plus: "Choose Tallwind Plus",
  pro: "Choose Tallwind Pro",
};

function planCard(plan: PlanDefinition): string {
  const features = plan.features
    .map((feature) => `<li>${icon("check", "icon icon-check")}<span>${esc(feature)}</span></li>`)
    .join("");
  return `<li class="plan-card" data-plan="${plan.name}">
      <h3>${esc(plan.title)}</h3>
      <p class="plan-audience">${esc(plan.audience)}</p>
      <p class="plan-price"><span class="plan-figure mono" data-plan-price data-monthly-cents="${plan.monthlyCents}" data-annual-cents="${plan.annualCents}">${formatPlanPrice(plan.monthlyCents)}</span><span class="plan-unit" data-plan-unit>/mo.</span></p>
      <ul class="plan-features">${features}</ul>
      ${linkButton("/signup", PLAN_CALLS[plan.name], plan.name === "plus" ? "primary" : "quiet")}
    </li>`;
}

function sectionCard(section: PricingSection): string {
  const rows = PLANS.map(
    (plan, index) => `<div><dt>${esc(plan.title)}</dt><dd>${esc(section.byPlan[index] ?? "")}</dd></div>`,
  ).join("");
  return `<section class="pricing-section" id="${section.id}" aria-labelledby="${section.id}-title">
      <h3 id="${section.id}-title">${esc(section.title)}</h3>
      <p>${esc(section.summary)}</p>
      <dl class="plan-differences">${rows}</dl>
    </section>`;
}

export function pricingPage(): RenderedPage {
  const jumpLinks = SECTIONS.map(
    (section) => `<li><a href="/pricing#${section.id}" data-jump-link>${esc(section.title)}</a></li>`,
  ).join("");
  const addOns = ADD_ONS.map(
    (addOn) => `<li><strong>${esc(addOn.name)}</strong><span class="mono">${esc(addOn.price)}</span></li>`,
  ).join("");
  return marketingDocument({
    title: pageTitle("Plans and pricing"),
    description: "Core banking costs nothing each month; add Plus or Pro only when your team needs more.",
    page: "pricing",
    main: [
      hero({
        id: "pricing-title",
        title: "Plans that start at zero",
        lede: "Core banking costs nothing each month; add Plus or Pro only when your team needs more.",
        actions: `<label class="switch">
        <input type="checkbox" role="switch" data-billing-toggle>
        <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        <span class="switch-label">Annual Pricing (15% off)</span>
      </label>`,
      }),
      `<div class="container jump-wrap"><nav class="jump-list" aria-label="Jump to section"><ul>${jumpLinks}</ul></nav></div>`,
      band({
        id: "plans-title",
        title: "Three plans, one ledger",
        body: `<ul class="plan-grid">${PLANS.map(planCard).join("")}</ul>
        <p class="plan-note">Choosing a plan opens sign-up. Tallwind takes no payment there.</p>`,
      }),
      band({
        id: "add-ons-title",
        title: "Add-ons",
        className: "band-tint",
        body: `<ul class="add-ons">${addOns}</ul>`,
      }),
      band({
        id: "compare-title",
        title: "What each plan adds",
        body: `<div class="pricing-sections">${SECTIONS.map(sectionCard).join("")}</div>`,
      }),
    ].join("\n"),
  });
}
