/** Product pages: business banking, payments, credit, treasury, invoicing, spend management, payroll and books. */
import { esc, type RenderedPage } from "../layout.js";
import { formatDollars } from "../../../shared/money.js";
import { controlsArt, growthArt, invoiceArt, virtualCardArt } from "./art.js";
import { marketingDocument } from "./chrome.js";
import { icon } from "./icons.js";
import { band, checkList, dataTable, emailCapture, faq, featurePanel, hero, linkButton, pageTitle, tileGrid } from "./parts.js";

function heroActions(...buttons: string[]): string {
  return `<div class="hero-actions">${buttons.join("")}</div>`;
}

function figureList(items: { figure: string; label: string }[]): string {
  const rows = items
    .map((item) => `<li class="stat"><span class="stat-figure mono">${esc(item.figure)}</span> <span class="stat-label">${esc(item.label)}</span></li>`)
    .join("");
  return `<ul class="stats">${rows}</ul>`;
}

function note(body: string): string {
  return `<p class="note">${icon("clock")}<span>${esc(body)}</span></p>`;
}

export function businessBankingPage(): RenderedPage {
  const pricingItems = [
    "Free checking and savings",
    "Zero monthly fees",
    "Free ACH",
    "Free domestic and USD international wires",
    "1 percent for non-USD international wires",
    "Free real-time payments",
    "Free checkbooks and mailed checks",
    "1.5 percent cashback",
  ];
  return marketingDocument({
    title: pageTitle("Business banking"),
    description: "Free checking and savings, virtual cards and same-day payments, run from one screen.",
    page: "business-banking",
    main: [
      hero({
        id: "banking-title",
        title: "Accounts that keep up with the company",
        lede: "Free checking and savings, virtual cards and same-day payments, run from one screen.",
        actions: emailCapture(),
      }),
      band({
        id: "banking-everything",
        title: "Everything you need to bank with less effort",
        aside: linkButton("/demo", "Explore demo", "quiet", "arrowRight"),
        body: tileGrid([
          { glyph: "banknote", title: "Free checking and savings", body: "Open as many accounts as the company needs, with no monthly fee on the core plan." },
          { glyph: "card", title: "Corporate cards", body: "Virtual Lift Cards for every team, with 1.5 percent cashback." },
          { glyph: "bolt", title: "Free wires", body: "Domestic and USD international wires cost nothing to send." },
          { glyph: "percent", title: "Transparent pricing", body: "One published price list. No surprise fees at month end." },
          { glyph: "repeat", title: "Payments by ACH, wire, real-time payment or check", body: "Pick the method per payment and see its settlement date before you send." },
          { glyph: "sparkle", title: "AI built into your account", body: "Pilot answers questions and finds any payment or recipient from the search bar." },
        ]),
      }),
      band({
        id: "banking-automation",
        title: "Let routine money move itself",
        className: "band-tint",
        body: tileGrid([
          { glyph: "calendar", title: "Scheduled payments", body: "Set the date once; bank holidays are handled for you." },
          { glyph: "repeat", title: "Auto-transfer rules", body: "Keep each account at the balance you want it to hold." },
          { glyph: "chat", title: "Approve payments via chat", body: "Large payments reach the second approver wherever they are." },
          { glyph: "scan", title: "Accounting integrations", body: "Transactions flow to your books as they post." },
          { glyph: "plug", title: "An API", body: "Read balances and move money from your own tools." },
        ]),
      }),
      band({
        id: "banking-limits",
        title: "Spend limits your team can see",
        body: `<div class="controls-layout">
          ${tileGrid([
            { glyph: "users", title: "User-level permissions", body: "Owners, admins and members each see and do only what their role allows." },
            { glyph: "shield", title: "Approval rules for large payments", body: "Anything over $5,000.00 waits for a colleague before it leaves." },
            { glyph: "card", title: "Customisable card limits", body: "Set a cap per card and per budget, and change it in a click." },
          ])}
          <div class="controls-art" aria-hidden="true">${controlsArt()}</div>
        </div>`,
      }),
      featurePanel({ id: "banking-pricing", title: "Transparent pricing", body: checkList(pricingItems, "check-list-light") }),
    ].join("\n"),
  });
}

