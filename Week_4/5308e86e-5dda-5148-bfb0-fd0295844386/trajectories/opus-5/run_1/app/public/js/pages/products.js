import { el, icon } from '../dom.js';
import { marketingPage, hero, section, cards, featureList, faq, dataTable } from './layout.js';

export const businessBanking = {
  title: 'Business banking — Tallwind',
  render() {
    return marketingPage([
      hero({
        title: 'Accounts that keep up with the company',
        lede: 'Free checking and savings, virtual cards and same-day payments, run from one screen.',
      }),
      section('Everything you need to bank with less effort', [
        el('p', {}, [el('a', { class: 'btn btn-secondary', href: '/demo' }, ['Explore demo', icon('arrowRight', { size: 16 })])]),
        cards([
          { title: 'Free checking and savings', body: 'No monthly fee, no minimum, no surprises.' },
          { title: 'Corporate cards', body: 'Issue virtual Lift Cards with their own limits.' },
          { title: 'Free wires', body: 'Domestic and USD international wires cost $0.' },
          { title: 'Transparent pricing', body: 'Every fee is published before you send.' },
          { title: 'Payments by ACH, wire, real-time payment or check', body: 'Pick the rail that fits the moment.' },
          { title: 'AI built into your account', body: 'Ask about any figure and get the stored answer.' },
        ]),
      ]),
      section('Let routine money move itself', [
        cards([
          { title: 'Scheduled payments', body: 'Post on the next Federal Reserve business day, automatically.' },
          { title: 'Auto-transfer rules', body: 'Sweep idle cash into Treasury and back.' },
          { title: 'Approve payments via chat', body: 'Decide a held payment without opening a laptop.' },
          { title: 'Accounting integrations', body: 'Your ledger lands in the books your bookkeeper uses.' },
          { title: 'An API', body: 'Every cockpit action is an endpoint you can call.' },
        ]),
      ]),
      section('Spend limits your team can see', [
        cards([
          { title: 'User-level permissions', body: 'Owners, admins and members each see what they should.' },
          { title: 'Approval rules for large payments', body: 'Over $5,000.00 waits for a second pair of eyes.' },
          { title: 'Customisable card limits', body: 'Set a cap per card, per month or per category.' },
        ]),
      ]),
      section('Transparent pricing', [
        el('div', { class: 'panel-dark' }, [
          el('h3', { text: 'What Tallwind charges' }),
          el('ul', {}, [
            el('li', { text: 'Free checking and savings' }),
            el('li', { text: 'Zero monthly fees' }),
            el('li', { text: 'Free ACH' }),
            el('li', { text: 'Free domestic and USD international wires' }),
            el('li', { text: '1 percent for non-USD international wires' }),
            el('li', { text: 'Free real-time payments' }),
            el('li', { text: 'Free checkbooks and mailed checks' }),
            el('li', { text: '1.5 percent cashback' }),
          ]),
        ]),
      ]),
    ]);
  },
};

export const businessPayments = {
  title: 'Business payments — Tallwind',
  tint: 'tint-sand',
  render() {
    return marketingPage([
      hero({
        title: 'Pay anyone, keep the fees',
        lede: "Most domestic Tallwind payments reach the recipient's bank by the next business day.",
      }),
      section('Fees and speed', [
        dataTable(
          ['Method', 'Fee', 'Speed'],
          [
            ['Real-time payments', '$0', 'Instant'],
            ['ACH', '$0', '0 to 1 business days'],
            ['Domestic wires', '$0', '0 to 1 business days'],
            ['Checkbooks', '$0', 'N/A'],
            ['Mailed checks', '$0', '7 to 14 business days'],
            ['USD international wires', '$0', '1 to 3 business days'],
          ]
        ),
        el('p', {
          class: 'hint',
          text:
            'ACH sent before 4 p.m. and wires sent before 5 p.m. New York time on a business day settle the same day; real-time payments settle every day of the year.',
        }),
        el('p', {
          class: 'hint',
          text: 'Payments that need approval wait five business days for a decision before they expire.',
        }),
      ]),
      section('Global payments', [
        cards([
          { title: '1 percent fee', body: 'For non-USD international wires.' },
          { title: '$0', body: 'For USD international wires.' },
          { title: '40+ local currencies', body: 'Pay in the currency your supplier bills in.' },
          { title: '200+ countries and regions', body: 'Wherever your suppliers are.' },
        ]),
      ]),
      faq('Payment questions, answered', [
        ['Do ACH and domestic wires cost anything?', 'No. Every USD payment method on Tallwind costs $0, including same-day wires.'],
        ['When does a payment settle?', 'The server stamps a settlement date from its method’s cutoff in New York, and the form shows that date before you send.'],
        ['What happens to a large payment?', 'A payment over $5,000.00 holds its money and waits for an approver for five business days.'],
      ]),
    ]);
  },
};

