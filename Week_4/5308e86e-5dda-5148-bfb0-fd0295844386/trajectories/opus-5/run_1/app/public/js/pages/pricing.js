import { el, prefersReducedMotion } from '../dom.js';
import * as api from '../api.js';
import * as router from '../router.js';
import { announce } from '../status.js';
import { centsToDollars } from '../format.js';
import { marketingPage, hero, section, cards } from './layout.js';

const PLAN_LABELS = {
  base: { name: 'Tallwind', purpose: 'banking and finance essentials' },
  plus: { name: 'Tallwind Plus', purpose: 'more efficiencies and streamlined invoicing' },
  pro: { name: 'Tallwind Pro', purpose: 'complex operations with a relationship manager' },
};

const PUBLISHED = [
  { name: 'base', monthly_cents: 0, annual_cents: 0 },
  { name: 'plus', monthly_cents: 2390, annual_cents: 29590 },
  { name: 'pro', monthly_cents: 34990, annual_cents: 239990 },
];

const SECTIONS = [
  ['Banking', 'Free checking and savings, with every balance exact to the cent.'],
  ['Sending and receiving money', 'ACH, wire, real-time payments and checks, all at $0.'],
  ['Access to Treasury', 'Up to 3.75% on idle cash, with same-day access to most of it.'],
  ['Company cards', 'Virtual and physical Lift Cards with 1.5 percent cashback.'],
  ['Expense management', 'Budgets, receipts and approvals in one place.'],
  ['Invoicing', 'Unlimited invoices, settled into the account you choose.'],
  ['Bill pay', 'Schedule bills around Federal Reserve holidays.'],
  ['Accounting', 'Monthly statements your bookkeeper can open.'],
  ['Taxes', 'Clean records for the year end, with an audit trail.'],
];

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function priceText(cents, annual) {
  const figure = Number(cents) === 0 ? '$0' : `$${centsToDollars(cents)}`;
  return annual ? figure : `${figure}/mo.`;
}

export const pricing = {
  title: 'Plans and pricing — Tallwind',
  async render(context) {
    const answer = await api.get('/api/plans', { authenticated: false });
    const plans = answer.json && answer.json.plans ? answer.json.plans : PUBLISHED;
    const ordered = ['base', 'plus', 'pro'].map((name) => plans.find((plan) => plan.name === name) || PUBLISHED.find((plan) => plan.name === name));

    let annual = context.query.get('billing') === 'annual';
    if (context.query.get('billing') !== null && context.query.get('billing') !== 'annual') {
      // An unknown value is removed in place, with no history entry.
      router.setAddress('/pricing', { replace: true });
    }

    const toggle = el('input', {
      type: 'checkbox',
      id: 'annual-toggle',
      role: 'switch',
      checked: annual,
    });
    const jumpLinks = SECTIONS.map(([title]) =>
      el('li', {}, [el('a', { href: `/pricing${annual ? '?billing=annual' : ''}#${slug(title)}`, text: title })])
    );

    const priceNodes = new Map();
    const planCards = ordered.map((plan) => {
      const label = PLAN_LABELS[plan.name];
      const price = el('p', { class: 'plan-price', text: priceText(annual ? plan.annual_cents : plan.monthly_cents, annual) });
      priceNodes.set(plan.name, { node: price, plan });
      return el('div', { class: 'card', dataset: { plan: plan.name } }, [
        el('h3', { text: label.name }),
        price,
        el('p', { text: `For ${label.purpose}.` }),
        el('a', { class: plan.name === 'base' ? 'btn btn-secondary' : 'pill', href: '/signup', text: plan.name === 'base' ? 'Open account' : `Choose ${label.name}` }),
      ]);
    });

    function paintPrices() {
      for (const { node, plan } of priceNodes.values()) {
        node.textContent = priceText(annual ? plan.annual_cents : plan.monthly_cents, annual);
      }
      for (const link of jumpLinks) {
        const anchor = link.querySelector('a');
        const hash = anchor.getAttribute('href').split('#')[1];
        anchor.setAttribute('href', `/pricing${annual ? '?billing=annual' : ''}#${hash}`);
      }
    }

    // Each price counts up as its card enters view.
    function countUp() {
      if (prefersReducedMotion()) return;
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const name = entry.target.dataset.plan;
          const record = priceNodes.get(name);
          const target = annual ? record.plan.annual_cents : record.plan.monthly_cents;
          if (target === 0) continue;
          const started = performance.now();
          const step = (now) => {
            const progress = Math.min(1, (now - started) / 900);
            const value = Math.round(target * progress);
            record.node.textContent = priceText(value, annual);
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      }, { threshold: 0.2 });
      for (const card of planCards) observer.observe(card);
      router.onCleanup(() => observer.disconnect());
    }

    toggle.addEventListener('change', () => {
      annual = toggle.checked;
      paintPrices();
      router.setAddress(annual ? '/pricing?billing=annual' : '/pricing', { replace: false });
      announce(annual ? 'Showing annual prices' : 'Showing monthly prices');
    });

    const node = marketingPage(
      [
        hero({
          title: 'Plans that start at zero',
          lede: 'Core banking costs nothing each month; add Plus or Pro only when your team needs more.',
          email: false,
          legal: false,
          actions: [el('a', { class: 'pill', href: '/signup', text: 'Open account' })],
        }),
        el('div', { class: 'wrap' }, [
          el('div', { class: 'switch-row' }, [
            toggle,
            el('label', { for: 'annual-toggle', text: 'Annual Pricing (15% off)' }),
          ]),
          el('nav', { class: 'jump-list', 'aria-label': 'Jump to section' }, [el('ul', {}, jumpLinks)]),
          el('div', { class: 'plans' }, planCards),
        ]),
        section('Add-ons', [
          cards([
            { title: 'Tallwind Books', body: '$35/mo.' },
            { title: 'Tallwind Payroll', body: '$100/mo. plus $50 per person each month.' },
          ]),
        ]),
        ...SECTIONS.map(([title, body]) => section(title, [el('p', { text: body })], { id: slug(title) })),
      ],
      { status: true }
    );

    requestAnimationFrame(() => {
      announce(annual ? 'Showing annual prices' : 'Showing monthly prices');
      countUp();
    });
    return node;
  },
};