export function businessPaymentsPage(): RenderedPage {
  const fees = dataTable({
    label: "Fee and speed by payment method",
    caption: "Every payment method costs $0 to send",
    head: ["Method", "Speed", "Fee"],
    figureColumns: [2],
    rows: [
      ["Real-time payments", "Instant", "$0"],
      ["ACH", "0 to 1 business days", "$0"],
      ["Domestic wires", "0 to 1 business days", "$0"],
      ["Checkbooks", "N/A", "$0"],
      ["Mailed checks", "7 to 14 business days", "$0"],
      ["USD international wires", "1 to 3 business days", "$0"],
    ],
  });
  return marketingDocument({
    title: pageTitle("Payments"),
    description: "Pay anyone by real-time payment, ACH, wire or check with no fees on USD payments.",
    page: "business-payments",
    bodyClass: "tint-sand",
    main: [
      hero({
        id: "payments-title",
        title: "Pay anyone, keep the fees",
        lede: "Most domestic Tallwind payments reach the recipient's bank by the next business day.",
        actions: heroActions(linkButton("/signup", "Send your first payment", "primary", "arrowRight")),
      }),
      band({
        id: "payments-fees",
        title: "What each method costs and how fast it arrives",
        body: `${fees}<div class="notes">
          ${note("ACH sent before 4 p.m. and wires sent before 5 p.m. New York time on a business day settle the same day; real-time payments settle every day of the year.")}
          ${note("Payments that need approval wait five business days for a decision before they expire.")}
        </div>`,
      }),
      band({
        id: "payments-global",
        title: "Global payments",
        className: "band-tint",
        body: figureList([
          { figure: "1 percent", label: "fee for non-USD international wires" },
          { figure: "$0", label: "for USD international wires" },
          { figure: "40+", label: "local currencies" },
          { figure: "200+", label: "countries and regions" },
        ]),
      }),
      faq("payments-faq", "Payment questions, answered", [
        { question: "Do ACH and domestic wires cost anything?", answer: "No. ACH, domestic wires, real-time payments and USD international wires cost $0 to send on every Tallwind plan. Only non-USD international wires carry a 1 percent fee." },
        { question: "When does a payment arrive?", answer: "Real-time payments arrive instantly, every day of the year. ACH and domestic wires arrive in 0 to 1 business days, and mailed checks in 7 to 14 business days." },
        { question: "What happens to payments that need approval?", answer: "They wait for a colleague. A payment that is not decided within five business days expires, and the money held for it is released." },
        { question: "Can I schedule a payment for a bank holiday?", answer: "Yes. An ACH, wire or check scheduled for a holiday takes effect on the next Federal Reserve business day. Real-time payments go out on the day you pick." },
      ]),
    ].join("\n"),
  });
}

export function creditPage(): RenderedPage {
  return marketingDocument({
    title: pageTitle("Credit card"),
    description: "The Lift Card is a business credit card whose limit grows with the balance you keep at Tallwind.",
    page: "credit",
    bodyClass: "tint-credit",
    main: [
      hero({
        id: "credit-title",
        title: "A card that grows with your balance",
        lede: "The Lift Card is a business credit card whose limit scales with the money you keep at Tallwind, with 1.5 percent cashback on everything you buy.",
        actions: heroActions(linkButton("/signup", "Get the Lift Card", "primary", "arrowRight")),
      }),
      band({
        id: "credit-growth",
        title: "From first hire to fiftieth",
        body: `<div class="controls-layout">
          ${tileGrid([
            { glyph: "percent", title: "1.5 percent cashback on all spend", body: "On software, travel, meals and everything in between." },
            { glyph: "chart", title: "Limits that scale with the balance", body: "Keep more at Tallwind and your limit rises with it." },
            { glyph: "layers", title: "Build business credit", body: "On-time payments are reported for the company, not for you." },
            { glyph: "shield", title: "No personal guarantee", body: "The card is the company's. Nothing you own personally backs it." },
          ])}
          <div class="controls-art" aria-hidden="true">${virtualCardArt()}</div>
        </div>`,
      }),
      faq("credit-faq", "Card questions, answered", [
        { question: "What is the Lift Card?", answer: "A business credit card with virtual and physical cards for your team, caps you set per card and 1.5 percent cashback on all spend." },
        { question: "How is my limit set?", answer: "It scales with the balance you keep in your Tallwind accounts. As the balance grows, the limit grows with it." },
        { question: "Do I need to guarantee the card personally?", answer: "No. The Lift Card carries no personal guarantee." },
        { question: "Can my team have their own cards?", answer: "Yes. Issue a virtual card in seconds, give it a cap and revoke it whenever you like." },
      ]),
    ].join("\n"),
  });
}