export const credit = {
  title: 'Lift Card — Tallwind',
  tint: 'tint-violet',
  render() {
    return marketingPage([
      hero({
        title: 'A card that grows with your balance',
        lede: 'The Lift Card gives your team spend power that scales with the cash you hold.',
      }),
      section('From first hire to fiftieth', [
        cards([
          { title: '1.5 percent cashback on all spend', body: 'Credited every month, with no categories to track.' },
          { title: 'Limits that scale with the balance', body: 'Your limit follows the cash in your accounts.' },
          { title: 'Build business credit', body: 'Reported in your company’s name.' },
          { title: 'No personal guarantee', body: 'Your house is not collateral.' },
        ]),
      ]),
      faq('Card questions, answered', [
        ['How is my limit set?', 'Your limit follows the balance across your Tallwind accounts, recalculated each day.'],
        ['Can I issue virtual cards?', 'Yes. Create a virtual Lift Card with its own limit in a few seconds.'],
      ]),
    ]);
  },
};

export const treasury = {
  title: 'Treasury — Tallwind',
  render() {
    return marketingPage([
      hero({
        title: 'Put idle cash to work and keep it within reach.',
        lede: 'Earn up to 3.75% on balances from $250K, with same-day access to most of it.',
      }),
      section('Rates by balance tier', [
        dataTable(
          ['Balance', 'Same-day liquidity', '1 to 2 day liquidity'],
          [
            ['$250K to $2M', '3.30%', '3.45%'],
            ['$2M to $5M', '3.40%', '3.55%'],
            ['$5M to $10M', '3.50%', '3.62%'],
            ['$10M to $20M', '3.60%', '3.70%'],
            ['$20M to $50M', '3.75%', '3.80%'],
          ]
        ),
        el('p', {
          class: 'hint',
          text: 'Above $25M we build a personalised portfolio with your treasury team.',
        }),
      ]),
    ]);
  },
};

export const invoicing = {
  title: 'Invoicing — Tallwind',
  render() {
    return marketingPage([
      hero({
        title: 'Invoices that land in the right account',
        lede:
          'Bill customers, see who has paid and settle each invoice into the account you choose, without leaving the cockpit.',
      }),
      section('However your customers pay', [
        cards([
          { title: 'Card', body: 'Visa, Mastercard and Amex.' },
          { title: 'Apple Pay', body: 'One tap on a phone.' },
          { title: 'Google Pay', body: 'One tap on a phone.' },
          { title: 'Wire', body: 'Domestic and USD international.' },
          { title: 'ACH transfer', body: 'Pushed from your customer’s bank.' },
          { title: 'ACH debit', body: 'Pulled on the date you agree.' },
        ]),
      ]),
      section('Recurring invoicing and reminders', [
        el('p', { text: 'Set an invoice to repeat, and Tallwind chases it politely until it is paid.' }),
        el('p', { class: 'hint', text: 'Unlimited invoicing is free on every plan.' }),
      ]),
    ]);
  },
};

