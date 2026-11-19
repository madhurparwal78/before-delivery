import { el, icon, prefersReducedMotion } from '../dom.js';
import * as router from '../router.js';
import { marketingPage, hero, section, cards, featureList } from './layout.js';

const TOUR_CUES = [
  'Watch every account in one calm view.',
  'Send a payment and see the balance move at once.',
  'Large payments wait for a second approver.',
];

// A rendered still of the cockpit, built from plain markup.
function cockpitStill() {
  const row = (name, amount, direction) =>
    el('div', { class: 'feed-row' }, [
      el('span', { class: 'feed-avatar', 'aria-hidden': 'true', text: name.slice(0, 2).toUpperCase() }),
      el('span', { class: 'feed-main' }, [
        el('span', { class: 'feed-name', text: name }),
        el('span', { class: 'feed-meta' }, [el('span', { class: 'chip', text: 'ACH' }), el('span', { text: 'Oct 27' })]),
      ]),
      el('span', { class: `feed-amount ${direction === 'credit' ? 'amount-credit' : 'amount-debit'} mono`, text: amount }),
    ]);
  return el('div', { class: 'card', style: 'margin:0' }, [
    el('div', { class: 'snapshot-cards cols-2', style: 'margin-bottom:1rem' }, [
      el('div', { class: 'snap-card' }, [
        el('p', { class: 'snap-label', text: 'Total cash' }),
        el('p', { class: 'snap-figure mono', text: '$18,420.50' }),
        el('p', { class: 'snap-available mono', text: 'Available $18,420.50' }),
      ]),
      el('div', { class: 'snap-card' }, [
        el('p', { class: 'snap-label', text: 'Checking' }),
        el('p', { class: 'snap-figure mono', text: '$12,420.50' }),
        el('p', { class: 'snap-available mono', text: 'Available $12,420.50' }),
      ]),
    ]),
    el('div', { class: 'feed' }, [
      row('Brightline Media', '+$4,200.00', 'credit'),
      row('Northwind Supply', '\u2212$1,250.00', 'debit'),
      row('Corner Print Shop', '\u2212$86.40', 'debit'),
    ]),
  ]);
}

// The cover recedes from left to right in step with the scroll position.
function revealSection() {
  const still = cockpitStill();
  const cover = el('div', { class: 'reveal-cover', 'aria-hidden': 'true' });
  const frame = el('div', { class: 'reveal-frame' }, [still, cover]);

  const update = () => {
    const box = frame.getBoundingClientRect();
    const start = window.innerHeight;
    const finish = window.innerHeight / 2;
    const progress = Math.min(1, Math.max(0, (start - box.top) / Math.max(1, start - finish)));
    cover.style.transform = `scaleX(${1 - progress})`;
  };

  if (prefersReducedMotion()) {
    cover.style.display = 'none';
  } else {
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    router.onCleanup(() => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    });
    requestAnimationFrame(update);
  }

  return el('section', { class: 'section reveal-section' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'section-head' }, [el('h2', { text: 'One ledger for the whole company.' })]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [
          featureList([
            { title: 'Accounts and treasury', body: 'Earn up to 3.75% on idle cash without locking it away.' },
            { title: 'Lift Card and spend controls', body: '1.5 percent cashback on every swipe, with limits your team can see.' },
            { title: 'Payments and invoicing', body: 'No fees on USD payments, and each invoice settles into the account you choose.' },
            { title: 'Books and reconciliation', body: 'Receipts and categories land beside the ledger they belong to.' },
          ]),
        ]),
        frame,
      ]),
    ]),
  ]);
}

function productTour() {
  const transcript = el('div', { hidden: true }, [
    el('h3', { text: 'Product tour transcript' }),
    el('ul', {}, TOUR_CUES.map((cue) => el('li', { text: cue }))),
  ]);
  const toggle = el('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: 'Show transcript',
    'aria-expanded': 'false',
    onclick: () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      transcript.hidden = open;
    },
  });

  const video = el('video', {
    poster: '/media/tour-poster.svg',
    controls: true,
    preload: 'none',
    'aria-label': 'Tallwind product tour',
    width: '640',
  }, [
    el('track', { kind: 'captions', src: '/media/tour.vtt', srclang: 'en', label: 'English', default: true }),
  ]);

  return section('See Tallwind move money', [
    el('div', { class: 'grid-2' }, [
      el('div', {}, [video]),
      el('div', {}, [
        el('p', { text: 'A captioned walk through the cockpit: balances, a send, and an approval.' }),
        toggle,
        transcript,
      ]),
    ]),
  ]);
}