export function treasuryPage(): RenderedPage {
  const rates = dataTable({
    label: "Treasury rate by balance tier",
    caption: "Annual rate by balance tier and how quickly you can reach the money",
    head: ["Balance tier", "Same-day liquidity", "1-to-2-day liquidity"],
    figureColumns: [1, 2],
    rows: [
      ["$250K to $2M", "3.30%", "3.20%"],
      ["$2M to $5M", "3.40%", "3.30%"],
      ["$5M to $10M", "3.50%", "3.40%"],
      ["$10M to $20M", "3.60%", "3.50%"],
      ["$20M to $50M", "3.75%", "3.65%"],
    ],
  });
  return marketingDocument({
    title: pageTitle("Treasury"),
    description: "Earn up to 3.75% on balances from $250K, with same-day access to most of it.",
    page: "treasury",
    main: [
      hero({
        id: "treasury-title",
        title: "Put idle cash to work and keep it within reach.",
        lede: "Earn up to 3.75% on balances from $250K, with same-day access to most of it.",
        actions: heroActions(linkButton("/contact", "Contact sales", "primary", "arrowRight")),
      }),
      band({
        id: "treasury-rates",
        title: "Rates by balance tier",
        body: `<div class="rates-layout">${rates}<div class="rates-art" aria-hidden="true">${growthArt()}</div></div>`,
      }),
      featurePanel({
        id: "treasury-portfolio",
        title: "A personalised portfolio above $25M",
        body: `<p class="band-lede">Balances above $25M can have a portfolio built around the timeline and the cash needs of the company. Talk to our team and we will draw it up with you.</p>
          ${linkButton("/contact", "Talk to our team", "primary", "arrowRight")}`,
      }),
    ].join("\n"),
  });
}

export function invoicingPage(): RenderedPage {
  return marketingDocument({
    title: pageTitle("Invoicing"),
    description: "Bill customers, see who has paid and settle each invoice into the account you choose.",
    page: "invoicing",
    main: [
      hero({
        id: "invoicing-title",
        title: "Invoices that land in the right account",
        lede: "Bill customers, see who has paid and settle each invoice into the account you choose, without leaving the cockpit.",
        actions: heroActions(linkButton("/signup", "Start invoicing", "primary", "arrowRight")),
      }),
      band({
        id: "invoicing-options",
        title: "Get paid the way your customers pay",
        body: tileGrid([
          { glyph: "card", title: "Card" },
          { glyph: "bolt", title: "Apple Pay" },
          { glyph: "bolt", title: "Google Pay" },
          { glyph: "globe", title: "Wire" },
          { glyph: "repeat", title: "ACH transfer" },
          { glyph: "banknote", title: "ACH debit" },
        ], "tile-grid-compact"),
      }),
      band({
        id: "invoicing-recurring",
        title: "Recurring invoicing and reminders",
        className: "band-tint",
        body: `<div class="controls-layout">
          <div class="prose">
            <p>Set an invoice to repeat every week, month or quarter, and Tallwind sends it for you. Reminders go to customers who have not paid, so you stop chasing by hand.</p>
            <p class="note">${icon("check", "icon icon-check")}<span>Unlimited invoicing is free.</span></p>
          </div>
          <div class="controls-art" aria-hidden="true">${invoiceArt()}</div>
        </div>`,
      }),
    ].join("\n"),
  });
}

interface Budget {
  name: string;
  capCents: number;
  spentCents: number;
  resets: string;
}

const BUDGETS: Budget[] = [
  { name: "Work meals", capCents: 250000, spentCents: 118420, resets: "Dec 1" },
  { name: "Office equipment", capCents: 800000, spentCents: 612575, resets: "Jan 1" },
  { name: "Wellness", capCents: 150000, spentCents: 42000, resets: "Dec 1" },
  { name: "Business travel", capCents: 1200000, spentCents: 934210, resets: "Jan 1" },
];

function budgetCard(budget: Budget): string {
  const remainingCents = budget.capCents - budget.spentCents;
  const spentPercent = Math.floor((budget.spentCents * 100) / budget.capCents);
  return `<li class="budget-card">
      <h3>${esc(budget.name)}</h3>
      <div class="budget-meter" aria-hidden="true" style="--spent: ${spentPercent}%"><span></span></div>
      <dl class="budget-figures">
        <div><dt>Cap</dt><dd class="mono">${formatDollars(budget.capCents)}</dd></div>
        <div><dt>Spent</dt><dd class="mono">${formatDollars(budget.spentCents)}</dd></div>
        <div><dt>Remaining</dt><dd class="mono">${formatDollars(remainingCents)}</dd></div>
        <div><dt>Resets</dt><dd>${esc(budget.resets)}</dd></div>
      </dl>
    </li>`;
}