export const spendManagement = {
  title: 'Spend management — Tallwind',
  tint: 'tint-sand',
  render() {
    const budgets = [
      { title: 'Work meals', cap: '$1,200.00', spent: '$740.25', remaining: '$459.75', reset: 'Resets 1 Nov' },
      { title: 'Office equipment', cap: '$4,000.00', spent: '$2,145.00', remaining: '$1,855.00', reset: 'Resets 1 Nov' },
      { title: 'Wellness', cap: '$600.00', spent: '$180.00', remaining: '$420.00', reset: 'Resets 1 Nov' },
      { title: 'Business travel', cap: '$9,500.00', spent: '$6,320.40', remaining: '$3,179.60', reset: 'Resets 1 Nov' },
    ];
    return marketingPage([
      hero({
        title: 'Budgets your cards already know',
        lede:
          'Set a cap once, and every card swipe, reimbursement and receipt counts against it as it happens.',
      }),
      section('Four budgets, always current', [
        el(
          'div',
          { class: 'grid-2' },
          budgets.map((budget) =>
            el('div', { class: 'card budget-card' }, [
              el('h3', { text: budget.title }),
              el('strong', { class: 'mono', text: budget.cap }),
              el('p', { class: 'mono', text: `Spent ${budget.spent}` }),
              el('p', { class: 'mono', text: `Remaining ${budget.remaining}` }),
              el('p', { class: 'hint', text: budget.reset }),
            ])
          )
        ),
      ]),
    ]);
  },
};

export const payroll = {
  title: 'Payroll — Tallwind',
  render() {
    return marketingPage([
      hero({
        title: 'Payroll that runs from your checking account',
        lede: 'Pay day funds itself from the account you already watch.',
        email: false,
        actions: [
          el('a', { class: 'pill', href: '/contact', text: 'Contact sales' }),
          el('a', { class: 'btn btn-secondary', href: '/signup', text: 'Open account' }),
        ],
      }),
      section('Onboarding checklist', [
        featureList([
          { title: 'Offer letter', state: 'Signed' },
          { title: 'Personal details', state: 'Done' },
          { title: 'Direct deposit', state: 'In progress' },
          { title: 'Tax withholding', state: 'Upcoming' },
          { title: 'I-9 verification', state: 'Upcoming' },
        ]),
      ]),
    ]);
  },
};

export const books = {
  title: 'Books — Tallwind',
  render() {
    return marketingPage([
      hero({
        title: 'Bookkeeping that reads straight from your ledger',
        lede: 'No imports, no spreadsheets: your books read the same rows your cockpit shows.',
        email: false,
        actions: [el('a', { class: 'pill', href: '/signup', text: 'Open account' })],
      }),
      section('Pricing', [el('p', { class: 'plan-price', text: '$35/mo.' }), el('p', { text: 'Tallwind Books, billed monthly.' })]),
      faq('Books questions, answered', [
        ['What is Tallwind Books?', 'Bookkeeping that reads straight from your Tallwind ledger, with a bookkeeper reviewing each month.'],
        ['Can my accountant use it?', 'Yes. Download a monthly statement for any account, or give your accountant their own member sign-in.'],
      ]),
    ]);
  },
};

export const ventureDebt = {
  title: 'Venture debt — Tallwind',
  render() {
    return marketingPage([
      hero({
        title: 'More months of runway, drawn when you need them',
        lede: 'A venture line that sits beside your checking account, drawn to the cent.',
        email: false,
        actions: [
          el('a', { class: 'pill', href: '/contact', text: 'Check eligibility' }),
          el('a', { class: 'btn btn-secondary', href: '/contact', text: 'Contact sales' }),
        ],
      }),
      section('How a draw works', [
        cards([
          { title: 'Draw to the cent', body: 'Request any amount up to your remaining credit.' },
          { title: 'Funds land at once', body: 'The credit appears in your funding account immediately.' },
          { title: 'Never twice', body: 'A lost answer is replayed, never drawn again.' },
        ]),
      ]),
    ]);
  },
};

export const workingCapitalLoans = {
  title: 'Working capital loans — Tallwind',
  render() {
    return marketingPage([
      hero({
        title: 'Inventory money for online sellers',
        lede: 'Borrow against the orders you have already won.',
        email: false,
        actions: [el('a', { class: 'pill', href: '/contact', text: 'Check eligibility' })],
      }),
      section('Built for stock that moves', [
        cards([
          { title: 'Repay as you sell', body: 'Payments follow your sales, not the calendar.' },
          { title: 'No warehouse paperwork', body: 'We read the orders in your ledger.' },
          { title: 'One screen', body: 'Your line sits beside your accounts.' },
        ]),
      ]),
    ]);
  },
};