export const home = {
  title: 'Tallwind — calm banking for companies on the move',
  render() {
    return marketingPage([
      el('div', { class: 'announce-strip' }, [
        el('div', { class: 'wrap', text: 'New: Tallwind Payroll runs pay day from the same account that funds it' }),
      ]),
      hero({
        title: 'Calm banking for companies on the move',
        lede:
          'Open an account in one sitting and see every dollar your company holds, owes and is owed on one quiet screen.',
        actions: [el('a', { class: 'btn btn-quiet', href: '/demo' }, ['Launch demo', icon('arrowRight', { size: 16 })])],
      }),
      revealSection(),
      productTour(),
      section('Chosen by 38,000 small companies that would rather build than reconcile', [
        el('blockquote', { class: 'card' }, [
          el('p', {
            text:
              '“Tallwind replaced four tools with one calm screen; I see every dollar and move it in seconds.”',
          }),
          el('footer', { text: 'Jordan Ames, founder of Fieldstone' }),
        ]),
      ]),
      section('Less admin, more runway.', [
        cards([
          { title: 'Issue a virtual card before the meeting ends', body: 'Create a Lift Card with its own limit in a few seconds.' },
          { title: 'Schedule bills around bank holidays', body: 'Tallwind posts each payment on the next Federal Reserve business day.' },
          { title: 'Settle each invoice into the account you choose', body: 'Mark an invoice paid and watch the credit land.' },
          { title: 'Match receipts as they arrive', body: 'Every receipt sits beside the transaction it belongs to.' },
        ]),
      ]),
      section('Set up in one sitting.', [
        cards([
          { title: 'Open an account without a branch visit', body: 'One form, one sitting, no paperwork in the post.' },
          { title: 'Start spending with a virtual Lift Card the same day', body: 'Your card works the moment the account opens.' },
          { title: 'Find any payment or recipient from the search bar', body: 'Search matches exactly what you type.' },
        ]),
      ]),
      section('Keep more of what you earn.', [
        cards([
          { title: 'No fees on USD payments', body: 'ACH, wires, real-time payments and checks cost $0.' },
          { title: '1.5 percent cashback', body: 'Earned on all Lift Card spend, credited every month.' },
          { title: 'Up to 3.75% on idle cash in Treasury', body: 'Keep same-day access to most of your balance.' },
        ]),
      ]),
      section('Grown-up controls from day one.', [
        cards([
          { title: 'Every account in view', body: 'Balances, held money and feeds on one screen.' },
          { title: 'Rules that move money for you', body: 'Auto-transfers and scheduled payments run themselves.' },
          { title: 'Roles and approvals for your team', body: 'Large payments wait for a second pair of eyes.' },
          { title: 'Pilot for quick answers', body: 'Ask about any figure and get the stored answer.' },
        ]),
      ]),
      section('Trusted with the day-to-day', [
        el('div', { class: 'grid-3' }, [
          el('div', { class: 'card' }, [el('p', { class: 'snap-figure mono', text: '38,000' }), el('p', { text: 'companies' })]),
          el('div', { class: 'card' }, [el('p', { class: 'snap-figure mono', text: '$4B+' }), el('p', { text: 'moved each month' })]),
          el('div', { class: 'card' }, [el('p', { class: 'snap-figure mono', text: '40+' }), el('p', { text: 'currencies for wires' })]),
          el('div', { class: 'card' }, [el('p', { class: 'snap-figure mono', text: '4.8' }), el('p', { text: 'average app rating' })]),
        ]),
      ]),
      section('Security', [
        el('div', { class: 'panel-dark' }, [
          el('h3', { text: 'Deposits are held at our partner banks' }),
          el('p', {
            text:
              'Every sign-in to move money is checked against your team’s roles, and every payment step lands in an audit trail the database itself refuses to edit.',
          }),
        ]),
      ]),
      section('Open an account in one sitting', [
        el('div', { class: 'hero-actions' }, [
          el('a', { class: 'pill', href: '/signup', text: 'Open account' }),
          el('a', { class: 'btn btn-secondary', href: '/contact', text: 'Contact sales' }),
        ]),
      ]),
    ]);
  },
};
