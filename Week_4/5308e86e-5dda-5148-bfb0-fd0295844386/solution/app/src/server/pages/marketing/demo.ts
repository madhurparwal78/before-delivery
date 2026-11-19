/** The demo: a static, read-only rendering of the cockpit home filled with invented sample figures. It calls no API. */
import { esc, type RenderedPage } from "../layout.js";
import { formatDollars } from "../../../shared/money.js";
import { marketingDocument } from "./chrome.js";
import { icon } from "./icons.js";
import { pageTitle } from "./parts.js";

interface SampleAccount {
  name: string;
  balanceCents: number;
  heldCents: number;
  /** Thirty end-of-day balances in cents, ending at the current balance. */
  history: number[];
}

type Method = "ACH" | "Wire" | "RTP" | "Check" | "Card" | "Transfer";

interface SampleTransaction {
  counterparty: string;
  method: Method;
  date: string;
  cents: number;
  direction: "in" | "out";
}

const ACCOUNTS: SampleAccount[] = [
  {
    name: "Checking",
    balanceCents: 18432045,
    heldCents: 0,
    history: [15210000, 15210000, 15480000, 15480000, 15480000, 16020000, 16020000, 15870000, 15870000, 16340000, 16340000, 16340000, 16110000, 16110000, 16790000, 17020000, 17020000, 17020000, 16840000, 17310000, 17310000, 17650000, 17650000, 17520000, 17990000, 17990000, 18210000, 18210000, 18090000, 18432045],
  },
  {
    name: "Savings",
    balanceCents: 41200000,
    heldCents: 0,
    history: [38000000, 38000000, 38000000, 38000000, 38400000, 38400000, 38400000, 38400000, 38400000, 39000000, 39000000, 39000000, 39000000, 39000000, 39000000, 39600000, 39600000, 39600000, 39600000, 40000000, 40000000, 40000000, 40000000, 40000000, 40600000, 40600000, 40600000, 41200000, 41200000, 41200000],
  },
  {
    name: "Operations",
    balanceCents: 3890510,
    heldCents: 500000,
    history: [4620000, 4580000, 4580000, 4410000, 4410000, 4390000, 4300000, 4300000, 4210000, 4215000, 4215000, 4180000, 4060000, 4060000, 4040000, 4100000, 4100000, 4020000, 3980000, 3980000, 3950000, 3940000, 3940000, 3900000, 3925000, 3925000, 3910000, 3910000, 3900000, 3890510],
  },
];

const TRANSACTIONS: SampleTransaction[] = [
  { counterparty: "Hollis & Pine Studio", method: "ACH", date: "Oct 27", cents: 420000, direction: "in" },
  { counterparty: "Cedar Freight", method: "Wire", date: "Oct 27", cents: 125000, direction: "out" },
  { counterparty: "Marlow Print Co.", method: "Card", date: "Oct 26", cents: 34000, direction: "out" },
  { counterparty: "Fieldstone Labs", method: "RTP", date: "Oct 26", cents: 1280000, direction: "in" },
  { counterparty: "Brightline Software", method: "Card", date: "Oct 25", cents: 8900, direction: "out" },
  { counterparty: "Checking to Savings", method: "Transfer", date: "Oct 25", cents: 500000, direction: "out" },
  { counterparty: "Orchard Supply", method: "Check", date: "Oct 24", cents: 214575, direction: "out" },
  { counterparty: "Juniper Health", method: "ACH", date: "Oct 24", cents: 960000, direction: "in" },
  { counterparty: "Tidewater Insurance", method: "ACH", date: "Oct 23", cents: 72500, direction: "out" },
  { counterparty: "Kestrel Design", method: "RTP", date: "Oct 22", cents: 310000, direction: "in" },
];

const PAGE_LINKS = ["Payments", "Recipients", "Approvals", "Invoicing", "Loans", "Cards", "Treasury", "Bill Pay"];
const AVATAR_FILLS = ["var(--avatar-cyan)", "var(--avatar-lime)", "var(--avatar-indigo)", "var(--avatar-amber)"];

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 32;

