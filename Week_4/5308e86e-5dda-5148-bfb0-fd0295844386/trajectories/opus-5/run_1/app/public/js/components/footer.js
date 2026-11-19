import { el } from '../dom.js';

const GROUPS = [
  {
    title: 'Banking',
    links: [
      ['Business Checking and Savings', '/business-banking'],
      ['Treasury', '/treasury'],
      ['Business Credit Cards', '/credit'],
      ['Working Capital Loans', '/working-capital-loans'],
      ['Venture Debt', '/venture-debt'],
    ],
  },
  {
    title: 'Platform',
    links: [
      ['Pricing', '/pricing'],
      ['API', '/business-banking'],
      ['Security', '/business-banking'],
      ['Status', '/business-banking'],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['Help Center', '/contact'],
      ['Blog', '/books'],
      ['Events', '/contact'],
    ],
  },
  {
    title: 'Finance Ops',
    links: [
      ['Payments', '/business-payments'],
      ['Bill Pay', '/business-payments'],
      ['Invoicing', '/invoicing'],
      ['Spend Management', '/spend-management'],
    ],
  },
];

export const DISCLAIMER =
  'Tallwind Labs builds the software. Your deposits are held by our partner banks, Harbor Financial and Keystone N.A., each a Member FDIC.';

export function footer() {
  return el('footer', { class: 'site-footer', role: 'contentinfo' }, [
    el('div', { class: 'wrap' }, [
      el(
        'div',
        { class: 'footer-groups' },
        GROUPS.map((group) =>
          el('div', {}, [
            el('h2', { text: group.title }),
            el(
              'ul',
              {},
              group.links.map(([label, href]) => el('li', {}, [el('a', { href, text: label })]))
            ),
          ])
        )
      ),
      el('p', { class: 'disclaimer', text: DISCLAIMER }),
    ]),
  ]);
}
