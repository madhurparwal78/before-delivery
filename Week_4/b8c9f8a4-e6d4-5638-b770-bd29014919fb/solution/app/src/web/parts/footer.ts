// The car file link footer closes every screen: four ruled columns on a saturated navy, which
// become accordion rows on a phone.

import { el, on } from '../dom.js';

interface Column {
  head: string;
  links: { label: string; href: string }[];
}

const COLUMNS: Column[] = [
  {
    head: 'The car file',
    links: [
      { label: 'Walkround', href: '#walkround' },
      { label: 'Test record', href: '#record' },
      { label: 'Gauge readings', href: '#gauge' },
      { label: 'Viewings', href: '#viewings' },
    ],
  },
  {
    head: 'Selling honestly',
    links: [
      { label: 'Every finding listed', href: '#walkround' },
      { label: 'Readings beside each panel', href: '#gauge' },
      { label: 'Advisories answered', href: '#record' },
      { label: 'A dated record of what you saw', href: '#walkround' },
    ],
  },
  {
    head: 'Viewing the car',
    links: [
      { label: 'Claim a viewing slot', href: '#viewings' },
      { label: 'Make an offer', href: '#offer' },
      { label: 'Bring an inspector', href: '#record' },
    ],
  },
  {
    head: 'Ostler Lane',
    links: [
      { label: 'One owner, one car at a time', href: '#story' },
      { label: 'No fees, no premium', href: '#offer' },
      { label: 'Private sale, plainly put', href: '#story' },
    ],
  },
];

export function carFileFooter(): HTMLElement {
  const columns = COLUMNS.map((column) => {
    const list = el('ul', { class: 'footer-links' },
      column.links.map((link) => el('li', {}, [el('a', { href: link.href }, [link.label])])));
    const head = el('button', { type: 'button', class: 'footer-head', 'aria-expanded': 'false' }, [
      el('span', {}, [column.head]),
      el('span', { class: 'footer-plus', 'aria-hidden': 'true' }, ['+']),
    ]);
    const block = el('div', { class: 'footer-column' }, [head, list]);
    on(head, 'click', () => {
      const open = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
      block.classList.toggle('is-open', !open);
    });
    return block;
  });

  return el('footer', { class: 'car-file-footer' }, [
    el('div', { class: 'footer-grid' }, columns),
    el('div', { class: 'footer-legal' }, [
      el('p', {}, ['Open Bonnet — one car, every finding, in the open.']),
      el('p', {}, ['A private sale. The car is sold as described, not as a trade warranty.']),
    ]),
  ]);
}