/** A thin line through the history; days without movement stay flat. Whole-number arithmetic only. */
function sparkline(history: number[]): string {
  const low = Math.min(...history);
  const range = Math.max(...history) - low || 1;
  const points = history
    .map((value, index) => {
      const x = Math.floor((index * SPARK_WIDTH) / (history.length - 1));
      const y = SPARK_HEIGHT - Math.floor(((value - low) * (SPARK_HEIGHT - 4)) / range) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return `<svg class="demo-spark" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="${points}" fill="none" stroke="var(--color-action)" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function accountCard(account: SampleAccount): string {
  return `<li class="demo-card">
        <h3>${esc(account.name)}</h3>
        <p class="demo-figure mono">${formatDollars(account.balanceCents)}</p>
        <p class="demo-available mono">Available ${formatDollars(account.balanceCents - account.heldCents)}</p>
        ${sparkline(account.history)}
      </li>`;
}

function feedRow(transaction: SampleTransaction, index: number): string {
  const credit = transaction.direction === "in";
  const sign = credit ? "+" : "−";
  return `<li class="demo-row">
        <span class="avatar" style="background: ${AVATAR_FILLS[index % AVATAR_FILLS.length]}" aria-hidden="true">${esc(initials(transaction.counterparty))}</span>
        <span class="demo-row-name">${esc(transaction.counterparty)}</span>
        <span class="chip">${transaction.method}</span>
        <span class="demo-row-date">${esc(transaction.date)}</span>
        <span class="demo-amount mono" data-direction="${transaction.direction}">${sign}${formatDollars(transaction.cents)} <span class="demo-direction">${credit ? "Money in" : "Money out"}</span></span>
      </li>`;
}

export function demoPage(): RenderedPage {
  const totalCents = ACCOUNTS.reduce((sum, account) => sum + account.balanceCents, 0);
  const availableCents = ACCOUNTS.reduce((sum, account) => sum + account.balanceCents - account.heldCents, 0);
  const rail = ACCOUNTS.map(
    (account, index) => `<li class="demo-account"${index === 0 ? ' data-active="true"' : ""}><span>${esc(account.name)}</span><span class="mono">${formatDollars(account.balanceCents)}</span></li>`,
  ).join("");
  const pages = PAGE_LINKS.map((name) => `<li>${esc(name)}</li>`).join("");
  return marketingDocument({
    title: pageTitle("Demo"),
    description: "A read-only tour of the Tallwind cockpit with sample data.",
    page: "demo",
    main: `<div class="demo-banner">
      <div class="container demo-banner-inner">
        <p>${icon("eye")}<span>This is a demo with sample data</span></p>
        <a class="btn btn-primary" href="/signup">Open account</a>
      </div>
    </div>
    <section class="demo" aria-labelledby="demo-title">
      <div class="container demo-frame">
        <div class="demo-sidebar">
          <p class="demo-mark">Tallwind</p>
          <ul class="demo-accounts">${rail}</ul>
          <ul class="demo-pages">${pages}</ul>
        </div>
        <div class="demo-main">
          <h1 class="demo-title" id="demo-title">Cockpit demo</h1>
          <ul class="demo-cards">
            <li class="demo-card demo-card-total">
              <h2>Total cash</h2>
              <p class="demo-figure mono">${formatDollars(totalCents)}</p>
              <p class="demo-available mono">Available ${formatDollars(availableCents)}</p>
            </li>
            ${ACCOUNTS.map(accountCard).join("")}
          </ul>
          <h2 class="demo-subtitle">Recent transactions</h2>
          <ul class="demo-activity" aria-label="Sample transactions">${TRANSACTIONS.map(feedRow).join("")}</ul>
        </div>
      </div>
    </section>`,
  });
}