export function spendManagementPage(): RenderedPage {
  return marketingDocument({
    title: pageTitle("Spend management"),
    description: "Set a cap once, and every card swipe, reimbursement and receipt counts against it as it happens.",
    page: "spend-management",
    bodyClass: "tint-sand",
    main: [
      hero({
        id: "spend-title",
        title: "Budgets your cards already know",
        lede: "Set a cap once, and every card swipe, reimbursement and receipt counts against it as it happens.",
        actions: heroActions(linkButton("/signup", "Set your first budget", "primary", "arrowRight")),
      }),
      band({
        id: "spend-budgets",
        title: "Sample budgets",
        lede: "Four budgets as a finance lead might set them. Each shows its cap, what has been spent, what remains and when it resets.",
        body: `<ul class="budget-grid">${BUDGETS.map(budgetCard).join("")}</ul>`,
      }),
    ].join("\n"),
  });
}

type OnboardingState = "Signed" | "Done" | "In progress" | "Upcoming";

const ONBOARDING_STEPS: { step: string; state: OnboardingState }[] = [
  { step: "Offer letter", state: "Signed" },
  { step: "Personal details", state: "Done" },
  { step: "Direct deposit", state: "In progress" },
  { step: "Tax withholding", state: "Upcoming" },
  { step: "I-9 verification", state: "Upcoming" },
];

export function payrollPage(): RenderedPage {
  const steps = ONBOARDING_STEPS.map(
    (item, index) => `<li class="checklist-step">
        <span class="step-number mono" aria-hidden="true">${index + 1}</span>
        <span class="checklist-name">${esc(item.step)}</span>
        <span class="state-badge" data-state="${item.state === "In progress" ? "progress" : item.state.toLowerCase()}">${item.state}</span>
      </li>`,
  ).join("");
  return marketingDocument({
    title: pageTitle("Payroll"),
    description: "Run pay day from the same account that funds it.",
    page: "payroll",
    main: [
      hero({
        id: "payroll-title",
        title: "Payroll that runs from your checking account",
        lede: "Pay your team from the account that funds it. Tallwind runs the payroll, withholds the taxes and deposits the pay on the day.",
        actions: heroActions(linkButton("/contact", "Contact sales", "quiet"), linkButton("/signup", "Open account")),
      }),
      band({
        id: "payroll-onboarding",
        title: "Onboard each hire in five steps",
        lede: "A new hire moves down one checklist, and you see where each person stands.",
        body: `<ol class="checklist">${steps}</ol>`,
      }),
      band({
        id: "payroll-price",
        title: "Priced by the person",
        className: "band-tint",
        body: `<p class="prose-line">Payroll is $100/mo. plus $50 per person each month, added to any Tallwind plan.</p>`,
      }),
    ].join("\n"),
  });
}

export function booksPage(): RenderedPage {
  return marketingDocument({
    title: pageTitle("Books"),
    description: "Bookkeeping that reads straight from your ledger for $35 a month.",
    page: "books",
    main: [
      hero({
        id: "books-title",
        title: "Bookkeeping that reads straight from your ledger",
        lede: "Every transaction is categorised as it posts, so the books are ready before the month ends.",
        actions: heroActions(linkButton("/signup", "Add Books to your account", "primary", "arrowRight")),
      }),
      band({
        id: "books-price",
        title: "$35/month, added to any plan",
        className: "band-tint",
        body: `<p class="prose-line">Tallwind Books costs $35/month. There is nothing to connect: it reads from the same ledger as your accounts.</p>`,
      }),
      faq("books-faq", "Books questions, answered", [
        { question: "What is Tallwind Books?", answer: "Bookkeeping built on the ledger your accounts already keep. Transactions, invoices and receipts land in the books as they happen." },
        { question: "How much does it cost?", answer: "$35/month, on top of whichever Tallwind plan you use." },
        { question: "Do I need to import my transactions?", answer: "No. Books reads straight from your Tallwind accounts, so there is nothing to import or reconcile by hand." },
      ]),
    ].join("\n"),
  });
}
